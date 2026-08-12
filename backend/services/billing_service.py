from __future__ import annotations

import json
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP

from backend.config import get_billing_config
from backend.database import get_db


def _decimal(value, default="0") -> Decimal:
    try:
        return Decimal(str(value if value is not None else default))
    except Exception:
        return Decimal(default)


def _round4(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


class BillingService:
    @staticmethod
    def calculate_rmb_prices(model_cfg: dict | None, config: dict | None = None) -> dict:
        cfg = model_cfg or {}
        billing = config or get_billing_config()
        currency = str(cfg.get("price_currency") or "usd").lower()
        fx_rate = _decimal(billing.get("usd_cny_fx_rate", 7.2))
        markup = _decimal(billing.get("platform_markup", 1))

        def price(field: str) -> Decimal | None:
            raw = cfg.get(field)
            if raw is None or raw == "":
                return None
            value = _decimal(raw)
            if currency == "usd":
                value *= fx_rate
            return _round4(value * markup)

        return {
            "input": price("input_price_per_million"),
            "output": price("output_price_per_million"),
            "cache_read": price("cache_read_price_per_million"),
            "cache_creation": price("cache_creation_price_per_million"),
            "currency": currency,
            "usd_cny_fx_rate": fx_rate,
            "platform_markup": markup,
        }

    @staticmethod
    def build_price_snapshot(model_cfg: dict | None, version_id=None, config: dict | None = None) -> dict:
        billing = config or get_billing_config()
        rmb = BillingService.calculate_rmb_prices(model_cfg, billing)
        points_per_rmb = _decimal(billing.get("points_per_rmb", 100))

        def points(value: Decimal | None) -> Decimal | None:
            return _round4(value * points_per_rmb / Decimal(1000)) if value is not None else None

        return {
            "model_id": (model_cfg or {}).get("model_id") or "",
            "pricing_version_id": version_id,
            "source_currency": rmb["currency"],
            "usd_cny_fx_rate": str(rmb["usd_cny_fx_rate"]),
            "platform_markup": str(rmb["platform_markup"]),
            "points_per_rmb": str(points_per_rmb),
            "rmb_per_million": {
                "input": str(rmb["input"]) if rmb["input"] is not None else None,
                "output": str(rmb["output"]) if rmb["output"] is not None else None,
                "cache_read": str(rmb["cache_read"]) if rmb["cache_read"] is not None else None,
                "cache_creation": str(rmb["cache_creation"]) if rmb["cache_creation"] is not None else None,
            },
            "points_per_1k": {
                "input": str(points(rmb["input"])) if rmb["input"] is not None else None,
                "output": str(points(rmb["output"])) if rmb["output"] is not None else None,
                "cache_read": str(points(rmb["cache_read"])) if rmb["cache_read"] is not None else None,
                "cache_creation": str(points(rmb["cache_creation"])) if rmb["cache_creation"] is not None else None,
            },
        }

    @staticmethod
    def get_model_price_snapshot(model_cfg: dict | None) -> dict:
        model_id = (model_cfg or {}).get("model_id") or ""
        if model_id:
            with get_db() as conn:
                row = conn.execute(
                    "SELECT id, snapshot FROM model_price_versions WHERE model_id = %s ORDER BY effective_at DESC, id DESC LIMIT 1",
                    (model_id,),
                ).fetchone()
            if row:
                snapshot = dict(row["snapshot"] or {})
                snapshot["pricing_version_id"] = row["id"]
                return snapshot
        return BillingService.build_price_snapshot(model_cfg)

    @staticmethod
    def calculate_cost_points(usage: dict | None, price_snapshot: dict | None, fallback: Decimal | None = None) -> tuple[Decimal, str]:
        if usage is None or not price_snapshot:
            return _decimal(fallback or 0), "per_request"
        unit = price_snapshot.get("points_per_1k") or {}
        if not any(unit.get(key) is not None for key in ("input", "output", "cache_read", "cache_creation")):
            return _decimal(fallback or 0), "per_request"
        keys = (
            ("input_tokens", "input"),
            ("output_tokens", "output"),
            ("cache_read_tokens", "cache_read"),
            ("cache_creation_tokens", "cache_creation"),
        )
        total = Decimal(0)
        for usage_key, price_key in keys:
            total += _decimal(usage.get(usage_key)) * _decimal(unit.get(price_key)) / Decimal(1000)
        return _round4(total), "token"

    @staticmethod
    def charge_points(cost_points: Decimal, config: dict | None = None) -> Decimal:
        return _round4(max(Decimal(0), _decimal(cost_points)))

    @staticmethod
    def create_price_version(model_cfg: dict, admin_id: int, overrides: dict | None = None) -> dict:
        data = dict(model_cfg or {})
        for key, value in (overrides or {}).items():
            if value is not None:
                data[key] = value
        snapshot = BillingService.build_price_snapshot(data)
        with get_db() as conn:
            row = conn.execute(
                """INSERT INTO model_price_versions
                   (model_id, source_currency, input_price_per_million, output_price_per_million,
                    cache_read_price_per_million, cache_creation_price_per_million,
                    usd_cny_fx_rate, platform_markup, points_per_rmb,
                    rmb_input_price_per_million, rmb_output_price_per_million,
                    rmb_cache_read_price_per_million, rmb_cache_creation_price_per_million,
                    points_per_1k_input, points_per_1k_output, points_per_1k_cache_read,
                    points_per_1k_cache_creation, snapshot, created_by)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   RETURNING id, effective_at""",
                (
                    data.get("model_id"),
                    str(data.get("price_currency") or "usd").lower(),
                    data.get("input_price_per_million"), data.get("output_price_per_million"),
                    data.get("cache_read_price_per_million"), data.get("cache_creation_price_per_million"),
                    snapshot["usd_cny_fx_rate"], snapshot["platform_markup"], snapshot["points_per_rmb"],
                    snapshot["rmb_per_million"]["input"], snapshot["rmb_per_million"]["output"],
                    snapshot["rmb_per_million"]["cache_read"], snapshot["rmb_per_million"]["cache_creation"],
                    snapshot["points_per_1k"]["input"], snapshot["points_per_1k"]["output"],
                    snapshot["points_per_1k"]["cache_read"], snapshot["points_per_1k"]["cache_creation"],
                    json.dumps(snapshot, ensure_ascii=False), admin_id,
                ),
            ).fetchone()
        snapshot["pricing_version_id"] = row["id"]
        snapshot["effective_at"] = row["effective_at"].isoformat() if row and row.get("effective_at") else None
        return snapshot
