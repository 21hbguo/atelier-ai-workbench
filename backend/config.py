import os
import json
from pathlib import Path
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")
def _safe_json_obj(s: str, default: dict):
    try:
        v = json.loads((s or "").strip() or "{}")
        return v if isinstance(v, dict) else dict(default)
    except Exception:
        return dict(default)

# 服务器配置
HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", 8000))

# 文件限制
MAX_FILE_SIZE_MB = int(os.getenv("MAX_FILE_SIZE_MB", 10))
MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024
ALLOWED_EXTENSIONS = set(os.getenv("ALLOWED_EXTENSIONS", "png,jpg,jpeg,webp").split(","))

# 频率限制
RATE_LIMIT_PER_MINUTE = int(os.getenv("RATE_LIMIT_PER_MINUTE", 60))

# PostgreSQL
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://localhost:5432/app_db")
PG_POOL_MIN = int(os.getenv("PG_POOL_MIN", "5"))
PG_POOL_MAX = int(os.getenv("PG_POOL_MAX", "20"))

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
    "generate_concurrent_limit_per_user": int(os.getenv("GENERATE_CONCURRENT_LIMIT_PER_USER", "10")),
    "points_cost_per_generation": int(os.getenv("POINTS_COST_PER_GENERATION", "10")),
    "points_checkin_reward": int(os.getenv("POINTS_CHECKIN_REWARD", "10")),
    "points_register_bonus": int(os.getenv("POINTS_REGISTER_BONUS", "50")),
    "points_migration_amount": int(os.getenv("POINTS_MIGRATION_AMOUNT", "50")),
    "login_rate_limit_per_minute_per_ip": int(os.getenv("LOGIN_RATE_LIMIT_PER_MINUTE_PER_IP", "5")),
    "register_rate_limit_per_minute_per_ip": int(os.getenv("REGISTER_RATE_LIMIT_PER_MINUTE_PER_IP", "3")),
    "default_model_id": os.getenv("GEN_DEFAULT_MODEL_ID", "image-default"),
    "generation_models": _safe_json_obj(os.getenv("GENERATION_MODELS_JSON", ""), {}),
    "generation_providers": _safe_json_obj(os.getenv("GENERATION_PROVIDERS_JSON", ""), {}),
    "cost_profit_config": _safe_json_obj(os.getenv("COST_PROFIT_CONFIG_JSON", ""), {}),
    "cost_profit_launch_at": os.getenv("COST_PROFIT_LAUNCH_AT", ""),
}
_runtime_config_defaults = dict(_runtime_config)
if not _runtime_config["generation_models"]:
    _runtime_config["generation_models"]={"image-default":{"label":"默认模型","capability":"image","enabled":True,"providers":["wuyin-main"]}}
if not _runtime_config["generation_providers"]:
    _runtime_config["generation_providers"]={"wuyin-main":{"type":"wuyin","enabled":True,"priority":100,"api_url":"","api_key":"","circuit_fail_threshold":3,"circuit_cooldown_seconds":60}}


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
def get_limit_config():
    cfg = get_config()
    out = {}
    for k in ["generate_concurrent_limit_per_user", "points_cost_per_generation", "points_checkin_reward", "points_register_bonus", "points_migration_amount", "login_rate_limit_per_minute_per_ip", "register_rate_limit_per_minute_per_ip"]:
        try:
            v = int(cfg.get(k, _runtime_config_defaults[k]))
        except Exception:
            v = int(_runtime_config_defaults[k])
        out[k] = v if v >= 0 else int(_runtime_config_defaults[k])
    if out["generate_concurrent_limit_per_user"] < 1: out["generate_concurrent_limit_per_user"] = 1
    if out["points_cost_per_generation"] < 1: out["points_cost_per_generation"] = 1
    if out["points_checkin_reward"] < 0: out["points_checkin_reward"] = 0
    if out["points_register_bonus"] < 0: out["points_register_bonus"] = 0
    if out["points_migration_amount"] < 0: out["points_migration_amount"] = 0
    if out["login_rate_limit_per_minute_per_ip"] < 1: out["login_rate_limit_per_minute_per_ip"] = 1
    if out["register_rate_limit_per_minute_per_ip"] < 1: out["register_rate_limit_per_minute_per_ip"] = 1
    return out


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


def get_default_model_id():
    return (_runtime_config.get("default_model_id") or "image-default").strip() or "image-default"


def get_generation_models():
    models = _runtime_config.get("generation_models") or {}
    return models if isinstance(models, dict) else {}


def get_generation_providers():
    providers = _runtime_config.get("generation_providers") or {}
    return providers if isinstance(providers, dict) else {}


_load_runtime_config()
