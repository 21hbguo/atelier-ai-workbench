import os
import json
from pathlib import Path
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

# 服务器配置
HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", 8000))

# 文件限制
MAX_FILE_SIZE_MB = int(os.getenv("MAX_FILE_SIZE_MB", 10))
MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024
ALLOWED_EXTENSIONS = set(os.getenv("ALLOWED_EXTENSIONS", "png,jpg,jpeg,webp").split(","))

# 频率限制
RATE_LIMIT_PER_MINUTE = int(os.getenv("RATE_LIMIT_PER_MINUTE", 60))

# 所有数据统一放在 data/ 下
DATA_DIR = PROJECT_ROOT / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
GENERATED_IMAGES_DIR = DATA_DIR / "images"
THUMBS_DIR = DATA_DIR / "thumbs"
EVO_IMAGES_DIR = Path(os.getenv("EVO_IMAGES_DIR", str(PROJECT_ROOT.parent / "evo" / "images")))
EVO_THUMBS_DIR = DATA_DIR / "evo_thumbs"

# 确保目录存在
for directory in [DATA_DIR, UPLOAD_DIR, GENERATED_IMAGES_DIR, THUMBS_DIR, EVO_THUMBS_DIR]:
    directory.mkdir(parents=True, exist_ok=True)

# 运行时可修改的配置
CONFIG_FILE = DATA_DIR / "config.json"

_runtime_config = {
    "api_url": os.getenv("IMAGE_GEN_API_URL", "https://api.wuyinkeji.com/api/async"),
    "api_key": os.getenv("IMAGE_GEN_API_KEY", ""),
    "image_hosting_upload_url": os.getenv("IMAGE_HOSTING_UPLOAD_URL", "https://img.heliar.top/upload"),
    "image_hosting_base_url": os.getenv("IMAGE_HOSTING_BASE_URL", "https://img.heliar.top"),
    "image_hosting_referer": os.getenv("IMAGE_HOSTING_REFERER", "https://img.heliar.top/"),
    "wechat_pay_qr_url": os.getenv("WECHAT_PAY_QR_URL", ""),
    "alipay_pay_qr_url": os.getenv("ALIPAY_PAY_QR_URL", ""),
    "manual_recharge_notice": os.getenv("MANUAL_RECHARGE_NOTICE", "请备注用户名并在下方提交支付凭证，审核通过后自动发放兑换码"),
}


def _load_runtime_config():
    global _runtime_config
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
            _runtime_config.update(saved)
        except Exception:
            pass


def _save_runtime_config():
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(_runtime_config, f, ensure_ascii=False, indent=2)


def get_config():
    return dict(_runtime_config)


def update_config(new_values: dict):
    _runtime_config.update(new_values)
    _save_runtime_config()


def IMAGE_GEN_API_URL():
    return _runtime_config["api_url"]


def IMAGE_GEN_API_KEY():
    return _runtime_config["api_key"]


def IMAGE_HOSTING_UPLOAD_URL():
    return _runtime_config["image_hosting_upload_url"]


def IMAGE_HOSTING_BASE_URL():
    return _runtime_config["image_hosting_base_url"]


def IMAGE_HOSTING_REFERER():
    return _runtime_config["image_hosting_referer"]


_load_runtime_config()
