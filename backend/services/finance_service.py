import json
from datetime import datetime,timedelta
from typing import Optional
from backend.database import get_db
from backend.config import get_generation_models,get_generation_providers

class FinanceService:
    @classmethod
    def _safe_float(cls,v,default=0.0):
        try:return float(v)
        except Exception:return float(default)
    @classmethod
    def _safe_json(cls,v,default=None):
        if isinstance(v,dict):return v
        if isinstance(v,str):
            try:
                x=json.loads(v or "{}")
                return x if isinstance(x,dict) else (default if default is not None else {})
            except Exception:return default if default is not None else {}
        return default if default is not None else {}
    @classmethod
    def _provider_cfg(cls,provider_id:str):
        return (get_generation_providers() or {}).get(provider_id) or {}
    @classmethod
    def _unit_name(cls,provider_id:str):
        return (cls._provider_cfg(provider_id).get("unit_name") or "供应商额度")
    @classmethod
    def _load_rule_row(cls,conn,provider_id:str,model_id:str):
        return conn.execute("SELECT * FROM provider_model_quota_rules WHERE provider_id=%s AND model_id=%s",(provider_id,model_id)).fetchone()
    @classmethod
    def _list_rules(cls,conn,provider_id:str=None):
        if provider_id:return conn.execute("SELECT * FROM provider_model_quota_rules WHERE provider_id=%s ORDER BY provider_id ASC,model_id ASC",(provider_id,)).fetchall()
        return conn.execute("SELECT * FROM provider_model_quota_rules ORDER BY provider_id ASC,model_id ASC").fetchall()
    @classmethod
    def _allocate_from_batches(cls,conn,provider_id:str,quota_needed:float):
        remain=round(cls._safe_float(quota_needed,0),6)
        allocations=[]
        if remain<=0:return allocations,0.0,0.0,0.0
        rows=conn.execute("SELECT id,remaining_quota,unit_cost FROM provider_purchase_batches WHERE provider_id=%s AND remaining_quota>0 ORDER BY purchase_date ASC,id ASC FOR UPDATE",(provider_id,)).fetchall()
        total_cost=0.0
        for row in rows:
            if remain<=0:break
            cur_rem=cls._safe_float(row["remaining_quota"],0)
            if cur_rem<=0:continue
            used=min(cur_rem,remain)
            if used<=0:continue
            cost=round(used*cls._safe_float(row["unit_cost"],0),6)
            new_rem=round(cur_rem-used,6)
            conn.execute("UPDATE provider_purchase_batches SET remaining_quota=%s,updated_at=NOW() WHERE id=%s",(new_rem,row["id"]))
            allocations.append({"purchase_batch_id":row["id"],"quota_used":round(used,6),"cost_rmb":cost})
            total_cost=round(total_cost+cost,6)
            remain=round(remain-used,6)
        return allocations,round(quota_needed,6),round(max(remain,0),6),total_cost
    @classmethod
    def resolve_range(cls,time_range:str="30d"):
        now=datetime.now();today_start=datetime(now.year,now.month,now.day);start_dt=today_start-timedelta(days=29);time_range=(time_range or "30d").strip()
        if time_range=="all":
            with get_db() as conn:
                row=conn.execute("SELECT MIN(ts) first_ts FROM (SELECT MIN(created_at) ts FROM generation_finance_entries UNION ALL SELECT MIN(created_at) ts FROM provider_purchase_batches UNION ALL SELECT MIN(created_at) ts FROM recharge_requests) t").fetchone()
                first_ts=(row or {}).get("first_ts") if row else None
            if first_ts:start_dt=datetime(first_ts.year,first_ts.month,first_ts.day)
        elif time_range=="today":start_dt=today_start
        elif time_range=="7d":start_dt=today_start-timedelta(days=6)
        elif time_range=="30d":start_dt=today_start-timedelta(days=29)
        else:time_range="30d"
        return {"range":time_range,"now":now,"start_dt":start_dt,"end_dt":now,"start_s":start_dt.strftime("%Y-%m-%d %H:%M:%S"),"end_s":now.strftime("%Y-%m-%d %H:%M:%S")}
    @classmethod
    def list_quota_rules(cls,page:int=1,size:int=20,provider_id:str=""):
        page=max(int(page or 1),1);size=max(1,min(int(size or 20),100));offset=(page-1)*size;provider_id=(provider_id or "").strip()
        where="";params=[]
        if provider_id:where="WHERE r.provider_id=%s";params=[provider_id]
        provider_cfg=get_generation_providers() or {};model_cfg=get_generation_models() or {}
        with get_db() as conn:
            total=conn.execute(f"SELECT COUNT(*) cnt FROM provider_model_quota_rules r {where}",params).fetchone()["cnt"]
            rows=conn.execute(f"SELECT r.* FROM provider_model_quota_rules r {where} ORDER BY r.provider_id ASC,r.model_id ASC LIMIT %s OFFSET %s",params+[size,offset]).fetchall()
        items=[{"id":x["id"],"provider_id":x["provider_id"],"provider_unit_name":(provider_cfg.get(x["provider_id"]) or {}).get("unit_name") or "供应商额度","model_id":x["model_id"],"model_label":(model_cfg.get(x["model_id"]) or {}).get("label") or x["model_id"],"quota_per_success":round(cls._safe_float(x["quota_per_success"],0),6),"enabled":x.get("enabled") is not False,"remark":x.get("remark") or "","created_at":x.get("created_at"),"updated_at":x.get("updated_at")} for x in rows]
        return {"items":items,"total":int(total or 0),"page":page,"size":size}
    @classmethod
    def upsert_quota_rule(cls,provider_id:str,model_id:str,quota_per_success:float,enabled:bool=True,remark:str="",rule_id:Optional[int]=None):
        provider_id=(provider_id or "").strip();model_id=(model_id or "").strip();quota_per_success=round(cls._safe_float(quota_per_success,0),6)
        if not provider_id:raise ValueError("供应商不能为空")
        if not model_id:raise ValueError("模型不能为空")
        if quota_per_success<=0:raise ValueError("每次消耗必须大于0")
        with get_db() as conn:
            row=conn.execute("INSERT INTO provider_model_quota_rules (provider_id,model_id,quota_per_success,enabled,remark) VALUES (%s,%s,%s,%s,%s) ON CONFLICT(provider_id,model_id) DO UPDATE SET quota_per_success=EXCLUDED.quota_per_success,enabled=EXCLUDED.enabled,remark=EXCLUDED.remark,updated_at=NOW() RETURNING *",(provider_id,model_id,quota_per_success,enabled,(remark or "").strip())).fetchone()
            return row
    @classmethod
    def delete_quota_rule(cls,rule_id:int):
        with get_db() as conn:
            row=conn.execute("SELECT id FROM provider_model_quota_rules WHERE id=%s",(rule_id,)).fetchone()
            if not row:return False
            conn.execute("DELETE FROM provider_model_quota_rules WHERE id=%s",(rule_id,))
            return True
    @classmethod
    def record_task_entry(cls,task_id:str,status:str):
        with get_db() as conn:
            task=conn.execute("SELECT task_id,user_id,points_cost,params,created_at FROM tasks WHERE task_id=%s FOR UPDATE",(task_id,)).fetchone()
            if not task:return None
            params=cls._safe_json(task.get("params") or {})
            provider_id=((params.get("provider_id") or "").strip())
            if not provider_id:
                trace=params.get("provider_trace") or []
                if isinstance(trace,list) and trace:
                    provider_id=((trace[0] or {}).get("provider_id") or "").strip()
            model_id=(params.get("model_id") or "image-default").strip() or "image-default"
            if not provider_id:
                return None
            existing=conn.execute("SELECT * FROM generation_finance_entries WHERE task_id=%s FOR UPDATE",(task_id,)).fetchone()
            if existing and str(existing.get("status") or "")==status:return existing
            quota_used=0.0;quota_shortage=0.0;cost_rmb=None;cost_source="unknown";pricing_source="rule";purchase_batch_id=None;allocations=[]
            rule=None
            if status=="completed" and provider_id:
                rule=cls._load_rule_row(conn,provider_id,model_id)
                if not rule or rule.get("enabled") is False:
                    cost_source="missing_quota_rule"
                else:
                    quota_used=round(cls._safe_float(rule.get("quota_per_success"),0),6)
                    if quota_used<=0:
                        cost_source="missing_quota_rule"
                    else:
                        allocations,quota_used,quota_shortage,total_cost=cls._allocate_from_batches(conn,provider_id,quota_used)
                        if allocations:
                            cost_rmb=round(total_cost,6)
                            purchase_batch_id=allocations[0]["purchase_batch_id"]
                            cost_source="purchase_batch" if quota_shortage<=0 else "insufficient_quota"
                        else:
                            cost_source="insufficient_quota"
                        if quota_shortage>0 and not allocations:cost_rmb=None
            elif status=="failed":
                cost_source="failed_no_charge"
            entry=conn.execute("INSERT INTO generation_finance_entries (task_id,user_id,model_id,provider_id,status,charged_points,revenue_rmb,cost_rmb,pricing_source,cost_source,purchase_batch_id,quota_used,quota_shortage,created_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(task_id) DO UPDATE SET user_id=EXCLUDED.user_id,model_id=EXCLUDED.model_id,provider_id=EXCLUDED.provider_id,status=EXCLUDED.status,charged_points=EXCLUDED.charged_points,revenue_rmb=EXCLUDED.revenue_rmb,cost_rmb=EXCLUDED.cost_rmb,pricing_source=EXCLUDED.pricing_source,cost_source=EXCLUDED.cost_source,purchase_batch_id=EXCLUDED.purchase_batch_id,quota_used=EXCLUDED.quota_used,quota_shortage=EXCLUDED.quota_shortage,created_at=EXCLUDED.created_at,updated_at=NOW() RETURNING *",(task_id,task.get("user_id"),model_id,provider_id,status,int(task.get("points_cost") or 0),0,cost_rmb,pricing_source,cost_source,purchase_batch_id,quota_used,quota_shortage,task.get("created_at") or datetime.now().strftime("%Y-%m-%d %H:%M:%S"))).fetchone()
            if allocations and entry:
                conn.execute("DELETE FROM generation_finance_allocations WHERE finance_entry_id=%s",(entry["id"],))
                for a in allocations:
                    conn.execute("INSERT INTO generation_finance_allocations (finance_entry_id,purchase_batch_id,quota_used,cost_rmb) VALUES (%s,%s,%s,%s)",(entry["id"],a["purchase_batch_id"],a["quota_used"],a["cost_rmb"]))
            return conn.execute("SELECT * FROM generation_finance_entries WHERE task_id=%s",(task_id,)).fetchone()
    @classmethod
    def create_purchase_batch(cls,provider_id:str,purchase_date:str,amount_rmb:float,quota_amount:float,remark:str,operator_user_id:Optional[int]):
        provider_id=(provider_id or "").strip()
        if not provider_id:raise ValueError("供应商不能为空")
        amount_rmb=round(cls._safe_float(amount_rmb,0),6);quota_amount=round(cls._safe_float(quota_amount,0),6)
        if amount_rmb<0:raise ValueError("采购金额不能小于0")
        if quota_amount<=0:raise ValueError("采购额度必须大于0")
        unit_cost=round(amount_rmb/quota_amount,8)
        purchase_date=(purchase_date or "").strip() or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with get_db() as conn:
            return conn.execute("INSERT INTO provider_purchase_batches (provider_id,purchase_date,amount_rmb,quota_amount,remaining_quota,unit_cost,remark,operator_user_id) VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *",(provider_id,purchase_date,amount_rmb,quota_amount,quota_amount,unit_cost,(remark or "").strip(),operator_user_id)).fetchone()
    @classmethod
    def update_purchase_batch(cls,batch_id:int,provider_id:str,purchase_date:str,amount_rmb:float,quota_amount:float,remark:str,operator_user_id:Optional[int],adjust_consumed:Optional[float]=None):
        provider_id=(provider_id or "").strip()
        if not provider_id:raise ValueError("供应商不能为空")
        amount_rmb=round(cls._safe_float(amount_rmb,0),6);quota_amount=round(cls._safe_float(quota_amount,0),6)
        if amount_rmb<0:raise ValueError("采购金额不能小于0")
        if quota_amount<=0:raise ValueError("采购额度必须大于0")
        purchase_date=(purchase_date or "").strip() or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with get_db() as conn:
            row=conn.execute("SELECT * FROM provider_purchase_batches WHERE id=%s FOR UPDATE",(batch_id,)).fetchone()
            if not row:raise ValueError("采购批次不存在")
            consumed_quota=round(max(cls._safe_float(row.get("quota_amount"),0)-cls._safe_float(row.get("remaining_quota"),0),0),6)
            locked=consumed_quota>0
            if locked and (provider_id!=row["provider_id"] or round(cls._safe_float(row.get("amount_rmb"),0),6)!=amount_rmb or round(cls._safe_float(row.get("quota_amount"),0),6)!=quota_amount):raise ValueError("该采购批次已被消耗，仅允许修改采购时间和备注")
            if adjust_consumed is not None:
                new_consumed=round(cls._safe_float(adjust_consumed,consumed_quota),6)
                if new_consumed<0:raise ValueError("已消耗不能小于0")
                if new_consumed>quota_amount:raise ValueError("已消耗不能大于采购总量")
                consumed_quota=new_consumed
            next_remaining=round(quota_amount-consumed_quota,6)
            if next_remaining<0:raise ValueError("采购单位数量不能小于已消耗数量")
            unit_cost=round(amount_rmb/quota_amount,8)
            return conn.execute("UPDATE provider_purchase_batches SET provider_id=%s,purchase_date=%s,amount_rmb=%s,quota_amount=%s,remaining_quota=%s,unit_cost=%s,remark=%s,operator_user_id=%s,updated_at=NOW() WHERE id=%s RETURNING *",(provider_id,purchase_date,amount_rmb,quota_amount,next_remaining,unit_cost,(remark or "").strip(),operator_user_id,batch_id)).fetchone()
    @classmethod
    def delete_purchase_batch(cls,batch_id:int):
        with get_db() as conn:
            row=conn.execute("SELECT * FROM provider_purchase_batches WHERE id=%s FOR UPDATE",(batch_id,)).fetchone()
            if not row:raise ValueError("采购批次不存在")
            consumed_quota=round(max(cls._safe_float(row.get("quota_amount"),0)-cls._safe_float(row.get("remaining_quota"),0),0),6)
            if consumed_quota>0:raise ValueError("该采购批次已被消耗，不能删除")
            alloc=conn.execute("SELECT COUNT(*) cnt FROM generation_finance_allocations WHERE purchase_batch_id=%s",(batch_id,)).fetchone()
            if int((alloc or {}).get("cnt") or 0)>0:raise ValueError("该采购批次已有成本分摊记录，不能删除")
            conn.execute("DELETE FROM provider_purchase_batches WHERE id=%s",(batch_id,))
            return True
    @classmethod
    def _provider_rollup(cls,conn,time_start:str,time_end:str):
        rows=conn.execute("SELECT provider_id,COUNT(*) calls,COUNT(*) FILTER (WHERE status='completed') success,COUNT(*) FILTER (WHERE status='failed') failed,COUNT(*) FILTER (WHERE cost_source='missing_quota_rule') missing_rule_calls,COUNT(*) FILTER (WHERE cost_source='insufficient_quota') insufficient_calls,COUNT(*) FILTER (WHERE cost_source='failed_no_charge') failed_no_charge_calls,COALESCE(SUM(cost_rmb),0) cost_amount,COALESCE(SUM(quota_used),0) quota_used,COALESCE(SUM(quota_shortage),0) quota_shortage FROM generation_finance_entries WHERE created_at >= %s AND created_at <= %s GROUP BY provider_id ORDER BY calls DESC,provider_id ASC",(time_start,time_end)).fetchall()
        return {x["provider_id"]:x for x in rows}
    @classmethod
    def finance_overview(cls,time_range:str="30d"):
        r=cls.resolve_range(time_range);provider_cfg=get_generation_providers() or {};model_cfg=get_generation_models() or {}
        with get_db() as conn:
            rev=conn.execute("SELECT COALESCE(SUM(amount),0) amt,COUNT(*) cnt FROM recharge_requests WHERE status='approved' AND created_at >= %s AND created_at <= %s",(r["start_s"],r["end_s"])).fetchone()
            entry_summary=conn.execute("SELECT COUNT(*) total_calls,COUNT(*) FILTER (WHERE status='completed') completed_calls,COUNT(*) FILTER (WHERE status='failed') failed_calls,COUNT(*) FILTER (WHERE cost_source='missing_quota_rule') missing_rule_calls,COUNT(*) FILTER (WHERE cost_source='insufficient_quota') insufficient_calls,COALESCE(SUM(cost_rmb),0) cost_amount,COALESCE(SUM(quota_used),0) quota_used,COALESCE(SUM(quota_shortage),0) quota_shortage FROM generation_finance_entries WHERE created_at >= %s AND created_at <= %s",(r["start_s"],r["end_s"])).fetchone()
            batch_row=conn.execute("SELECT COUNT(*) total_batches,COUNT(*) FILTER (WHERE remaining_quota>0) active_batches,COALESCE(SUM(amount_rmb),0) purchased_amount,COALESCE(SUM(quota_amount),0) purchased_quota,COALESCE(SUM(remaining_quota),0) remaining_quota FROM provider_purchase_batches").fetchone()
            recent=conn.execute("SELECT e.id,e.task_id,e.model_id,e.provider_id,e.status,e.cost_rmb,e.cost_source,e.quota_used,e.quota_shortage,e.created_at,u.username,u.nickname FROM generation_finance_entries e LEFT JOIN users u ON u.id=e.user_id WHERE e.created_at >= %s AND e.created_at <= %s ORDER BY e.created_at DESC,e.id DESC LIMIT 10",(r["start_s"],r["end_s"])).fetchall()
            rule_rows=conn.execute("SELECT r.*,COALESCE(SUM(b.remaining_quota),0) provider_remaining_quota FROM provider_model_quota_rules r LEFT JOIN provider_purchase_batches b ON b.provider_id=r.provider_id GROUP BY r.id ORDER BY r.provider_id ASC,r.model_id ASC").fetchall()
            entry_rows=conn.execute("SELECT model_id,provider_id,COUNT(*) calls,COUNT(*) FILTER (WHERE status='completed') success,COUNT(*) FILTER (WHERE status='failed') failed,COALESCE(SUM(cost_rmb),0) cost_amount,AVG(cost_rmb) FILTER (WHERE cost_rmb IS NOT NULL AND cost_rmb>0) avg_cost FROM generation_finance_entries WHERE created_at >= %s AND created_at <= %s GROUP BY model_id,provider_id ORDER BY calls DESC,model_id ASC,provider_id ASC",(r["start_s"],r["end_s"])).fetchall()
            provider_batches=conn.execute("SELECT provider_id,COUNT(*) batch_count,COALESCE(SUM(amount_rmb),0) purchased_amount,COALESCE(SUM(quota_amount),0) purchased_quota,COALESCE(SUM(remaining_quota),0) remaining_quota FROM provider_purchase_batches GROUP BY provider_id").fetchall()
            provider_rollup=conn.execute("SELECT provider_id,COUNT(*) calls,COUNT(*) FILTER (WHERE cost_source='missing_quota_rule') missing_rule_calls,COUNT(*) FILTER (WHERE cost_source='insufficient_quota') insufficient_calls,COUNT(*) FILTER (WHERE cost_source='failed_no_charge') failed_no_charge_calls,COALESCE(SUM(quota_used),0) quota_used,COALESCE(SUM(quota_shortage),0) quota_shortage FROM generation_finance_entries WHERE created_at >= %s AND created_at <= %s GROUP BY provider_id",(r["start_s"],r["end_s"])).fetchall()
        batch_map={x["provider_id"]:x for x in provider_batches};entry_map={(x["model_id"],x["provider_id"]):x for x in entry_rows}
        provider_map={}
        for pid in set(list(provider_cfg.keys())+list(batch_map.keys())+[x["provider_id"] for x in entry_rows]+[x["provider_id"] for x in rule_rows]):
            provider_map[pid]={"provider_id":pid,"provider_type":((provider_cfg.get(pid) or {}).get("type") or "unknown"),"provider_unit_name":(provider_cfg.get(pid) or {}).get("unit_name") or "供应商额度","calls":0,"success":0,"failed":0,"missing_rule_calls":0,"insufficient_calls":0,"failed_no_charge_calls":0,"cost_amount":0.0,"quota_used":0.0,"quota_shortage":0.0,"batch_count":int((batch_map.get(pid) or {}).get("batch_count") or 0),"purchased_amount":round(cls._safe_float((batch_map.get(pid) or {}).get("purchased_amount"),0),2),"purchased_quota":round(cls._safe_float((batch_map.get(pid) or {}).get("purchased_quota"),0),6),"remaining_quota":round(cls._safe_float((batch_map.get(pid) or {}).get("remaining_quota"),0),6)}
        for x in entry_rows:
            m=provider_map.setdefault(x["provider_id"],{"provider_id":x["provider_id"],"provider_type":((provider_cfg.get(x["provider_id"]) or {}).get("type") or "unknown"),"provider_unit_name":(provider_cfg.get(x["provider_id"]) or {}).get("unit_name") or "供应商额度","calls":0,"success":0,"failed":0,"missing_rule_calls":0,"insufficient_calls":0,"failed_no_charge_calls":0,"cost_amount":0.0,"quota_used":0.0,"quota_shortage":0.0,"batch_count":int((batch_map.get(x["provider_id"]) or {}).get("batch_count") or 0),"purchased_amount":round(cls._safe_float((batch_map.get(x["provider_id"]) or {}).get("purchased_amount"),0),2),"purchased_quota":round(cls._safe_float((batch_map.get(x["provider_id"]) or {}).get("purchased_quota"),0),6),"remaining_quota":round(cls._safe_float((batch_map.get(x["provider_id"]) or {}).get("remaining_quota"),0),6)})
            m["calls"]+=int(x["calls"] or 0);m["success"]+=int(x["success"] or 0);m["failed"]+=int(x["failed"] or 0);m["cost_amount"]=round(m["cost_amount"]+cls._safe_float(x.get("cost_amount"),0),6)
        for rrow in provider_rollup:
            m=provider_map.setdefault(rrow["provider_id"],{"provider_id":rrow["provider_id"],"provider_type":((provider_cfg.get(rrow["provider_id"]) or {}).get("type") or "unknown"),"provider_unit_name":(provider_cfg.get(rrow["provider_id"]) or {}).get("unit_name") or "供应商额度","calls":0,"success":0,"failed":0,"missing_rule_calls":0,"insufficient_calls":0,"failed_no_charge_calls":0,"cost_amount":0.0,"quota_used":0.0,"quota_shortage":0.0,"batch_count":int((batch_map.get(rrow["provider_id"]) or {}).get("batch_count") or 0),"purchased_amount":round(cls._safe_float((batch_map.get(rrow["provider_id"]) or {}).get("purchased_amount"),0),2),"purchased_quota":round(cls._safe_float((batch_map.get(rrow["provider_id"]) or {}).get("purchased_quota"),0),6),"remaining_quota":round(cls._safe_float((batch_map.get(rrow["provider_id"]) or {}).get("remaining_quota"),0),6)})
            m["missing_rule_calls"]=int(rrow.get("missing_rule_calls") or 0);m["insufficient_calls"]=int(rrow.get("insufficient_calls") or 0);m["failed_no_charge_calls"]=int(rrow.get("failed_no_charge_calls") or 0);m["quota_used"]=round(cls._safe_float(rrow.get("quota_used"),0),6);m["quota_shortage"]=round(cls._safe_float(rrow.get("quota_shortage"),0),6)
        provider_stats=sorted(provider_map.values(),key=lambda x:(-x["calls"],x["provider_id"]))
        rules=[]
        for rr in rule_rows:
            pid=rr["provider_id"];mid=rr["model_id"];rule_quota=round(cls._safe_float(rr["quota_per_success"],0),6);prov_rem=round(cls._safe_float(rr.get("provider_remaining_quota"),0),6)
            stat=entry_map.get((mid,pid)) or {}
            rules.append({"id":rr["id"],"provider_id":pid,"provider_type":((provider_cfg.get(pid) or {}).get("type") or "unknown"),"provider_unit_name":(provider_cfg.get(pid) or {}).get("unit_name") or "供应商额度","model_id":mid,"model_label":((model_cfg.get(mid) or {}).get("label") or mid),"calls":int(stat.get("calls") or 0),"success":int(stat.get("success") or 0),"failed":int(stat.get("failed") or 0),"cost_amount":round(cls._safe_float(stat.get("cost_amount"),0),6),"avg_cost":round(cls._safe_float(stat.get("avg_cost"),0),6),"quota_per_success":rule_quota,"remaining_times":int(prov_rem//rule_quota) if rule_quota>0 else 0,"provider_remaining_quota":prov_rem,"enabled":rr.get("enabled") is not False,"remark":rr.get("remark") or "","rule_status":"enabled" if rr.get("enabled") is not False else "disabled"})
        used_keys={(r["model_id"],r["provider_id"]) for r in rules}
        for stat in entry_rows:
            key=(stat["model_id"],stat["provider_id"])
            if key in used_keys:continue
            pid=stat["provider_id"];mid=stat["model_id"];prov_rem=round(cls._safe_float((batch_map.get(pid) or {}).get("remaining_quota"),0),6)
            rules.append({"id":None,"provider_id":pid,"provider_type":((provider_cfg.get(pid) or {}).get("type") or "unknown"),"provider_unit_name":(provider_cfg.get(pid) or {}).get("unit_name") or "供应商额度","model_id":mid,"model_label":((model_cfg.get(mid) or {}).get("label") or mid),"calls":int(stat["calls"] or 0),"success":int(stat["success"] or 0),"failed":int(stat["failed"] or 0),"cost_amount":round(cls._safe_float(stat.get("cost_amount"),0),6),"avg_cost":round(cls._safe_float(stat.get("avg_cost"),0),6),"quota_per_success":None,"remaining_times":None,"provider_remaining_quota":prov_rem,"enabled":False,"remark":"","rule_status":"missing"})
        return {"range":r["range"],"start_date":r["start_dt"].strftime("%Y-%m-%d"),"end_date":r["end_dt"].strftime("%Y-%m-%d"),"summary":{"revenue_amount":round(cls._safe_float((rev or {}).get("amt"),0),2),"revenue_orders":int((rev or {}).get("cnt") or 0),"cost_amount":round(cls._safe_float((entry_summary or {}).get("cost_amount"),0),6),"profit_amount":round(round(cls._safe_float((rev or {}).get("amt"),0),2)-round(cls._safe_float((entry_summary or {}).get("cost_amount"),0),6),6),"profit_rate":round(((round(cls._safe_float((rev or {}).get("amt"),0),2)-round(cls._safe_float((entry_summary or {}).get("cost_amount"),0),6))/round(cls._safe_float((rev or {}).get("amt"),0),2))*100,2) if cls._safe_float((rev or {}).get("amt"),0)>0 else 0.0,"total_calls":int((entry_summary or {}).get("total_calls") or 0),"completed_calls":int((entry_summary or {}).get("completed_calls") or 0),"failed_calls":int((entry_summary or {}).get("failed_calls") or 0),"missing_rule_calls":int((entry_summary or {}).get("missing_rule_calls") or 0),"insufficient_calls":int((entry_summary or {}).get("insufficient_calls") or 0),"quota_used":round(cls._safe_float((entry_summary or {}).get("quota_used"),0),6),"quota_shortage":round(cls._safe_float((entry_summary or {}).get("quota_shortage"),0),6)},"purchases":{"total_batches":int((batch_row or {}).get("total_batches") or 0),"active_batches":int((batch_row or {}).get("active_batches") or 0),"purchased_amount":round(cls._safe_float((batch_row or {}).get("purchased_amount"),0),2),"purchased_quota":round(cls._safe_float((batch_row or {}).get("purchased_quota"),0),6),"remaining_quota":round(cls._safe_float((batch_row or {}).get("remaining_quota"),0),6)},"providers":provider_stats,"rules":rules,"recent_tasks":[{"id":x["id"],"task_id":x["task_id"],"model_id":x["model_id"],"provider_id":x["provider_id"],"status":x["status"],"cost_rmb":cls._safe_float(x.get("cost_rmb"),0) if x.get("cost_rmb") is not None else None,"cost_source":x["cost_source"],"quota_used":round(cls._safe_float(x.get("quota_used"),0),6),"quota_shortage":round(cls._safe_float(x.get("quota_shortage"),0),6),"created_at":x["created_at"],"username":x.get("username"),"account":x.get("username"),"nickname":x.get("nickname")} for x in recent]}
    @classmethod
    def finance_providers(cls,time_range:str="30d"):
        r=cls.resolve_range(time_range);provider_cfg=get_generation_providers() or {}
        with get_db() as conn:
            rows=conn.execute("SELECT provider_id,COUNT(*) calls,COUNT(*) FILTER (WHERE status='completed') success,COUNT(*) FILTER (WHERE status='failed') failed,COUNT(*) FILTER (WHERE cost_source='missing_quota_rule') missing_rule_calls,COUNT(*) FILTER (WHERE cost_source='insufficient_quota') insufficient_calls,COUNT(*) FILTER (WHERE cost_source='failed_no_charge') failed_no_charge_calls,COALESCE(SUM(cost_rmb),0) cost_amount,COALESCE(SUM(quota_used),0) quota_used,COALESCE(SUM(quota_shortage),0) quota_shortage FROM generation_finance_entries WHERE created_at >= %s AND created_at <= %s GROUP BY provider_id ORDER BY calls DESC,provider_id ASC",(r["start_s"],r["end_s"])).fetchall()
            batches=conn.execute("SELECT provider_id,COUNT(*) batch_count,COALESCE(SUM(amount_rmb),0) purchased_amount,COALESCE(SUM(quota_amount),0) purchased_quota,COALESCE(SUM(remaining_quota),0) remaining_quota FROM provider_purchase_batches GROUP BY provider_id").fetchall()
        batch_map={x["provider_id"]:x for x in batches};ids=sorted(set(list(batch_map.keys())+[x["provider_id"] for x in rows]+list(provider_cfg.keys())))
        out=[]
        for pid in ids:
            base=next((x for x in rows if x["provider_id"]==pid),None) or {}
            bat=batch_map.get(pid) or {}
            out.append({"provider_id":pid,"provider_type":(provider_cfg.get(pid) or {}).get("type") or "unknown","provider_unit_name":(provider_cfg.get(pid) or {}).get("unit_name") or "供应商额度","calls":int(base.get("calls") or 0),"success":int(base.get("success") or 0),"failed":int(base.get("failed") or 0),"success_rate":round((int(base.get("success") or 0)/int(base.get("calls") or 1))*100,1),"missing_rule_calls":int(base.get("missing_rule_calls") or 0),"insufficient_calls":int(base.get("insufficient_calls") or 0),"failed_no_charge_calls":int(base.get("failed_no_charge_calls") or 0),"cost_amount":round(cls._safe_float(base.get("cost_amount"),0),6),"quota_used":round(cls._safe_float(base.get("quota_used"),0),6),"quota_shortage":round(cls._safe_float(base.get("quota_shortage"),0),6),"batch_count":int(bat.get("batch_count") or 0),"purchased_amount":round(cls._safe_float(bat.get("purchased_amount"),0),2),"purchased_quota":round(cls._safe_float(bat.get("purchased_quota"),0),6),"remaining_quota":round(cls._safe_float(bat.get("remaining_quota"),0),6)})
        return {"range":r["range"],"providers":out}
    @classmethod
    def list_purchase_batches(cls,page:int=1,size:int=20,provider_id:str=""):
        page=max(int(page or 1),1);size=max(1,min(int(size or 20),100));offset=(page-1)*size;provider_id=(provider_id or "").strip();where="";params=[]
        if provider_id:where="WHERE provider_id=%s";params.append(provider_id)
        provider_cfg=get_generation_providers() or {}
        with get_db() as conn:
            total=conn.execute(f"SELECT COUNT(*) cnt FROM provider_purchase_batches {where}",params).fetchone()["cnt"]
            rows=conn.execute(f"""SELECT b.*,u.username operator_name,COALESCE(a.allocation_count,0) allocation_count
                FROM provider_purchase_batches b
                LEFT JOIN users u ON u.id=b.operator_user_id
                LEFT JOIN (SELECT purchase_batch_id,COUNT(*) allocation_count FROM generation_finance_allocations GROUP BY purchase_batch_id) a ON a.purchase_batch_id=b.id
                {where}
                ORDER BY b.purchase_date DESC,b.id DESC LIMIT %s OFFSET %s""",params+[size,offset]).fetchall()
        items=[]
        for x in rows:
            consumed_quota=round(max(cls._safe_float(x["quota_amount"],0)-cls._safe_float(x["remaining_quota"],0),0),6);allocation_count=int(x.get("allocation_count") or 0);can_edit_core=consumed_quota<=0 and allocation_count<=0;can_delete=can_edit_core;locked_reason="" if can_edit_core else "已消耗，金额/数量/渠道不可改，且不能删除"
            items.append({"id":x["id"],"provider_id":x["provider_id"],"provider_unit_name":(provider_cfg.get(x["provider_id"]) or {}).get("unit_name") or "供应商额度","purchase_date":x["purchase_date"],"amount_rmb":round(cls._safe_float(x["amount_rmb"],0),2),"quota_amount":round(cls._safe_float(x["quota_amount"],0),6),"remaining_quota":round(cls._safe_float(x["remaining_quota"],0),6),"consumed_quota":consumed_quota,"unit_cost":round(cls._safe_float(x["unit_cost"],0),8),"remark":x.get("remark") or "","operator_user_id":x.get("operator_user_id"),"operator_name":x.get("operator_name") or "","created_at":x.get("created_at"),"allocation_count":allocation_count,"can_edit_core":can_edit_core,"can_delete":can_delete,"locked_reason":locked_reason})
        return {"items":items,"total":int(total or 0),"page":page,"size":size}
    @classmethod
    def list_task_entries(cls,time_range:str="30d",provider_id:str="",model_id:str="",status:str="",page:int=1,size:int=20):
        r=cls.resolve_range(time_range);page=max(int(page or 1),1);size=max(1,min(int(size or 20),100));offset=(page-1)*size;clauses=["e.created_at >= %s","e.created_at <= %s"];params=[r["start_s"],r["end_s"]]
        if provider_id:clauses.append("e.provider_id=%s");params.append(provider_id)
        if model_id:clauses.append("e.model_id=%s");params.append(model_id)
        if status in {"completed","failed"}:clauses.append("e.status=%s");params.append(status)
        where="WHERE "+" AND ".join(clauses)
        provider_cfg=get_generation_providers() or {};model_cfg=get_generation_models() or {}
        with get_db() as conn:
            total=conn.execute(f"SELECT COUNT(*) cnt FROM generation_finance_entries e {where}",params).fetchone()["cnt"]
            rows=conn.execute(f"""SELECT e.*,u.username,u.nickname,b.purchase_date,b.amount_rmb batch_amount_rmb,b.unit_cost batch_unit_cost,COALESCE(a.allocation_count,0) allocation_count,COALESCE(a.quota_allocated,0) quota_allocated
                FROM generation_finance_entries e
                LEFT JOIN users u ON u.id=e.user_id
                LEFT JOIN provider_purchase_batches b ON b.id=e.purchase_batch_id
                LEFT JOIN (SELECT finance_entry_id,COUNT(*) allocation_count,COALESCE(SUM(quota_used),0) quota_allocated FROM generation_finance_allocations GROUP BY finance_entry_id) a ON a.finance_entry_id=e.id
                {where}
                ORDER BY e.created_at DESC,e.id DESC LIMIT %s OFFSET %s""",params+[size,offset]).fetchall()
        items=[]
        for x in rows:
            pid=x["provider_id"];mid=x["model_id"]
            items.append({"id":x["id"],"task_id":x["task_id"],"user_id":x.get("user_id"),"username":x.get("username"),"account":x.get("username"),"nickname":x.get("nickname"),"model_id":mid,"model_label":(model_cfg.get(mid) or {}).get("label") or mid,"provider_id":pid,"provider_unit_name":(provider_cfg.get(pid) or {}).get("unit_name") or "供应商额度","status":x["status"],"charged_points":int(x.get("charged_points") or 0),"quota_used":round(cls._safe_float(x.get("quota_used"),0),6),"quota_shortage":round(cls._safe_float(x.get("quota_shortage"),0),6),"quota_allocated":round(cls._safe_float(x.get("quota_allocated"),0),6),"allocation_count":int(x.get("allocation_count") or 0),"revenue_rmb":round(cls._safe_float(x.get("revenue_rmb"),0),6),"cost_rmb":cls._safe_float(x.get("cost_rmb"),0) if x.get("cost_rmb") is not None else None,"pricing_source":x.get("pricing_source"),"cost_source":x.get("cost_source"),"purchase_batch_id":x.get("purchase_batch_id"),"purchase_date":x.get("purchase_date"),"batch_amount_rmb":round(cls._safe_float(x.get("batch_amount_rmb"),0),2) if x.get("batch_amount_rmb") is not None else None,"batch_unit_cost":round(cls._safe_float(x.get("batch_unit_cost"),0),8) if x.get("batch_unit_cost") is not None else None,"created_at":x.get("created_at")})
        return {"range":r["range"],"items":items,"total":int(total or 0),"page":page,"size":size}
