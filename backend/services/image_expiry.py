from __future__ import annotations
import asyncio
import logging
import math
import os
from datetime import datetime, timedelta
from backend.config import GENERATED_IMAGES_DIR, is_github_hosting_enabled, get_limit_config
from backend.database import get_db
from backend.services.task_manager import TaskManager
logger=logging.getLogger(__name__)
EXTEND_DAYS=3
EXTEND_COST_PER_IMAGE=2
RETENTION_DAYS=2
IMAGE_EXTEND_TX_TYPE="image_expire_extend"
IMAGE_GENERATED_TX_TYPE="image_generated"
GITHUB_REPO_SIZE_LIMIT_MB=200


def _detect_hosting_type(url: str) -> str:
    if "cdn.jsdelivr.net" in url:
        return "github"
    return "heliar"
def _now():
    return datetime.now()
def get_extend_cost_per_image():
    try:return max(1,int(get_limit_config().get("points_cost_per_image_extend",EXTEND_COST_PER_IMAGE)))
    except Exception:return EXTEND_COST_PER_IMAGE
def _parse_dt(v):
    if not v: return None
    if isinstance(v, datetime): return v
    s=str(v).strip()
    if not s: return None
    try:
        return datetime.fromisoformat(s.replace("Z", ""))
    except Exception:
        try:
            return datetime.strptime(s, "%Y-%m-%d %H:%M:%S")
        except Exception:
            return None

def _fmt_dt(v):
    return v.strftime("%Y-%m-%d %H:%M:%S") if isinstance(v, datetime) else None

def get_expiry_data(raw: dict | None) -> dict:
    d=dict(raw or {})
    created_at=_parse_dt(d.get("created_at"))
    expires_at=_parse_dt(d.get("expires_at"))
    is_permanent=bool(d.get("is_permanent"))
    if not is_permanent and not expires_at and created_at:
        expires_at=created_at+timedelta(days=RETENTION_DAYS)
    now=_now()
    if is_permanent:
        days_left=None
        expired=False
    elif not expires_at:
        days_left=None
        expired=False
    else:
        delta=expires_at-now
        days_left=max(0, math.ceil(delta.total_seconds()/86400))
        expired=delta.total_seconds()<=0
    return {"expires_at":_fmt_dt(expires_at),"is_permanent":is_permanent,"days_left":days_left,"expired":expired,"retention_days":RETENTION_DAYS,"extend_days":EXTEND_DAYS,"extend_cost":get_extend_cost_per_image()}

def mark_image_permanent(filename: str, conn=None) -> None:
    def _run(c):
        c.execute("UPDATE image_metadata SET is_permanent = TRUE, expires_at = NULL WHERE filename = %s", (filename,))
    if conn is not None:
        _run(conn)
        return
    with get_db() as c:
        _run(c)
def refresh_permanent_flags_by_filenames(filenames: list[str], conn=None) -> int:
    names=[str(x).strip() for x in (filenames or []) if str(x).strip()]
    names=list(dict.fromkeys(names))
    if not names:
        return 0
    def _run(c):
        placeholders=",".join(["%s"]*len(names))
        cur=c.execute(f"UPDATE image_metadata m SET is_permanent = CASE WHEN EXISTS (SELECT 1 FROM square_images s WHERE s.filename = m.filename) THEN TRUE ELSE FALSE END, expires_at = CASE WHEN EXISTS (SELECT 1 FROM square_images s WHERE s.filename = m.filename) THEN NULL ELSE COALESCE(m.expires_at, COALESCE(m.created_at, NOW()) + interval '2 day') END WHERE m.filename IN ({placeholders})", names)
        return cur.rowcount
    if conn is not None:
        return _run(conn)
    with get_db() as c:
        return _run(c)

def set_generated_image_expiry(filename: str, created_at: datetime | None = None, conn=None) -> dict:
    created_at=created_at or _now()
    expires_at=created_at+timedelta(days=RETENTION_DAYS)
    payload={"expires_at":_fmt_dt(expires_at),"is_permanent":False}
    def _run(c):
        c.execute("UPDATE image_metadata SET created_at = COALESCE(created_at, %s), expires_at = COALESCE(expires_at, %s), is_permanent = COALESCE(is_permanent, FALSE) WHERE filename = %s", (_fmt_dt(created_at), _fmt_dt(expires_at), filename))
    if conn is not None:
        _run(conn)
    else:
        with get_db() as c:
            _run(c)
    return payload

def extend_images(filenames: list[str], user_id: int) -> dict:
    filenames=[f for f in dict.fromkeys([str(x).strip() for x in filenames if str(x).strip()]) if f]
    if not filenames:
        return {"success": [], "skipped": [], "failed": [], "total_cost": 0, "points": None}
    with get_db() as conn:
        user=conn.execute("SELECT id, points, is_admin FROM users WHERE id = %s", (user_id,)).fetchone()
        if not user:
            raise ValueError("用户不存在")
        rows=conn.execute(f"SELECT m.filename,m.expires_at,m.is_permanent,m.user_id,s.id AS square_id FROM image_metadata m LEFT JOIN square_images s ON s.filename = m.filename WHERE m.filename IN ({','.join(['%s']*len(filenames))})", filenames).fetchall()
        row_map={r["filename"]: r for r in rows}
        success=[]
        skipped=[]
        failed=[]
        eligible=[]
        for filename in filenames:
            row=row_map.get(filename)
            if not row:
                failed.append({"filename": filename, "reason": "图片不存在"})
                continue
            if (not user["is_admin"]) and row["user_id"] != user_id:
                failed.append({"filename": filename, "reason": "无权限"})
                continue
            if row["square_id"] or row["is_permanent"]:
                skipped.append({"filename": filename, "reason": "广场图片无需延长"})
                continue
            eligible.append(filename)
        total_cost=len(eligible)*get_extend_cost_per_image()
        if total_cost <= 0:
            return {"success": success, "skipped": skipped, "failed": failed, "total_cost": 0, "points": None}
        if user["points"] < total_cost:
            raise ValueError("积分不足")
        cursor=conn.execute("UPDATE users SET points = points - %s WHERE id = %s AND points >= %s", (total_cost, user_id, total_cost))
        if cursor.rowcount <= 0:
            raise ValueError("积分不足")
        new_balance=conn.execute("SELECT points FROM users WHERE id = %s", (user_id,)).fetchone()["points"]
        conn.execute("INSERT INTO point_transactions (user_id, amount, balance_after, type, description) VALUES (%s, %s, %s, %s, %s)", (user_id, -total_cost, new_balance, IMAGE_EXTEND_TX_TYPE, f"延长图片有效期 {len(eligible)} 张"))
        for filename in eligible:
            row=row_map[filename]
            base=_parse_dt(row["expires_at"]) or _now()
            if base < _now():
                base=_now()
            new_expires=base+timedelta(days=EXTEND_DAYS)
            conn.execute("UPDATE image_metadata SET expires_at = %s, is_permanent = FALSE WHERE filename = %s", (_fmt_dt(new_expires), filename))
            success.append({"filename": filename, "expires_at": _fmt_dt(new_expires), "days_left": get_expiry_data({"expires_at": new_expires, "is_permanent": False})["days_left"]})
        return {"success": success, "skipped": skipped, "failed": failed, "total_cost": total_cost, "points": new_balance}

async def cleanup_expired_images() -> dict:
    now=_fmt_dt(_now())
    deleted=0
    missing=0
    failed=0
    with get_db() as conn:
        rows=conn.execute("SELECT filename FROM image_metadata WHERE is_permanent = FALSE AND expires_at IS NOT NULL AND expires_at <= %s", (now,)).fetchall()
        for row in rows:
            filename=row["filename"]
            image_path=GENERATED_IMAGES_DIR / filename
            try:
                if image_path.exists():
                    image_path.unlink()
                    deleted+=1
                else:
                    missing+=1
                conn.execute("DELETE FROM image_metadata WHERE filename = %s", (filename,))
                try:
                    TaskManager.remove_image_from_tasks(str(image_path))
                except Exception:
                    pass
            except Exception:
                failed+=1
                logger.exception(f"cleanup remove file failed filename={filename}")
    return {"deleted": deleted, "missing": missing, "failed": failed}


async def cleanup_expired_hosting_images() -> dict:
    from backend.services.github_image_hosting import GithubImageHostingService
    github_enabled=is_github_hosting_enabled()
    if not github_enabled:
        return {"github_cleanup": 0, "github_failed": 0}
    now=_fmt_dt(_now())
    github_cleanup=0
    github_failed=0
    with get_db() as conn:
        rows=conn.execute("SELECT m.filename, im.delete_token FROM image_metadata m JOIN image_mappings im ON im.local_path = CONCAT(%s, '/', m.filename) WHERE m.is_permanent = FALSE AND m.expires_at IS NOT NULL AND m.expires_at <= %s AND im.url LIKE '%%cdn.jsdelivr.net%%' AND im.delete_token != ''", (str(GENERATED_IMAGES_DIR), now)).fetchall()
        for row in rows:
            filename=row["filename"]
            delete_token=row["delete_token"]
            try:
                if await GithubImageHostingService.delete_image(delete_token):
                    github_cleanup+=1
                else:
                    github_failed+=1
            except Exception:
                github_failed+=1
                logger.exception(f"github hosting cleanup failed filename={filename}")
    return {"github_cleanup": github_cleanup, "github_failed": github_failed}


async def cleanup_dangling_mappings() -> dict:
    from backend.services.github_image_hosting import GithubImageHostingService
    github_enabled=is_github_hosting_enabled()
    if not github_enabled:
        return {"cleaned": 0, "github_deleted": 0, "github_failed": 0}
    cleaned=0
    github_deleted=0
    github_failed=0
    with get_db() as conn:
        rows=conn.execute("SELECT id, local_path, url, delete_token FROM image_mappings WHERE url LIKE '%%cdn.jsdelivr.net%%' AND delete_token != ''").fetchall()
        for row in rows:
            local_path=row["local_path"]
            if not os.path.exists(local_path):
                try:
                    if await GithubImageHostingService.delete_image(row["delete_token"]):
                        github_deleted+=1
                    else:
                        github_failed+=1
                except Exception:
                    github_failed+=1
                conn.execute("DELETE FROM image_mappings WHERE id = %s", (row["id"],))
                cleaned+=1
    return {"cleaned": cleaned, "github_deleted": github_deleted, "github_failed": github_failed}


async def enforce_github_repo_size_limit() -> dict:
    from backend.services.github_image_hosting import GithubImageHostingService
    github_enabled=is_github_hosting_enabled()
    if not github_enabled:
        return {"checked": False, "reason": "GitHub hosting not enabled"}
    size_kb=await GithubImageHostingService.get_repo_size_kb()
    if size_kb is None:
        return {"checked": False, "reason": "unable to get repo size"}
    size_mb=size_kb/1024
    if size_mb<=GITHUB_REPO_SIZE_LIMIT_MB:
        return {"checked": True, "size_mb": round(size_mb, 1), "over_limit": False, "github_deleted": 0}
    logger.warning(f"GitHub repo size {size_mb:.1f}MB exceeds limit {GITHUB_REPO_SIZE_LIMIT_MB}MB")
    github_deleted=0
    github_failed=0
    with get_db() as conn:
        rows=conn.execute("SELECT m.filename, im.delete_token FROM image_metadata m JOIN image_mappings im ON im.local_path = CONCAT(%s, '/', m.filename) WHERE m.is_permanent = FALSE AND im.url LIKE '%%cdn.jsdelivr.net%%' AND im.delete_token != '' ORDER BY m.created_at ASC LIMIT 20", (str(GENERATED_IMAGES_DIR),)).fetchall()
        for row in rows:
            try:
                if await GithubImageHostingService.delete_image(row["delete_token"]):
                    github_deleted+=1
                else:
                    github_failed+=1
            except Exception:
                github_failed+=1
                logger.exception(f"github repo size enforcement delete failed filename={row['filename']}")
    new_size_kb=await GithubImageHostingService.get_repo_size_kb()
    new_size_mb=(new_size_kb/1024) if new_size_kb else None
    return {"checked": True, "size_mb": round(size_mb, 1), "new_size_mb": round(new_size_mb, 1) if new_size_mb else None, "over_limit": new_size_mb is not None and new_size_mb>GITHUB_REPO_SIZE_LIMIT_MB, "github_deleted": github_deleted, "github_failed": github_failed}

async def expiry_cleanup_loop(interval_seconds: int = 3600):
    while True:
        try:
            result=await cleanup_expired_images()
            logger.info(f"image expiry cleanup result={result}")
            hosting_result=await cleanup_expired_hosting_images()
            if hosting_result.get("github_cleanup", 0)>0:
                logger.info(f"hosting image cleanup result={hosting_result}")
            mapping_result=await cleanup_dangling_mappings()
            if mapping_result["cleaned"]>0:
                logger.info(f"dangling mappings cleanup result={mapping_result}")
            size_result=await enforce_github_repo_size_limit()
            if size_result.get("github_deleted", 0)>0:
                logger.info(f"github repo size enforcement result={size_result}")
        except Exception:
            logger.exception("image expiry cleanup crashed")
        await asyncio.sleep(max(60, int(interval_seconds or 3600)))
