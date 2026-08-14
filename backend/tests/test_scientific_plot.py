"""scientific_plot 受控科研作图工具测试。"""
import asyncio

import pytest

from backend import config
from backend.services.agent.context import AgentContext
from backend.services.agent.registry import get_tool
from backend.services.agent.tools.scientific_plot import scientific_plot


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "USER_WORKSPACES_DIR", tmp_path / "workspaces")
    root = config.USER_WORKSPACES_DIR / "user_1" / "uploads"
    root.mkdir(parents=True)
    (root / "data.csv").write_text("time,value,group,fc,p,f1,f2\n1,2,A,1.5,0.01,1,3\n2,4,B,-2,0.02,2,1\n3,3,A,0.2,0.5,3,5\n", encoding="utf-8")
    return config.USER_WORKSPACES_DIR / "user_1"


def _ctx():
    return AgentContext(user_id=1, extra={"entitlements": {"features": {"file_write": True}}})


def test_scientific_plot_line_generates_all_files(workspace):
    ctx = _ctx()
    result = _run(scientific_plot({
        "source_path": "uploads/data.csv", "plot_type": "line", "output_name": "figures/line",
        "x_column": "time", "y_columns": ["value"],
    }, ctx))

    assert "已生成并发送" in result
    assert (workspace / "figures" / "line.png").is_file()
    assert (workspace / "figures" / "line.svg").is_file()
    assert (workspace / "figures" / "line.pdf").is_file()
    assert (workspace / "figures" / "line.json").is_file()
    assert len(ctx.files) == 4


def test_scientific_plot_rejects_unknown_column(workspace):
    result = _run(scientific_plot({
        "source_path": "uploads/data.csv", "plot_type": "scatter", "output_name": "bad",
        "x_column": "missing", "y_column": "value",
    }, _ctx()))

    assert "找不到列：missing" in result


def test_scientific_plot_cannot_use_other_user_data(workspace):
    other_upload = workspace.parent / "user_2" / "uploads"
    other_upload.mkdir(parents=True)
    other_data = other_upload / "private.csv"
    other_data.write_text("time,value\n1,999\n", encoding="utf-8")

    result = _run(scientific_plot({
        "source_path": str(other_data), "plot_type": "line", "output_name": "figures/private",
        "x_column": "time", "y_columns": ["value"],
    }, _ctx()))

    assert "路径无效" in result
    assert not (workspace / "figures" / "private.png").exists()


def test_scientific_plot_rejects_oversized_figure(workspace):
    result = _run(scientific_plot({
        "source_path": "uploads/data.csv", "plot_type": "line", "output_name": "figures/large",
        "x_column": "time", "y_columns": ["value"], "width": 100,
    }, _ctx()))

    assert "width 和 height 必须在" in result


@pytest.mark.parametrize("output_name", ["uploads/plot", ".trash/plot"])
def test_scientific_plot_rejects_protected_output_directories(workspace, output_name):
    result = _run(scientific_plot({
        "source_path": "uploads/data.csv", "plot_type": "line", "output_name": output_name,
        "x_column": "time", "y_columns": ["value"],
    }, _ctx()))

    assert "output_name 不能写入" in result


@pytest.mark.parametrize(("plot_type", "args"), [
    ("heatmap", {"value_columns": ["value", "fc", "p"]}),
    ("pca", {"feature_columns": ["value", "fc", "f1", "f2"]}),
])
def test_scientific_plot_generates_numeric_matrix_plots(workspace, plot_type, args):
    result = _run(scientific_plot({
        "source_path": "uploads/data.csv", "plot_type": plot_type, "output_name": f"figures/{plot_type}", **args,
    }, _ctx()))

    assert "已生成并发送" in result
    assert (workspace / "figures" / f"{plot_type}.png").is_file()


def test_scientific_plot_is_registered():
    assert get_tool("scientific_plot") is not None
