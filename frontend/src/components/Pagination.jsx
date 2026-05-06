import { useEffect, useState } from 'react'
export default function Pagination({ page, totalPages, onPageChange, scrollTargetId, scrollBeforeChange = true }) {
  const [draft, setDraft] = useState(String(page))
  if (totalPages <= 1) return null
  useEffect(() => { setDraft(String(page)) }, [page])
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
    <div className="flex items-center justify-center gap-2 mt-4 flex-wrap">
      <button onClick={e => go(page - 1, e)} disabled={page === 1}
        className="px-3 py-1 rounded-lg text-xs font-medium disabled:opacity-40"
        style={{ color: 'var(--text-secondary)', background: 'var(--bg-card)' }}>上一页</button>
      <span className="text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>{page}/{totalPages}</span>
      <div className="flex items-center gap-1 rounded-lg px-2 py-1" style={{ background: 'var(--bg-card)' }}>
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>跳至</span>
        <input value={draft} onChange={e => setDraft(e.target.value.replace(/[^\d]/g, ''))} onKeyDown={e => { if (e.key === 'Enter') submitDraft(e) }} className="w-12 bg-transparent text-center text-xs outline-none tabular-nums" style={{ color: 'var(--text-primary)' }} />
        <button onClick={submitDraft} className="px-2 py-0.5 rounded-md text-xs font-medium" style={{ color: 'var(--text-primary)', background: 'var(--bg-primary)' }}>确定</button>
      </div>
      <button onClick={e => go(page + 1, e)} disabled={page === totalPages}
        className="px-3 py-1 rounded-lg text-xs font-medium disabled:opacity-40"
        style={{ color: 'var(--text-secondary)', background: 'var(--bg-card)' }}>下一页</button>
    </div>
  )
}
