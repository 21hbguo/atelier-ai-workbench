"""聊天生成任务管理器（进程内存）。

任务制聊天：POST /sessions/{sid}/messages 只创建任务并立即返回 task_id，
生成逻辑在后台 asyncio 任务中执行；前端通过 GET /tasks/{task_id}/stream
订阅流式输出，断开可重连（回放事件环存量 + 实时增量）。

设计要点：
- 事件环（events）只保留「运行中」任务的事件；任务进入终态后从内存 dict 移除，
  新订阅者改走 DB 回放（chat_messages.status/error 已是终态，见 chat.py 的 stream 端点）。
- 广播 = append 到事件环 + 写入所有订阅者队列（进程内单线程，无锁安全）。
- 并发控制：count_active(user_id) 供路由层做 429 校验（替代旧 _active_chat_requests）。
"""
import asyncio
import logging
import time
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class ChatTask:
    """一个进行中的聊天生成任务。"""
    task_id: str
    user_id: int
    session_id: int
    message_id: int          # assistant 占位消息 id（终态后按它反查 DB 回放）
    req_id: str              # 预扣/退款幂等 key 用（chat:{req_id} / chat_refund:{req_id}）
    cost_per: float
    charge_mode: str         # free/paid/unlimited
    daily_total: int | None
    model_id: str
    status: str = "streaming"  # streaming → done/failed/stopped
    cancelled: bool = False    # 停止请求标志（stop 端点同步终态 + 协程 except 幂等兜底）
    events: list = field(default_factory=list)  # [{"type": name, "data": {...}}, ...] 按序累积
    asyncio_task: asyncio.Task | None = None
    created_at: float = field(default_factory=time.time)
    _waiters: set = field(default_factory=set)  # 订阅者 asyncio.Queue 集合


class ChatTaskManager:
    """进程内聊天任务注册表（类级单例，与旧 _active_chat_requests 同生命周期）。"""

    _tasks: dict[str, ChatTask] = {}

    # ------------------------------------------------------------------
    # 创建 / 查询
    # ------------------------------------------------------------------
    @classmethod
    def create(cls, *, task_id: str, user_id: int, session_id: int, message_id: int,
               req_id: str, cost_per: float, charge_mode: str,
               daily_total: int | None, model_id: str) -> ChatTask:
        task = ChatTask(
            task_id=task_id, user_id=user_id, session_id=session_id,
            message_id=message_id, req_id=req_id, cost_per=cost_per,
            charge_mode=charge_mode, daily_total=daily_total, model_id=model_id,
        )
        cls._tasks[task_id] = task
        return task

    @classmethod
    def get(cls, task_id: str) -> ChatTask | None:
        return cls._tasks.get(task_id)

    @classmethod
    def get_by_message_id(cls, message_id: int) -> ChatTask | None:
        """按 assistant 消息 id 查运行中任务（stop/删除消息时用）。"""
        for t in cls._tasks.values():
            if t.message_id == message_id:
                return t
        return None

    @classmethod
    def count_active(cls, user_id: int) -> int:
        """该用户「运行中」任务数（含刚创建未开始执行的）。"""
        return sum(1 for t in cls._tasks.values() if t.user_id == user_id)

    # ------------------------------------------------------------------
    # 事件：广播 / 订阅
    # ------------------------------------------------------------------
    @classmethod
    def broadcast(cls, task_id: str, event_type: str, data: dict | None = None) -> bool:
        """追加事件到事件环并通知所有订阅者。任务已移除（终态）时返回 False。"""
        task = cls._tasks.get(task_id)
        if task is None:
            return False
        item = {"type": event_type, "data": data or {}}
        task.events.append(item)
        for q in list(task._waiters):
            try:
                q.put_nowait(item)
            except Exception:  # noqa: BLE001 - 队列异常不影响任务主体
                logger.warning("[chat_task] broadcast queue put failed: %s", task_id)
        return True

    @classmethod
    def subscribe(cls, task_id: str) -> tuple[list, asyncio.Queue] | None:
        """订阅运行中任务：返回 (事件环存量快照, 实时队列)；任务不在内存返回 None。

        快照与队列之间无竞态：广播是同步操作，subscribe 也是同步操作，
        event loop 单线程内两者不会交错；快照之后的增量事件必然进入队列。
        """
        task = cls._tasks.get(task_id)
        if task is None:
            return None
        queue: asyncio.Queue = asyncio.Queue()
        task._waiters.add(queue)
        return list(task.events), queue

    @classmethod
    def unsubscribe(cls, task_id: str, queue: asyncio.Queue) -> None:
        task = cls._tasks.get(task_id)
        if task is not None:
            task._waiters.discard(queue)

    # ------------------------------------------------------------------
    # 终态 / 取消
    # ------------------------------------------------------------------
    @classmethod
    def finish(cls, task_id: str) -> None:
        """任务进入终态：从内存移除（幂等）。调用前须先广播终态事件并设置 task.status。"""
        task = cls._tasks.pop(task_id, None)
        if task is not None:
            logger.info(
                "[chat_task] finished task=%s user=%s session=%s msg=%s status=%s events=%s",
                task_id, task.user_id, task.session_id, task.message_id,
                task.status, len(task.events),
            )

    @classmethod
    def cancel(cls, task_id: str) -> bool:
        """取消后台 asyncio 任务（触发 CancelledError 分支：退款 + 标 stopped + 广播）。"""
        task = cls._tasks.get(task_id)
        if task is None or task.asyncio_task is None or task.asyncio_task.done():
            return False
        task.cancelled = True
        task.asyncio_task.cancel()
        return True

    @classmethod
    def cancel_by_message_id(cls, message_id: int) -> bool:
        """按消息 id 取消：置 cancelled 标志 + 取消 asyncio 任务（若已启动）。

        注意：任务可能尚未被事件循环调度（create_task 后立即 stop），此时
        cancel() 会让协程函数体完全不执行，终态清理由 stop 端点同步完成。
        """
        task = cls.get_by_message_id(message_id)
        if task is None:
            return False
        task.cancelled = True
        if task.asyncio_task is not None and not task.asyncio_task.done():
            task.asyncio_task.cancel()
        return True

    @classmethod
    async def cancel_all(cls) -> None:
        """服务关闭：取消全部运行中任务并等待清理（退款/标 stopped 由任务自身完成）。"""
        tasks = [t for t in cls._tasks.values() if t.asyncio_task is not None and not t.asyncio_task.done()]
        if not tasks:
            return
        for t in tasks:
            t.asyncio_task.cancel()
        try:
            await asyncio.wait_for(
                asyncio.gather(*(t.asyncio_task for t in tasks), return_exceptions=True),
                timeout=10,
            )
        except asyncio.TimeoutError:
            logger.warning("[chat_task] cancel_all timeout, %s tasks still running", len(tasks))
        logger.info("[chat_task] cancelled %s chat tasks on shutdown", len(tasks))


CHAT_TASK_MANAGER = ChatTaskManager()
"""模块级单例：路由层直接引用（测试可 monkeypatch）。"""
