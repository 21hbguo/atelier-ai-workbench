#!/usr/bin/env python3
import os,re,json,psycopg
from dotenv import load_dotenv
load_dotenv()
db=os.getenv("DATABASE_URL","postgresql://localhost:5432/app_db")
with psycopg.connect(db) as conn:
    with conn.cursor() as cur:
        cur.execute("select id,source,category,tags,name from prompts where source like 'evo:%'")
        rows=cur.fetchall()
        total=len(rows);tag_mismatch=[];source_mismatch=[];missing_category=[]
        for pid,source,category,tags,name in rows:
            if not category:missing_category.append((pid,source,name))
            t=tags if isinstance(tags,list) else json.loads(tags or "[]")
            if (not t) or t[0]!=category:tag_mismatch.append((pid,source,category,t,name))
            k=source.split(":",1)[1] if source and ":" in source else ""
            m=re.match(r"([a-z0-9\-]+)_case\d+$",k)
            if m and m.group(1)!=category and m.group(1)!="case":source_mismatch.append((pid,source,category,name))
        print(json.dumps({"total":total,"missing_category":len(missing_category),"tag_mismatch":len(tag_mismatch),"source_prefix_mismatch":len(source_mismatch),"sample":{"missing_category":missing_category[:5],"tag_mismatch":tag_mismatch[:5],"source_prefix_mismatch":source_mismatch[:5]}},ensure_ascii=False,indent=2))
