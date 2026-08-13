"""scientific_plot 工具：从用户工作区 CSV/XLSX 生成受控的科研图文件。"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import urllib.parse
from pathlib import Path

from backend.services.agent.context import AgentContext
from backend.services.agent.registry import agent_tool
from backend.services.agent.tools.send_file import MAX_SEND_BYTES
from backend.services.agent.workspace import MAX_WORKSPACE_BYTES, resolve_workspace_path, workspace_usage_bytes

logger = logging.getLogger(__name__)

MAX_ROWS = 50_000
MAX_COLUMNS = 100
MAX_OUTPUT_FILES = 4
PLOT_TYPES = {"line", "bar", "scatter", "distribution", "heatmap", "volcano", "pca", "roc_pr"}
PLOT_STYLES = {"science", "nature", "ieee"}
SAFE_NAME = re.compile(r"^[A-Za-z0-9._-]{1,100}$")


def _has_file_write(ctx: AgentContext | None) -> bool:
    return bool((getattr(ctx, "extra", None) or {}).get("entitlements", {}).get("features", {}).get("file_write"))


def _number_column(frame, column: str):
    import pandas as pd

    if column not in frame.columns:
        raise ValueError(f"找不到列：{column}")
    return pd.to_numeric(frame[column], errors="coerce")


def _validate_columns(frame, columns: list[str]) -> None:
    missing = [column for column in columns if column not in frame.columns]
    if missing:
        raise ValueError(f"找不到列：{', '.join(missing)}")


def _read_data(path: Path, sheet_name: str):
    import pandas as pd

    suffix = path.suffix.lower()
    if suffix == ".csv":
        frame = pd.read_csv(path)
    elif suffix == ".xlsx":
        frame = pd.read_excel(path, sheet_name=sheet_name or 0)
    else:
        raise ValueError("source_path 仅支持 .csv 或 .xlsx 文件")
    if frame.empty:
        raise ValueError("数据文件为空")
    if len(frame) > MAX_ROWS:
        raise ValueError(f"数据行数超过上限 {MAX_ROWS}，请先筛选或拆分文件")
    if len(frame.columns) > MAX_COLUMNS:
        raise ValueError(f"数据列数超过上限 {MAX_COLUMNS}，请先精简文件")
    frame.columns = [str(column).strip() for column in frame.columns]
    if len(set(frame.columns)) != len(frame.columns):
        raise ValueError("数据列名存在重复，请先修改后重试")
    return frame


def _configure_style(style: str):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    try:
        import scienceplots  # noqa: F401
        plt.style.use(["science", "no-latex"] + ([style] if style != "science" else []))
    except Exception:
        plt.style.use("seaborn-v0_8-whitegrid")
    plt.rcParams.update({
        "font.sans-serif": ["Noto Sans CJK SC", "Microsoft YaHei", "DejaVu Sans"],
        "axes.unicode_minus": False,
        "figure.dpi": 150,
        "savefig.dpi": 300,
    })
    return plt


def _finish(ax, args: dict) -> None:
    title = str(args.get("title") or "").strip()
    if title:
        ax.set_title(title)
    xlabel = str(args.get("x_label") or "").strip()
    ylabel = str(args.get("y_label") or "").strip()
    if xlabel:
        ax.set_xlabel(xlabel)
    if ylabel:
        ax.set_ylabel(ylabel)
    if args.get("show_grid", True):
        ax.grid(True, alpha=0.25)


def _plot_line(ax, frame, args: dict) -> None:
    x_column = str(args.get("x_column") or "").strip()
    y_columns = [str(value).strip() for value in args.get("y_columns") or [] if str(value).strip()]
    if not x_column or not y_columns:
        raise ValueError("line 图需要 x_column 和至少一个 y_columns")
    _validate_columns(frame, [x_column, *y_columns])
    x = frame[x_column]
    for column in y_columns:
        values = _number_column(frame, column)
        mask = values.notna() & x.notna()
        ax.plot(x[mask], values[mask], marker="o", linewidth=1.8, markersize=3.5, label=column)
    ax.legend(frameon=False)


def _plot_bar(ax, frame, args: dict) -> None:
    x_column = str(args.get("x_column") or "").strip()
    y_column = str(args.get("y_column") or "").strip()
    if not x_column or not y_column:
        raise ValueError("bar 图需要 x_column 和 y_column")
    _validate_columns(frame, [x_column, y_column])
    values = _number_column(frame, y_column)
    data = frame.assign(_value=values).dropna(subset=[x_column, "_value"])
    if data.empty:
        raise ValueError("没有可用于柱状图的数值")
    group_column = str(args.get("group_column") or "").strip()
    if group_column:
        _validate_columns(frame, [group_column])
        pivot = data.pivot_table(index=x_column, columns=group_column, values="_value", aggfunc="mean", sort=False).fillna(0)
        pivot.plot(kind="bar", ax=ax, width=0.8)
        ax.legend(title=group_column, frameon=False)
    else:
        grouped = data.groupby(x_column, sort=False)["_value"].mean()
        ax.bar(grouped.index.astype(str), grouped.values)
    ax.tick_params(axis="x", rotation=30)


def _plot_scatter(ax, frame, args: dict) -> None:
    import numpy as np

    x_column = str(args.get("x_column") or "").strip()
    y_column = str(args.get("y_column") or "").strip()
    if not x_column or not y_column:
        raise ValueError("scatter 图需要 x_column 和 y_column")
    _validate_columns(frame, [x_column, y_column])
    x, y = _number_column(frame, x_column), _number_column(frame, y_column)
    data = frame.assign(_x=x, _y=y).dropna(subset=["_x", "_y"])
    if data.empty:
        raise ValueError("没有可用于散点图的数值")
    group_column = str(args.get("group_column") or "").strip()
    if group_column:
        _validate_columns(frame, [group_column])
        for label, group in data.groupby(group_column, dropna=False, sort=False):
            ax.scatter(group["_x"], group["_y"], s=24, alpha=0.8, label=str(label))
        ax.legend(title=group_column, frameon=False)
    else:
        ax.scatter(data["_x"], data["_y"], s=24, alpha=0.8)
    if args.get("trendline", False) and len(data) >= 2:
        slope, intercept = np.polyfit(data["_x"], data["_y"], 1)
        points = np.linspace(data["_x"].min(), data["_x"].max(), 100)
        ax.plot(points, slope * points + intercept, color="#D1495B", linewidth=1.6, label="线性趋势")
        if group_column:
            ax.legend(title=group_column, frameon=False)


def _plot_distribution(ax, frame, args: dict) -> None:
    x_column = str(args.get("x_column") or "").strip()
    y_column = str(args.get("y_column") or "").strip()
    if not x_column or not y_column:
        raise ValueError("distribution 图需要 x_column 和 y_column")
    _validate_columns(frame, [x_column, y_column])
    values = _number_column(frame, y_column)
    data = frame.assign(_value=values).dropna(subset=[x_column, "_value"])
    if data.empty:
        raise ValueError("没有可用于分布图的数值")
    groups = [(str(label), group["_value"].to_numpy()) for label, group in data.groupby(x_column, sort=False)]
    if not groups:
        raise ValueError("没有可用于分布图的分组")
    labels, arrays = zip(*groups)
    kind = str(args.get("distribution_kind") or "box")
    if kind == "violin":
        parts = ax.violinplot(arrays, showmeans=False, showmedians=True)
        for body in parts["bodies"]:
            body.set_alpha(0.65)
    elif kind == "strip":
        import numpy as np
        for index, values in enumerate(arrays, start=1):
            jitter = np.random.default_rng(42 + index).normal(index, 0.045, size=len(values))
            ax.scatter(jitter, values, s=16, alpha=0.7)
    else:
        ax.boxplot(arrays, patch_artist=True, boxprops={"facecolor": "#4C78A8", "alpha": 0.65})
    ax.set_xticks(range(1, len(labels) + 1), labels, rotation=30)


def _plot_heatmap(ax, frame, args: dict) -> None:
    import numpy as np
    import pandas as pd

    value_columns = [str(value).strip() for value in args.get("value_columns") or [] if str(value).strip()]
    if not value_columns:
        raise ValueError("heatmap 图需要 value_columns")
    _validate_columns(frame, value_columns)
    matrix = frame[value_columns].apply(pd.to_numeric, errors="coerce").to_numpy(dtype=float)
    if not np.isfinite(matrix).any():
        raise ValueError("热图列不包含有效数值")
    image = ax.imshow(matrix, aspect="auto", cmap=str(args.get("color_map") or "viridis"))
    ax.set_xticks(range(len(value_columns)), value_columns, rotation=30, ha="right")
    index_column = str(args.get("index_column") or "").strip()
    if index_column:
        _validate_columns(frame, [index_column])
        labels = frame[index_column].astype(str).tolist()
        if len(labels) <= 40:
            ax.set_yticks(range(len(labels)), labels)
    ax.figure.colorbar(image, ax=ax, fraction=0.046, pad=0.04)


def _plot_volcano(ax, frame, args: dict) -> None:
    import numpy as np

    fc_column = str(args.get("log2fc_column") or "").strip()
    p_column = str(args.get("p_value_column") or "").strip()
    if not fc_column or not p_column:
        raise ValueError("volcano 图需要 log2fc_column 和 p_value_column")
    _validate_columns(frame, [fc_column, p_column])
    log2fc, p_value = _number_column(frame, fc_column), _number_column(frame, p_column)
    data = frame.assign(_fc=log2fc, _p=p_value).dropna(subset=["_fc", "_p"])
    data = data[data["_p"] > 0]
    if data.empty:
        raise ValueError("火山图需要大于 0 的 p 值")
    fc_threshold = float(args.get("fold_change_threshold") or 1)
    p_threshold = float(args.get("p_value_threshold") or 0.05)
    data = data.assign(_neglog=-np.log10(data["_p"]))
    significant = (data["_p"] <= p_threshold) & (data["_fc"].abs() >= fc_threshold)
    colors = np.where(significant & (data["_fc"] > 0), "#D1495B", np.where(significant, "#4C78A8", "#A0AEC0"))
    ax.scatter(data["_fc"], data["_neglog"], s=16, alpha=0.75, c=colors)
    ax.axvline(fc_threshold, color="#718096", linestyle="--", linewidth=1)
    ax.axvline(-fc_threshold, color="#718096", linestyle="--", linewidth=1)
    ax.axhline(-np.log10(p_threshold), color="#718096", linestyle="--", linewidth=1)
    ax.set_xlabel(args.get("x_label") or "log2 Fold Change")
    ax.set_ylabel(args.get("y_label") or "-log10(p-value)")
    label_column = str(args.get("label_column") or "").strip()
    if label_column:
        _validate_columns(frame, [label_column])
        for _, row in data[significant].nlargest(10, "_neglog").iterrows():
            ax.annotate(str(row[label_column]), (row["_fc"], row["_neglog"]), fontsize=7, xytext=(3, 3), textcoords="offset points")


def _plot_pca(ax, frame, args: dict) -> None:
    import numpy as np
    import pandas as pd

    feature_columns = [str(value).strip() for value in args.get("feature_columns") or [] if str(value).strip()]
    if len(feature_columns) < 2:
        raise ValueError("pca 图需要至少两个 feature_columns")
    _validate_columns(frame, feature_columns)
    numeric_frame = frame[feature_columns].apply(pd.to_numeric, errors="coerce")
    matrix = numeric_frame.dropna().to_numpy(dtype=float)
    if len(matrix) < 2:
        raise ValueError("PCA 至少需要两行完整数值数据")
    matrix = (matrix - matrix.mean(axis=0)) / np.where(matrix.std(axis=0) == 0, 1, matrix.std(axis=0))
    scores = np.linalg.svd(matrix, full_matrices=False)
    coordinates = scores[0][:, :2] * scores[1][:2]
    explained = (scores[1] ** 2) / (scores[1] ** 2).sum()
    valid = numeric_frame.notna().all(axis=1)
    group_column = str(args.get("group_column") or "").strip()
    if group_column:
        _validate_columns(frame, [group_column])
        groups = frame.loc[valid, group_column].astype(str)
        for label in groups.drop_duplicates():
            mask = groups == label
            ax.scatter(coordinates[mask, 0], coordinates[mask, 1], s=26, alpha=0.8, label=label)
        ax.legend(title=group_column, frameon=False)
    else:
        ax.scatter(coordinates[:, 0], coordinates[:, 1], s=26, alpha=0.8)
    ax.set_xlabel(args.get("x_label") or f"PC1 ({explained[0] * 100:.1f}%)")
    ax.set_ylabel(args.get("y_label") or f"PC2 ({explained[1] * 100:.1f}%)")


def _plot_roc_pr(ax, frame, args: dict) -> None:
    import numpy as np

    label_column = str(args.get("label_column") or "").strip()
    score_column = str(args.get("score_column") or "").strip()
    if not label_column or not score_column:
        raise ValueError("roc_pr 图需要 label_column 和 score_column")
    _validate_columns(frame, [label_column, score_column])
    labels, scores = _number_column(frame, label_column), _number_column(frame, score_column)
    data = frame.assign(_label=labels, _score=scores).dropna(subset=["_label", "_score"])
    if set(data["_label"].unique()) - {0, 1} or data["_label"].nunique() != 2:
        raise ValueError("label_column 必须是包含 0 和 1 的二分类标签")
    ordered = data.sort_values("_score", ascending=False)
    truth = ordered["_label"].to_numpy(dtype=int)
    positives, negatives = truth.sum(), len(truth) - truth.sum()
    tpr = np.r_[0, np.cumsum(truth) / positives]
    fpr = np.r_[0, np.cumsum(1 - truth) / negatives]
    precision = np.cumsum(truth) / np.arange(1, len(truth) + 1)
    recall = np.cumsum(truth) / positives
    mode = str(args.get("curve_type") or "roc")
    if mode == "pr":
        ax.plot(np.r_[0, recall], np.r_[1, precision], linewidth=2, label="PR curve")
        ax.set_xlabel(args.get("x_label") or "Recall")
        ax.set_ylabel(args.get("y_label") or "Precision")
    else:
        auc = np.trapezoid(tpr, fpr)
        ax.plot(fpr, tpr, linewidth=2, label=f"ROC (AUC={auc:.3f})")
        ax.plot([0, 1], [0, 1], linestyle="--", color="#718096", linewidth=1)
        ax.set_xlabel(args.get("x_label") or "False Positive Rate")
        ax.set_ylabel(args.get("y_label") or "True Positive Rate")
    ax.legend(frameon=False, loc="lower right")


def _build_plot(path: Path, output_base: Path, args: dict) -> list[Path]:
    plot_type = str(args.get("plot_type") or "").strip()
    if plot_type not in PLOT_TYPES:
        raise ValueError(f"plot_type 必须是：{', '.join(sorted(PLOT_TYPES))}")
    frame = _read_data(path, str(args.get("sheet_name") or "").strip())
    style = str(args.get("style") or "science")
    if style not in PLOT_STYLES:
        raise ValueError(f"style 必须是：{', '.join(sorted(PLOT_STYLES))}")
    plt = _configure_style(style)
    width, height = args.get("width") or 6.4, args.get("height") or 4.2
    figure, ax = plt.subplots(figsize=(float(width), float(height)))
    try:
        {
            "line": _plot_line,
            "bar": _plot_bar,
            "scatter": _plot_scatter,
            "distribution": _plot_distribution,
            "heatmap": _plot_heatmap,
            "volcano": _plot_volcano,
            "pca": _plot_pca,
            "roc_pr": _plot_roc_pr,
        }[plot_type](ax, frame, args)
        _finish(ax, args)
        figure.tight_layout()
        outputs = [output_base.with_suffix(ext) for ext in (".png", ".svg", ".pdf")]
        for output in outputs:
            figure.savefig(output, bbox_inches="tight")
    finally:
        plt.close(figure)
    config_path = output_base.with_suffix(".json")
    config_path.write_text(json.dumps(args, ensure_ascii=False, indent=2), encoding="utf-8")
    return [*outputs, config_path]


@agent_tool(
    name="scientific_plot",
    description=(
        "受控科研作图工具：从用户工作区的 CSV/XLSX 生成可投稿的 PNG、SVG、PDF 和可复现 JSON 配置，"
        "不执行任何用户代码或命令。支持 line（折线）、bar（柱状）、scatter（散点）、distribution（箱线/提琴/散点分布）、"
        "heatmap（热图）、volcano（火山图）、pca（主成分图）、roc_pr（ROC/PR 曲线）。"
        "使用前先通过 file_ops_list 查看 uploads/ 下的数据文件与列名；source_path 必须是工作区内的 .csv/.xlsx 路径。"
        "数据分析图优先用本工具，不要用 image_gen。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "source_path": {"type": "string", "description": "工作区内 CSV/XLSX 文件路径，例如 uploads/abc.csv"},
            "plot_type": {"type": "string", "enum": sorted(PLOT_TYPES), "description": "图表类型"},
            "output_name": {"type": "string", "description": "输出文件基础名，不含扩展名，例如 figures/experiment_1"},
            "sheet_name": {"type": "string", "description": "XLSX 工作表名称，可选"},
            "title": {"type": "string", "description": "图标题，可选"},
            "x_column": {"type": "string", "description": "X/分组列；line、bar、scatter、distribution 使用"},
            "y_column": {"type": "string", "description": "Y 列；bar、scatter、distribution 使用"},
            "y_columns": {"type": "array", "items": {"type": "string"}, "description": "Y 列列表；line 使用"},
            "group_column": {"type": "string", "description": "分组列；bar、scatter、pca 可选"},
            "value_columns": {"type": "array", "items": {"type": "string"}, "description": "热图数值列列表"},
            "index_column": {"type": "string", "description": "热图行标签列，可选"},
            "feature_columns": {"type": "array", "items": {"type": "string"}, "description": "PCA 特征列列表，至少两个"},
            "log2fc_column": {"type": "string", "description": "火山图 log2 fold change 列"},
            "p_value_column": {"type": "string", "description": "火山图 p 值列"},
            "label_column": {"type": "string", "description": "火山图标签列，或 ROC/PR 二分类标签列（0/1）"},
            "score_column": {"type": "string", "description": "ROC/PR 预测分数列"},
            "distribution_kind": {"type": "string", "enum": ["box", "violin", "strip"], "description": "分布图类型，默认 box"},
            "curve_type": {"type": "string", "enum": ["roc", "pr"], "description": "ROC/PR 图类型，默认 roc"},
            "fold_change_threshold": {"type": "number", "description": "火山图 fold change 阈值，默认 1"},
            "p_value_threshold": {"type": "number", "description": "火山图 p 值阈值，默认 0.05"},
            "trendline": {"type": "boolean", "description": "散点图是否添加线性趋势线，默认 false"},
            "style": {"type": "string", "enum": sorted(PLOT_STYLES), "description": "论文样式，默认 science"},
            "color_map": {"type": "string", "description": "热图 Matplotlib 色图，默认 viridis"},
            "width": {"type": "number", "description": "图宽（英寸），默认 6.4"},
            "height": {"type": "number", "description": "图高（英寸），默认 4.2"},
            "x_label": {"type": "string", "description": "X 轴显示名，可选"},
            "y_label": {"type": "string", "description": "Y 轴显示名，可选"},
            "show_grid": {"type": "boolean", "description": "是否显示网格，默认 true"},
        },
        "required": ["source_path", "plot_type", "output_name"],
    },
)
async def scientific_plot(args: dict, ctx: AgentContext) -> str:
    if not _has_file_write(ctx):
        return "当前套餐不支持文件写入。"
    user_id = getattr(ctx, "user_id", None)
    if user_id is None:
        return "需要登录后才能使用科研作图工具"
    source_path = str(args.get("source_path") or "").strip()
    output_name = str(args.get("output_name") or "").strip()
    if not source_path or not output_name:
        return "scientific_plot 参数错误：source_path 和 output_name 不能为空"
    output_rel = Path(output_name)
    if output_rel.suffix:
        output_rel = output_rel.with_suffix("")
    if not SAFE_NAME.match(output_rel.name):
        return "output_name 只能包含字母、数字、点、下划线和短横线"
    try:
        source = resolve_workspace_path(user_id, source_path)
        output_base = resolve_workspace_path(user_id, str(output_rel))
    except ValueError as exc:
        return f"路径无效：{exc}"
    if not source.is_file():
        return f"数据文件不存在：{source_path}"
    if source.suffix.lower() not in {".csv", ".xlsx"}:
        return "source_path 仅支持 .csv 或 .xlsx 文件"
    output_base.parent.mkdir(parents=True, exist_ok=True)
    try:
        outputs = await asyncio.to_thread(_build_plot, source, output_base, args)
    except (ValueError, OSError) as exc:
        return f"科研作图失败：{exc}"
    except Exception:
        logger.exception("[scientific_plot] 生成失败 source=%s", source_path)
        return "科研作图失败，请检查数据列和参数是否匹配"
    try:
        if workspace_usage_bytes(user_id) > MAX_WORKSPACE_BYTES:
            raise ValueError(f"工作区总容量超过 {MAX_WORKSPACE_BYTES // (1024 * 1024)}MB 上限")
    except (OSError, ValueError) as exc:
        for path in outputs:
            path.unlink(missing_ok=True)
        return f"科研作图失败：{exc}"
    sent = []
    for output in outputs[:MAX_OUTPUT_FILES]:
        size = output.stat().st_size
        if size > MAX_SEND_BYTES:
            continue
        relative = str(output.relative_to(resolve_workspace_path(user_id, ".")))
        url = f"/api/workspace/files/download?path={urllib.parse.quote(relative)}"
        description = "科研图配置" if output.suffix == ".json" else f"科研图 {output.suffix.upper().lstrip('.')}"
        ctx.add_file(filename=output.name, url=url, size=size, description=description)
        sent.append(output.name)
    if not sent:
        return "科研图已生成，但文件过大无法发送"
    return f"已生成并发送科研图文件：{', '.join(sent)}。PNG 用于预览，SVG/PDF 可用于论文排版，JSON 记录本次作图参数。"
