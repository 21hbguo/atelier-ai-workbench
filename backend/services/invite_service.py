import json
import secrets
from datetime import datetime
from fastapi import HTTPException
from backend.config import get_invite_config
from backend.services.points_service import PointsService
SAME_IP_WINDOW_SQL="NOW() - interval '30 day'"

class InviteService:
    CODE_LENGTH=6
    @classmethod
    def is_enabled(cls):
        return bool(get_invite_config().get("invite_enabled",True))
    @classmethod
    def register_reward_points(cls):
        return int(get_invite_config().get("invite_register_reward_points",0) or 0)
    @classmethod
    def recharge_rebate_percent(cls):
        return float(get_invite_config().get("invite_recharge_rebate_percent",0) or 0)
    @classmethod
    def recharge_bonus_percent(cls):
        return float(get_invite_config().get("invite_recharge_bonus_percent",0) or 0)
    @classmethod
    def normalize_code(cls,code:str)->str:
        return (code or "").strip().upper()[:32]
    @classmethod
    def generate_unique_code(cls,conn)->str:
        while True:
            code=secrets.token_urlsafe(8).replace("-","").replace("_","").upper()[:cls.CODE_LENGTH]
            if len(code)<cls.CODE_LENGTH:
                continue
            if not conn.execute("SELECT id FROM users WHERE invite_code=%s",(code,)).fetchone():
                return code
    @classmethod
    def ensure_user_invite_code(cls,user_id:int):
        with __import__("backend.database",fromlist=["get_db"]).get_db() as conn:
            user=conn.execute("SELECT invite_code FROM users WHERE id=%s",(user_id,)).fetchone()
            if not user: raise HTTPException(status_code=404,detail="用户不存在")
            code=(user.get("invite_code") or "").strip() if isinstance(user,dict) else (user["invite_code"] or "").strip()
            if code: return code
            code=cls.generate_unique_code(conn)
            conn.execute("UPDATE users SET invite_code=%s,invite_code_created_at=NOW() WHERE id=%s",(code,user_id))
            return code
    @classmethod
    def find_inviter_by_code(cls,conn,invite_code:str):
        code=cls.normalize_code(invite_code)
        if not code:return None
        row=conn.execute("SELECT id,username,nickname,invite_code,last_ip FROM users WHERE invite_code=%s",(code,)).fetchone()
        return dict(row) if row else None
    @classmethod
    def detect_same_ip(cls,conn,inviter_user_id:int,current_ip:str):
        ip=(current_ip or "").strip()
        if not ip:return {"hit":False,"reason":""}
        hit=conn.execute(
            """
            SELECT 1
            FROM users u
            WHERE u.id=%s AND u.last_ip=%s AND COALESCE(u.last_active,u.created_at,NOW())>=NOW()-interval '30 day'
            UNION ALL
            SELECT 1
            FROM auth_refresh_tokens
            WHERE user_id=%s AND last_ip=%s AND created_at>=NOW()-interval '30 day'
            LIMIT 1
            """,
            (inviter_user_id,ip,inviter_user_id,ip),
        ).fetchone()
        return {"hit":bool(hit),"reason":"same_ip_within_30d" if hit else ""}
    @classmethod
    def bind_inviter(cls,conn,user_id:int,inviter_user_id:int,invite_code:str):
        row=conn.execute("SELECT inviter_user_id FROM users WHERE id=%s FOR UPDATE",(user_id,)).fetchone()
        if not row: raise HTTPException(status_code=404,detail="用户不存在")
        current=row["inviter_user_id"]
        if current and int(current)!=int(inviter_user_id):
            raise HTTPException(status_code=400,detail="当前账号已绑定邀请码")
        if not current:
            conn.execute("UPDATE users SET inviter_user_id=%s,register_invite_code=CASE WHEN COALESCE(register_invite_code,'')='' THEN %s ELSE register_invite_code END,invited_at=COALESCE(invited_at,NOW()) WHERE id=%s",(inviter_user_id,cls.normalize_code(invite_code),user_id))
    @classmethod
    def create_event(cls,conn,inviter_user_id:int|None,invitee_user_id:int|None,event_type:str,status:str="recorded",invite_code:str="",request_id:int|None=None,reward_points:int=0,recharge_amount:float=0,same_ip_hit:bool=False,same_ip_reason:str="",metadata:dict|None=None):
        conn.execute(
            "INSERT INTO invite_events (inviter_user_id,invitee_user_id,event_type,status,invite_code,request_id,reward_points,recharge_amount,same_ip_hit,same_ip_reason,metadata) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (inviter_user_id,invitee_user_id,event_type,status,cls.normalize_code(invite_code),request_id,reward_points,recharge_amount,same_ip_hit,same_ip_reason,json.dumps(metadata or {},ensure_ascii=False)),
        )
    @classmethod
    def apply_register_invite(cls,conn,user_id:int,invite_code:str,current_ip:str):
        inviter=cls.find_inviter_by_code(conn,invite_code)
        code=cls.normalize_code(invite_code)
        if not code:return None
        if not inviter: raise HTTPException(status_code=400,detail="邀请码不存在")
        if int(inviter["id"])==int(user_id): raise HTTPException(status_code=400,detail="不能填写自己的邀请码")
        cls.bind_inviter(conn,user_id,inviter["id"],code)
        same_ip=cls.detect_same_ip(conn,inviter["id"],current_ip)
        reward=cls.register_reward_points()
        status="blocked_same_ip" if same_ip["hit"] else ("rewarded" if reward>0 else "recorded")
        if reward>0 and not same_ip["hit"]:
            PointsService.add_points(inviter["id"],reward,"invite_register_reward","邀请注册奖励",conn=conn)
        cls.create_event(conn,inviter["id"],user_id,"register",status,code,None,reward,0,same_ip["hit"],same_ip["reason"],{"ip":current_ip})
        return {"inviter_user_id":inviter["id"],"invite_code":code,"same_ip_hit":same_ip["hit"],"same_ip_reason":same_ip["reason"],"reward_points":reward if not same_ip["hit"] else 0}
    @classmethod
    def resolve_recharge_inviter(cls,conn,user_id:int,invite_code:str):
        user=conn.execute("SELECT inviter_user_id,register_invite_code FROM users WHERE id=%s",(user_id,)).fetchone()
        if not user: raise HTTPException(status_code=404,detail="用户不存在")
        user=dict(user)
        existing=user["inviter_user_id"]
        code=cls.normalize_code(invite_code or user.get("register_invite_code") or "")
        if existing:
            inviter=conn.execute("SELECT id,invite_code,username,nickname FROM users WHERE id=%s",(existing,)).fetchone()
            if not inviter:return None
            if invite_code and cls.normalize_code(invite_code)!=(inviter["invite_code"] or ""):
                raise HTTPException(status_code=400,detail="当前账号已绑定其他邀请码")
            return {"inviter_user_id":inviter["id"],"invite_code":inviter["invite_code"] or code,"bound":True}
        if not code:return None
        inviter=cls.find_inviter_by_code(conn,code)
        if not inviter: raise HTTPException(status_code=400,detail="邀请码不存在")
        if int(inviter["id"])==int(user_id): raise HTTPException(status_code=400,detail="不能填写自己的邀请码")
        cls.bind_inviter(conn,user_id,inviter["id"],code)
        return {"inviter_user_id":inviter["id"],"invite_code":code,"bound":False}
    @classmethod
    def calc_recharge_bonus_points(cls,points:int):
        return max(0,int(round(float(points or 0)*cls.recharge_bonus_percent()/100)))
    @classmethod
    def calc_recharge_rebate_points(cls,points:int):
        return max(0,int(round(float(points or 0)*cls.recharge_rebate_percent()/100)))
    @classmethod
    def build_recharge_snapshot(cls,conn,user_id:int,amount:float,points:int,invite_code:str,current_ip:str):
        resolved=cls.resolve_recharge_inviter(conn,user_id,invite_code)
        bonus=cls.calc_recharge_bonus_points(points) if resolved else 0
        rebate=cls.calc_recharge_rebate_points(points) if resolved else 0
        same_ip={"hit":False,"reason":""}
        if resolved and resolved.get("inviter_user_id"):
            same_ip=cls.detect_same_ip(conn,resolved["inviter_user_id"],current_ip)
        return {"inviter_user_id":resolved["inviter_user_id"] if resolved else None,"invite_code":resolved["invite_code"] if resolved else "","invite_discount_percent_snapshot":cls.recharge_bonus_percent() if resolved else 0,"invite_rebate_percent_snapshot":cls.recharge_rebate_percent() if resolved else 0,"invite_bonus_points":bonus,"invite_rebate_points":rebate,"same_ip_hit":same_ip["hit"],"same_ip_reason":same_ip["reason"]}
    @classmethod
    def apply_recharge_rewards(cls,conn,recharge_item:dict,current_ip:str=""):
        inviter_user_id=recharge_item.get("inviter_user_id")
        invite_code=cls.normalize_code(recharge_item.get("invite_code") or "")
        request_id=recharge_item.get("id")
        invitee_user_id=recharge_item.get("user_id")
        bonus_points=int(recharge_item.get("invite_bonus_points") or 0)
        rebate_points=int(recharge_item.get("invite_rebate_points") or 0)
        amount=float(recharge_item.get("amount") or 0)
        same_ip=cls.detect_same_ip(conn,inviter_user_id,current_ip) if inviter_user_id else {"hit":False,"reason":""}
        if inviter_user_id:
            cls.create_event(conn,inviter_user_id,invitee_user_id,"recharge_submit","recorded",invite_code,request_id,0,amount,same_ip["hit"],same_ip["reason"],{})
        if bonus_points>0 and invitee_user_id:
            cls.create_event(conn,inviter_user_id,invitee_user_id,"recharge_bonus","rewarded",invite_code,request_id,bonus_points,amount,same_ip["hit"],same_ip["reason"],{})
        if inviter_user_id and rebate_points>0:
            if same_ip["hit"]:
                cls.create_event(conn,inviter_user_id,invitee_user_id,"recharge_rebate","blocked_same_ip",invite_code,request_id,rebate_points,amount,True,same_ip["reason"],{})
            else:
                PointsService.add_points(inviter_user_id,rebate_points,"invite_recharge_rebate",f"邀请充值返利 (¥{amount})",conn=conn,request_key=f"invite-rebate:{request_id}",recharge_request_id=request_id)
                cls.create_event(conn,inviter_user_id,invitee_user_id,"recharge_rebate","rewarded",invite_code,request_id,rebate_points,amount,False,"",{})
        return {"same_ip_hit":same_ip["hit"],"same_ip_reason":same_ip["reason"],"bonus_points":bonus_points,"rebate_points":0 if same_ip["hit"] else rebate_points}
    @classmethod
    def get_user_invite_overview(cls,user_id:int):
        with __import__("backend.database",fromlist=["get_db"]).get_db() as conn:
            user=conn.execute("SELECT id,invite_code,invite_code_created_at,inviter_user_id,register_invite_code,invited_at FROM users WHERE id=%s",(user_id,)).fetchone()
            if not user: raise HTTPException(status_code=404,detail="用户不存在")
            inviter_name=None
            if user["inviter_user_id"]:
                inviter=conn.execute("SELECT username,nickname,invite_code FROM users WHERE id=%s",(user["inviter_user_id"],)).fetchone()
                if inviter: inviter_name=inviter["nickname"] or inviter["username"]
            summary=conn.execute(
                """
                SELECT
                COUNT(*) FILTER (WHERE event_type='register') AS invited_register_count,
                COALESCE(SUM(reward_points) FILTER (WHERE event_type='recharge_rebate' AND status='rewarded'),0) AS total_rebate_points,
                COALESCE(SUM(recharge_amount) FILTER (WHERE event_type='recharge_submit'),0) AS total_recharge_amount,
                COUNT(*) FILTER (WHERE same_ip_hit=TRUE) AS risk_hit_count
                FROM invite_events
                WHERE inviter_user_id=%s
                """,
                (user_id,),
            ).fetchone()
            return {"invite_code":user["invite_code"] or "","invite_code_created_at":user["invite_code_created_at"],"inviter_user_id":user["inviter_user_id"],"inviter_name":inviter_name,"register_invite_code":user["register_invite_code"] or "","invited_at":user["invited_at"],"summary":dict(summary) if summary else {"invited_register_count":0,"total_rebate_points":0,"total_recharge_amount":0,"risk_hit_count":0}}
    @classmethod
    def list_user_invite_history(cls,user_id:int,page:int=1,size:int=20):
        offset=(page-1)*size
        with __import__("backend.database",fromlist=["get_db"]).get_db() as conn:
            total=conn.execute("SELECT COUNT(*) cnt FROM invite_events WHERE inviter_user_id=%s OR invitee_user_id=%s",(user_id,user_id)).fetchone()["cnt"]
            rows=conn.execute(
                """
                SELECT e.*,iu.username inviter_username,iu.nickname inviter_nickname,eu.username invitee_username,eu.nickname invitee_nickname
                FROM invite_events e
                LEFT JOIN users iu ON e.inviter_user_id=iu.id
                LEFT JOIN users eu ON e.invitee_user_id=eu.id
                WHERE e.inviter_user_id=%s OR e.invitee_user_id=%s
                ORDER BY e.created_at DESC,e.id DESC
                LIMIT %s OFFSET %s
                """,
                (user_id,user_id,size,offset),
            ).fetchall()
            return {"total":total,"items":[dict(r) for r in rows],"page":page,"size":size}
