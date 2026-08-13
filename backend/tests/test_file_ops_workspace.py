"""file_ops_workspace 系列工具单元测试（tmp_path 沙箱，不碰真实 data 目录）。

覆盖：路径解析校验（越界/空/非法字符/symlink 逃逸）、read 分页与二进制拒绝、
write 三种模式、edit 替换语义与并发锁、list/glob/grep 基本行为、套餐门控。
测试模式与 test_agent_image_gen.py 一致：无 pytest-asyncio，用 asyncio.run 包装协程。
"""
import asyncio

import pytest

from backend import config
from backend.services.agent import workspace
from backend.services.agent.context import AgentContext
from backend.services.agent.tools import file_ops_workspace as fow


def _run(coro):
    return asyncio.run(coro)


def _ctx(user_id=123, file_write=True):
    features = {"file_write": True} if file_write else {}
    return AgentContext(
        session_id=1,
        user_id=user_id,
        extra={"entitlements": {"features": features}},
    )


@pytest.fixture
def ws(tmp_path, monkeypatch):
    """把用户工作区根目录重定向到 pytest tmp_path（workspace 动态读 config 属性）。"""
    monkeypatch.setattr(config, "USER_WORKSPACES_DIR", tmp_path)
    return tmp_path


def _root(ws, user_id=123):
    return ws / f"user_{user_id}"


def _write(root, name, text):
    p = root / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")
    return p


# ---------- resolve_workspace_path ----------

def test_resolve_relative_path(ws):
    p = workspace.resolve_workspace_path(123, "docs/a.txt")
    assert p == (_root(ws) / "docs" / "a.txt").resolve()


def test_resolve_dot_relative(ws):
    p = workspace.resolve_workspace_path(123, "./a.txt")
    assert p == (_root(ws) / "a.txt").resolve()


def test_resolve_absolute_inside_ok(ws):
    target = _root(ws) / "x.txt"
    p = workspace.resolve_workspace_path(123, str(target))
    assert p == target.resolve()


def test_resolve_parent_traversal_rejected(ws):
    with pytest.raises(ValueError):
        workspace.resolve_workspace_path(123, "../secret.txt")
    with pytest.raises(ValueError):
        workspace.resolve_workspace_path(123, "a/../../secret.txt")


def test_resolve_absolute_outside_rejected(ws):
    with pytest.raises(ValueError):
        workspace.resolve_workspace_path(123, "/etc/passwd")
    outside = ws / "outside.txt"  # 在 tmp_path 下但在 user_123 之外
    outside.write_text("secret")
    with pytest.raises(ValueError):
        workspace.resolve_workspace_path(123, str(outside))


def test_resolve_empty_and_bad_chars(ws):
    with pytest.raises(ValueError):
        workspace.resolve_workspace_path(123, "")
    with pytest.raises(ValueError):
        workspace.resolve_workspace_path(123, None)
    with pytest.raises(ValueError):
        workspace.resolve_workspace_path(123, "a\0b")


def test_resolve_symlink_escape_rejected(ws):
    outside = ws / "secret.txt"
    outside.write_text("secret")
    root = _root(ws)
    root.mkdir(parents=True)
    (root / "link.txt").symlink_to(outside)
    with pytest.raises(ValueError):
        workspace.resolve_workspace_path(123, "link.txt")
    with pytest.raises(ValueError):
        workspace.resolve_workspace_path(123, str(root / "link.txt"))


# ---------- file_ops_read ----------

def test_read_pagination(ws):
    root = _root(ws)
    _write(root, "a.txt", "l1\nl2\nl3\nl4\nl5\n")
    ctx = _ctx()
    result = _run(fow.file_ops_read({"path": "a.txt", "offset": 2, "limit": 2}, ctx))
    assert "2: l2" in result
    assert "3: l3" in result
    assert "1: l1" not in result
    assert "共 5 行，显示 2 行" in result
    assert "已截断" in result
    # 默认参数：从第 1 行读 200 行
    result2 = _run(fow.file_ops_read({"path": "a.txt"}, ctx))
    assert "1: l1" in result2
    assert "5: l5" in result2
    assert "共 5 行，显示 5 行" in result2


def test_read_file_not_found(ws):
    result = _run(fow.file_ops_read({"path": "missing.txt"}, _ctx()))
    assert "文件不存在" in result


def test_read_binary_rejected(ws):
    root = _root(ws)
    p = _write(root, "bin.dat", "abc")
    p.write_bytes(b"\x00\x01\x02")
    result = _run(fow.file_ops_read({"path": "bin.dat"}, _ctx()))
    assert "二进制" in result


def test_read_requires_login():
    result = _run(fow.file_ops_read({"path": "a.txt"}, AgentContext()))
    assert "需要登录" in result


def test_read_outside_rejected(ws):
    result = _run(fow.file_ops_read({"path": "../etc/passwd"}, _ctx()))
    assert "越界" in result


# ---------- file_ops_write ----------

def test_write_overwrite(ws):
    root = _root(ws)
    _write(root, "f.txt", "old")
    result = _run(fow.file_ops_write({"path": "f.txt", "content": "new"}, _ctx()))
    assert "已写入 f.txt（3 字符，overwrite）" in result
    assert (root / "f.txt").read_text(encoding="utf-8") == "new"


def test_write_create_existing_rejected(ws):
    root = _root(ws)
    _write(root, "f.txt", "old")
    result = _run(fow.file_ops_write({"path": "f.txt", "content": "x", "mode": "create"}, _ctx()))
    assert "文件已存在" in result
    assert (root / "f.txt").read_text(encoding="utf-8") == "old"


def test_write_create_new_and_append(ws):
    root = _root(ws)
    ctx = _ctx()
    r1 = _run(fow.file_ops_write({"path": "f.txt", "content": "a\n", "mode": "create"}, ctx))
    assert "create" in r1
    r2 = _run(fow.file_ops_write({"path": "f.txt", "content": "b\n", "mode": "append"}, ctx))
    assert "append" in r2
    assert (root / "f.txt").read_text(encoding="utf-8") == "a\nb\n"


def test_write_creates_parent_dirs(ws):
    result = _run(fow.file_ops_write({"path": "deep/nested/dir/f.txt", "content": "hi"}, _ctx()))
    assert "已写入" in result
    assert (_root(ws) / "deep/nested/dir/f.txt").read_text(encoding="utf-8") == "hi"


def test_write_too_long(ws, monkeypatch):
    monkeypatch.setattr(fow, "MAX_CONTENT_CHARS", 5)
    result = _run(fow.file_ops_write({"path": "f.txt", "content": "123456"}, _ctx()))
    assert "写入内容过长" in result


def test_write_requires_entitlement(ws):
    ctx = _ctx(file_write=False)
    result = _run(fow.file_ops_write({"path": "f.txt", "content": "x"}, ctx))
    assert result == "当前套餐不支持文件写入。"
    assert not (_root(ws) / "f.txt").exists()


def test_write_outside_rejected(ws):
    result = _run(fow.file_ops_write({"path": "../evil.txt", "content": "x"}, _ctx()))
    assert "越界" in result
    assert not (ws / "evil.txt").exists()


# ---------- file_ops_edit ----------

def test_edit_unique_replace(ws):
    root = _root(ws)
    _write(root, "f.txt", "hello world")
    result = _run(fow.file_ops_edit({"path": "f.txt", "old_string": "world", "new_string": "agent"}, _ctx()))
    assert "已替换 1 处" in result
    assert (root / "f.txt").read_text(encoding="utf-8") == "hello agent"


def test_edit_multiple_requires_replace_all(ws):
    root = _root(ws)
    _write(root, "f.txt", "a b a")
    result = _run(fow.file_ops_edit({"path": "f.txt", "old_string": "a", "new_string": "x"}, _ctx()))
    assert "出现 2 次" in result
    assert "replace_all" in result
    assert (root / "f.txt").read_text(encoding="utf-8") == "a b a"  # 未改动


def test_edit_replace_all(ws):
    root = _root(ws)
    _write(root, "f.txt", "a b a")
    result = _run(fow.file_ops_edit(
        {"path": "f.txt", "old_string": "a", "new_string": "x", "replace_all": True}, _ctx()))
    assert "已替换 2 处" in result
    assert (root / "f.txt").read_text(encoding="utf-8") == "x b x"


def test_edit_old_not_found(ws):
    root = _root(ws)
    _write(root, "f.txt", "hello")
    result = _run(fow.file_ops_edit({"path": "f.txt", "old_string": "zzz", "new_string": "x"}, _ctx()))
    assert "未在文件中找到" in result
    assert (root / "f.txt").read_text(encoding="utf-8") == "hello"


def test_edit_file_not_found(ws):
    result = _run(fow.file_ops_edit({"path": "nope.txt", "old_string": "a", "new_string": "b"}, _ctx()))
    assert "文件不存在" in result


def test_edit_requires_entitlement(ws):
    root = _root(ws)
    _write(root, "f.txt", "hello")
    result = _run(fow.file_ops_edit({"path": "f.txt", "old_string": "h", "new_string": "H"}, _ctx(file_write=False)))
    assert result == "当前套餐不支持文件写入。"
    assert (root / "f.txt").read_text(encoding="utf-8") == "hello"


def test_edit_binary_rejected(ws):
    root = _root(ws)
    p = _write(root, "b.dat", "x")
    p.write_bytes(b"\x00\x01")
    result = _run(fow.file_ops_edit({"path": "b.dat", "old_string": "a", "new_string": "b"}, _ctx()))
    assert "二进制" in result


def test_edit_concurrent_same_file(ws):
    root = _root(ws)
    _write(root, "f.txt", "x" * 1000)
    ctx = _ctx()

    async def _two_edits():
        await asyncio.gather(
            fow.file_ops_edit({"path": "f.txt", "old_string": "x", "new_string": "y", "replace_all": True}, ctx),
            fow.file_ops_edit({"path": "f.txt", "old_string": "y", "new_string": "z", "replace_all": True}, ctx),
        )

    _run(_two_edits())
    content = (root / "f.txt").read_text(encoding="utf-8")
    # 锁串行化保证两个 edit 完整生效：最终为全 y 或全 z（取决于执行顺序），不会互相覆盖丢更新
    assert content in ("y" * 1000, "z" * 1000)


# ---------- file_ops_list ----------

def test_list_basic(ws):
    root = _root(ws)
    _write(root, "a.txt", "aaaa")
    _write(root, "b.txt", "b")
    _write(root, "docs/c.txt", "c")
    result = _run(fow.file_ops_list({"path": "."}, _ctx()))
    assert "docs（dir" in result
    assert "a.txt（file，4 bytes）" in result
    assert "b.txt（file，1 bytes）" in result
    assert result.index("docs") < result.index("a.txt")  # 目录在前


def test_list_recursive(ws):
    root = _root(ws)
    _write(root, "a.txt", "a")
    _write(root, "docs/c.txt", "c")
    result = _run(fow.file_ops_list({"path": ".", "recursive": True}, _ctx()))
    assert "a.txt（file" in result
    assert "docs/c.txt（file" in result


def test_list_dir_not_found(ws):
    result = _run(fow.file_ops_list({"path": "nope"}, _ctx()))
    assert "目录不存在" in result


def test_list_outside_rejected(ws):
    result = _run(fow.file_ops_list({"path": ".."}, _ctx()))
    assert "越界" in result


# ---------- file_ops_glob ----------

def test_glob_basic(ws):
    root = _root(ws)
    _write(root, "a.md", "# t")
    _write(root, "docs/b.md", "x")
    _write(root, "docs/c.txt", "y")
    result = _run(fow.file_ops_glob({"pattern": "**/*.md"}, _ctx()))
    assert "a.md" in result
    assert "docs/b.md" in result
    assert "c.txt" not in result
    result2 = _run(fow.file_ops_glob({"pattern": "*.md", "base_path": "docs"}, _ctx()))
    assert "docs/b.md" in result2


def test_glob_no_match(ws):
    result = _run(fow.file_ops_glob({"pattern": "*.xyz"}, _ctx()))
    assert "未找到匹配" in result


def test_glob_outside_base_rejected(ws):
    result = _run(fow.file_ops_glob({"pattern": "*.py", "base_path": "../"}, _ctx()))
    assert "越界" in result


# ---------- file_ops_grep ----------

def test_grep_basic(ws):
    root = _root(ws)
    _write(root, "a.py", "def foo():\n    return 1\n")
    _write(root, "docs/b.py", "foo = 2\nbar = 3\n")
    _write(root, "readme.md", "foo here")
    result = _run(fow.file_ops_grep({"pattern": "foo"}, _ctx()))
    assert "a.py:1: def foo():" in result
    assert "docs/b.py:1: foo = 2" in result
    assert "readme.md:1: foo here" in result
    # file_pattern 过滤
    result2 = _run(fow.file_ops_grep({"pattern": "foo", "file_pattern": "*.py"}, _ctx()))
    assert "a.py" in result2
    assert "readme.md" not in result2


def test_grep_no_match(ws):
    _write(_root(ws), "a.txt", "hello")
    result = _run(fow.file_ops_grep({"pattern": "zzz"}, _ctx()))
    assert "未找到匹配" in result


def test_grep_invalid_regex(ws):
    result = _run(fow.file_ops_grep({"pattern": "([", "path": "."}, _ctx()))
    assert "正则表达式无效" in result


def test_grep_outside_rejected(ws):
    result = _run(fow.file_ops_grep({"pattern": "x", "path": "../"}, _ctx()))
    assert "越界" in result


def test_grep_skips_binary(ws):
    root = _root(ws)
    p = _write(root, "bin.dat", "x")
    p.write_bytes(b"\x00\x01foo")
    result = _run(fow.file_ops_grep({"pattern": "foo", "path": "."}, _ctx()))
    assert "未找到匹配" in result


def test_grep_max_results(ws):
    root = _root(ws)
    _write(root, "f.txt", "\n".join(f"line {i} foo" for i in range(10)))
    result = _run(fow.file_ops_grep({"pattern": "foo", "max_results": 3}, _ctx()))
    assert "（结果过多，已截断）" in result
    assert result.count("f.txt:") == 3


# ---------- 门控 ----------

def test_write_tools_require_entitlement(ws):
    ctx = _ctx(file_write=False)
    assert _run(fow.file_ops_list({"path": "."}, ctx)) == "当前套餐不支持文件写入。"
    assert _run(fow.file_ops_glob({"pattern": "*"}, ctx)) == "当前套餐不支持文件写入。"
    assert _run(fow.file_ops_grep({"pattern": "x"}, ctx)) == "当前套餐不支持文件写入。"


# ---------- 安全加固（security review 修复项） ----------

def test_glob_parent_traversal_pattern_rejected(ws):
    for pattern in ["../**", "a/../../b", "..", "sub/../.."]:
        result = _run(fow.file_ops_glob({"pattern": pattern}, _ctx()))
        assert "不能包含绝对路径或 .. 穿越" in result, pattern


def test_glob_absolute_pattern_rejected(ws):
    for pattern in ["/etc/**", "/tmp/*.md"]:
        result = _run(fow.file_ops_glob({"pattern": pattern}, _ctx()))
        assert "不能包含绝对路径或 .. 穿越" in result, pattern


def test_grep_too_long_pattern_rejected(ws):
    result = _run(fow.file_ops_grep({"pattern": "a" * 201}, _ctx()))
    assert "正则表达式过长" in result


def test_grep_skips_overlong_lines(ws):
    """>4096 字符的单行跳过（防灾难性回溯），但其他行仍正常命中。"""
    root = _root(ws)
    root.mkdir(parents=True, exist_ok=True)
    long_line = "x" * 5000
    _write(root, "big.txt", f"{long_line}\nfoo\n")
    result = _run(fow.file_ops_grep({"pattern": "x+", "path": "."}, _ctx()))
    assert "未找到匹配" in result  # 超长行被跳过，无命中
    result = _run(fow.file_ops_grep({"pattern": "foo", "path": "."}, _ctx()))
    assert "big.txt:2: foo" in result


def test_error_message_no_server_path_leak(ws):
    """OSError 回显修复：返回文本不得包含服务器绝对路径（tmp_path 即服务器路径）。"""
    root = _root(ws)
    root.mkdir(parents=True, exist_ok=True)
    # 把 path 指向一个目录 → write_text 触发 IsADirectoryError
    (root / "adir").mkdir()
    result = _run(fow.file_ops_write({"path": "adir", "content": "x"}, _ctx()))
    assert str(ws) not in result
    assert result == "写入文件失败"
    result = _run(fow.file_ops_read({"path": "adir"}, _ctx()))
    assert str(ws) not in result


def test_read_truncates_overlong_line(ws):
    """单行超过 MAX_READ_LINE_CHARS 时截断并提示，防超长行撑爆模型上下文。"""
    from backend.services.agent.workspace import MAX_READ_LINE_CHARS

    root = _root(ws)
    root.mkdir(parents=True, exist_ok=True)
    long_line = "x" * (MAX_READ_LINE_CHARS + 500)
    _write(root, "long.txt", f"{long_line}\n短行\n")
    result = _run(fow.file_ops_read({"path": "long.txt"}, _ctx()))
    assert "行过长已截断" in result
    assert "1: " + long_line not in result  # 完整超长行不应出现
    assert "2: 短行" in result
