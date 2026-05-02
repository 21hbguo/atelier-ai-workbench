#!/usr/bin/env python3
"""Parse cases markdown files and generate metadata JSON for import."""
import re
import json
from pathlib import Path
from datetime import datetime

EVO_ROOT = Path(__file__).resolve().parent.parent.parent.parent / "evo"
CASES_DIR = EVO_ROOT / "cases"

# Map filename slug to full category name
FILE_CATEGORY_MAP = {
    "portrait": "Portrait & Photography Cases",
    "poster": "Poster & Illustration Cases",
    "ui": "UI & Social Media Mockup Cases",
    "comparison": "Comparison & Community Examples",
    "ecommerce": "E-commerce Cases",
    "ad-creative": "Ad Creative Cases",
    "character": "Character Design Cases",
}

CASE_RE = re.compile(
    r'### Case (\d+): \[(.+?)\]\((https?://x\.com/[^)]+)\) '
    r'\(by \[(@?[^\]]+)\]\(https?://x\.com/[^)]+\)\)',
    re.MULTILINE,
)
IMG_RE = re.compile(r'<img src="[^"]*images/([^"]+)/output\.jpg"')
PROMPT_RE = re.compile(r'\*\*提示词[：:]\*\*\s*\n\s*```\n(.*?)\n```', re.DOTALL)


def parse_markdown(md_path: Path, category: str) -> list[dict]:
    text = md_path.read_text(encoding="utf-8")
    results = []

    # Split by case headers
    parts = re.split(r'(?=### Case \d+:)', text)
    for part in parts:
        header = CASE_RE.search(part)
        if not header:
            continue

        case_num = int(header.group(1))
        title = header.group(2)
        tweet_url = header.group(3)
        author = header.group(4).lstrip("@")

        img_match = IMG_RE.search(part)
        image_dir = f"images/{img_match.group(1)}" if img_match else None

        prompt_match = PROMPT_RE.search(part)
        prompt_text = prompt_match.group(1).strip() if prompt_match else ""

        if not prompt_text:
            continue

        results.append({
            "tweet_url": tweet_url,
            "author_handle": author,
            "title": title,
            "category": category,
            "image_dir": image_dir,
            "prompt": prompt_text,
            "case_num": case_num,
        })

    return results


def main():
    all_records = []
    for md_file in sorted(CASES_DIR.glob("*_zh-CN.md")):
        file_stem = md_file.stem.replace("_zh-CN", "")
        category = FILE_CATEGORY_MAP.get(file_stem)
        if not category:
            print(f"Warning: unknown file {md_file.name}, skipping")
            continue
        records = parse_markdown(md_file, category)
        print(f"{file_stem}: {len(records)} cases")
        all_records.extend(records)

    print(f"\nTotal: {len(all_records)} records")

    output = {
        "generated_at": datetime.now().isoformat(),
        "source": "cases_md",
        "records": all_records,
    }
    output_path = EVO_ROOT / "data" / "parsed_cases.json"
    output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Output: {output_path}")


if __name__ == "__main__":
    main()
