"""聊天附件工作区化（uploads/ + 回收站）单元测试。

覆盖：reconcile_chat_uploads 旧格式迁移/幂等/孤儿清理/回收站过期清理、
_remove_chat_uploads 新旧格式删除。全部用 tmp_path + monkeypatch 重定向
目录，get_db 用 MagicMock（风格参照 test_rename_session.py），不碰真实 data/。
"""
import os
import time
from unittest.mock import MagicMock, patch

import pytest

from backend import config
from backend.routers import chat


@pytest.fixture
def dirs(tmp_path, monkeypatch):
    """重定向聊天附件目录与用户工作区根目录到 tmp_path。"""
    chat_uploads = tmp_path / "chat_uploads"
    chat_uploads.mkdir()
    monkeypatch.setattr(config, "CHAT_UPLOAD_DIR", chat_uploads)
    monkeypatch.setattr(chat, "CHAT_UPLOAD_DIR", chat_uploads)
    monkeypatch.setattr(config, "USER_WORKSPACES_DIR", tmp_path)
    return tmp_path


def _mock_db(rows):
    """mock get_db 上下文管理器：fetchall 返回 chat_files 行（dict 列表）。"""
    conn = MagicMock()
    conn.execute.return_value.fetchall.return_value = rows
    db = MagicMock()
    db.__enter__ = MagicMock(return_value=conn)
    db.__exit__ = MagicMock(return_value=False)
    return db, conn


def _updates(conn):
    return [c.args for c in conn.execute.call_args_list if str(c.args[0]).startswith("UPDATE chat_files")]


# ---------- reconcile：旧格式迁移到用户工作区 uploads/ ----------

def test_reconcile_migrates_old_format(dirs):
    old_dir = chat.CHAT_UPLOAD_DIR
    (old_dir / "a.txt").write_text("内容A", encoding="utf-8")
    (old_dir / "b.txt").write_text("内容B", encoding="utf-8")
    rows = [
        {"id": 1, "user_id": 7, "storage_name": "a.txt"},
        {"id": 2, "user_id": 7, "storage_name": "b.txt"},
    ]
    db, conn = _mock_db(rows)
    with patch.object(chat, "get_db", return_value=db):
        result = chat.reconcile_chat_uploads()

    # 文件复制到 user_7/uploads/ 且旧目录源文件删除
    target = dirs / "user_7" / "uploads"
    assert (target / "a.txt").read_text(encoding="utf-8") == "内容A"
    assert (target / "b.txt").read_text(encoding="utf-8") == "内容B"
    assert not (old_dir / "a.txt").exists()
    assert not (old_dir / "b.txt").exists()
    # storage_name UPDATE 被执行（新格式）
    updates = _updates(conn)
    assert len(updates) == 2
    args_by_id = {a[1][1]: a[1][0] for a in updates}
    assert args_by_id[1] == "uploads/a.txt"
    assert args_by_id[2] == "uploads/b.txt"
    assert result == {"migrated": 2, "deleted": 0, "failed": 0, "trash_purged": 0}


def test_reconcile_idempotent_no_duplicate_copy(dirs):
    old_dir = chat.CHAT_UPLOAD_DIR
    target = dirs / "user_7" / "uploads"
    target.mkdir(parents=True)
    (target / "a.txt").write_text("已迁移", encoding="utf-8")
    (old_dir / "a.txt").write_text("旧副本", encoding="utf-8")  # 旧目录残留
    # 第二次调用：chat_files 已全部是新格式 → 不再迁移/更新
    rows = [{"id": 1, "user_id": 7, "storage_name": "uploads/a.txt"}]
    db, conn = _mock_db(rows)
    with patch.object(chat, "get_db", return_value=db):
        result = chat.reconcile_chat_uploads()
    assert result["migrated"] == 0
    assert _updates(conn) == []
    # 目标文件未被覆盖（target 已存在时跳过复制），旧目录残留被清理
    assert (target / "a.txt").read_text(encoding="utf-8") == "已迁移"
    assert not (old_dir / "a.txt").exists()
    assert result["deleted"] == 1


def test_reconcile_updates_field_even_if_source_missing(dirs):
    """旧格式记录但源文件不存在：storage_name 字段仍更新（幂等），不计数为失败。"""
    rows = [{"id": 3, "user_id": 7, "storage_name": "gone.txt"}]
    db, conn = _mock_db(rows)
    with patch.object(chat, "get_db", return_value=db):
        result = chat.reconcile_chat_uploads()
    assert result["migrated"] == 1
    assert result["failed"] == 0
    updates = _updates(conn)
    assert len(updates) == 1
    assert updates[0][1] == ("uploads/gone.txt", 3)


def test_reconcile_keeps_pending_old_files_and_cleans_orphans(dirs, monkeypatch):
    """迁移失败的旧格式文件保留在旧目录；未被引用的孤儿文件删除。"""
    old_dir = chat.CHAT_UPLOAD_DIR
    (old_dir / "pending.txt").write_text("待迁移", encoding="utf-8")
    (old_dir / "orphan.txt").write_text("孤儿", encoding="utf-8")
    # pending.txt 是旧格式记录；复制阶段抛异常 → 迁移失败，文件应保留在旧目录
    rows = [{"id": 1, "user_id": 7, "storage_name": "pending.txt"}]
    db, conn = _mock_db(rows)

    def _boom(*a, **k):
        raise OSError("disk full")

    monkeypatch.setattr(chat.shutil, "copy2", _boom)
    with patch.object(chat, "get_db", return_value=db):
        result = chat.reconcile_chat_uploads()
    assert result["failed"] == 1
    assert (old_dir / "pending.txt").exists()  # 未迁移成功的旧格式文件受保护
    assert not (old_dir / "orphan.txt").exists()  # 孤儿文件被清理
    assert result["deleted"] == 1


# ---------- reconcile：回收站过期清理 ----------

def test_reconcile_purges_expired_trash(dirs):
    trash = dirs / "user_8" / ".trash"
    trash.mkdir(parents=True)
    expired = trash / "expired.txt"
    expired.write_text("过期", encoding="utf-8")
    fresh = trash / "fresh.txt"
    fresh.write_text("新鲜", encoding="utf-8")
    old = time.time() - 31 * 86400
    os.utime(expired, (old, old))
    db, conn = _mock_db([])
    with patch.object(chat, "get_db", return_value=db):
        result = chat.reconcile_chat_uploads()
    assert result["trash_purged"] == 1
    assert not expired.exists()
    assert fresh.exists()


# ---------- _remove_chat_uploads：新旧格式各删一个 ----------

def test_remove_chat_uploads_new_and_old_format(dirs):
    old_dir = chat.CHAT_UPLOAD_DIR
    (old_dir / "old.txt").write_text("旧", encoding="utf-8")
    uploads = dirs / "user_7" / "uploads"
    uploads.mkdir(parents=True)
    (uploads / "new.txt").write_text("新", encoding="utf-8")

    chat._remove_chat_uploads(7, ["uploads/new.txt", "old.txt"])

    assert not (uploads / "new.txt").exists()
    assert not (old_dir / "old.txt").exists()
    # 其他目录不受影响
    assert (dirs / "user_7").is_dir()


def test_remove_chat_uploads_legacy_signature(dirs):
    """兼容旧调用 _remove_chat_uploads(storage_names)（无 user_id）。"""
    old_dir = chat.CHAT_UPLOAD_DIR
    (old_dir / "legacy.txt").write_text("旧", encoding="utf-8")
    chat._remove_chat_uploads(["legacy.txt"])
    assert not (old_dir / "legacy.txt").exists()


def test_remove_chat_uploads_removes_empty_uploads_dir(dirs):
    uploads = dirs / "user_9" / "uploads"
    uploads.mkdir(parents=True)
    (uploads / "only.txt").write_text("x", encoding="utf-8")
    chat._remove_chat_uploads(9, ["uploads/only.txt"])
    assert not (uploads / "only.txt").exists()
    assert not uploads.exists()  # 空 uploads 目录被顺带移除
