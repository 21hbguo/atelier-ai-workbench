import os
from pathlib import Path
from PIL import Image
_CACHE={}
def get_image_dimensions(path:str):
    try:
        rp=str(Path(path).resolve())
        st=os.stat(rp)
        sig=(st.st_mtime_ns,st.st_size)
        cached=_CACHE.get(rp)
        if cached and cached[:2]==sig:return cached[2],cached[3]
        with Image.open(rp) as img:w,h=img.size
        if w>0 and h>0:_CACHE[rp]=(sig[0],sig[1],w,h);return w,h
    except Exception:
        return None,None
    return None,None
