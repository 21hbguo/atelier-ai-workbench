import re
import json
import httpx
import logging
from backend.config import get_llm_config
logger=logging.getLogger(__name__)
SYSTEM_PROMPT="""你是中文文生图作品标题编辑，只做“起标题”，不是做内容总结，也不是改写提示词。必须根据完整提示词提炼出像作品名、卡片标题、展名那样的中文短标题。只输出一个标题，不要解释、不要编号、不要换行。标题必须是中文，优先4到8个字，最多12个字。标题要像“可爱Q版潮玩”“雨夜海港”“武侠女侠”“魔法书房”“霓虹机甲少女”这种作品名，不要像“根据原图生成卡通女孩”“把图片转化为可爱风格”“设计一个穿白裙的少女”。如果输入是英文或混合语言，先理解语义并翻成自然中文标题，再起名，不能直接输出英文或拼音。必须综合使用整个提示词，不许只看开头或只截取一小段。不要照抄原句，不要复述提示词，不要使用“生成、制作、转化、设计、根据、基于、把、将、请、用、做、让、呈现、优化、提升、修复、调整、改成、输出”等动作词开头。避免空泛词，如“作品”“插画”“图像”“风景”。不要使用书名号、引号、句号、冒号。若原始标题已是很好的中文短标题，只做轻微润色。"""
def _clean_text(v:str)->str:return re.sub(r"\s+"," ",str(v or "")).strip()
def needs_title_generation(raw_name:str,prompt:str="")->bool:
    name=_clean_text(raw_name)
    prompt=_clean_text(prompt)
    if not name:return True
    if len(name)>16:return True
    if re.search(r"[A-Za-z]{3,}",name):return True
    if prompt and name==prompt:return True
    return not _is_good_chinese_title(name)
def _is_good_chinese_title(v:str)->bool:
    s=_clean_text(v)
    if not s:return False
    if len(s)<2 or len(s)>16:return False
    if re.search(r"[A-Za-z]{3,}",s):return False
    if re.match(r"^(根据|基于|按照|把|将|请|生成|制作|转化|设计|优化|提升|调整|改成|输出|呈现|做|让|用)",s):return False
    if re.search(r"(根据|基于|按照|把|将|请|生成|制作|转化|设计|优化|提升|调整|改成|输出|呈现|做|让|用)",s) and len(s)>6:return False
    return bool(re.search(r"[\u4e00-\u9fff]",s))
def _fallback_title(prompt:str,raw_name:str="")->str:
    base=_clean_text(raw_name)
    if _is_good_chinese_title(base):return base[:12]
    text=_clean_text(prompt)
    if not text:return "未命名作品"
    text=re.sub(r'^(把我的图片转化为|将我的图片转化为|把图片转化为|将图片转化为|生成一张|生成一个|请生成|请把我的图片转化为|请将我的图片转化为|a\s+|an\s+|the\s+)\s*','',text,flags=re.I)
    parts=[_clean_text(p) for p in re.split(r"[，,。；;、\n]",text) if _clean_text(p)]
    keywords=[]
    for part in parts:
        if re.search(r"[A-Za-z]{3,}",part):continue
        if re.search(r"[\u4e00-\u9fff]",part):
            seg=re.split(r"(?:风格为|类型为|场景为|氛围为|主体|构图|光照|色彩|背景)",part)[0].strip()
            if seg and len(seg)<=12:keywords.append(seg)
            if len(keywords)>=3:break
    if keywords:
        title="".join(keywords[:2])[:12]
        return title if len(title)>=2 else "未命名作品"
    m=re.search(r"([\u4e00-\u9fff]{2,12})",text)
    if m:return m.group(1)[:12]
    return _fallback_english_title(text)

def _fallback_english_title(text:str)->str:
    t=_clean_text(text).lower()
    if not t:return "未命名作品"
    rules=[(r"cute|chibi|kawaii|adorable|toy|blind box|figure|doll|mini","可爱潮玩"),(r"portrait|headshot|executive|business|professional|studio","商务肖像"),(r"library|books|book","梦幻书房"),(r"candle|floating candles|glow|glowing|light","微光"),(r"girl|woman|female|lady","少女"),(r"man|male|boy","少年"),(r"pink","粉色"),(r"blue","蓝色"),(r"white background|clean background|minimal background","纯净背景"),(r"fantasy|dreamy|magical","梦幻"),(r"vintage|retro","复古"),(r"cyber|neon|sci[- ]?fi|future","赛博"),(r"anime|cartoon|illustration","插画"),(r"hair","发色"),(r"bubblegum","泡泡糖")]
    tags=[]
    for pat,label in rules:
        if re.search(pat,t) and label not in tags:tags.append(label)
    if not tags:
        if re.search(r"portrait|headshot|executive|business",t):tags.append("商务肖像")
        if re.search(r"library|books",t):tags.append("梦幻书房")
        if re.search(r"cute|chibi|toy|blind box",t):tags.append("可爱潮玩")
    title="".join(tags[:3]) if tags else "主题作品"
    return title[:12] if len(title)>=2 else "未命名作品"
class TitleGenerator:
    _client:httpx.AsyncClient|None=None
    @classmethod
    def _get_client(cls)->httpx.AsyncClient:
        if cls._client is None or cls._client.is_closed:
            llm_cfg=get_llm_config()
            cls._client=httpx.AsyncClient(timeout=httpx.Timeout(float(llm_cfg["timeout_seconds"]),connect=5.0))
        return cls._client
    @classmethod
    async def close(cls):
        if cls._client and not cls._client.is_closed:
            await cls._client.aclose()
            cls._client=None
    @classmethod
    async def generate(cls,prompt:str,raw_name:str="",prefer_prompt:bool=False)->str:
        prompt=_clean_text(prompt)
        raw_name=_clean_text(raw_name)
        if _is_good_chinese_title(raw_name) and not prefer_prompt:return raw_name[:12]
        llm_cfg=get_llm_config()
        if not llm_cfg["enabled"] or not llm_cfg["api_key"]:return _fallback_title(prompt,raw_name)
        try:
            client=cls._get_client()
            url=f"{llm_cfg['base_url'].rstrip('/')}/v1/messages"
            headers={"x-api-key":llm_cfg["api_key"],"anthropic-version":"2023-06-01","content-type":"application/json"}
            prefer_tip="必须优先参考完整提示词重新命名，不要沿用原始标题。\n" if prefer_prompt else ""
            user_text=f"原始标题：{raw_name or '无'}\n完整提示词：\n{prompt}\n\n{prefer_tip}只返回最终中文标题"
            body={"model":llm_cfg["model"],"max_tokens":96,"system":SYSTEM_PROMPT,"thinking":{"type":"disabled"},"messages":[{"role":"user","content":user_text}]}
            for retry in range(2):
                resp=await client.post(url,headers=headers,json=body)
                resp.raise_for_status()
                data=resp.json()
                text=""
                for block in data.get("content",[]):
                    if block.get("type")=="text":text+=block.get("text","")
                title=_clean_text(text).strip("《》\"'“”‘’[]()（）.,，。；;：:")
                if _is_good_chinese_title(title):return title[:12]
                body["messages"]=[{"role":"user","content":f"请把下面的提示词翻译并概括成一个自然的中文作品标题，只返回标题本身，不要解释。\n原始标题：{raw_name or '无'}\n完整提示词：\n{prompt}\n\n{prefer_tip}最终必须输出中文标题"}]
            if _is_good_chinese_title(raw_name) and not prefer_prompt:return raw_name[:12]
        except Exception:
            logger.exception("[title_generator] generate failed")
        return _fallback_title(prompt,raw_name)
