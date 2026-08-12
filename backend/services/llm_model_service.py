"""LLM 模型档案服务：以 data/llm_models.csv 为主存储（一行一个模型，可用 Excel 直接编辑）。

字段：model_id, label, protocol, max_input_tokens, max_output_tokens, reasoning_efforts(分号分隔),
      default_reasoning_effort, thinking_default, context_budget_chars,
      input_price_per_million, output_price_per_million, price_currency, enabled, notes

写入采用「文件锁 + 原子写」（写临时文件再 rename），防止并发损坏。"""
import csv
import json
import logging
import os
import threading
from pathlib import Path

from backend.config import get_llm_config, DATA_DIR

logger = logging.getLogger(__name__)

CSV_PATH = Path(DATA_DIR) / "llm_models.csv"
_FIELDNAMES = [
    "model_id", "label", "provider", "protocol",
    "base_url", "api_key",
    "max_input_tokens", "max_output_tokens",
    "input_price_per_million", "output_price_per_million", "cache_read_price_per_million", "cache_creation_price_per_million", "price_currency",
    "input_points_per_million", "output_points_per_million", "points_per_request",
    "points_per_1k_input", "points_per_1k_output", "points_per_1k_cache_read", "points_per_1k_cache_creation",
    "reasoning_efforts", "default_reasoning_effort", "thinking_default", "context_budget_chars",
    "capabilities", "enabled", "deprecation_date", "source", "notes",
]
_write_lock = threading.RLock()  # 可重入锁：upsert/delete 外层持锁后内部 _write_all 再获取

# 未建档时的兜底档案（与默认行为一致）
FALLBACK_MODEL = {
    "model_id": "",
    "label": "",
    "provider": "",
    "protocol": "openai",
    "base_url": "",
    "api_key": "",
    "max_input_tokens": 1000000,
    "max_output_tokens": 128000,
    "input_price_per_million": None,
    "output_price_per_million": None,
    "cache_read_price_per_million": None,
    "cache_creation_price_per_million": None,
    "price_currency": "usd",
    "input_points_per_million": None,
    "output_points_per_million": None,
    "points_per_request": None,
    "points_per_1k_input": None,
    "points_per_1k_output": None,
    "points_per_1k_cache_read": None,
    "points_per_1k_cache_creation": None,
    "reasoning_efforts": ["auto", "low", "medium", "high", "max", "xhigh"],
    "default_reasoning_effort": "auto",
    "thinking_default": "enabled",
    "context_budget_chars": 256000,
    "capabilities": [],
    "enabled": True,
    "deprecation_date": "",
    "source": "",
    "notes": "",
}


def _to_price(v):
    """价格转 float，空值/非法值返回 None"""
    if v is None or v == '':
        return None
    try:
        return float(v)
    except Exception:
        return None


def _fmt_price(v):
    """价格格式化写入 CSV，空值写空串"""
    return v if v is not None else ""


def _split_semicolon(v: str) -> list[str]:
    if not v:
        return []
    return [x.strip() for x in str(v).replace("，", ";").split(";") if x.strip()]


def _row_to_dict(r: dict) -> dict:
    return {
        "model_id": str(r.get("model_id") or "").strip(),
        "label": str(r.get("label") or "").strip(),
        "provider": str(r.get("provider") or "").strip(),
        "protocol": str(r.get("protocol") or "openai").strip() or "openai",
        "base_url": str(r.get("base_url") or "").strip(),
        "api_key": str(r.get("api_key") or "").strip(),
        "max_input_tokens": max(1024, int(r.get("max_input_tokens") or 1000000)),
        "max_output_tokens": max(1, int(r.get("max_output_tokens") or 128000)),
        "reasoning_efforts": _split_semicolon(r.get("reasoning_efforts")) or ["auto"],
        "default_reasoning_effort": str(r.get("default_reasoning_effort") or "auto"),
        "thinking_default": str(r.get("thinking_default") or "enabled"),
        "context_budget_chars": max(1000, int(r.get("context_budget_chars") or 256000)),
        "input_price_per_million": _to_price(r.get("input_price_per_million")),
        "output_price_per_million": _to_price(r.get("output_price_per_million")),
        "cache_read_price_per_million": _to_price(r.get("cache_read_price_per_million")),
        "cache_creation_price_per_million": _to_price(r.get("cache_creation_price_per_million")),
        "price_currency": str(r.get("price_currency") or "usd").strip() or "usd",
        "input_points_per_million": _to_price(r.get("input_points_per_million")),
        "output_points_per_million": _to_price(r.get("output_points_per_million")),
        "points_per_request": _to_price(r.get("points_per_request")),
        "points_per_1k_input": _to_price(r.get("points_per_1k_input")),
        "points_per_1k_output": _to_price(r.get("points_per_1k_output")),
        "points_per_1k_cache_read": _to_price(r.get("points_per_1k_cache_read")),
        "points_per_1k_cache_creation": _to_price(r.get("points_per_1k_cache_creation")),
        "capabilities": _split_semicolon(r.get("capabilities")),
        "enabled": str(r.get("enabled") or "").strip().lower() in ("1", "true", "yes", "on"),
        "deprecation_date": str(r.get("deprecation_date") or "").strip(),
        "source": str(r.get("source") or "").strip(),
        "notes": str(r.get("notes") or ""),
    }


def _read_all() -> list[dict]:
    if not CSV_PATH.exists():
        return []
    with open(CSV_PATH, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        rows = []
        for r in reader:
            if not (r.get("model_id") or "").strip():
                continue
            try:
                rows.append(_row_to_dict(r))
            except Exception:
                logger.exception("[llm_model] 跳过非法行: %s", r.get("model_id"))
        return rows


def _write_all(rows: list[dict]):
    with _write_lock:
        tmp = CSV_PATH.with_suffix(".csv.tmp")
        with open(tmp, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=_FIELDNAMES)
            w.writeheader()
            for r in rows:
                w.writerow({
                    "model_id": r["model_id"], "label": r["label"], "provider": r.get("provider", ""),
                    "protocol": r["protocol"],
                    "base_url": r.get("base_url", ""), "api_key": r.get("api_key", ""),
                    "max_input_tokens": r["max_input_tokens"], "max_output_tokens": r["max_output_tokens"],
                    "input_price_per_million": _fmt_price(r.get("input_price_per_million")),
                    "output_price_per_million": _fmt_price(r.get("output_price_per_million")),
                    "cache_read_price_per_million": _fmt_price(r.get("cache_read_price_per_million")),
                    "cache_creation_price_per_million": _fmt_price(r.get("cache_creation_price_per_million")),
                    "price_currency": r["price_currency"],
                    "input_points_per_million": _fmt_price(r.get("input_points_per_million")),
                    "output_points_per_million": _fmt_price(r.get("output_points_per_million")),
                    "points_per_request": _fmt_price(r.get("points_per_request")),
                    "points_per_1k_input": _fmt_price(r.get("points_per_1k_input")),
                    "points_per_1k_output": _fmt_price(r.get("points_per_1k_output")),
                    "points_per_1k_cache_read": _fmt_price(r.get("points_per_1k_cache_read")),
                    "points_per_1k_cache_creation": _fmt_price(r.get("points_per_1k_cache_creation")),
                    "reasoning_efforts": ";".join(r["reasoning_efforts"]),
                    "default_reasoning_effort": r["default_reasoning_effort"],
                    "thinking_default": r["thinking_default"],
                    "context_budget_chars": r["context_budget_chars"],
                    "capabilities": ";".join(r.get("capabilities") or []),
                    "enabled": "true" if r["enabled"] else "false",
                    "deprecation_date": r.get("deprecation_date", ""),
                    "source": r.get("source", ""),
                    "notes": r["notes"],
                })
        os.replace(tmp, CSV_PATH)  # 原子替换


def get_all() -> list[dict]:
    return _read_all()


def get_by_model_id(model_id: str) -> dict | None:
    if not model_id:
        return None
    for r in _read_all():
        if r["model_id"] == model_id:
            return r
    return None


def get_active() -> dict:
    """当前激活模型的档案；未建档时返回兜底档案（model_id 填当前配置值）。"""
    llm_cfg = get_llm_config()
    model_id = str(llm_cfg.get("model") or "").strip()
    record = get_by_model_id(model_id)
    if record:
        return record
    fb = dict(FALLBACK_MODEL)
    fb["model_id"] = model_id
    fb["label"] = model_id or "未配置模型"
    base = str(llm_cfg.get("base_url") or "").lower()
    fb["protocol"] = "anthropic" if "anthropic" in base else "openai"
    return fb


def upsert(data: dict) -> dict:
    """新增或更新模型档案。**部分更新语义**：已存在的模型只覆盖 data 中传入的字段，
    未传字段保留原值（避免误伤）；不存在的模型用默认值创建。"""
    model_id = str(data.get("model_id") or "").strip()
    if not model_id:
        raise ValueError("model_id 不能为空")

    with _write_lock:
        rows = _read_all()
        existing = next((r for r in rows if r["model_id"] == model_id), None)
        base = dict(existing) if existing else dict(FALLBACK_MODEL)
        base["model_id"] = model_id

        def _pick(key, fallback=None):
            return data[key] if key in data else (base.get(key, fallback))

        efforts = _pick("reasoning_efforts")
        if efforts is None:
            efforts = ["auto", "low", "medium", "high", "max", "xhigh"]
        if not isinstance(efforts, list) or not efforts:
            raise ValueError("reasoning_efforts 必须是数组")
        efforts = [str(e).strip() for e in efforts if str(e).strip()]
        if not efforts:
            raise ValueError("reasoning_efforts 不能为空")
        default_effort = str(_pick("default_reasoning_effort") or "auto")
        if default_effort not in efforts:
            default_effort = "auto"
            if "auto" not in efforts:
                efforts = ["auto"] + efforts

        new_row = {
            "model_id": model_id,
            "label": str(_pick("label") or model_id),
            "provider": str(_pick("provider") or "").strip(),
            "protocol": str(_pick("protocol") or "openai"),
            "base_url": str(_pick("base_url") or "").strip(),
            "api_key": str(_pick("api_key") or "").strip(),
            "max_input_tokens": max(1024, int(_pick("max_input_tokens") or _pick("context_tokens") or 1000000)),
            "max_output_tokens": max(1, int(_pick("max_output_tokens") or _pick("output_tokens") or 128000)),
            "reasoning_efforts": efforts,
            "default_reasoning_effort": default_effort,
            "thinking_default": str(_pick("thinking_default") or "enabled"),
            "context_budget_chars": max(1000, int(_pick("context_budget_chars") or 256000)),
            "input_price_per_million": _to_price(_pick("input_price_per_million")),
            "output_price_per_million": _to_price(_pick("output_price_per_million")),
            "cache_read_price_per_million": _to_price(_pick("cache_read_price_per_million")),
            "cache_creation_price_per_million": _to_price(_pick("cache_creation_price_per_million")),
            "price_currency": str(_pick("price_currency") or "usd"),
            "input_points_per_million": _to_price(_pick("input_points_per_million")),
            "output_points_per_million": _to_price(_pick("output_points_per_million")),
            "points_per_request": _to_price(_pick("points_per_request")),
            "points_per_1k_input": _to_price(_pick("points_per_1k_input")),
            "points_per_1k_output": _to_price(_pick("points_per_1k_output")),
            "points_per_1k_cache_read": _to_price(_pick("points_per_1k_cache_read")),
            "points_per_1k_cache_creation": _to_price(_pick("points_per_1k_cache_creation")),
            "capabilities": [str(c).strip() for c in (_pick("capabilities") or []) if str(c).strip()],
            "enabled": bool(_pick("enabled", True)),
            "deprecation_date": str(_pick("deprecation_date") or "").strip(),
            "source": str(_pick("source") or "").strip(),
            "notes": str(_pick("notes") or ""),
        }
        if existing:
            for i, r in enumerate(rows):
                if r["model_id"] == model_id:
                    rows[i] = new_row
                    break
        else:
            rows.append(new_row)
        _write_all(rows)
    return dict(new_row)


def delete(model_id: str) -> bool:
    with _write_lock:
        rows = _read_all()
        remaining = [r for r in rows if r["model_id"] != model_id]
        if len(remaining) == len(rows):
            return False
        _write_all(remaining)
    return True
