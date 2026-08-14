"""admin 层 LLM 模型改名引用检查测试：_collect_llm_model_rename_refs 容错与结构、路由返回契约。"""
import asyncio
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

import backend.routers.admin as admin_module
from backend.routers.admin import _collect_llm_model_rename_refs
from backend.services import llm_model_service as service


def _run(coro):
    return asyncio.run(coro)


def _mock_get_db(conn):
    db = MagicMock(name="get_db")
    db.__enter__ = MagicMock(return_value=conn)
    db.__exit__ = MagicMock(return_value=False)
    return patch.object(admin_module, "get_db", return_value=db)


def _conn_with(plans=None, price_count=None, error=None):
    conn = MagicMock(name="db_conn")

    def _side(sql, *params):
        if error:
            raise error
        cur = MagicMock(name="cur")
        s = str(sql)
        if "FROM subscription_plans" in s:
            cur.fetchall.return_value = plans if plans is not None else []
        elif "FROM model_price_versions" in s:
            cur.fetchone.return_value = {"cnt": price_count if price_count is not None else 0}
        return cur

    conn.execute.side_effect = _side
    return conn


# ---------------------------------------------------------------------------
# _collect_llm_model_rename_refs
# ---------------------------------------------------------------------------

def test_collect_refs_all_references_found():
    conn = _conn_with(
        plans=[
            {"code": "pro", "name": "专业版", "allowed_models": ["gpt-5.5", "old-model"]},
            {"code": "basic", "name": "基础版", "allowed_models": ["gpt-5.5"]},
            {"code": "broken", "name": "畸形", "allowed_models": None},
        ],
        price_count=3,
    )
    with _mock_get_db(conn), patch("backend.config.get_llm_config", return_value={"model": "old-model"}):
        refs = _collect_llm_model_rename_refs("old-model")

    assert refs == {
        "plans": [{"code": "pro", "name": "专业版"}],  # 含旧 id 的套餐；不含旧 id 与畸形数据被跳过
        "is_global_default": True,
        "price_version_count": 3,
    }


def test_collect_refs_none_found():
    conn = _conn_with(plans=[{"code": "pro", "name": "专业版", "allowed_models": ["gpt-5.5"]}], price_count=0)
    with _mock_get_db(conn), patch("backend.config.get_llm_config", return_value={"model": "other"}):
        refs = _collect_llm_model_rename_refs("old-model")

    assert refs == {"plans": [], "is_global_default": False, "price_version_count": 0}


def test_collect_refs_db_and_config_errors_fall_back_safe_defaults():
    """任一查询失败都容错降级，绝不影响改名。"""
    conn = _conn_with(error=RuntimeError("db down"))
    with _mock_get_db(conn), patch("backend.config.get_llm_config", side_effect=Exception("no config")):
        refs = _collect_llm_model_rename_refs("ghost")

    assert refs == {"plans": [], "is_global_default": False, "price_version_count": 0}


# ---------------------------------------------------------------------------
# admin_upsert_llm_model 路由返回契约
# ---------------------------------------------------------------------------

def test_admin_upsert_rename_returns_bare_dict_with_rename_refs(tmp_path, monkeypatch):
    """改名：返回裸模型 dict + 顶层 rename_refs（不包裹 item，兼容既有调用方）。"""
    monkeypatch.setattr(service, "CSV_PATH", Path(tmp_path) / "llm_models.csv")
    service.upsert({"model_id": "old", "label": "Old", "reasoning_efforts": ["auto"]})

    conn = _conn_with(plans=[{"code": "pro", "name": "专业版", "allowed_models": ["old"]}], price_count=1)
    with _mock_get_db(conn), patch("backend.config.get_llm_config", return_value={"model": "old"}):
        resp = _run(admin_module.admin_upsert_llm_model(
            {"model_id": "new", "original_model_id": "old", "label": "New"}, admin=None,
        ))

    assert resp["model_id"] == "new"
    assert resp["label"] == "New"
    assert resp["rename_refs"] == {
        "plans": [{"code": "pro", "name": "专业版"}],
        "is_global_default": True,
        "price_version_count": 1,
    }
    assert [r["model_id"] for r in service.get_all()] == ["new"]


def test_admin_upsert_no_rename_keeps_bare_dict_contract(tmp_path, monkeypatch):
    """非改名：返回裸模型 dict，与原契约完全一致（无 rename_refs 键）。"""
    monkeypatch.setattr(service, "CSV_PATH", Path(tmp_path) / "llm_models.csv")

    resp = _run(admin_module.admin_upsert_llm_model(
        {"model_id": "fresh", "label": "Fresh", "reasoning_efforts": ["auto"]}, admin=None,
    ))

    assert resp["model_id"] == "fresh"
    assert resp["label"] == "Fresh"
    # 裸 dict 契约：无 item 包裹、无 rename_refs 键
    assert "rename_refs" not in resp
    assert "item" not in resp


def test_admin_upsert_rename_conflict_returns_400(tmp_path, monkeypatch):
    """改名冲突（新 id 已存在）→ 400，且不做引用查询（先 upsert 后收集）。"""
    monkeypatch.setattr(service, "CSV_PATH", Path(tmp_path) / "llm_models.csv")
    service.upsert({"model_id": "old", "label": "Old", "reasoning_efforts": ["auto"]})
    service.upsert({"model_id": "taken", "label": "Taken", "reasoning_efforts": ["auto"]})

    conn = _conn_with()
    with _mock_get_db(conn):
        with pytest.raises(HTTPException) as ei:
            _run(admin_module.admin_upsert_llm_model(
                {"model_id": "taken", "original_model_id": "old", "label": "X"}, admin=None,
            ))
    assert ei.value.status_code == 400
    assert "已存在" in ei.value.detail
    # 改名失败：引用查询不应执行（get_db 未被调用）
    conn.execute.assert_not_called()
