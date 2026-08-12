"""LLMClient usage 解析单元测试：openai/anthropic 双协议 + 缓存 token 多来源兜底。

覆盖 backend/services/llm_client.py 中：
- _extract_usage_openai：OpenAI 官方 cached_tokens / DeepSeek prompt_cache_hit_tokens /
  GPT-5.6+ cache_write_tokens 的解析与 input 扣除
- _extract_usage_anthropic：cache_read_input_tokens / cache_creation_input_tokens
- _extract_usage：按协议分派

不连真实 LLM，纯函数级测试。
"""
from backend.services.llm_client import LLMClient


# ---------------------------------------------------------------------------
# OpenAI 官方协议（prompt_tokens_details.cached_tokens）
# ---------------------------------------------------------------------------
def test_openai_official_cached_tokens():
    """OpenAI 官方：cached_tokens 在 prompt_tokens_details 内，input 需扣除缓存部分。"""
    usage = {
        "prompt_tokens": 5000,
        "completion_tokens": 1000,
        "total_tokens": 6000,
        "prompt_tokens_details": {"cached_tokens": 4000},
    }
    result = LLMClient._extract_usage_openai(usage)
    assert result["cache_read_tokens"] == 4000
    assert result["input_tokens"] == 1000  # 5000 - 4000
    assert result["output_tokens"] == 1000
    assert result["cache_creation_tokens"] == 0
    assert result["total_tokens"] == 6000


def test_openai_deepseek_cache_hit_tokens():
    """DeepSeek 兼容实现：缓存命中在顶层 prompt_cache_hit_tokens（无 prompt_tokens_details）。"""
    usage = {
        "prompt_tokens": 5000,
        "completion_tokens": 1000,
        "total_tokens": 6000,
        "prompt_cache_hit_tokens": 4000,
        "prompt_cache_miss_tokens": 1000,
    }
    result = LLMClient._extract_usage_openai(usage)
    assert result["cache_read_tokens"] == 4000
    assert result["input_tokens"] == 1000  # 5000 - 4000 = miss 部分
    assert result["cache_creation_tokens"] == 0


def test_openai_cache_write_tokens():
    """GPT-5.6+ / Azure：cache_write_tokens 归入 cache_creation（缓存写）。"""
    usage = {
        "prompt_tokens": 3000,
        "completion_tokens": 500,
        "total_tokens": 3500,
        "prompt_tokens_details": {"cached_tokens": 1000, "cache_write_tokens": 800},
    }
    result = LLMClient._extract_usage_openai(usage)
    assert result["cache_read_tokens"] == 1000
    assert result["cache_creation_tokens"] == 800
    assert result["input_tokens"] == 2000


def test_openai_no_cache_fields():
    """无任何缓存字段：全部按普通 input 计。"""
    usage = {"prompt_tokens": 5000, "completion_tokens": 1000, "total_tokens": 6000}
    result = LLMClient._extract_usage_openai(usage)
    assert result["cache_read_tokens"] == 0
    assert result["cache_creation_tokens"] == 0
    assert result["input_tokens"] == 5000


def test_openai_reasoning_tokens_kept_separate():
    """reasoning_tokens 单独记录（含在 completion 内，不参与计费拆分）。"""
    usage = {
        "prompt_tokens": 100,
        "completion_tokens": 200,
        "total_tokens": 300,
        "completion_tokens_details": {"reasoning_tokens": 150},
    }
    result = LLMClient._extract_usage_openai(usage)
    assert result["reasoning_tokens"] == 150
    assert result["output_tokens"] == 200


# ---------------------------------------------------------------------------
# Anthropic 协议
# ---------------------------------------------------------------------------
def test_anthropic_cache_read_and_creation():
    """Anthropic：input 不含缓存，缓存读/写独立字段。"""
    usage = {
        "input_tokens": 1000,
        "output_tokens": 500,
        "cache_read_input_tokens": 3000,
        "cache_creation_input_tokens": 200,
    }
    result = LLMClient._extract_usage_anthropic(usage)
    assert result["input_tokens"] == 1000
    assert result["cache_read_tokens"] == 3000
    assert result["cache_creation_tokens"] == 200
    assert result["reasoning_tokens"] == 0
    assert result["total_tokens"] == 4700


# ---------------------------------------------------------------------------
# 协议分派
# ---------------------------------------------------------------------------
def test_extract_usage_dispatch_by_protocol():
    usage = {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}
    assert LLMClient._extract_usage("openai", usage) is not None
    assert LLMClient._extract_usage("anthropic", usage) is not None
    # 未知协议默认走 openai
    assert LLMClient._extract_usage("unknown", usage) is not None


def test_extract_usage_none_or_invalid():
    assert LLMClient._extract_usage("openai", None) is None
    assert LLMClient._extract_usage_openai({}) is None
    assert LLMClient._extract_usage_anthropic({}) is None
    # 异常数据（非 int）不抛异常，返回 None
    assert LLMClient._extract_usage_openai({"prompt_tokens": "x"}) is None
