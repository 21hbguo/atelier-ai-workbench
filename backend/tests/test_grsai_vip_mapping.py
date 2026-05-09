import asyncio
from unittest.mock import patch
from backend.services.providers.grsai_provider import GrsAIProvider
from backend.routers.generate import _get_model_cost

def test_vip_pixels_low_square():
    assert GrsAIProvider._resolve_vip_aspect_pixels("low","1:1")=="1024x1024"

def test_vip_pixels_medium_wide():
    assert GrsAIProvider._resolve_vip_aspect_pixels("medium","16:9")=="2048x1152"

def test_vip_pixels_high_portrait():
    assert GrsAIProvider._resolve_vip_aspect_pixels("high","2:3")=="2336x3504"

def test_vip_auto_clears_ratio():
    assert GrsAIProvider._resolve_vip_aspect_pixels("auto","16:9")==""

def test_image_ratio_pixels():
    assert GrsAIProvider._resolve_image_ratio_pixels("1:1")=="1024x1024"
    assert GrsAIProvider._resolve_image_ratio_pixels("16:9")=="1774x887"
    assert GrsAIProvider._resolve_image_ratio_pixels("auto")==""

def test_vip_resolution_cost_mapping():
    with patch("backend.routers.generate.get_generation_models",return_value={"grsai-vip":{"params":{"points_cost":15,"resolution_costs":{"auto":15,"low":15,"medium":25,"high":40}}}}):
        assert _get_model_cost("grsai-vip","auto")==15
        assert _get_model_cost("grsai-vip","low")==15
        assert _get_model_cost("grsai-vip","medium")==25
        assert _get_model_cost("grsai-vip","high")==40

def test_grsai_gpt_image_2_uses_size_payload():
    payloads=[]
    class DummyResponse:
        status_code=200
        def json(self): return {"code":0,"data":{"id":"task-1"}}
    class DummyClient:
        async def post(self,url,headers=None,json=None):
            payloads.append(json)
            return DummyResponse()
    with patch("backend.services.providers.grsai_provider.get_http_client",return_value=DummyClient()):
        asyncio.run(GrsAIProvider.submit({},prompt="p",size="16:9",model="gpt-image-2"))
    assert payloads[0]["size"]=="1774x887"
    assert "aspectRatio" not in payloads[0]

def test_grsai_vip_uses_size_payload():
    payloads=[]
    class DummyResponse:
        status_code=200
        def json(self): return {"code":0,"data":{"id":"task-2"}}
    class DummyClient:
        async def post(self,url,headers=None,json=None):
            payloads.append(json)
            return DummyResponse()
    with patch("backend.services.providers.grsai_provider.get_http_client",return_value=DummyClient()):
        asyncio.run(GrsAIProvider.submit({},prompt="p",size="16:9",resolution="medium",aspect_ratio=None,model="gpt-image-2-vip"))
    assert payloads[0]["size"]=="2048x1152"
    assert "aspectRatio" not in payloads[0]

def test_grsai_vip_auto_mode_omits_size_payload():
    payloads=[]
    class DummyResponse:
        status_code=200
        def json(self): return {"code":0,"data":{"id":"task-3"}}
    class DummyClient:
        async def post(self,url,headers=None,json=None):
            payloads.append(json)
            return DummyResponse()
    with patch("backend.services.providers.grsai_provider.get_http_client",return_value=DummyClient()):
        asyncio.run(GrsAIProvider.submit({},prompt="p",size="auto",resolution="high",aspect_ratio=None,model="gpt-image-2-vip"))
    assert "size" not in payloads[0]
