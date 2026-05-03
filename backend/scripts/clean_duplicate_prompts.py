#!/usr/bin/env python3
import os, json
from dotenv import load_dotenv
load_dotenv()
import psycopg

def main():
    db = os.getenv("DATABASE_URL")
    if not db:
        print("Error: DATABASE_URL not found")
        return

    with psycopg.connect(db) as conn:
        with conn.cursor() as cur:
            # 查找重复的提示词（保留最早创建的那条）
            cur.execute("""
                SELECT prompt, COUNT(*) as cnt, array_agg(id ORDER BY created_at) as ids
                FROM prompts
                GROUP BY prompt
                HAVING COUNT(*) > 1
            """)
            duplicates = cur.fetchall()

            total_deleted = 0
            for prompt, cnt, ids in duplicates:
                keep_id = ids[0]  # 保留最早创建的
                delete_ids = ids[1:]  # 删除其他的

                print(f"提示词: {prompt[:60]}...")
                print(f"  保留: {keep_id}")
                print(f"  删除: {delete_ids}")

                for did in delete_ids:
                    cur.execute("DELETE FROM prompt_likes WHERE prompt_id = %s", (did,))
                    cur.execute("DELETE FROM prompts WHERE id = %s", (did,))
                    total_deleted += 1

            conn.commit()
            print(f"\n清理完成: 共删除 {total_deleted} 条重复记录")

if __name__ == "__main__":
    main()
