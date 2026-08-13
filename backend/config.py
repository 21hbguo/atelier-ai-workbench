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
def _safe_json_list(s: str, default: list):
    try:
        v = json.loads((s or "").strip() or "[]")
        return v if isinstance(v, list) else list(default)
    except Exception:
        return list(default)

# 服务器配置
HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", 8000))

# 文件限制
MAX_FILE_SIZE_MB = int(os.getenv("MAX_FILE_SIZE_MB", 20))
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
USER_WORKSPACES_DIR = DATA_DIR / "user_workspaces"
GENERATED_IMAGES_DIR = DATA_DIR / "images"
THUMBS_DIR = DATA_DIR / "thumbs"
EVO_IMAGES_DIR = Path(os.getenv("EVO_IMAGES_DIR", str(DATA_DIR / "evo_images")))
EVO_THUMBS_DIR = DATA_DIR / "evo_thumbs"
EVO_IMPORTED_DIR = DATA_DIR / "evo_images"

# 确保目录存在
for directory in [DATA_DIR, UPLOAD_DIR, USER_WORKSPACES_DIR, GENERATED_IMAGES_DIR, THUMBS_DIR, EVO_THUMBS_DIR, EVO_IMPORTED_DIR]:
    directory.mkdir(parents=True, exist_ok=True)

# 运行时可修改的配置
CONFIG_FILE = DATA_DIR / "config.json"
ENV_FILE = PROJECT_ROOT / ".env"

# 敏感字段：config.json 中不保存，改为存入 .env
_SENSITIVE_KEYS = {
    "api_key": "IMAGE_GEN_API_KEY",
    "github_hosting_token": "GITHUB_HOSTING_TOKEN",
    "smtp_password": "SMTP_PASSWORD",
    "smtp_sender": "SMTP_SENDER",
    "sendgrid_api_key": "SENDGRID_API_KEY",
    "sendgrid_sender": "SENDGRID_SENDER",
    "resend_api_key": "RESEND_API_KEY",
    "llm_api_key": "LLM_API_KEY",
    "turnstile_secret_key": "TURNSTILE_SECRET_KEY",
    "vmq_notify_secret": "VMQ_NOTIFY_SECRET",
}

def _update_env_file(key: str, value: str):
    """更新 .env 文件中的指定 key，不存在则追加"""
    lines = []
    if ENV_FILE.exists():
        lines = ENV_FILE.read_text(encoding="utf-8").splitlines(keepends=True)
    found = False
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("#") or "=" not in stripped:
            continue
        if stripped.split("=", 1)[0].strip() == key:
            lines[i] = f"{key}={value}\n"
            found = True
            break
    if not found:
        if lines and not lines[-1].endswith("\n"):
            lines[-1] += "\n"
        lines.append(f"{key}={value}\n")
    ENV_FILE.write_text("".join(lines), encoding="utf-8")

_runtime_config = {
    "api_url": os.getenv("IMAGE_GEN_API_URL", "https://api.wuyinkeji.com/api/async"),
    "api_key": os.getenv("IMAGE_GEN_API_KEY", ""),
    "register_enabled": os.getenv("REGISTER_ENABLED", "true").lower() in {"1", "true", "yes", "on"},
    "show_login_sessions": os.getenv("SHOW_LOGIN_SESSIONS", "false").lower() in {"1", "true", "yes", "on"},
    "image_hosting_upload_url": os.getenv("IMAGE_HOSTING_UPLOAD_URL", "https://img.heliar.top/upload"),
    "image_hosting_base_url": os.getenv("IMAGE_HOSTING_BASE_URL", "https://img.heliar.top"),
    "image_hosting_referer": os.getenv("IMAGE_HOSTING_REFERER", "https://img.heliar.top/"),
    "wechat_pay_qr_url": os.getenv("WECHAT_PAY_QR_URL", ""),
    "alipay_pay_qr_url": os.getenv("ALIPAY_PAY_QR_URL", ""),
    "donation_contact": os.getenv("DONATION_CONTACT", ""),
    "manual_recharge_notice": os.getenv("MANUAL_RECHARGE_NOTICE", "支持 Atelier 持续承担模型、图床与服务器成本。你可按需充值支持平台运行，审核通过后按页面公示档位赠送对应积分。请备注账号并上传支付凭证，发放完成后不支持回退。"),
    "recharge_packages": _safe_json_list(os.getenv("RECHARGE_PACKAGES_JSON", ""), [{"amount": 10, "points": 100, "label": "轻量支持"}, {"amount": 30, "points": 300, "label": "常用支持"}, {"amount": 50, "points": 500, "label": "高频支持"}]),
    "recharge_random_discount_min": float(os.getenv("RECHARGE_RANDOM_DISCOUNT_MIN", "0.01")),
    "recharge_random_discount_max": float(os.getenv("RECHARGE_RANDOM_DISCOUNT_MAX", "0.50")),
    "generate_concurrent_limit_per_user": int(os.getenv("GENERATE_CONCURRENT_LIMIT_PER_USER", "10")),
    "home_page_size": int(os.getenv("HOME_PAGE_SIZE", "24")),
    "square_page_size": int(os.getenv("SQUARE_PAGE_SIZE", "20")),
    "points_cost_per_generation": float(os.getenv("POINTS_COST_PER_GENERATION", "10")),
    "points_cost_per_optimize": float(os.getenv("POINTS_COST_PER_OPTIMIZE", "10")),
    "points_cost_per_optimize_refine": float(os.getenv("POINTS_COST_PER_OPTIMIZE_REFINE", "20")),
    "points_cost_per_chat": float(os.getenv("POINTS_COST_PER_CHAT", "1")),
    "ai_daily_free_quota": int(os.getenv("AI_DAILY_FREE_QUOTA", "5")),
    "chat_max_sessions": int(os.getenv("CHAT_MAX_SESSIONS", "50")),
    "chat_max_messages": int(os.getenv("CHAT_MAX_MESSAGES", "100")),
    "chat_rate_limit_per_minute": int(os.getenv("CHAT_RATE_LIMIT_PER_MINUTE", "10")),
    "chat_context_max_chars": int(os.getenv("CHAT_CONTEXT_MAX_CHARS", "256000")),
    "points_checkin_reward": int(os.getenv("POINTS_CHECKIN_REWARD", "10")),
    "points_cost_per_image_extend": float(os.getenv("POINTS_COST_PER_IMAGE_EXTEND", "2")),
    "points_register_bonus": int(os.getenv("POINTS_REGISTER_BONUS", "50")),
    "points_migration_amount": int(os.getenv("POINTS_MIGRATION_AMOUNT", "50")),
    "points_unit_version": int(os.getenv("POINTS_UNIT_VERSION", "100")),
    "points_per_rmb": float(os.getenv("POINTS_PER_RMB", "100")),
    "usd_cny_fx_rate": float(os.getenv("USD_CNY_FX_RATE", "7.2")),
    "platform_markup": float(os.getenv("PLATFORM_MARKUP", "1")),
    "min_charge_points": int(os.getenv("MIN_CHARGE_POINTS", "1")),
    "rounding_mode": os.getenv("POINTS_ROUNDING_MODE", "ceil"),
    "invite_enabled": os.getenv("INVITE_ENABLED", "true").lower() in {"1", "true", "yes", "on"},
    "invite_register_reward_points": int(os.getenv("INVITE_REGISTER_REWARD_POINTS", "20")),
    "invite_recharge_rebate_percent": float(os.getenv("INVITE_RECHARGE_REBATE_PERCENT", "10")),
    "invite_recharge_bonus_percent": float(os.getenv("INVITE_RECHARGE_BONUS_PERCENT", "10")),
    "login_rate_limit_per_minute_per_ip": int(os.getenv("LOGIN_RATE_LIMIT_PER_MINUTE_PER_IP", "5")),
    "register_rate_limit_per_minute_per_ip": int(os.getenv("REGISTER_RATE_LIMIT_PER_MINUTE_PER_IP", "3")),
    "default_model_id": os.getenv("GEN_DEFAULT_MODEL_ID", "gpt-image-2"),
    "generation_models": _safe_json_obj(os.getenv("GENERATION_MODELS_JSON", ""), {}),
    "generation_providers": _safe_json_obj(os.getenv("GENERATION_PROVIDERS_JSON", ""), {}),
    "cost_profit_config": _safe_json_obj(os.getenv("COST_PROFIT_CONFIG_JSON", ""), {}),
    "cost_profit_launch_at": os.getenv("COST_PROFIT_LAUNCH_AT", ""),
    "github_hosting_enabled": os.getenv("GITHUB_HOSTING_ENABLED", "false").lower() in {"1", "true", "yes", "on"},
    "github_hosting_repo": os.getenv("GITHUB_HOSTING_REPO", ""),
    "github_hosting_token": os.getenv("GITHUB_HOSTING_TOKEN", ""),
    "github_hosting_branch": os.getenv("GITHUB_HOSTING_BRANCH", "main"),
    "smtp_server": os.getenv("SMTP_SERVER", "smtp.qq.com"),
    "smtp_port": int(os.getenv("SMTP_PORT", "465")),
    "smtp_password": os.getenv("SMTP_PASSWORD", ""),
    "smtp_sender": os.getenv("SMTP_SENDER", ""),
    "smtp_sender_name": os.getenv("SMTP_SENDER_NAME", "Atelier · AI 工作台"),
    "sendgrid_api_key": os.getenv("SENDGRID_API_KEY", ""),
    "sendgrid_sender": os.getenv("SENDGRID_SENDER", ""),
    "resend_api_key": os.getenv("RESEND_API_KEY", ""),
    "resend_sender": os.getenv("RESEND_SENDER", "onboarding@resend.dev"),
    "turnstile_site_key": os.getenv("TURNSTILE_SITE_KEY", ""),
    "turnstile_secret_key": os.getenv("TURNSTILE_SECRET_KEY", ""),
    "llm_base_url": os.getenv("LLM_BASE_URL", "https://token-plan-cn.xiaomimimo.com/anthropic"),
    "llm_api_key": os.getenv("LLM_API_KEY", "REDACTED_API_KEY"),
    "llm_model": os.getenv("LLM_MODEL", "mimo-v2.5"),
    "llm_max_tokens": int(os.getenv("LLM_MAX_TOKENS", "2000")),
    "llm_timeout_seconds": int(os.getenv("LLM_TIMEOUT_SECONDS", "300")),
    "prompt_optimize_enabled": os.getenv("PROMPT_OPTIMIZE_ENABLED", "true").lower() in {"1", "true", "yes", "on"},
    "prompt_refine_enabled": os.getenv("PROMPT_REFINE_ENABLED", "true").lower() in {"1", "true", "yes", "on"},
    "prompt_embedding_model": os.getenv("PROMPT_EMBEDDING_MODEL", "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"),
    "prompt_embedding_batch_size": int(os.getenv("PROMPT_EMBEDDING_BATCH_SIZE", "4")),
    "prompt_embedding_dir": os.getenv("PROMPT_EMBEDDING_DIR", str(DATA_DIR / "prompt_embeddings")),
    "vmq_notify_secret": os.getenv("VMQ_NOTIFY_SECRET", ""),
}
_runtime_config_defaults = dict(_runtime_config)
if not _runtime_config["generation_models"]:
    _runtime_config["generation_models"]={"gpt-image-2":{"label":"默认模型","capability":"image","enabled":True,"providers":["wuyin-main"]}}
if not _runtime_config["generation_providers"]:
    _runtime_config["generation_providers"]={"wuyin-main":{"type":"wuyin","enabled":True,"priority":100,"api_url":"","api_key":"","circuit_fail_threshold":3,"circuit_cooldown_seconds":60,"unit_name":"供应商积分","unit_code":"vendor_points"}}

def _vip_resolution_options():
    return [{"value":"low","label":"1K"},{"value":"medium","label":"2K"},{"value":"high","label":"4K"}]

def _image_ratio_options():
    return [{"value":"auto","label":"自动"},{"value":"1:1","label":"1:1"},{"value":"3:2","label":"3:2"},{"value":"2:3","label":"2:3"},{"value":"4:3","label":"4:3"},{"value":"3:4","label":"3:4"},{"value":"16:9","label":"16:9"},{"value":"9:16","label":"9:16"}]

def _vip_quality_options():
    return [{"value":"auto","label":"自动"},{"value":"low","label":"低"},{"value":"medium","label":"中"},{"value":"high","label":"高"}]

def _vip_resolution_costs(params: dict):
    if not isinstance(params,dict): return {"auto":15,"low":15,"medium":25,"high":40}
    raw=params.get("resolution_costs") or {}
    def _to_points(value, fallback: float):
        try:return round(max(0,float(value)),4)
        except Exception:return round(max(0,float(fallback)),4)
    low=_to_points(raw.get("low",params.get("points_cost",15)),15)
    medium=_to_points(raw.get("medium",25),25)
    high=_to_points(raw.get("high",40),40)
    auto=_to_points(raw.get("auto",low),low)
    return {"auto":auto,"low":low,"medium":medium,"high":high}

def normalize_generation_model_params(model_id: str, model: dict):
    if not isinstance(model,dict): return {}
    out=dict(model)
    params=out.get("params") or {}
    if model_id=="gpt-image-2" and isinstance(params,dict):
        out["params"]={**{k:v for k,v in params.items() if k not in {"size","quality","aspectRatio"}}, "size":{"label":"比例","type":"select","default":"auto","options":_image_ratio_options()}}
        return out
    if model_id!="grsai-vip" or not isinstance(params,dict): return out
    resolution_costs=_vip_resolution_costs(params)
    out["params"]={**{k:v for k,v in params.items() if k not in {"size","quality","aspectRatio","resolution","points_cost","resolution_costs"}}, "points_cost":resolution_costs.get("low",15),"resolution_costs":resolution_costs,"size":{"label":"比例","type":"select","default":"auto","options":_image_ratio_options()},"resolution":{"label":"分辨率","type":"select","default":"low","options":_vip_resolution_options()},"quality":{"label":"画质","type":"select","default":"auto","options":_vip_quality_options()}}
    return out


def _provider_env_key(provider_name: str) -> str:
    return f"PROVIDER_{provider_name.upper().replace('-', '_')}_API_KEY"

def _load_runtime_config():
    global _runtime_config
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
            for k, v in saved.items():
                if k not in _SENSITIVE_KEYS:
                    _runtime_config[k] = v
        except Exception:
            pass
    # 从 .env 恢复供应商 api_key
    if "generation_providers" in _runtime_config:
        for pk, pv in _runtime_config["generation_providers"].items():
            env_val = os.getenv(_provider_env_key(pk))
            if env_val:
                pv["api_key"] = env_val


def _save_runtime_config():
    to_save = {k: v for k, v in _runtime_config.items() if k not in _SENSITIVE_KEYS}
    # 供应商 api_key 写入 .env，config.json 中清除
    if "generation_providers" in to_save:
        for pk, pv in to_save["generation_providers"].items():
            if "api_key" in pv and pv["api_key"]:
                _update_env_file(_provider_env_key(pk), pv["api_key"])
        to_save["generation_providers"] = {
            pk: {k: v for k, v in pv.items() if k != "api_key"}
            for pk, pv in to_save["generation_providers"].items()
        }
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(to_save, f, ensure_ascii=False, indent=2)


def get_config():
    return dict(_runtime_config)


def update_config(new_values: dict):
    if "recharge_packages" in new_values:
        new_values["recharge_packages"] = normalize_recharge_packages(new_values.get("recharge_packages"))
    # 敏感字段写入 .env，其余写入 config.json
    for k, env_key in _SENSITIVE_KEYS.items():
        if k in new_values:
            _update_env_file(env_key, str(new_values[k]))
    _runtime_config.update(new_values)
    _save_runtime_config()
def get_limit_config():
    cfg = get_config()
    out = {}
    point_cost_keys = {"points_cost_per_generation", "points_cost_per_optimize", "points_cost_per_optimize_refine", "points_cost_per_chat", "points_cost_per_image_extend"}
    for k in ["generate_concurrent_limit_per_user", "home_page_size", "square_page_size", "points_cost_per_generation", "points_cost_per_optimize", "points_cost_per_optimize_refine", "points_cost_per_chat", "chat_max_sessions", "chat_max_messages", "chat_rate_limit_per_minute", "chat_context_max_chars", "points_cost_per_image_extend", "points_checkin_reward", "points_register_bonus", "points_migration_amount", "invite_register_reward_points", "login_rate_limit_per_minute_per_ip", "register_rate_limit_per_minute_per_ip", "ai_daily_free_quota"]:
        try:
            v = float(cfg.get(k, _runtime_config_defaults[k])) if k in point_cost_keys else int(cfg.get(k, _runtime_config_defaults[k]))
        except Exception:
            v = float(_runtime_config_defaults[k]) if k in point_cost_keys else int(_runtime_config_defaults[k])
        out[k] = v if v >= 0 else (float(_runtime_config_defaults[k]) if k in point_cost_keys else int(_runtime_config_defaults[k]))
    if out["generate_concurrent_limit_per_user"] < 1: out["generate_concurrent_limit_per_user"] = 1
    if out["home_page_size"] < 1: out["home_page_size"] = 1
    if out["square_page_size"] < 1: out["square_page_size"] = 1
    if out["points_cost_per_generation"] <= 0: out["points_cost_per_generation"] = 0.0001
    if out["points_cost_per_optimize"] <= 0: out["points_cost_per_optimize"] = 0.0001
    if out["points_cost_per_optimize_refine"] <= 0: out["points_cost_per_optimize_refine"] = 0.0001
    if out["points_cost_per_chat"] <= 0: out["points_cost_per_chat"] = 0.0001
    if out["ai_daily_free_quota"] < 0: out["ai_daily_free_quota"] = 0
    if out["chat_max_sessions"] < 1: out["chat_max_sessions"] = 1
    if out["chat_max_messages"] < 1: out["chat_max_messages"] = 1
    if out["chat_rate_limit_per_minute"] < 1: out["chat_rate_limit_per_minute"] = 1
    if out["chat_context_max_chars"] < 1000: out["chat_context_max_chars"] = 1000
    if out["points_cost_per_image_extend"] <= 0: out["points_cost_per_image_extend"] = 0.0001
    if out["points_checkin_reward"] < 0: out["points_checkin_reward"] = 0
    if out["points_register_bonus"] < 0: out["points_register_bonus"] = 0
    if out["points_migration_amount"] < 0: out["points_migration_amount"] = 0
    if out["invite_register_reward_points"] < 0: out["invite_register_reward_points"] = 0
    if out["login_rate_limit_per_minute_per_ip"] < 1: out["login_rate_limit_per_minute_per_ip"] = 1
    if out["register_rate_limit_per_minute_per_ip"] < 1: out["register_rate_limit_per_minute_per_ip"] = 1
    return out


def get_billing_config():
    cfg = get_config()
    defaults = _runtime_config_defaults
    try:
        points_per_rmb = float(cfg.get("points_per_rmb", defaults["points_per_rmb"]))
    except (TypeError, ValueError):
        points_per_rmb = defaults["points_per_rmb"]
    try:
        fx_rate = float(cfg.get("usd_cny_fx_rate", defaults["usd_cny_fx_rate"]))
    except (TypeError, ValueError):
        fx_rate = defaults["usd_cny_fx_rate"]
    try:
        markup = float(cfg.get("platform_markup", defaults["platform_markup"]))
    except (TypeError, ValueError):
        markup = defaults["platform_markup"]
    try:
        min_charge = int(cfg.get("min_charge_points", defaults["min_charge_points"]))
    except (TypeError, ValueError):
        min_charge = defaults["min_charge_points"]
    return {
        "points_unit_version": int(cfg.get("points_unit_version", defaults["points_unit_version"])),
        "points_per_rmb": max(1.0, points_per_rmb),
        "usd_cny_fx_rate": max(0.0001, fx_rate),
        "platform_markup": max(0.0001, markup),
        "min_charge_points": max(1, min_charge),
        "rounding_mode": "ceil",
    }
def get_invite_config():
    cfg=get_config()
    def _to_float(v,d=0):
        try:return float(v)
        except Exception:return float(d)
    rebate=max(0.0,_to_float(cfg.get("invite_recharge_rebate_percent",_runtime_config_defaults["invite_recharge_rebate_percent"]),_runtime_config_defaults["invite_recharge_rebate_percent"]))
    bonus=max(0.0,_to_float(cfg.get("invite_recharge_bonus_percent",_runtime_config_defaults["invite_recharge_bonus_percent"]),_runtime_config_defaults["invite_recharge_bonus_percent"]))
    return {"invite_enabled":bool(cfg.get("invite_enabled",True)),"invite_register_reward_points":max(0,int(cfg.get("invite_register_reward_points",_runtime_config_defaults["invite_register_reward_points"]) or 0)),"invite_recharge_rebate_percent":rebate,"invite_recharge_bonus_percent":bonus}


def is_register_enabled():
    return bool(_runtime_config.get("register_enabled", True))


def get_turnstile_config():
    site_key=(_runtime_config.get("turnstile_site_key") or "").strip()
    secret_key=(_runtime_config.get("turnstile_secret_key") or "").strip()
    return {"enabled":bool(site_key and secret_key),"site_key":site_key,"secret_key":secret_key}


def get_email_delivery_config():
    return {"smtp_server":_runtime_config.get("smtp_server","smtp.qq.com"),"smtp_port":int(_runtime_config.get("smtp_port",465)),"smtp_password":_runtime_config.get("smtp_password",""),"smtp_sender":_runtime_config.get("smtp_sender",""),"smtp_sender_name":_runtime_config.get("smtp_sender_name","Atelier · AI 工作台"),"sendgrid_api_key":(_runtime_config.get("sendgrid_api_key") or "").strip(),"sendgrid_sender":(_runtime_config.get("sendgrid_sender") or "").strip(),"resend_api_key":(_runtime_config.get("resend_api_key") or "").strip(),"resend_sender":(_runtime_config.get("resend_sender") or "onboarding@resend.dev").strip()}


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


def is_github_hosting_enabled():
    return bool(_runtime_config.get("github_hosting_enabled"))


def GITHUB_HOSTING_REPO():
    return _runtime_config.get("github_hosting_repo", "")


def GITHUB_HOSTING_TOKEN():
    return _runtime_config.get("github_hosting_token", "")


def GITHUB_HOSTING_BRANCH():
    return _runtime_config.get("github_hosting_branch", "main")


def get_default_model_id():
    return (_runtime_config.get("default_model_id") or "gpt-image-2").strip() or "gpt-image-2"


def get_generation_models():
    models = _runtime_config.get("generation_models") or {}
    if not isinstance(models, dict): return {}
    return {model_id:normalize_generation_model_params(model_id,model) for model_id,model in models.items()}


def get_generation_providers():
    providers = _runtime_config.get("generation_providers") or {}
    if not isinstance(providers, dict): return {}
    out={}
    for pid,p in providers.items():
        if isinstance(p,dict):
            out[pid]={**p,"unit_name":p.get("unit_name") or "供应商额度","unit_code":p.get("unit_code") or "vendor_quota"}
    return out
def normalize_recharge_packages(items):
    raw=items if isinstance(items,list) else _runtime_config_defaults.get("recharge_packages") or []
    out=[]
    for i,item in enumerate(raw):
        if not isinstance(item,dict): continue
        try:
            amount=round(float(item.get("amount") or 0),2)
            points=int(item.get("points") or 0)
        except Exception:
            continue
        if amount<=0 or points<=0: continue
        label=str(item.get("label") or f"套餐{i+1}").strip()[:32] or f"套餐{i+1}"
        out.append({"amount":amount,"points":points,"label":label})
    if out: return out
    return [{"amount":10,"points":100,"label":"轻量支持"},{"amount":30,"points":300,"label":"常用支持"},{"amount":50,"points":500,"label":"高频支持"}]
def get_recharge_packages():
    return normalize_recharge_packages(_runtime_config.get("recharge_packages"))
def get_recharge_random_discount_range():
    def _to_float(v,d):
        try:return round(float(v),2)
        except Exception:return round(float(d),2)
    min_v=max(0.01,_to_float(_runtime_config.get("recharge_random_discount_min",_runtime_config_defaults.get("recharge_random_discount_min",0.01)),_runtime_config_defaults.get("recharge_random_discount_min",0.01)))
    max_v=max(0.01,_to_float(_runtime_config.get("recharge_random_discount_max",_runtime_config_defaults.get("recharge_random_discount_max",0.50)),_runtime_config_defaults.get("recharge_random_discount_max",0.50)))
    if max_v<min_v:max_v=min_v
    return {"min":min_v,"max":max_v}


def get_smtp_config():
    return {
        "server": _runtime_config.get("smtp_server", "smtp.qq.com"),
        "port": int(_runtime_config.get("smtp_port", 465)),
        "password": _runtime_config.get("smtp_password", ""),
        "sender": _runtime_config.get("smtp_sender", ""),
        "sender_name": _runtime_config.get("smtp_sender_name", "Atelier · AI 工作台"),
    }


def get_llm_config():
    return {
        "base_url": _runtime_config.get("llm_base_url", "https://token-plan-cn.xiaomimimo.com/anthropic"),
        "api_key": _runtime_config.get("llm_api_key", ""),
        "model": _runtime_config.get("llm_model", "mimo-v2.5"),
        "max_tokens": int(_runtime_config.get("llm_max_tokens", 2000)),
        "timeout_seconds": int(_runtime_config.get("llm_timeout_seconds", 30)),
        "enabled": bool(_runtime_config.get("prompt_optimize_enabled", True)),
        # 协议：openai（OpenAI 兼容 /chat/completions）或 anthropic（/v1/messages）；留空则按 base_url 推断
        "protocol": str(_runtime_config.get("llm_protocol", "")).strip().lower(),
    }


def get_prompt_embedding_config():
    d=Path(str(_runtime_config.get("prompt_embedding_dir") or (DATA_DIR / "prompt_embeddings")));d.mkdir(parents=True,exist_ok=True)
    return {"enabled":bool(_runtime_config.get("prompt_refine_enabled",True)),"model":str(_runtime_config.get("prompt_embedding_model") or "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2").strip() or "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2","batch_size":max(1,int(_runtime_config.get("prompt_embedding_batch_size",32) or 32)),"dir":d}


_load_runtime_config()
