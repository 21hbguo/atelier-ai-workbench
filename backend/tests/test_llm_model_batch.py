from pathlib import Path

import pytest

from backend.services import llm_model_service as service


def test_add_many_writes_all_models_once(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "CSV_PATH", Path(tmp_path) / "llm_models.csv")

    items = service.add_many([
        {"model_id": "model-a", "label": "Model A", "base_url": "https://example.com/v1", "api_key": "env:TEST_KEY", "reasoning_efforts": ["auto"]},
        {"model_id": "model-b", "label": "Model B", "base_url": "https://example.com/v1", "api_key": "env:TEST_KEY", "reasoning_efforts": ["auto"]},
    ])

    assert [item["model_id"] for item in items] == ["model-a", "model-b"]
    assert [item["model_id"] for item in service.get_all()] == ["model-a", "model-b"]


def test_add_many_rejects_existing_models_without_partial_write(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "CSV_PATH", Path(tmp_path) / "llm_models.csv")
    service.upsert({"model_id": "existing", "reasoning_efforts": ["auto"]})

    with pytest.raises(ValueError, match="模型档案已存在：existing"):
        service.add_many([
            {"model_id": "new-model", "reasoning_efforts": ["auto"]},
            {"model_id": "existing", "reasoning_efforts": ["auto"]},
        ])

    assert [item["model_id"] for item in service.get_all()] == ["existing"]


def test_update_many_changes_only_requested_fields(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "CSV_PATH", Path(tmp_path) / "llm_models.csv")
    service.add_many([
        {"model_id": "model-a", "label": "Model A", "provider": "old", "base_url": "https://old.example.com", "reasoning_efforts": ["auto"]},
        {"model_id": "model-b", "label": "Model B", "provider": "old", "base_url": "https://old.example.com", "reasoning_efforts": ["auto"]},
    ])

    service.update_many(["model-a", "model-b"], {"base_url": "https://new.example.com", "api_key": "env:NEW_KEY"})

    assert [(item["model_id"], item["label"], item["provider"], item["base_url"], item["api_key"]) for item in service.get_all()] == [
        ("model-a", "Model A", "old", "https://new.example.com", "env:NEW_KEY"),
        ("model-b", "Model B", "old", "https://new.example.com", "env:NEW_KEY"),
    ]


def test_upsert_rename_changes_model_id(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "CSV_PATH", Path(tmp_path) / "llm_models.csv")
    service.upsert({
        "model_id": "old", "label": "Old Model", "provider": "provider-x",
        "base_url": "https://old.example.com/v1", "api_key": "env:KEY",
        "max_input_tokens": 200000, "reasoning_efforts": ["auto", "high"],
        "notes": "keep me",
    })

    result = service.upsert({"model_id": "new", "original_model_id": "old", "label": "新名"})

    rows = service.get_all()
    assert [r["model_id"] for r in rows] == ["new"]  # 原位置、无旧 id 行
    assert result["model_id"] == "new"
    assert result["label"] == "新名"
    # 未覆盖字段保留原值
    assert result["provider"] == "provider-x"
    assert result["base_url"] == "https://old.example.com/v1"
    assert result["api_key"] == "env:KEY"
    assert result["max_input_tokens"] == 200000
    assert result["reasoning_efforts"] == ["auto", "high"]
    assert result["notes"] == "keep me"
    assert not any(r["model_id"] == "old" for r in rows)
    # original_model_id 是控制字段，绝不能写进 CSV
    raw = Path(tmp_path / "llm_models.csv").read_text(encoding="utf-8-sig")
    assert "original_model_id" not in raw


def test_upsert_original_equals_model_id_keeps_behavior(tmp_path, monkeypatch):
    """编辑未改名（original_model_id == model_id）时走更新路径，不新增行。"""
    monkeypatch.setattr(service, "CSV_PATH", Path(tmp_path) / "llm_models.csv")
    service.upsert({"model_id": "old", "label": "A", "reasoning_efforts": ["auto"]})

    service.upsert({"model_id": "old", "original_model_id": "old", "label": "B"})

    rows = service.get_all()
    assert len(rows) == 1
    assert rows[0]["model_id"] == "old"
    assert rows[0]["label"] == "B"
    assert rows[0]["reasoning_efforts"] == ["auto"]


def test_upsert_rename_conflict_rejected(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "CSV_PATH", Path(tmp_path) / "llm_models.csv")
    service.upsert({"model_id": "old", "label": "Old", "reasoning_efforts": ["auto"]})
    service.upsert({"model_id": "taken", "label": "Taken", "reasoning_efforts": ["auto"]})

    with pytest.raises(ValueError, match="已存在"):
        service.upsert({"model_id": "taken", "original_model_id": "old", "label": "改名"})

    # CSV 不变
    rows = service.get_all()
    assert sorted(r["model_id"] for r in rows) == ["old", "taken"]
    assert {r["model_id"]: r["label"] for r in rows} == {"old": "Old", "taken": "Taken"}


def test_upsert_rename_unknown_original_rejected(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "CSV_PATH", Path(tmp_path) / "llm_models.csv")

    with pytest.raises(ValueError, match="原模型"):
        service.upsert({"model_id": "new", "original_model_id": "ghost"})

    assert service.get_all() == []


def test_upsert_without_original_keeps_existing_behavior(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "CSV_PATH", Path(tmp_path) / "llm_models.csv")
    service.upsert({"model_id": "old", "label": "A", "reasoning_efforts": ["auto"]})

    service.upsert({"model_id": "old", "label": "B"})

    rows = service.get_all()
    assert len(rows) == 1  # 更新而不是新增
    assert rows[0]["model_id"] == "old"
    assert rows[0]["label"] == "B"  # 部分更新语义保留
    assert rows[0]["reasoning_efforts"] == ["auto"]
