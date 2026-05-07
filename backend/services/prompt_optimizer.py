import httpx
import json
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

JSON_SYSTEM_PROMPT = """你是一名顶级的 AI 绘画提示词工程师，精通 Stable Diffusion、Midjourney 的提示词语法，擅长将用户简短描述扩展为结构化的 JSON 格式提示词。

你的任务是：
1. 根据用户输入，生成指定数量的不同优化版本，每个版本输出一个完整的 JSON 对象，用水平分隔符"---"隔开。
2. 输出语言规则：默认使用中文输出。仅当用户输入本身是纯英文时，才使用英文输出。
3. 每个 JSON 对象必须包含以下字段：
   - "type"：画面类型/版式（如"品牌VI设计文档"、"角色设定集"、"产品海报"、"信息图表"等，根据用户意图选择最合适的类型）
   - "subject"：主体描述（人物/产品/场景的核心描述，具体到形态、材质、表情、动作等）
   - "layout"：布局结构（包含 grid 网格描述和 sections 区块数组，每个 section 有 title 和 elements）
   - "style"：艺术风格（如"3D渲染"、"扁平插画"、"写实摄影"、"日系动漫"等）
   - "colors"：配色方案（颜色数组）
   - "mood"：整体氛围/调性
4. layout.sections 应根据 type 自动规划合理的区块数量和内容，每个 section 的 elements 描述该区块需要包含的视觉元素。
5. JSON 中所有值都应该是描述性的文本字符串，让图像生成模型能够理解。
6. 优化必须尽可能贴近用户原意，只在细节、风格、布局上做合理补充，不得偏离用户表达的核心内容。
7. 当用户输入包含"类型为Z"、"风格为X"或"氛围为Y"标签时，将其展开并融入 JSON 结构中。
8. 当用户输入仅包含类型/风格/氛围标签而没有具体主体描述时，只展开标签含义，不凭空添加主体。
9. 如用户输入含不合理内容，忽略并引导回安全方向，但不输出任何解释文字。
10. 每个 JSON 版本控制在合理大小内，sections 不超过 12 个。
11. 禁止输出任何解释、前缀、寒暄、编号、标题、markdown 格式。仅输出 JSON 对象本身，版本间用"---"分隔。
12. 绝对不要包含任何 NSFW、暴力、血腥、政治敏感或真人裸露内容。

JSON 输出示例：
{"type":"角色设定集","subject":"3D渲染的可爱柴犬吉祥物，穿着绿色围裙","layout":{"grid":"3列×4行","sections":[{"title":"形态研究","elements":["4个角度的头部线稿","4个身体比例图"]},{"title":"表情设定","elements":["9种3D渲染头部表情"]},{"title":"姿势库","elements":["6个全身3D渲染姿势"]},{"title":"色彩应用","elements":["主配色方案","4种配色变体"]}]}},"style":"3D渲染","colors":["黄色","绿色","白色","棕色"],"mood":"温暖亲切"}

牢记：你不是在与用户对话，只是给出结果。你的身份是Atelier的用户小助手！"""


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
    def _parse_json_versions(cls, text: str, fallback: str) -> list[str]:
        parts = [v.strip() for v in text.split("---") if v.strip()]
        versions = []
        for part in parts:
            cleaned = part.strip()
            if cleaned.startswith("```"):
                cleaned = cleaned.split("\n", 1)[-1] if "\n" in cleaned else cleaned[3:]
                if cleaned.endswith("```"):
                    cleaned = cleaned[:-3]
                cleaned = cleaned.strip()
            try:
                parsed = json.loads(cleaned)
                if isinstance(parsed, dict):
                    versions.append(json.dumps(parsed, ensure_ascii=False, indent=2))
                elif isinstance(parsed, list):
                    versions.append(json.dumps(parsed, ensure_ascii=False, indent=2))
                else:
                    versions.append(cleaned)
            except json.JSONDecodeError:
                versions.append(cleaned)
        return versions or [fallback]

    @classmethod
    async def optimize(cls, prompt: str, count: int = 1, format: str = "text") -> list[str]:
        llm_cfg = get_llm_config()
        if not llm_cfg["enabled"] or not llm_cfg["api_key"]:
            return [prompt]

        if len(prompt) < 2 or len(prompt) > 500:
            raise ValueError("输入长度需在 2-500 个字符之间")

        if BannedWordsService.check(prompt):
            return [prompt]

        system = JSON_SYSTEM_PROMPT if format == "json" else SYSTEM_PROMPT

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
                "system": system,
                "messages": [{"role": "user", "content": f"请生成 {count} 个优化版本。\n用户原始提示词：\n{prompt}"}],
            }
            resp = await client.post(url, headers=headers, json=body)
            resp.raise_for_status()

            data = resp.json()
            text = ""
            for block in data.get("content", []):
                if block.get("type") == "text":
                    text += block.get("text", "")

            if format == "json":
                versions = cls._parse_json_versions(text, prompt)
            else:
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

    @classmethod
    async def optimize_stream(cls, prompt: str, count: int = 1, format: str = "text"):
        llm_cfg = get_llm_config()
        if not llm_cfg["enabled"] or not llm_cfg["api_key"]:
            yield {"type": "done", "versions": [prompt]}
            return

        if len(prompt) < 2 or len(prompt) > 500:
            yield {"type": "error", "detail": "输入长度需在 2-500 个字符之间"}
            return

        if BannedWordsService.check(prompt):
            yield {"type": "done", "versions": [prompt]}
            return

        try:
            client = cls._get_client()
            url = f"{llm_cfg['base_url'].rstrip('/')}/v1/messages"
            headers = {
                "x-api-key": llm_cfg["api_key"],
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            }

            system = JSON_SYSTEM_PROMPT if format == "json" else SYSTEM_PROMPT

            body = {
                "model": llm_cfg["model"],
                "max_tokens": max(llm_cfg["max_tokens"], 2000) * count,
                "system": system,
                "stream": True,
                "messages": [{"role": "user", "content": f"请生成 {count} 个优化版本。\n用户原始提示词：\n{prompt}"}],
            }

            full_text = ""
            current_version = 0
            buffer = ""
            sep = "---"

            async with client.stream("POST", url, headers=headers, json=body, timeout=httpx.Timeout(float(llm_cfg["timeout_seconds"]), connect=5.0)) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data_str = line[6:]
                    if data_str.strip() == "[DONE]":
                        break
                    try:
                        event = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue

                    if event.get("type") == "content_block_delta":
                        delta = event.get("delta", {})
                        if delta.get("type") == "text_delta":
                            text = delta.get("text", "")
                            full_text += text
                            buffer += text

                            while True:
                                idx = buffer.find(sep)
                                if idx < 0:
                                    break
                                before = buffer[:idx].strip()
                                buffer = buffer[idx + len(sep):]
                                if before:
                                    checked = before if not BannedWordsService.check(before) else prompt
                                    yield {"type": "chunk", "text": before, "version_index": current_version, "done": True}
                                current_version += 1

                            remaining = buffer.strip()
                            if remaining:
                                partial = remaining
                            else:
                                partial = ""
                            if partial:
                                yield {"type": "chunk", "text": partial, "version_index": current_version, "done": False}

            if buffer.strip():
                last = buffer.strip()
                checked = last if not BannedWordsService.check(last) else prompt
                yield {"type": "chunk", "text": last, "version_index": current_version, "done": True}

            if format == "json":
                versions = cls._parse_json_versions(full_text, prompt)
            else:
                versions = [v.strip() for v in full_text.split("---") if v.strip()]
                if not versions:
                    versions = [prompt]
            versions = [v if not BannedWordsService.check(v) else prompt for v in versions]
            yield {"type": "done", "versions": versions[:count]}

        except httpx.TimeoutException:
            logger.warning("[prompt_optimizer] LLM API timeout (stream)")
            yield {"type": "error", "detail": "优化超时，请重试"}
        except Exception:
            logger.exception("[prompt_optimizer] LLM API stream failed")
            yield {"type": "error", "detail": "优化失败，请重试"}
