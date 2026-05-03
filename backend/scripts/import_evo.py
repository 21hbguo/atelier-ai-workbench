#!/usr/bin/env python3
"""
Import prompts and images from the EvoLinkAI awesome-gpt-image-2-prompts repository.

Usage:
    python -m backend.scripts.import_evo           # Incremental import (default)
    python -m backend.scripts.import_evo --full     # Full import (ignore import_sources)
    python -m backend.scripts.import_evo --dry-run  # Preview without writing
"""
import sys
import json
import re
import argparse
from pathlib import Path
from datetime import datetime

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from backend.database import get_db, init_db
from backend.config import EVO_IMAGES_DIR

EVO_ROOT = Path(__file__).resolve().parent.parent.parent.parent / "evo"
CASES_DIR = EVO_ROOT / "cases"
DATA_FILE = EVO_ROOT / "data" / "ingested_tweets.json"

CATEGORY_MAP = {
    "Portrait & Photography Cases": "portrait",
    "Poster & Illustration Cases": "poster",
    "UI & Social Media Mockup Cases": "ui",
    "Comparison & Community Examples": "comparison",
    "Ad Creative Cases": "ad-creative",
    "E-commerce Cases": "ecommerce",
    "Character Design Cases": "character",
    "portrait": "portrait",
    "poster": "poster",
    "ui": "ui",
}

FILE_CATEGORY_MAP = {
    "portrait": "portrait",
    "poster": "poster",
    "ui": "ui",
    "comparison": "comparison",
    "ad-creative": "ad-creative",
    "ecommerce": "ecommerce",
    "character": "character",
}

CASE_HEADER_RE = re.compile(
    r'###\s+Case\s+(\d+):\s+\[(.+?)\]\((https?://[^\)]+)\)\s+\(by\s+\[(@?\w+)\]',
)
PROMPT_RE = re.compile(r'\*\*提示词[：:]\*\*\s*\n\s*\x60\x60\x60\n(.*?)\n\s*\x60\x60\x60', re.DOTALL)


def parse_markdown(md_path: Path) -> dict[int, str]:
    """Extract prompts from a markdown file, keyed by case number."""
    text = md_path.read_text(encoding="utf-8")
    prompts = {}
    parts = re.split(r'(?=###\s+Case\s+\d+:)', text)
    for part in parts:
        header = CASE_HEADER_RE.search(part)
        prompt_match = PROMPT_RE.search(part)
        if header and prompt_match:
            case_num = int(header.group(1))
            prompts[case_num] = prompt_match.group(1).strip()
    return prompts


PARSED_CASES_FILE = EVO_ROOT / "data" / "parsed_cases.json"


def main():
    parser = argparse.ArgumentParser(description="Import Evo prompts")
    parser.add_argument("--full", action="store_true", help="Full import (ignore import_sources)")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    parser.add_argument("--source", choices=["evo", "cases"], default="evo",
                        help="Data source: evo (ingested_tweets.json) or cases (parsed_cases.json)")
    args = parser.parse_args()

    if args.source == "cases":
        if not PARSED_CASES_FILE.exists():
            print("parsed_cases.json not found, running parse_cases.py ...")
            from backend.scripts.parse_cases import main as parse_cases_main
            parse_cases_main()
        data = json.loads(PARSED_CASES_FILE.read_text(encoding="utf-8"))
    else:
        if not DATA_FILE.exists():
            print(f"Error: {DATA_FILE} not found")
            sys.exit(1)
        data = json.loads(DATA_FILE.read_text(encoding="utf-8"))

    generated_at = data.get("generated_at", "")
    records = data.get("records", [])

    init_db()

    source_key = f"evo_{args.source}" if args.source != "evo" else "evo"
    if not args.full:
        with get_db() as conn:
            row = conn.execute(
                "SELECT last_imported_at FROM import_sources WHERE source_key = %s",
                (source_key,)
            ).fetchone()
            if row and row["last_imported_at"]:
                if generated_at <= row["last_imported_at"]:
                    print(f"No new data (last import: {row['last_imported_at']}, source: {generated_at})")
                    return

    prompts_by_file = {}
    if args.source == "evo":
        for md_file in sorted(CASES_DIR.glob("*_zh-CN.md")):
            file_stem = md_file.stem.replace("_zh-CN", "")
            category = FILE_CATEGORY_MAP.get(file_stem)
            if category:
                prompts_by_file[category] = parse_markdown(md_file)

    existing_sources = set()
    with get_db() as conn:
        rows = conn.execute("SELECT source FROM prompts WHERE source IS NOT NULL").fetchall()
        existing_sources = {r["source"] for r in rows}

    to_insert = []
    skipped = 0
    seen_sources = set()
    for record in records:
        image_dir = record.get("image_dir", "")
        if not image_dir:
            skipped += 1
            continue
        dir_name = Path(image_dir).name
        source = f"evo:{dir_name}"

        if source in seen_sources:
            skipped += 1
            continue
        seen_sources.add(source)

        if source in existing_sources:
            skipped += 1
            continue

        category_slug = CATEGORY_MAP.get(record.get("category", ""), "")
        if not category_slug:
            continue

        case_match = re.search(r'case(\d+)', dir_name)
        case_num = int(case_match.group(1)) if case_match else None

        prompt_text = ""
        if args.source == "cases":
            prompt_text = record.get("prompt", "")
        else:
            if category_slug in prompts_by_file and case_num:
                prompt_text = prompts_by_file[category_slug].get(case_num, "")

        if not prompt_text:
            skipped += 1
            continue

        image_path = f"{dir_name}/output.jpg"
        if not (EVO_IMAGES_DIR / image_path).exists():
            image_path = None

        title = record.get("title", f"Case {case_num or '?'}")
        author = record.get("author_handle", "")

        to_insert.append({
            "name": title,
            "prompt": prompt_text,
            "image_path": image_path,
            "author": f"@{author}" if author else "",
            "source": source,
            "category": category_slug,
            "tags": json.dumps([category_slug]),
        })

    if args.dry_run:
        print(f"Would insert: {len(to_insert)}, Skip (existing): {skipped}")
        for item in to_insert[:5]:
            print(f"  - {item['name'][:50]}... [{item['category']}] by {item['author']}")
        if len(to_insert) > 5:
            print(f"  ... and {len(to_insert) - 5} more")
        return

    inserted = 0
    with get_db() as conn:
        for item in to_insert:
            from uuid import uuid4
            conn.execute(
                """INSERT INTO prompts (id, name, prompt, negative_prompt, tags, created_at, user_id, image_path, author, source, category)
                   VALUES (%s, %s, %s, '', %s, %s, NULL, %s, %s, %s, %s)""",
                (
                    str(uuid4()),
                    item["name"],
                    item["prompt"],
                    json.dumps([item["category"]]),
                    datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    item["image_path"],
                    item["author"],
                    item["source"],
                    item["category"],
                ),
            )
            inserted += 1

        conn.execute(
            """INSERT INTO import_sources (source_key, last_imported_at, record_count, metadata)
               VALUES (%s, %s, %s, %s)
               ON CONFLICT(source_key) DO UPDATE SET
                 last_imported_at = excluded.last_imported_at,
                 record_count = excluded.record_count,
                 metadata = excluded.metadata""",
            (source_key, generated_at, inserted, json.dumps({"total_records": len(records)})),
        )

    print(f"Imported: {inserted}, Skipped: {skipped}")


if __name__ == "__main__":
    main()
