#!/usr/bin/env python3
"""从 LiteLLM 模型库（data/litellm_models.json，2988+ 模型官方规格）快速添加/查询模型到 data/llm_models.csv。

用法：
    python scripts/update_llm_models_from_litellm.py list [关键字]      # 列出匹配的模型（含上下文/价格）
    python scripts/update_llm_models_from_litellm.py add <model_id>...  # 把模型加入 CSV（自动补全规格）

示例：
    python scripts/update_llm_models_from_litellm.py list grok
    python scripts/update_llm_models_from_litellm.py add grok-5 claude-sonnet-5
"""
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LITELLM_JSON = ROOT / "data" / "litellm_models.json"
CSV_PATH = ROOT / "data" / "llm_models.csv"

FIELDNAMES = ['model_id', 'label', 'provider', 'protocol', 'max_input_tokens', 'max_output_tokens',
              'input_price_per_million', 'output_price_per_million', 'cache_read_price_per_million', 'price_currency',
              'input_points_per_million', 'output_points_per_million', 'points_per_request',
              'reasoning_efforts', 'default_reasoning_effort', 'thinking_default', 'context_budget_chars',
              'capabilities', 'enabled', 'deprecation_date', 'source', 'notes']

CAP_MAP = {
    'supports_function_calling': 'function_calling',
    'supports_parallel_function_calling': 'parallel_function_calling',
    'supports_vision': 'vision',
    'supports_reasoning': 'reasoning',
    'supports_prompt_caching': 'caching',
    'supports_response_schema': 'json_mode',
    'supports_system_messages': 'system_messages',
    'supports_tool_choice': 'tool_choice',
    'supports_web_search': 'web_search',
    'supports_pdf_input': 'pdf_input',
    'supports_audio_input': 'audio_input',
    'supports_native_streaming': 'streaming',
}


def load_litellm():
    with open(LITELLM_JSON, encoding="utf-8") as f:
        return json.load(f)


def to_row(model_id: str, info: dict) -> dict:
    caps = [cap for k, cap in CAP_MAP.items() if info.get(k)]
    cache = info.get('cache_read_input_token_cost')
    return {
        'model_id': model_id,
        'label': info.get('label') or model_id,
        'provider': info.get('litellm_provider', ''),
        'protocol': 'anthropic' if 'anthropic' in str(info.get('litellm_provider', '')).lower() else 'openai',
        'max_input_tokens': info.get('max_input_tokens') or info.get('max_tokens') or 1000000,
        'max_output_tokens': info.get('max_output_tokens') or info.get('max_tokens') or 128000,
        'input_price_per_million': round(info['input_cost_per_token'] * 1e6, 4) if info.get('input_cost_per_token') else '',
        'output_price_per_million': round(info['output_cost_per_token'] * 1e6, 4) if info.get('output_cost_per_token') else '',
        'cache_read_price_per_million': round(cache * 1e6, 4) if cache else '',
        'price_currency': 'usd',
        'reasoning_efforts': 'auto;low;medium;high;max',
        'default_reasoning_effort': 'auto',
        'thinking_default': 'enabled',
        'context_budget_chars': 256000,
        'capabilities': ';'.join(caps) if caps else 'streaming',
        'enabled': 'true',
        'deprecation_date': info.get('deprecation_date', ''),
        'source': info.get('source', ''),
        'notes': '',
    }


def read_csv():
    if not CSV_PATH.exists():
        return []
    with open(CSV_PATH, encoding='utf-8-sig', newline='') as f:
        return list(csv.DictReader(f))


def write_csv(rows):
    with open(CSV_PATH, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.DictWriter(f, fieldnames=FIELDNAMES)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, '') for k in FIELDNAMES})


def cmd_list(keyword: str):
    data = load_litellm()
    k = keyword.lower()
    hits = []
    for mid, info in sorted(data.items()):
        if info.get('mode') != 'chat':
            continue
        if k and k not in mid.lower():
            continue
        inp = info.get('input_cost_per_token')
        ipm = round(inp * 1e6, 3) if inp else '—'
        hits.append(f"{mid:<48} {info.get('litellm_provider',''):<16} in={ipm}$/M "
                    f"max_in={info.get('max_input_tokens','?')} max_out={info.get('max_output_tokens','?')}")
    print(f"共 {len(hits)} 个模型：")
    for h in hits:
        print(' ', h)


def _find_model(data, mid: str):
    """先精确匹配，再按 */model_id 后缀匹配"""
    if mid in data:
        return data[mid]
    prefix = mid.split('/', 1)[0] + '/'
    if mid.startswith(prefix):
        if mid in data:
            return data[mid]
    # 后缀匹配：xx/grok-4.5 → grok-4.5
    for k, v in data.items():
        if k.endswith('/' + mid):
            return v
    # 前缀匹配：grok-4.5 → xai/grok-4.5（唯一时）
    hits = [k for k in data if k.endswith('/' + mid)]
    if len(hits) == 1:
        return data[hits[0]]
    return None


def cmd_add(model_ids):
    data = load_litellm()
    rows = read_csv()
    existing = {r['model_id'] for r in rows}
    added = 0
    for mid in model_ids:
        info = _find_model(data, mid)
        if not info:
            print(f'✗ {mid}: LiteLLM 库中不存在（试试 list 关键字）')
            continue
        if mid in existing:
            print(f'~ {mid}: 已存在，跳过（要更新请先删 CSV 行）')
            continue
        rows.append(to_row(mid, info))
        added += 1
        print(f'✓ {mid}: 已加入（{info.get("litellm_provider")}，输入价 {round(info.get("input_cost_per_token",0)*1e6,3)}$/M）')
    if added:
        write_csv(rows)
        print(f'已写入 {CSV_PATH}，共 {len(rows)} 行')


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return
    cmd = sys.argv[1]
    if cmd == 'list':
        cmd_list(sys.argv[2] if len(sys.argv) > 2 else '')
    elif cmd == 'add':
        cmd_add(sys.argv[2:])
    else:
        print(__doc__)


if __name__ == '__main__':
    main()
