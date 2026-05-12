import asyncio
from unittest.mock import patch
from backend.services.gen_gateway import GenGateway

def test_non_retryable_submit_error_does_not_open_circuit():
    class DummyProvider:
        calls=0
        @classmethod
        async def submit(cls,conf,**kwargs):
            cls.calls+=1
            raise RuntimeError("policy_blocked")
        @classmethod
        def is_retryable_error(cls,exc):
            return False
    GenGateway._health={}
    with patch.object(GenGateway,"_providers",{"dummy":DummyProvider}),patch("backend.services.gen_gateway.get_generation_models",return_value={"m":{"enabled":True,"providers":["p"],"model":"dummy-model"}}),patch("backend.services.gen_gateway.get_generation_providers",return_value={"p":{"type":"dummy","enabled":True,"circuit_fail_threshold":1,"circuit_cooldown_seconds":60}}),patch("backend.services.gen_gateway.get_default_model_id",return_value="m"):
        for _ in range(2):
            try:
                asyncio.run(GenGateway.submit("m","prompt"))
            except RuntimeError as e:
                assert str(e)=="submit_failed:policy_blocked"
            else:
                raise AssertionError("expected submit failure")
    assert DummyProvider.calls==2
    assert GenGateway._health["p"].get("opened_until") is None

def test_retryable_submit_error_opens_circuit():
    class DummyProvider:
        calls=0
        @classmethod
        async def submit(cls,conf,**kwargs):
            cls.calls+=1
            raise RuntimeError("timeout")
        @classmethod
        def is_retryable_error(cls,exc):
            return True
    GenGateway._health={}
    with patch.object(GenGateway,"_providers",{"dummy":DummyProvider}),patch("backend.services.gen_gateway.get_generation_models",return_value={"m":{"enabled":True,"providers":["p"],"model":"dummy-model"}}),patch("backend.services.gen_gateway.get_generation_providers",return_value={"p":{"type":"dummy","enabled":True,"circuit_fail_threshold":1,"circuit_cooldown_seconds":60}}),patch("backend.services.gen_gateway.get_default_model_id",return_value="m"):
        try:
            asyncio.run(GenGateway.submit("m","prompt"))
        except RuntimeError as e:
            assert str(e)=="submit_failed:timeout"
        else:
            raise AssertionError("expected submit failure")
        try:
            asyncio.run(GenGateway.submit("m","prompt"))
        except RuntimeError as e:
            assert str(e)=="submit_failed:no_provider_available"
        else:
            raise AssertionError("expected no provider")
    assert DummyProvider.calls==1
    assert GenGateway._health["p"].get("opened_until") is not None
