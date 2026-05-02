export default function Pagination({ page, totalPages, onPageChange }) {
  if (totalPages <= 1) return null

  return (
    <div className="flex items-center justify-center gap-2 mt-4">
      <button onClick={() => onPageChange(page - 1)} disabled={page === 1}
        className="px-3 py-1 rounded-lg text-xs font-medium disabled:opacity-40"
        style={{ color: 'var(--text-secondary)', background: 'var(--bg-secondary)' }}>上一页</button>
      <span className="text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>{page}/{totalPages}</span>
      <button onClick={() => onPageChange(page + 1)} disabled={page === totalPages}
        className="px-3 py-1 rounded-lg text-xs font-medium disabled:opacity-40"
        style={{ color: 'var(--text-secondary)', background: 'var(--bg-secondary)' }}>下一页</button>
    </div>
  )
}
