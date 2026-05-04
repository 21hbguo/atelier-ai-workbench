export default function Pagination({ page, totalPages, onPageChange, scrollTargetId, scrollBeforeChange = true }) {
  if (totalPages <= 1) return null
  const scrollParentToTop = el => {
    if (scrollTargetId) {
      const t = document.getElementById(scrollTargetId)
      if (t) { t.scrollTop = 0; return }
    }
    let p = el?.parentElement
    while (p) {
      const st = window.getComputedStyle(p)
      const oy = st.overflowY
      const scrollable = (oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight
      if (scrollable) { p.scrollTop = 0; return }
      p = p.parentElement
    }
    window.scrollTo(0, 0)
  }
  const go = (next, e) => {
    if (next < 1 || next > totalPages || next === page) return
    if (scrollBeforeChange) scrollParentToTop(e?.currentTarget)
    onPageChange(next)
  }

  return (
    <div className="flex items-center justify-center gap-2 mt-4">
      <button onClick={e => go(page - 1, e)} disabled={page === 1}
        className="px-3 py-1 rounded-lg text-xs font-medium disabled:opacity-40"
        style={{ color: 'var(--text-secondary)', background: 'var(--bg-card)' }}>上一页</button>
      <span className="text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>{page}/{totalPages}</span>
      <button onClick={e => go(page + 1, e)} disabled={page === totalPages}
        className="px-3 py-1 rounded-lg text-xs font-medium disabled:opacity-40"
        style={{ color: 'var(--text-secondary)', background: 'var(--bg-card)' }}>下一页</button>
    </div>
  )
}
