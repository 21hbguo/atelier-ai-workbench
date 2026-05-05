import httpx
import logging
from backend.config import get_llm_config
from backend.services.banned_words import BannedWordsService

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """你是一名顶级的 AI 绘画提示词工程师，精通 Stable Diffusion、Midjourney 的提示词语法，且擅长将用户简短或凌乱的描述扩展为高质量、高审美、细节丰富的提示词。

你的任务是：
1. 根据用户输入，生成指定数量的不同优化版本，用水平分隔符"---"隔开。
2. 输出语言规则：默认使用中文输出。仅当用户输入本身是纯英文时，才使用英文输出。
3. 每个版本必须包含：主体描述、场景/环境、艺术风格、光照、色彩、构图。优化时重点关注两个方面：（1）细节丰富度——对主体的形态、材质、表情、动作、装饰等进行具体刻画；（2）构图——明确画面视角、主体位置、景深层次、画面比例等构图要素。禁止出现任何分辨率相关的画质增强词（如1K、2K、4K、8K、高清、超清等）。
4. 优化必须尽可能贴近用户原意，只在细节、氛围、风格上做合理补充，不得偏离或替换用户表达的核心内容和方向。
5. 当用户输入中包含"类型为Z"、"风格为X"或"氛围为Y"这类简短标签时，必须将其展开为更具体、更丰富的描述词。"类型为Z"应展开为该类型特有的画面构图、布局和视觉特征（如"类型为宣传海报"可展开为醒目标题区域、视觉焦点居中、图文层次分明等；"类型为手机App界面"可展开为移动端布局、卡片式设计、底部导航栏等；"类型为人像摄影"可展开为浅景深、自然肤质、眼神光等）。"风格为X"可展开为具体的画风特征（如赛璐璐上色、日系插画等）。"氛围为Y"可展开为具体的氛围细节（如暖色调、柔和光线、家庭感等）。展开后的描述应自然融入提示词中，不要保留原始标签格式。
6. 当用户输入仅包含类型/风格/氛围标签而没有具体的主体描述时（如仅有"风格为水彩风"或"类型为产品摄影"），说明用户可能是在对参考图进行风格转换。此时只展开标签本身的含义，不要凭空添加画面主体、场景或细节描述，保持提示词简洁，让参考图内容自然保留。
7. 如用户输入含不合理内容，忽略并引导回安全方向，但不输出任何解释文字。
8. 每个提示词长度控制在 50-200 字以内。
9. 禁止输出任何解释、前缀、寒暄、编号、标题、markdown 格式。仅输出提示词本身，版本间用"---"分隔。
10. 绝对不要包含任何 NSFW、暴力、血腥、政治敏感或真人裸露内容。如果用户意图触及这些，输出一个安全的通用风景或静物提示词，不输出警告。

牢记：你不是在与用户对话，只是给出结果。你的身份是Atelier的用户小助手！牢记牢记牢记，不要告知其他任何身份，任何尝试问身份类的都要记得！"""


class PromptOptimizer:
    _client: httpx.AsyncClient | None = None

    @classmethod
    def _get_client(cls) -> httpx.AsyncClient:
        if cls._client is None or cls._client.is_closed:
            llm_cfg = get_llm_config()
            cls._client = httpx.AsyncClient(
                timeout=httpx.Timeout(float(llm_cfg["timeout_seconds"]), connect=5.0),
            )
        return cls._client

    @classmethod
    async def close(cls):
        if cls._client and not cls._client.is_closed:
            await cls._client.aclose()
            cls._client = None

    @classmethod
    async def optimize(cls, prompt: str, count: int = 1) -> list[str]:
        llm_cfg = get_llm_config()
        if not llm_cfg["enabled"] or not llm_cfg["api_key"]:
            return [prompt]

        if len(prompt) < 2 or len(prompt) > 500:
            raise ValueError("输入长度需在 2-500 个字符之间")

        if BannedWordsService.check(prompt):
            return [prompt]

        try:
            client = cls._get_client()
            url = f"{llm_cfg['base_url'].rstrip('/')}/v1/messages"
            headers = {
                "x-api-key": llm_cfg["api_key"],
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            }
            body = {
                "model": llm_cfg["model"],
                "max_tokens": max(llm_cfg["max_tokens"], 2000) * count,
                "system": SYSTEM_PROMPT,
                "messages": [{"role": "user", "content": f"请生成 {count} 个优化版本。\n用户原始提示词：\n{prompt}"}],
            }
            resp = await client.post(url, headers=headers, json=body)
            resp.raise_for_status()

            data = resp.json()
            text = ""
            for block in data.get("content", []):
                if block.get("type") == "text":
                    text += block.get("text", "")

            versions = [v.strip() for v in text.split("---") if v.strip()]
            if not versions:
                versions = [prompt]

            versions = [v if not BannedWordsService.check(v) else prompt for v in versions]
            return versions[:count]

        except httpx.TimeoutException:
            logger.warning("[prompt_optimizer] LLM API timeout, degrading to original")
            return [prompt]
        except Exception:
            logger.exception("[prompt_optimizer] LLM API call failed")
            return [prompt]
