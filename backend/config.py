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
TASKS_JSON = DATA_DIR / "tasks.json"
STATS_JSON = DATA_DIR / "stats.json"
PROMPTS_JSON = DATA_DIR / "prompts.json"
IMAGE_URL_MAPPING_CSV = DATA_DIR / "image_mapping.csv"

# 确保目录存在
for directory in [DATA_DIR, UPLOAD_DIR, GENERATED_IMAGES_DIR, THUMBS_DIR]:
    directory.mkdir(parents=True, exist_ok=True)

# 运行时可修改的配置
CONFIG_FILE = DATA_DIR / "config.json"

_runtime_config = {
    "api_url": os.getenv("IMAGE_GEN_API_URL", "https://api.wuyinkeji.com/api/async"),
    "api_key": os.getenv("IMAGE_GEN_API_KEY", ""),
    "image_hosting_upload_url": os.getenv("IMAGE_HOSTING_UPLOAD_URL", "https://img.heliar.top/upload"),
    "image_hosting_base_url": os.getenv("IMAGE_HOSTING_BASE_URL", "https://img.heliar.top"),
    "image_hosting_referer": os.getenv("IMAGE_HOSTING_REFERER", "https://img.heliar.top/"),
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


_CONFIG_TO_ENV = {
    "api_url": "IMAGE_GEN_API_URL",
    "api_key": "IMAGE_GEN_API_KEY",
    "image_hosting_upload_url": "IMAGE_HOSTING_UPLOAD_URL",
    "image_hosting_base_url": "IMAGE_HOSTING_BASE_URL",
    "image_hosting_referer": "IMAGE_HOSTING_REFERER",
}


def _save_runtime_config():
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(_runtime_config, f, ensure_ascii=False, indent=2)


def _save_to_env():
    env_path = PROJECT_ROOT / ".env"
    lines = []
    if env_path.exists():
        with open(env_path, "r", encoding="utf-8") as f:
            lines = f.readlines()

    updated_keys = set()
    for i, line in enumerate(lines):
        for config_key, env_key in _CONFIG_TO_ENV.items():
            if line.strip().startswith(f"{env_key}="):
                lines[i] = f"{env_key}={_runtime_config[config_key]}\n"
                updated_keys.add(env_key)
                break

    for config_key, env_key in _CONFIG_TO_ENV.items():
        if env_key not in updated_keys:
            lines.append(f"{env_key}={_runtime_config[config_key]}\n")

    with open(env_path, "w", encoding="utf-8") as f:
        f.writelines(lines)


def get_config():
    return dict(_runtime_config)


def update_config(new_values: dict):
    _runtime_config.update(new_values)
    _save_runtime_config()
    _save_to_env()


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
