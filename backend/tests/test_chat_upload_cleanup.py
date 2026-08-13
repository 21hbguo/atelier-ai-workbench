from backend import config
from backend.routers import chat


def test_remove_chat_uploads_only_uses_chat_upload_dir(tmp_path, monkeypatch):
    chat_uploads = tmp_path / "chat_uploads"
    uploads = tmp_path / "uploads"
    chat_uploads.mkdir()
    uploads.mkdir()
    (chat_uploads / "doc.txt").write_text("chat", encoding="utf-8")
    (uploads / "doc.txt").write_text("other", encoding="utf-8")
    monkeypatch.setattr(config, "CHAT_UPLOAD_DIR", chat_uploads)
    monkeypatch.setattr(chat, "CHAT_UPLOAD_DIR", chat_uploads)

    chat._remove_chat_uploads(["doc.txt"])

    assert not (chat_uploads / "doc.txt").exists()
    assert (uploads / "doc.txt").exists()
