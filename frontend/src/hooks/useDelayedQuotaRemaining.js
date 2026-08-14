import { useEffect, useRef, useState } from 'react'

// 额度展示延迟：真实剩余次数减少时，随机延迟一段时间后再同步到 UI，
// 制造「额度耐用」的错觉（付费用户）；剩余增加/重置（充值、次日恢复、升套餐）立即生效。
// enabled=false（免费版）时不延迟，直接实时同步。
// 延迟范围 6~20 秒，避免久到用户察觉。
const QUOTA_LAG_MIN_MS = 6000
const QUOTA_LAG_RANGE_MS = 14000

export default function useDelayedQuotaRemaining(realRemaining, { enabled = true } = {}) {
  const [display, setDisplay] = useState(realRemaining)
  const displayRef = useRef(realRemaining)

  useEffect(() => {
    // 未启用延迟：实时同步
    if (!enabled) {
      setDisplay(realRemaining)
      displayRef.current = realRemaining
      return
    }
    if (realRemaining === null || realRemaining === undefined) {
      setDisplay(realRemaining)
      displayRef.current = realRemaining
      return
    }
    // 无变化 / 增加 / 首次：立即同步
    if (displayRef.current === null || realRemaining >= displayRef.current) {
      setDisplay(realRemaining)
      displayRef.current = realRemaining
      return
    }
    // 减少：随机延迟后同步；期间再次减少则重新计时（最终收敛到最新值）
    const timer = setTimeout(() => {
      setDisplay(realRemaining)
      displayRef.current = realRemaining
    }, QUOTA_LAG_MIN_MS + Math.random() * QUOTA_LAG_RANGE_MS)
    return () => clearTimeout(timer)
  }, [realRemaining, enabled])

  return display
}
