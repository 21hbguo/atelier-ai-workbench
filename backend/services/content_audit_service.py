import httpx
import json
import logging
import asyncio
from typing import List, Dict, Any, Optional
from backend.config import get_llm_config
from backend.database import get_db

logger=logging.getLogger(__name__)
_task_logs:Dict[int,List[Dict]]={}
_task_log_events:Dict[int,asyncio.Event]={}
_running_tasks:set[int]=set()
SYSTEM_TEMPLATE="""你是一名AI内容安全审核助手。你的任务是根据提示词或作品描述，对广场内容进行风险审核，并给出人工管理建议。

风险等级规则：
1. high：明显涉及违法、极端暴力、未成年人性内容、露骨色情、仇恨歧视、真实人物严重侵权、诈骗引流、明显规避平台规则等，建议立即处理。
2. medium：存在擦边、软色情、血腥暴力、敏感人物/版权/侵权风险、导流营销、疑似违规暗示等，需要重点关注。
3. low：整体相对安全，但可能存在轻微争议、误导表述、分类不清、质量问题，仅供人工参考。

动作建议规则：
1. item_type=prompt 时，high 优先建议 freeze，medium 可建议 review，low 建议 keep。
2. item_type=image 时，high 优先建议 delete，medium 可建议 review，low 建议 keep。
3. 必须给出简洁明确的理由，并列出命中的风险点关键词。
4. 严格只输出 JSON 数组，不要输出任何其他文字。
5. 每个元素包含：
   - "item_id": 原始项目ID
   - "risk_level": "high" / "medium" / "low"
   - "confidence": "high" / "medium" / "low"
   - "suggested_action": "freeze" / "delete" / "review" / "keep"
   - "reason_summary": 20字以内中文摘要
   - "reason_detail": 中文详细原因，1-2句话
   - "hit_rules": 字符串数组，列出风险点关键词

示例输出：
[{{"item_id":"1","risk_level":"high","confidence":"high","suggested_action":"freeze","reason_summary":"包含未成年性暗示","reason_detail":"提示词出现未成年人和性化描述组合，存在严重违规风险。","hit_rules":["未成年人","性暗示"]}}]"""
USER_TEMPLATE="请审核以下 {count} 个项目：\n{items}"
BATCH_SIZE=5

class ContentAuditService:
    _client:httpx.AsyncClient|None=None
    @classmethod
    def _get_client(cls)->httpx.AsyncClient:
        if cls._client is None or cls._client.is_closed:
            llm_cfg=get_llm_config()
            cls._client=httpx.AsyncClient(timeout=httpx.Timeout(float(llm_cfg["timeout_seconds"]),connect=5.0))
        return cls._client
    @classmethod
    async def close(cls):
        if cls._client and not cls._client.is_closed:
            await cls._client.aclose()
            cls._client=None
    @classmethod
    def _push_log(cls,task_id:int,log_type:str,message:str,data:Any=None):
        if task_id not in _task_logs:
            _task_logs[task_id]=[]
            _task_log_events[task_id]=asyncio.Event()
        entry={"type":log_type,"message":message,"data":data}
        _task_logs[task_id].append(entry)
        if task_id in _task_log_events:_task_log_events[task_id].set()
    @classmethod
    async def get_task_logs(cls,task_id:int):
        if task_id not in _task_logs:
            _task_logs[task_id]=[]
            _task_log_events[task_id]=asyncio.Event()
        idx=0
        while True:
            logs=_task_logs.get(task_id,[])
            while idx<len(logs):
                yield logs[idx]
                idx+=1
            with get_db() as conn:
                task=conn.execute("SELECT status FROM content_audit_tasks WHERE id = %s",(task_id,)).fetchone()
                if task and task["status"] not in ("processing",):
                    while idx<len(logs):
                        yield logs[idx]
                        idx+=1
                    yield {"type":"complete","message":"任务已完成"}
                    _task_logs.pop(task_id,None)
                    _task_log_events.pop(task_id,None)
                    return
            _task_log_events[task_id].clear()
            try:
                await asyncio.wait_for(_task_log_events[task_id].wait(),timeout=2.0)
            except asyncio.TimeoutError:
                pass
    @classmethod
    def create_task(cls,admin_id:int,item_type:str="prompt",risk_level:str="",limit:int=200)->Dict[str,Any]:
        if item_type not in ("prompt","image"):raise ValueError("item_type 必须是 prompt 或 image")
        limit=max(1,min(int(limit or 200),500))
        with get_db() as conn:
            if item_type=="image":
                rows=conn.execute("SELECT si.id,si.filename,si.prompt,si.category,COALESCE(u.nickname,u.username,'') author FROM square_images si LEFT JOIN users u ON si.user_id = u.id WHERE COALESCE(si.is_frozen,FALSE)=FALSE ORDER BY si.created_at DESC LIMIT %s",(limit,)).fetchall()
            else:
                rows=conn.execute("SELECT p.id,p.name,p.prompt,p.category,COALESCE(p.author,u.nickname,u.username,'') author FROM prompts p LEFT JOIN users u ON p.user_id = u.id WHERE p.user_id IS NULL AND COALESCE(p.is_frozen,FALSE)=FALSE ORDER BY p.created_at DESC LIMIT %s",(limit,)).fetchall()
            if not rows:raise ValueError(f"没有可审核的{'作品' if item_type=='image' else '提示词'}")
            task=conn.execute("INSERT INTO content_audit_tasks (status,item_type,source_scope,total_items,created_by) VALUES ('processing',%s,'square',%s,%s) RETURNING id,status,item_type,source_scope,total_items,created_at",(item_type,len(rows),admin_id)).fetchone()
            with conn.cursor() as cur:
                for r in rows:
                    cur.execute("INSERT INTO content_audit_results (task_id,item_id,item_type,source_scope,item_name,item_prompt,item_category,item_author,item_thumb_url) VALUES (%s,%s,%s,'square',%s,%s,%s,%s,%s)",(task["id"],str(r["id"]),item_type,r.get("filename") or r.get("name") or "",(r["prompt"] or "")[:1000],r.get("category") or "",r.get("author") or "",f"/api/images/thumb/{r['filename']}?size=400" if item_type=="image" and r.get("filename") else None))
            return {"id":task["id"],"status":task["status"],"item_type":task["item_type"],"source_scope":task["source_scope"],"total_items":task["total_items"],"created_at":str(task["created_at"])}
    @classmethod
    async def run_audit(cls,task_id:int):
        if task_id in _running_tasks:return
        _running_tasks.add(task_id)
        try:
            cls._push_log(task_id,"info","开始审核任务")
            with get_db() as conn:
                task=conn.execute("SELECT id,status,item_type FROM content_audit_tasks WHERE id = %s",(task_id,)).fetchone()
                if not task or task["status"]!="processing":return
            processed=0
            batch_num=0
            while True:
                with get_db() as conn:
                    batch=conn.execute("SELECT id,item_id,item_name,item_prompt,item_category,item_author,item_type FROM content_audit_results WHERE task_id = %s AND status = 'pending' AND risk_level IS NULL LIMIT %s",(task_id,BATCH_SIZE)).fetchall()
                if not batch:break
                batch_num+=1
                cls._push_log(task_id,"info",f"处理批次 {batch_num}，{len(batch)} 个项目")
                items=[{"item_id":r["item_id"],"name":r["item_name"] or "","prompt":(r["item_prompt"] or "")[:600],"category":r["item_category"] or "","author":r["item_author"] or "","item_type":r["item_type"]} for r in batch]
                cls._push_log(task_id,"info",f"正在调用 LLM 审核 {len(items)} 个项目...")
                results=await cls._audit_batch(items)
                cls._push_log(task_id,"info",f"LLM 返回 {len(results)} 个审核结果")
                result_map={r["item_id"]:r for r in results} if results else {}
                with get_db() as conn:
                    for row in batch:
                        match=result_map.get(row["item_id"])
                        if match:
                            if match.get("risk_level")=="low":
                                conn.execute("UPDATE content_audit_results SET status = 'rejected', reviewed_at = NOW(), risk_level = %s, confidence = %s, suggested_action = %s, reason_summary = %s, reason_detail = %s, hit_rules = %s WHERE id = %s",(match.get("risk_level","low"),match.get("confidence","medium"),match.get("suggested_action","keep"),match.get("reason_summary","低风险已跳过"),match.get("reason_detail","该内容风险较低，系统已自动跳过，不进入待审核列表。"),json.dumps(match.get("hit_rules",[]),ensure_ascii=False),row["id"]))
                                cls._push_log(task_id,"info",f"{row['item_name'] or row['item_id']} 低风险自动跳过")
                                processed+=1
                                continue
                            conn.execute("UPDATE content_audit_results SET risk_level = %s, confidence = %s, suggested_action = %s, reason_summary = %s, reason_detail = %s, hit_rules = %s WHERE id = %s",(match.get("risk_level",""),match.get("confidence",""),match.get("suggested_action","review"),match.get("reason_summary",""),match.get("reason_detail",""),json.dumps(match.get("hit_rules",[]),ensure_ascii=False),row["id"]))
                            cls._push_log(task_id,"result",f"{row['item_name'] or row['item_id']} -> {match.get('risk_level','')} / {match.get('suggested_action','review')}")
                        else:
                            conn.execute("UPDATE content_audit_results SET risk_level = 'medium', confidence = 'low', suggested_action = 'review', reason_summary = '模型未返回结果', reason_detail = '本条未获得有效审核结果，建议人工复核。', hit_rules = %s WHERE id = %s",(json.dumps(["模型无结果"],ensure_ascii=False),row["id"]))
                            cls._push_log(task_id,"error",f"{row['item_name'] or row['item_id']} 审核回退为人工复核")
                        processed+=1
                    conn.execute("UPDATE content_audit_tasks SET processed_items = %s WHERE id = %s",(processed,task_id))
            with get_db() as conn:
                pending=conn.execute("SELECT COUNT(*) AS cnt FROM content_audit_results WHERE task_id = %s AND status = 'pending'",(task_id,)).fetchone()["cnt"]
                new_status="pending_review" if pending>0 else "completed"
                conn.execute("UPDATE content_audit_tasks SET status = %s, processed_items = total_items, completed_at = NOW() WHERE id = %s",(new_status,task_id))
            cls._push_log(task_id,"info",f"任务完成，处理 {processed} 个项目")
        except Exception as e:
            cls._push_log(task_id,"error",f"任务异常: {str(e)[:200]}")
            logger.exception("[content_audit] task failed")
            with get_db() as conn:
                conn.execute("UPDATE content_audit_tasks SET status = 'error', completed_at = NOW() WHERE id = %s",(task_id,))
        finally:
            _running_tasks.discard(task_id)
    @classmethod
    def resume_processing_tasks(cls):
        with get_db() as conn:
            rows=conn.execute("SELECT id FROM content_audit_tasks WHERE status = 'processing' ORDER BY id ASC").fetchall()
        for row in rows:
            task_id=int(row["id"])
            if task_id in _running_tasks:continue
            try:asyncio.create_task(cls.run_audit(task_id))
            except RuntimeError:logger.exception("[content_audit] resume create_task failed")
    @classmethod
    async def _audit_batch(cls,items:List[Dict])->List[Dict]:
        llm_cfg=get_llm_config()
        if not llm_cfg["enabled"] or not llm_cfg["api_key"]:
            logger.warning("[content_audit] LLM not enabled or API key missing")
            return []
        text=""
        try:
            client=cls._get_client()
            url=f"{llm_cfg['base_url'].rstrip('/')}/v1/messages"
            headers={"x-api-key":llm_cfg["api_key"],"anthropic-version":"2023-06-01","content-type":"application/json"}
            body={"model":llm_cfg["model"],"max_tokens":max(llm_cfg["max_tokens"],2200),"system":SYSTEM_TEMPLATE,"thinking":{"type":"disabled"},"messages":[{"role":"user","content":USER_TEMPLATE.format(count=len(items),items=json.dumps(items,ensure_ascii=False))}]}
            resp=await client.post(url,headers=headers,json=body)
            resp.raise_for_status()
            data=resp.json()
            for block in data.get("content",[]):
                if block.get("type")=="text":text+=block.get("text","")
            text=text.strip()
            if text.startswith("```"):
                lines=text.split("\n")
                text="\n".join(lines[1:-1] if lines[-1].strip()=="```" else lines[1:]).strip()
            return json.loads(text)
        except httpx.TimeoutException:
            logger.warning("[content_audit] timeout")
            return []
        except httpx.HTTPStatusError as e:
            logger.error(f"[content_audit] HTTP {e.response.status_code}: {e.response.text[:200]}")
            return []
        except json.JSONDecodeError:
            logger.warning(f"[content_audit] parse failed: {text[:200]}")
            return []
        except Exception:
            logger.exception("[content_audit] audit batch failed")
            return []

    @classmethod
    async def auto_audit_single(cls, item_type:str, item_id:str, prompt:str="", name:str="", category:str="", author:str="")->Dict[str,Any]:
        if item_type not in ("prompt","image"):return {}
        llm_cfg=get_llm_config()
        if not llm_cfg["enabled"] or not llm_cfg["api_key"]:
            return {"risk_level":"low","confidence":"low","suggested_action":"keep","reason_summary":"LLM不可用","reason_detail":"当前未启用内容审核模型，已跳过自动审核。","hit_rules":["LLM不可用"]}
        item={"item_id":str(item_id),"name":name or "","prompt":prompt or "","category":category or "","author":author or "","item_type":item_type}
        results=await cls._audit_batch([item])
        if not results:return {"risk_level":"medium","confidence":"low","suggested_action":"review","reason_summary":"模型未返回结果","reason_detail":"本条未获得有效审核结果，建议人工复核。","hit_rules":["模型无结果"]}
        return results[0] or {}
    @classmethod
    def list_tasks(cls,page:int=1,size:int=20)->Dict[str,Any]:
        with get_db() as conn:
            total=conn.execute("SELECT COUNT(*) AS cnt FROM content_audit_tasks").fetchone()["cnt"]
            offset=(page-1)*size
            rows=conn.execute("SELECT * FROM content_audit_tasks ORDER BY id DESC LIMIT %s OFFSET %s",(size,offset)).fetchall()
            return {"total":total,"page":page,"size":size,"items":[{"id":r["id"],"status":r["status"],"item_type":r["item_type"],"source_scope":r["source_scope"],"total_items":r["total_items"],"processed_items":r["processed_items"],"created_at":str(r["created_at"]),"completed_at":str(r["completed_at"]) if r["completed_at"] else None} for r in rows]}
    @classmethod
    def get_task(cls,task_id:int)->Optional[Dict[str,Any]]:
        with get_db() as conn:
            task=conn.execute("SELECT * FROM content_audit_tasks WHERE id = %s",(task_id,)).fetchone()
            if not task:return None
            results=conn.execute("SELECT * FROM content_audit_results WHERE task_id = %s AND NOT (status = 'rejected' AND risk_level = 'low') ORDER BY CASE risk_level WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END,id DESC",(task_id,)).fetchall()
            items=[]
            for r in results:
                d=dict(r)
                raw=d.get("hit_rules")
                if isinstance(raw,str):
                    try:d["hit_rules"]=json.loads(raw or "[]")
                    except Exception:d["hit_rules"]=[]
                elif raw is None:d["hit_rules"]=[]
                items.append(d)
            return {"id":task["id"],"status":task["status"],"item_type":task["item_type"],"source_scope":task["source_scope"],"total_items":task["total_items"],"processed_items":task["processed_items"],"created_at":str(task["created_at"]),"completed_at":str(task["completed_at"]) if task["completed_at"] else None,"results":items}
    @classmethod
    def approve_results(cls,task_id:int,result_ids:List[int])->Dict[str,Any]:
        with get_db() as conn:
            placeholders=",".join(["%s"]*len(result_ids))
            rows=conn.execute(f"SELECT * FROM content_audit_results WHERE task_id = %s AND id IN ({placeholders}) AND status = 'pending'",(task_id,*result_ids)).fetchall()
            applied=0
            for r in rows:
                action=r["suggested_action"] or "review"
                if r["item_type"]=="prompt":
                    if action=="freeze":
                        conn.execute("UPDATE prompts SET is_frozen = TRUE WHERE id = %s",(r["item_id"],))
                        applied+=1
                    elif action in ("keep","review"):
                        applied+=1
                else:
                    if action=="delete":
                        img=conn.execute("SELECT filename FROM square_images WHERE id = %s",(int(r["item_id"]),)).fetchone()
                        conn.execute("DELETE FROM favorites WHERE target_type = 'image' AND target_id = %s",(str(r["item_id"]),))
                        conn.execute("DELETE FROM square_likes WHERE image_id = %s",(int(r["item_id"]),))
                        conn.execute("DELETE FROM square_images WHERE id = %s",(int(r["item_id"]),))
                        if img:from backend.services.image_expiry import refresh_permanent_flags_by_filenames;refresh_permanent_flags_by_filenames([img["filename"]],conn=conn)
                        applied+=1
                    elif action in ("keep","review"):
                        applied+=1
                conn.execute("UPDATE content_audit_results SET status = 'applied', reviewed_at = NOW(), applied_at = NOW() WHERE id = %s",(r["id"],))
            remaining=conn.execute("SELECT COUNT(*) AS cnt FROM content_audit_results WHERE task_id = %s AND status = 'pending'",(task_id,)).fetchone()["cnt"]
            if remaining==0:conn.execute("UPDATE content_audit_tasks SET status = 'completed', completed_at = NOW() WHERE id = %s",(task_id,))
            return {"approved":applied,"remaining_pending":remaining}
    @classmethod
    def reject_results(cls,task_id:int,result_ids:List[int])->Dict[str,Any]:
        with get_db() as conn:
            placeholders=",".join(["%s"]*len(result_ids))
            conn.execute(f"UPDATE content_audit_results SET status = 'rejected', reviewed_at = NOW() WHERE task_id = %s AND id IN ({placeholders}) AND status = 'pending'",(task_id,*result_ids))
            remaining=conn.execute("SELECT COUNT(*) AS cnt FROM content_audit_results WHERE task_id = %s AND status = 'pending'",(task_id,)).fetchone()["cnt"]
            if remaining==0:
                task=conn.execute("SELECT id FROM content_audit_tasks WHERE id = %s AND status IN ('pending_review','processing')",(task_id,)).fetchone()
                if task:conn.execute("UPDATE content_audit_tasks SET status = 'completed', completed_at = NOW() WHERE id = %s",(task_id,))
            return {"rejected":len(result_ids),"remaining_pending":remaining}
    @classmethod
    def update_result(cls,result_id:int,risk_level:str,confidence:str,suggested_action:str,reason_summary:str,reason_detail:str,hit_rules:List[str])->Dict[str,Any]:
        with get_db() as conn:
            conn.execute("UPDATE content_audit_results SET risk_level = %s, confidence = %s, suggested_action = %s, reason_summary = %s, reason_detail = %s, hit_rules = %s WHERE id = %s AND status = 'pending'",(risk_level,confidence,suggested_action,reason_summary,reason_detail,json.dumps(hit_rules or [],ensure_ascii=False),result_id))
            row=conn.execute("SELECT * FROM content_audit_results WHERE id = %s",(result_id,)).fetchone()
            if not row:return {}
            d=dict(row)
            raw=d.get("hit_rules")
            if isinstance(raw,str):
                try:d["hit_rules"]=json.loads(raw or "[]")
                except Exception:d["hit_rules"]=[]
            return d
