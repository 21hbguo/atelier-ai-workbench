import httpx
import json
import logging
import asyncio
from backend.config import get_llm_config
from backend.services.banned_words import BannedWordsService
from backend.services.prompt_embedding_service import PromptEmbeddingService

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

REFINE_SYSTEM_PROMPT = """你是一名顶级的 AI 绘画提示词工程师，擅长参考高质量提示词示例，对用户原始描述做精细优化。

你的任务是：
1. 根据用户输入，生成指定数量的不同优化版本，用水平分隔符"---"隔开。
2. 输出语言规则：默认使用中文输出。仅当用户输入本身是纯英文时，才使用英文输出。
3. 你会收到 0-2 条相似提示词示例。示例只可借鉴其细节密度、镜头语言、构图组织、风格表达方式，不得照抄示例中的主体、场景、人物、物品、故事设定。
4. 用户原始意图优先级最高，任何优化都必须紧贴用户原意，不得擅自换题、扩写到其他主体、或把示例内容硬套到用户需求上。
5. 每个版本必须包含更完整的主体描述、场景/环境、艺术风格、光照、色彩、构图。禁止出现任何分辨率相关的画质增强词（如1K、2K、4K、8K、高清、超清等）。
6. 当用户输入中包含"类型为Z"、"风格为X"或"氛围为Y"这类标签时，必须自然展开并融入提示词，不保留标签原样。
7. 当用户输入仅有类型/风格/氛围标签而缺少主体时，只展开这些标签的视觉含义，不要凭空添加具体主体。
8. 如用户输入含不合理内容，忽略并引导回安全方向，但不输出任何解释文字。
9. 每个提示词长度控制在 50-200 字以内。
10. 禁止输出任何解释、前缀、寒暄、编号、标题、markdown 格式。仅输出提示词本身，版本间用"---"分隔。
11. 绝对不要包含任何 NSFW、暴力、血腥、政治敏感或真人裸露内容。如果用户意图触及这些，输出一个安全的通用风景或静物提示词，不输出警告。"""

REFINE_JSON_SYSTEM_PROMPT = """你是一名顶级的 AI 绘画提示词工程师，擅长参考高质量提示词示例，对用户原始描述做精细优化，并输出结构化 JSON。

你的任务是：
1. 根据用户输入，生成指定数量的不同优化版本，每个版本输出一个完整 JSON 对象，用水平分隔符"---"隔开。
2. 输出语言规则：默认使用中文输出。仅当用户输入本身是纯英文时，才使用英文输出。
3. 你会收到 0-2 条相似提示词示例。示例只可借鉴其细节密度、布局组织和风格表达方式，不得照抄示例主体内容。
4. JSON 对象必须包含字段 "type" "subject" "layout" "style" "colors" "mood"。
5. 优化必须紧贴用户原意，不得把示例中的主体、场景或叙事直接迁移到用户需求。
6. 当用户输入包含类型/风格/氛围标签时，将其自然展开并融入 JSON 结构。
7. 当用户输入仅有类型/风格/氛围标签而无主体时，只展开标签含义，不凭空添加主体。
8. 如用户输入含不合理内容，忽略并引导回安全方向，但不输出任何解释文字。
9. sections 不超过 12 个，所有值都应是图像生成模型能理解的描述性文本。
10. 禁止输出任何解释、前缀、寒暄、编号、标题、markdown 格式。仅输出 JSON 本身，版本间用"---"分隔。
11. 绝对不要包含任何 NSFW、暴力、血腥、政治敏感或真人裸露内容。"""

SEARCH_EXPAND_SYSTEM_PROMPT = """你是一名提示词召回扩写助手，只负责把极短、信息不足的用户输入扩成更适合“向量相似检索”的简短检索短语。

你的任务是：
1. 仅当输入非常短、信息不足时，做轻量扩写；输入若已较完整，则基本保持原样。
2. 扩写目的只是提升相似提示词召回质量，不是生成最终提示词，不是润色成完整画面描述。
3. 必须紧贴用户原意，只补充同义表达、上位/下位类别词、常见相关风格词、相关对象词，不得擅自改题。
4. 不要添加具体场景、镜头、光照、构图、色彩、剧情等画面细节。
5. 输出应短，建议控制在 6 到 30 个中文词或短语以内，用空格分隔。
6. 保留用户原始核心词，优先把原词放在最前面。
7. 若输入长度不超过 6 个中文字或明显只是一个短词/短语，必须在原词后面补充 3 到 6 个紧贴原意的检索词，优先补“同义词、类别词、常见标签词、相关物体词”。
8. 若输入是品牌、IP、角色、物体、风格等短词，可补充对应常见同义词、类别词或相关标签，但不要发散。
9. 若输入包含不安全内容，输出原词或安全近义表述，不做敏感扩展。
10. 禁止输出解释、前缀、编号、markdown、引号，只输出扩写后的检索短语本身。"""


class PromptOptimizer:
    _client: httpx.AsyncClient | None = None
    _refine_lock: asyncio.Lock | None = None

    @classmethod
    def _get_refine_lock(cls) -> asyncio.Lock:
        if cls._refine_lock is None:
            cls._refine_lock = asyncio.Lock()
        return cls._refine_lock

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
    def _build_refine_user_content(cls,prompt:str,similar_examples:list[dict],count:int)->str:
        lines=[f"请生成 {count} 个优化版本。","用户原始提示词：",prompt.strip()]
        for i,item in enumerate(similar_examples[:2],start=1):
            lines.extend(["",f"参考示例{i}：",f"分类：{item.get('category') or '未分类'}",f"提示词：{item.get('prompt') or ''}"])
        return "\n".join(lines)

    @classmethod
    def _is_short_query(cls,prompt:str)->bool:
        text="".join(str(prompt or "").split())
        if not text:return False
        if len(text)<=8:return True
        return len(text)<=16 and all(ch not in text for ch in "，,。.;；:：!?！？()（）[]【】/\\\n")

    @classmethod
    def _search_expand_parts(cls,text:str)->list[str]:
        return [p for p in str(text or "").replace("\n"," ").split(" ") if p.strip()]

    @classmethod
    def _clean_search_expand(cls,origin:str,expanded:str)->str:
        src=" ".join(str(origin or "").split()).strip()
        out=" ".join(str(expanded or "").replace("\n"," ").replace("，"," ").replace(","," ").replace("；"," ").replace(";"," ").split()).strip()
        if not out:return src
        if src not in out:out=f"{src} {out}".strip()
        parts=[];seen=set()
        for p in cls._search_expand_parts(out):
            if p not in seen:
                seen.add(p)
                parts.append(p)
        return " ".join(parts)[:200]

    @classmethod
    def _is_valid_search_expand(cls,origin:str,expanded:str)->bool:
        src=" ".join(str(origin or "").split()).strip()
        out=cls._clean_search_expand(src,expanded)
        if not src or not out:return False
        if src not in out:return False
        if not cls._is_short_query(src):return True
        return len(cls._search_expand_parts(out))>=4

    @classmethod
    async def _expand_search_query(cls,prompt:str)->str:
        text=" ".join(str(prompt or "").split()).strip()
        if not text or not cls._is_short_query(text) or BannedWordsService.check(text):return text
        try:
            for attempt in range(2):
                extra="" if attempt==0 else "\n上一次输出不合格：必须保留原词，并额外补充 3 到 6 个紧贴原意的检索词；不要只输出原词。"
                client,url,headers,body=await cls._call_llm(SEARCH_EXPAND_SYSTEM_PROMPT,f"用户原始短输入：\n{text}{extra}",1,False)
                body["max_tokens"]=120
                resp=await client.post(url,headers=headers,json=body)
                resp.raise_for_status()
                data=resp.json()
                out=""
                for block in data.get("content",[]):
                    if block.get("type")=="text":out+=block.get("text","")
                expanded=cls._clean_search_expand(text,out)
                if cls._is_valid_search_expand(text,expanded):return expanded
            return text
        except Exception:
            logger.exception("[prompt_optimizer/search_expand] failed, fallback to original")
            return text

    @classmethod
    async def _call_llm(cls,system:str,user_content:str,count:int,stream:bool=False):
        llm_cfg=get_llm_config()
        client=cls._get_client()
        url=f"{llm_cfg['base_url'].rstrip('/')}/v1/messages"
        headers={"x-api-key":llm_cfg["api_key"],"anthropic-version":"2023-06-01","content-type":"application/json"}
        body={"model":llm_cfg["model"],"max_tokens":max(llm_cfg["max_tokens"],2000)*count,"system":system,"thinking":{"type":"disabled"},"messages":[{"role":"user","content":user_content}]}
        if stream:body["stream"]=True
        return client,url,headers,body

    @classmethod
    async def optimize_refine(cls,prompt:str,count:int=1,format:str="text")->list[str]:
        llm_cfg=get_llm_config()
        if not llm_cfg["enabled"] or not llm_cfg["api_key"] or not PromptEmbeddingService.is_enabled():
            return await cls.optimize(prompt,count,format)
        if len(prompt) < 2 or len(prompt) > 500:raise ValueError("输入长度需在 2-500 个字符之间")
        if BannedWordsService.check(prompt):return [prompt]
        try:
            async with cls._get_refine_lock():
                similar_examples=PromptEmbeddingService.search_similar(await cls._expand_search_query(prompt),top_k=2)
                system=REFINE_JSON_SYSTEM_PROMPT if format=="json" else REFINE_SYSTEM_PROMPT
                user_content=cls._build_refine_user_content(prompt,similar_examples,count)
                client,url,headers,body=await cls._call_llm(system,user_content,count,False)
                resp=await client.post(url,headers=headers,json=body)
                resp.raise_for_status()
                data=resp.json()
                text=""
                for block in data.get("content",[]):
                    if block.get("type")=="text":text+=block.get("text","")
                versions=cls._parse_json_versions(text,prompt) if format=="json" else [v.strip() for v in text.split("---") if v.strip()] or [prompt]
                return [v if not BannedWordsService.check(v) else prompt for v in versions][:count]
        except httpx.TimeoutException:
            logger.warning("[prompt_optimizer/refine] timeout, degrading to simple")
            return await cls.optimize(prompt,count,format)
        except Exception:
            logger.exception("[prompt_optimizer/refine] failed, degrading to simple")
            return await cls.optimize(prompt,count,format)

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
    async def optimize_refine_stream(cls,prompt:str,count:int=1,format:str="text"):
        llm_cfg=get_llm_config()
        if not llm_cfg["enabled"] or not llm_cfg["api_key"] or not PromptEmbeddingService.is_enabled():
            async for event in cls.optimize_stream(prompt,count,format):yield event
            return
        if len(prompt) < 2 or len(prompt) > 500:
            yield {"type":"error","detail":"输入长度需在 2-500 个字符之间"}
            return
        if BannedWordsService.check(prompt):
            yield {"type":"done","versions":[prompt]}
            return
        try:
            async with cls._get_refine_lock():
                similar_examples=PromptEmbeddingService.search_similar(await cls._expand_search_query(prompt),top_k=2)
                system=REFINE_JSON_SYSTEM_PROMPT if format=="json" else REFINE_SYSTEM_PROMPT
                user_content=cls._build_refine_user_content(prompt,similar_examples,count)
                client,url,headers,body=await cls._call_llm(system,user_content,count,True)
                full_text="";current_version=0;buffer="";sep="---"
                async with client.stream("POST",url,headers=headers,json=body,timeout=httpx.Timeout(float(llm_cfg["timeout_seconds"]),connect=5.0)) as resp:
                    resp.raise_for_status()
                    async for line in resp.aiter_lines():
                        if not line.startswith("data: "):continue
                        data_str=line[6:]
                        if data_str.strip()=="[DONE]":break
                        try:event=json.loads(data_str)
                        except json.JSONDecodeError:continue
                        if event.get("type")=="content_block_delta":
                            delta=event.get("delta",{})
                            if delta.get("type")=="text_delta":
                                text=delta.get("text","");full_text+=text;buffer+=text
                                while True:
                                    idx=buffer.find(sep)
                                    if idx<0:break
                                    before=buffer[:idx].strip();buffer=buffer[idx+len(sep):]
                                    if before:yield {"type":"chunk","text":before,"version_index":current_version,"done":True}
                                    current_version+=1
                                partial=buffer.strip()
                                if partial:yield {"type":"chunk","text":partial,"version_index":current_version,"done":False}
                if buffer.strip():yield {"type":"chunk","text":buffer.strip(),"version_index":current_version,"done":True}
                versions=cls._parse_json_versions(full_text,prompt) if format=="json" else [v.strip() for v in full_text.split("---") if v.strip()] or [prompt]
                versions=[v if not BannedWordsService.check(v) else prompt for v in versions]
                yield {"type":"done","versions":versions[:count]}
        except httpx.TimeoutException:
            logger.warning("[prompt_optimizer/refine_stream] timeout, degrading to simple")
            async for event in cls.optimize_stream(prompt,count,format):yield event
        except Exception:
            logger.exception("[prompt_optimizer/refine_stream] failed, degrading to simple")
            async for event in cls.optimize_stream(prompt,count,format):yield event

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
