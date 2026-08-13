from backend import config
from backend.services import image_expiry


def test_remove_generated_image_thumbnails(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "THUMBS_DIR", tmp_path)
    monkeypatch.setattr(image_expiry, "THUMBS_DIR", tmp_path)
    target = tmp_path / "400_task-1_0.webp"
    target.write_bytes(b"thumb")
    other = tmp_path / "400_task-2_0.webp"
    other.write_bytes(b"thumb")

    image_expiry.remove_generated_image_thumbnails("task-1_0.png")

    assert not target.exists()
    assert other.exists()
