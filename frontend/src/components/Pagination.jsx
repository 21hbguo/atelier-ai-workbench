import { useEffect, useState } from 'react'
export default function Pagination({ page, totalPages, onPageChange, scrollTargetId, scrollBeforeChange = true }) {
  const [draft, setDraft] = useState(String(page))
  useEffect(() => { setDraft(String(page)) }, [page])
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
  const submitDraft = (e) => {
    const raw = Number(String(draft || '').trim())
    if (!Number.isFinite(raw)) { setDraft(String(page)); return }
    const next = Math.min(totalPages, Math.max(1, Math.trunc(raw)))
    go(next, e)
    setDraft(String(next))
  }

  return (
    <div className="mt-4 flex items-center justify-center gap-2">
      <button onClick={e => go(page - 1, e)} disabled={page === 1}
        className="h-8 rounded-xl px-3 text-xs font-medium disabled:opacity-40"
        style={{ color: 'var(--text-secondary)', background: 'var(--bg-card)' }}>上一页</button>
      <div className="flex h-8 items-center rounded-xl px-2" style={{ background: 'var(--bg-card)' }}>
        <input value={draft} onChange={e => setDraft(e.target.value.replace(/[^\d]/g, ''))} onBlur={submitDraft} onKeyDown={e => { if (e.key === 'Enter') submitDraft(e) }} className="w-10 bg-transparent text-center text-xs outline-none tabular-nums" style={{ color: 'var(--text-primary)' }} />
        <span className="px-1 text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>/ {totalPages}</span>
      </div>
      <button onClick={e => go(page + 1, e)} disabled={page === totalPages}
        className="h-8 rounded-xl px-3 text-xs font-medium disabled:opacity-40"
        style={{ color: 'var(--text-secondary)', background: 'var(--bg-card)' }}>下一页</button>
    </div>
  )
}
