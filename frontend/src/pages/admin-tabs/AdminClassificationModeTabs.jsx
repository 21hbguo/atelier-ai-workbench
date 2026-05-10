export default function AdminClassificationModeTabs({ mode, modeTabs, onSwitch }) {
  return (
    <div className="flex items-center gap-2">
      {modeTabs.map(i => (
        <button key={i.k} onClick={() => onSwitch(i.k)} className="px-3 py-1.5 rounded-2xl text-xs font-medium border" style={mode === i.k ? { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' } : { borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
          {i.l}
        </button>
      ))}
    </div>
  )
}
