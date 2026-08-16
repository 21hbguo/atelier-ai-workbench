// 修复：移除「额度延迟同步」的欺骗性设计（真实扣减后随机延迟 6~20 秒再同步 UI）。
// 现在直接返回真实剩余值，UI 与后端扣减实时一致。
// enabled 参数保留仅为维持调用方兼容（Sidebar/AccountPage/ChatAssistantPage），不再影响行为。
export default function useDelayedQuotaRemaining(realRemaining, _options = {}) {
  return realRemaining
}
