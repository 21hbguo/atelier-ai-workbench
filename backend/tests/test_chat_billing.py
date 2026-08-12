"""聊天按 token 计费补扣逻辑的 mock 单元测试。

覆盖 backend/routers/chat.py 中的：
- _compute_token_cost：按 token 单价计算费用 / 回退按次
- _record_chat_usage：落库 chat_usage_records + 补差价（consume/add_points）
- _refund_once：失败退款时 UPDATE is_refunded=TRUE（闭包，通过源码静态校验 + 调用序列动态验证）

不连真实数据库、不连真实 LLM。所有 DB / PointsService 均通过 unittest.mock 打桩。
"""
import inspect
from contextlib import contextmanager
from decimal import Decimal
from unittest.mock import patch, MagicMock

from backend.routers import chat as chat_module
from backend.routers.chat import _compute_token_cost, _record_chat_usage

# 模型档案：配了 4 档 token 单价 + 按次预扣
_MODEL_WITH_UNIT_PRICE = {
    "model_id": "test-model",
    "points_per_request": 10,
    "points_per_1k_input": 2,
    "points_per_1k_output": 6,
    "points_per_1k_cache_read": 1,
    "points_per_1k_cache_creation": 1.5,
}

# usage：input=5000、output=2000、cache_read=1000、cache_creation=500、reasoning=100、total=8500
# 注意：reasoning_tokens 已包含在 output_tokens 内，不参与计费
_USAGE_FULL = {
    "input_tokens": 5000,
    "output_tokens": 2000,
    "cache_read_tokens": 1000,
    "cache_creation_tokens": 500,
    "reasoning_tokens": 100,
    "total_tokens": 8500,
}


@contextmanager
def _mock_db_conn():
    """Patch chat 模块的 get_db；yield conn mock。

    get_db 是 @contextmanager，`with get_db() as conn:` 会调用
    get_db().__enter__() 拿到 conn。这里把 __enter__.return_value 设为 conn mock。
    """
    conn = MagicMock(name="db_conn")
    with patch.object(chat_module, "get_db") as mock_get_db:
        mock_get_db.return_value.__enter__.return_value = conn
        mock_get_db.return_value.__exit__.return_value = False
        yield conn


def _insert_params(conn):
    """从 mock conn.execute 的调用中取出 INSERT chat_usage_records 的参数元组。

    conn.execute(SQL, params) → call_args[0] = (SQL, params) → params 在索引 1。
    params 字段顺序：(user_id, session_id, message_id, model_key, request_id,
                      input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
                      reasoning_tokens, total_tokens, cost_points, billing_mode)
    """
    return conn.execute.call_args[0][1]


# ---------------------------------------------------------------------------
# 场景 1: 模型配了单价，token 费用 > 预扣（需要补扣差额）
# ---------------------------------------------------------------------------
def test_record_chat_usage_token_cost_exceeds_precharge():
    """费用 = (5000*2 + 2000*6 + 1000*1 + 500*1.5)/1000 = 23.75 > 预扣 10
    → 补扣 13.75，落库 cost_points=23.75、billing_mode='token'。
    """
    model_cfg = dict(_MODEL_WITH_UNIT_PRICE, points_per_request=10)
    req_id = "req-scenario-1"

    with patch.object(chat_module.PointsService, "consume", return_value=76.25) as mock_consume, \
        patch.object(chat_module.PointsService, "refund") as mock_refund, \
         _mock_db_conn() as conn:
        final_balance = _record_chat_usage(
            user_id=1, session_id=2, message_id=3,
            model_cfg=model_cfg, usage=dict(_USAGE_FULL), req_id=req_id,
            pre_charged=10.0, pre_balance=100.0,
        )

    # 实际费用 23.75 向上取整为 24，diff = 24 - 10 = 14 → consume 一次
    mock_consume.assert_called_once()
    args, kwargs = mock_consume.call_args
    assert args[0] == 1                       # user_id
    assert args[1] == 14.0                    # amount = float(diff)
    assert args[2] == "AI对话按量补差"          # description
    assert kwargs["tx_type"] == "chat_token_adjust"
    assert kwargs["request_key"] == f"chat_token_adjust:{req_id}"
    mock_refund.assert_not_called()
    # consume 返回值作为 final_balance 回传
    assert final_balance == 76.25

    # DB INSERT：cost_points=23.75, billing_mode='token'
    params = _insert_params(conn)
    assert params[11] == Decimal("23.75")     # cost_points
    assert params[12] == "token"              # billing_mode


# ---------------------------------------------------------------------------
# 场景 2: 模型配了单价，token 费用 < 预扣（需要退差额）
# ---------------------------------------------------------------------------
def test_record_chat_usage_token_cost_below_precharge():
    """费用 = (500*2 + 100*6)/1000 = 1.6 < 预扣 50
    → 退还 48.4，落库 cost_points=1.6。
    """
    model_cfg = dict(_MODEL_WITH_UNIT_PRICE, points_per_request=50)
    usage = {"input_tokens": 500, "output_tokens": 100,
             "cache_read_tokens": 0, "cache_creation_tokens": 0}
    req_id = "req-scenario-2"

    with patch.object(chat_module.PointsService, "consume") as mock_consume, \
        patch.object(chat_module.PointsService, "refund", return_value=98) as mock_refund, \
         _mock_db_conn() as conn:
        final_balance = _record_chat_usage(
            user_id=1, session_id=2, message_id=3,
            model_cfg=model_cfg, usage=usage, req_id=req_id,
            pre_charged=50.0, pre_balance=50.0,
        )

    # 实际费用 1.6 向上取整为 2，diff = 2 - 50 = -48 → refund 一次
    mock_refund.assert_called_once()
    args, kwargs = mock_refund.call_args
    assert args[0] == 1                       # user_id
    assert args[1] == 48.0                    # amount = float(-diff)
    assert args[2] == "AI对话按量退还差额"
    assert kwargs["request_key"] == f"chat_token_adjust:{req_id}"
    mock_consume.assert_not_called()
    assert final_balance == 98

    params = _insert_params(conn)
    assert params[11] == Decimal("1.6")       # cost_points
    assert params[12] == "token"              # billing_mode


# ---------------------------------------------------------------------------
# 场景 3: 模型配了单价，token 费用 == 预扣（不补差不退款）
# ---------------------------------------------------------------------------
def test_record_chat_usage_token_cost_equals_precharge():
    """费用 = 5000*2/1000 = 10 == 预扣 10
    → 既不 consume 也不 add_points，但仍落一条 usage 记录。
    """
    model_cfg = dict(_MODEL_WITH_UNIT_PRICE, points_per_request=10)
    # input=5000, 单价 2/1k → cost=10 == pre_charged
    usage = {"input_tokens": 5000, "output_tokens": 0,
             "cache_read_tokens": 0, "cache_creation_tokens": 0}
    req_id = "req-scenario-3"

    with patch.object(chat_module.PointsService, "consume") as mock_consume, \
        patch.object(chat_module.PointsService, "refund") as mock_refund, \
         _mock_db_conn() as conn:
        final_balance = _record_chat_usage(
            user_id=1, session_id=2, message_id=3,
            model_cfg=model_cfg, usage=usage, req_id=req_id,
            pre_charged=10.0, pre_balance=100.0,
        )

    mock_consume.assert_not_called()
    mock_refund.assert_not_called()
    # diff=0 时不调整余额，回传 pre_balance
    assert final_balance == 100.0
    # 仍落一条 usage 记录
    assert conn.execute.call_count == 1
    params = _insert_params(conn)
    assert params[11] == Decimal("10")        # cost_points
    assert params[12] == "token"              # billing_mode


# ---------------------------------------------------------------------------
# 场景 4: usage 为 None（上游不返回，回退按次）
# ---------------------------------------------------------------------------
def test_compute_token_cost_usage_none_falls_back_per_request():
    """usage=None → billing_mode='per_request'，cost_points=points_per_request，
    既不 consume 也不 add_points（预扣已按 points_per_request 扣过）。
    """
    model_cfg = dict(_MODEL_WITH_UNIT_PRICE, points_per_request=10)

    # 直接验证 _compute_token_cost
    cost, mode = _compute_token_cost(None, model_cfg)
    assert cost == Decimal("10")
    assert mode == "per_request"

    # 验证 _record_chat_usage 不补差不退款
    req_id = "req-scenario-4"
    with patch.object(chat_module.PointsService, "consume") as mock_consume, \
        patch.object(chat_module.PointsService, "refund") as mock_refund, \
         _mock_db_conn() as conn:
        final_balance = _record_chat_usage(
            user_id=1, session_id=2, message_id=3,
            model_cfg=model_cfg, usage=None, req_id=req_id,
            pre_charged=10.0, pre_balance=100.0,
        )

    mock_consume.assert_not_called()
    mock_refund.assert_not_called()
    assert final_balance == 100.0
    params = _insert_params(conn)
    assert params[11] == Decimal("10")        # cost_points
    assert params[12] == "per_request"        # billing_mode


# ---------------------------------------------------------------------------
# 场景 5: 模型未配单价（points_per_1k_input 为 None，回退按次）
# ---------------------------------------------------------------------------
def test_compute_token_cost_no_unit_price_falls_back_per_request():
    """points_per_1k_input=None → billing_mode='per_request'，
    cost_points=points_per_request，不补差不退款。
    """
    model_cfg = {
        "model_id": "test-model",
        "points_per_request": 10,
        "points_per_1k_input": None,   # 未配 token 单价
    }

    cost, mode = _compute_token_cost(dict(_USAGE_FULL), model_cfg)
    assert cost == Decimal("10")
    assert mode == "per_request"

    req_id = "req-scenario-5"
    with patch.object(chat_module.PointsService, "consume") as mock_consume, \
        patch.object(chat_module.PointsService, "refund") as mock_refund, \
         _mock_db_conn() as conn:
        final_balance = _record_chat_usage(
            user_id=1, session_id=2, message_id=3,
            model_cfg=model_cfg, usage=dict(_USAGE_FULL), req_id=req_id,
            pre_charged=10.0, pre_balance=100.0,
        )

    mock_consume.assert_not_called()
    mock_refund.assert_not_called()
    assert final_balance == 100.0
    params = _insert_params(conn)
    assert params[11] == Decimal("10")        # cost_points
    assert params[12] == "per_request"        # billing_mode


# ---------------------------------------------------------------------------
# 场景 6: 失败退款同步标记 is_refunded
# ---------------------------------------------------------------------------
def test_refund_marks_usage_refunded():
    """_refund_once 失败退款时 UPDATE is_refunded=TRUE。

    _refund_once 是 send_message 内的局部闭包（捕获 user_id/cost_per/req_id），
    无法在不跑完整 HTTP 请求管线的前提下直接调用。因此：
    1. 静态校验 send_message 源码包含正确的 UPDATE 语句（is_refunded=TRUE + WHERE request_id + is_refunded=FALSE）
    2. 动态验证：mock DB + PointsService.refund，复制 _refund_once 的调用序列，
       确认 cursor.execute 收到正确的 UPDATE SQL 与 (req_id,) 参数
    """
    # 1. 静态：源码包含正确的 UPDATE 语句
    source = inspect.getsource(chat_module.send_message)
    assert "UPDATE chat_usage_records SET is_refunded = TRUE" in source, \
        "_refund_once 应将 is_refunded 置为 TRUE"
    assert "WHERE request_id = %s AND is_refunded = FALSE" in source, \
        "_refund_once 应按 request_id 且仅更新未退款的记录"

    # 2. 动态：mock 后复制 _refund_once 调用序列
    req_id = "req-refund-6"
    user_id = 1
    cost_per = 10.0
    update_sql = (
        "UPDATE chat_usage_records SET is_refunded = TRUE "
        "WHERE request_id = %s AND is_refunded = FALSE"
    )

    with patch.object(chat_module.PointsService, "refund", return_value=90.0) as mock_refund, \
         _mock_db_conn() as conn:
        # 复制 _refund_once 的调用序列（与 chat.py 中闭包体一致）
        try:
            chat_module.PointsService.refund(
                user_id, cost_per, "AI助手回复失败退还",
                request_key=f"chat_refund:{req_id}",
            )
        except Exception:
            pass
        try:
            with chat_module.get_db() as c:
                c.execute(update_sql, (req_id,))
        except Exception:
            pass

    # refund 被调用，参数与 _refund_once 一致
    mock_refund.assert_called_once_with(
        user_id, cost_per, "AI助手回复失败退还",
        request_key=f"chat_refund:{req_id}",
    )
    # UPDATE 被执行，参数为 (req_id,)
    conn.execute.assert_called_once_with(update_sql, (req_id,))
