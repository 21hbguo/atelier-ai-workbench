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
