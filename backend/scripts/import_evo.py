#!/usr/bin/env python3
import sys,json,re,argparse
from pathlib import Path
from uuid import uuid4
from datetime import datetime,timezone
sys.path.insert(0,str(Path(__file__).resolve().parent.parent.parent))
from backend.database import get_db,init_db
from backend.config import EVO_IMAGES_DIR
EVO_ROOT=Path(__file__).resolve().parent.parent.parent.parent/"evo"
DATA_DIR=EVO_ROOT/"data"
CASES_FILE=DATA_DIR/"parsed_cases.json"
EVO_FILE=DATA_DIR/"ingested_tweets.json"
CATEGORY_MAP={"Portrait & Photography Cases":"portrait","Poster & Illustration Cases":"poster","UI & Social Media Mockup Cases":"ui","Comparison & Community Examples":"comparison","Ad Creative Cases":"ad-creative","E-commerce Cases":"ecommerce","Character Design Cases":"character","portrait":"portrait","poster":"poster","ui":"ui","comparison":"comparison","ad-creative":"ad-creative","ecommerce":"ecommerce","character":"character"}
DEFAULT_CATEGORY_LABELS={"poster":"海报与插画","portrait":"人像摄影","ui":"UI设计","comparison":"模型对比","ad-creative":"广告创意","ecommerce":"电商案例","character":"角色设计","uncategorized":"未分类"}
def _safe_slug(raw:str)->str:
    s=(raw or "").strip().lower()
    s=s.replace("&"," and ").replace("/"," ").replace("_"," ").replace("-"," ")
    s=re.sub(r"[^\w\s\u4e00-\u9fff]"," ",s)
    s=re.sub(r"\s+","-",s).strip("-")
    if not s:s="uncategorized"
    return s[:64]
def _category_slug(value:str)->str:
    if not value:return "uncategorized"
    if value in CATEGORY_MAP:return CATEGORY_MAP[value]
    if value.lower() in CATEGORY_MAP:return CATEGORY_MAP[value.lower()]
    return _safe_slug(value)
def _category_label(raw:str,slug:str)->str:
    if slug in DEFAULT_CATEGORY_LABELS:return DEFAULT_CATEGORY_LABELS[slug]
    t=(raw or "").strip()
    if t:return t[:128]
    return slug.replace("-"," ").title()[:128]
def _load_records(path:Path,name:str)->tuple[list[dict],str]:
    if not path.exists():
        if name=="cases":
            from backend.scripts.parse_cases import main as parse_cases_main
            parse_cases_main()
        else:
            return [],""
    if not path.exists():return [],""
    data=json.loads(path.read_text(encoding="utf-8"))
    return data.get("records",[]),data.get("generated_at","")
def _case_key(r:dict)->str:
    image_dir=r.get("image_dir") or ""
    if not image_dir:return ""
    return Path(image_dir).name
def _author(r:dict)->str:
    a=(r.get("author_handle") or "").strip().lstrip("@")
    return f"@{a}" if a else ""
def _normalize_record(r:dict,source_name:str)->dict|None:
    key=_case_key(r)
    if not key:return None
    raw_cat=(r.get("category") or "").strip()
    slug=_category_slug(raw_cat)
    return {"key":key,"source_name":source_name,"source_ref":f"{source_name}:{key}","raw_category":raw_cat,"category":slug,"category_label":_category_label(raw_cat,slug),"title":(r.get("title") or "").strip(),"prompt":(r.get("prompt") or "").strip(),"author":_author(r),"image_path":f"{key}/output.jpg"}
def _merge_records(cases_records:list[dict],evo_records:list[dict])->tuple[dict,dict]:
    merged={}
    stats={"input_cases":len(cases_records),"input_evo":len(evo_records),"merged":0,"conflicts":0}
    evo_map={}
    cases_map={}
    for r in evo_records:
        n=_normalize_record(r,"evo")
        if n:evo_map[n["key"]]=n
    for r in cases_records:
        n=_normalize_record(r,"cases")
        if n:cases_map[n["key"]]=n
    for key in sorted(set(evo_map)|set(cases_map)):
        c=cases_map.get(key)
        e=evo_map.get(key)
        raw_cat=(c or e)["raw_category"]
        category=(c or e)["category"]
        if c and e and c["category"]!=e["category"]:stats["conflicts"]+=1
        prompt=(c["prompt"] if c and c["prompt"] else e["prompt"] if e else "")
        title=(c["title"] if c and c["title"] else e["title"] if e else f"Case {key}")
        author=(c["author"] if c and c["author"] else e["author"] if e else "")
        image_path=(c["image_path"] if c else e["image_path"] if e else None)
        sources=[x for x in [f"cases:{key}" if c else None,f"evo:{key}" if e else None] if x]
        merged[key]={"key":key,"name":title,"prompt":prompt,"author":author,"category":category,"raw_category":raw_cat,"category_label":_category_label(raw_cat,category),"image_path":image_path if (image_path and (EVO_IMAGES_DIR/image_path).exists()) else None,"source":f"evo:{key}","source_refs":sources,"tags":[category]}
    stats["merged"]=len(merged)
    return merged,stats
def _ensure_categories(conn,items:dict)->int:
    existing={r["slug"] for r in conn.execute("SELECT slug FROM categories").fetchall()}
    missing=[]
    for x in items.values():
        slug=x["category"]
        if slug and slug not in existing:
            missing.append((slug,x["category_label"]))
            existing.add(slug)
    if not missing:return 0
    max_sort=conn.execute("SELECT COALESCE(MAX(sort_order),0) AS m FROM categories").fetchone()["m"]
    for i,(slug,label) in enumerate(missing,1):
        conn.execute("INSERT INTO categories (slug,label,sort_order) VALUES (%s,%s,%s) ON CONFLICT(slug) DO UPDATE SET label=EXCLUDED.label",(slug,label,max_sort+i))
    return len(missing)
def _load_existing(conn)->dict:
    out={}
    for r in conn.execute("SELECT id,source,name,prompt,author,category,tags,image_path FROM prompts WHERE source LIKE 'evo:%'").fetchall():
        key=(r["source"] or "").split(":",1)[1] if r["source"] else ""
        if key:out[key]=r
    return out
def _parse_dt(s:str):
    try:
        d=datetime.fromisoformat(str(s).replace(" ","T"))
        if d.tzinfo is None:d=d.replace(tzinfo=timezone.utc)
        return d
    except Exception:return None
def _upsert_prompts(conn,merged:dict,mode:str,dry_run:bool)->dict:
    existing=_load_existing(conn)
    existing_prompts={r["prompt"] for r in conn.execute("SELECT prompt FROM prompts WHERE source LIKE 'evo:%'").fetchall()}
    st={"inserted":0,"updated":0,"skipped":0,"missing_prompt":0,"fixed_tag_mismatch":0,"duplicate_content":0}
    for key,item in merged.items():
        if not item["prompt"]:
            st["missing_prompt"]+=1
            continue
        row=existing.get(key)
        tags_json=json.dumps(item["tags"],ensure_ascii=False)
        if row:
            old_tags=row["tags"] if isinstance(row["tags"],list) else json.loads(row["tags"] or "[]")
            old0=old_tags[0] if old_tags else None
            if old0!=item["category"]:st["fixed_tag_mismatch"]+=1
            same=row["name"]==item["name"] and row["prompt"]==item["prompt"] and row["author"]==item["author"] and row["category"]==item["category"] and old_tags==item["tags"] and row["image_path"]==item["image_path"]
            if same:
                st["skipped"]+=1
                continue
            if not dry_run:
                conn.execute("UPDATE prompts SET name=%s,prompt=%s,author=%s,category=%s,tags=%s,image_path=%s WHERE id=%s",(item["name"],item["prompt"],item["author"],item["category"],tags_json,item["image_path"],row["id"]))
            st["updated"]+=1
        elif item["prompt"] in existing_prompts:
            st["duplicate_content"]+=1
            continue
        else:
            if not dry_run:
                conn.execute("""INSERT INTO prompts (id,name,prompt,negative_prompt,tags,created_at,user_id,image_path,author,source,category) VALUES (%s,%s,%s,'',%s,%s,NULL,%s,%s,%s,%s)""",(str(uuid4()),item["name"],item["prompt"],tags_json,datetime.now().strftime("%Y-%m-%d %H:%M:%S"),item["image_path"],item["author"],item["source"],item["category"]))
                existing_prompts.add(item["prompt"])
            st["inserted"]+=1
    return st
def _can_incremental(conn,gen_cases:str,gen_evo:str)->bool:
    rows=conn.execute("SELECT source_key,last_imported_at FROM import_sources WHERE source_key IN ('evo','evo_cases')").fetchall()
    m={r["source_key"]:_parse_dt(r["last_imported_at"]) for r in rows}
    gc=_parse_dt(gen_cases); ge=_parse_dt(gen_evo); lc=m.get("evo_cases"); le=m.get("evo")
    if gc and ge and lc and le and gc<=lc and ge<=le:return True
    return False
def _save_import_source(conn,key:str,generated_at:str,record_count:int,metadata:dict,dry_run:bool):
    if dry_run:return
    conn.execute("""INSERT INTO import_sources (source_key,last_imported_at,record_count,metadata) VALUES (%s,%s,%s,%s) ON CONFLICT(source_key) DO UPDATE SET last_imported_at=EXCLUDED.last_imported_at,record_count=EXCLUDED.record_count,metadata=EXCLUDED.metadata""",(key,generated_at or datetime.now().isoformat(),record_count,json.dumps(metadata,ensure_ascii=False)))
def main():
    p=argparse.ArgumentParser(description="Import Evo prompts with dual-source normalization")
    p.add_argument("--mode",choices=["incremental","full-rebuild"],default="incremental")
    p.add_argument("--dry-run",action="store_true")
    p.add_argument("--full",action="store_true")
    args=p.parse_args()
    if args.full:args.mode="full-rebuild"
    cases_records,gen_cases=_load_records(CASES_FILE,"cases")
    evo_records,gen_evo=_load_records(EVO_FILE,"evo")
    if not cases_records and not evo_records:
        print("Error: no source data available")
        sys.exit(1)
    merged,merge_stats=_merge_records(cases_records,evo_records)
    init_db()
    with get_db() as conn:
        if args.mode=="incremental" and _can_incremental(conn,gen_cases,gen_evo):
            print(f"No new data (evo={gen_evo}, cases={gen_cases})")
            return
        new_cat_count=_ensure_categories(conn,merged)
        upsert_stats=_upsert_prompts(conn,merged,args.mode,args.dry_run)
        meta={"mode":args.mode,"input":merge_stats,"result":upsert_stats,"new_categories":new_cat_count,"generated_at":{"evo":gen_evo,"cases":gen_cases}}
        _save_import_source(conn,"evo",gen_evo,len(evo_records),{"mode":args.mode,"upsert":upsert_stats,"conflicts":merge_stats["conflicts"]},args.dry_run)
        _save_import_source(conn,"evo_cases",gen_cases,len(cases_records),{"mode":args.mode,"upsert":upsert_stats,"conflicts":merge_stats["conflicts"]},args.dry_run)
        _save_import_source(conn,"evo_dual",max(gen_evo,gen_cases),len(merged),meta,args.dry_run)
    print(json.dumps(meta,ensure_ascii=False,indent=2))
if __name__=="__main__":
    main()
