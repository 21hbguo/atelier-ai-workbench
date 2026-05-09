from backend.services.providers.grsai_provider import GrsAIProvider

def test_vip_pixels_low_square():
    assert GrsAIProvider._resolve_vip_aspect_pixels("low","1:1")=="1024x1024"

def test_vip_pixels_medium_wide():
    assert GrsAIProvider._resolve_vip_aspect_pixels("medium","16:9")=="2048x1152"

def test_vip_pixels_high_portrait():
    assert GrsAIProvider._resolve_vip_aspect_pixels("high","2:3")=="2336x3504"

def test_vip_auto_clears_ratio():
    assert GrsAIProvider._resolve_vip_aspect_pixels("auto","16:9")==""
