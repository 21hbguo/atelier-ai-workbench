import { useState } from 'react'
export default function AdminAuditSuggestion({ result, canEdit, onChange }) {
  const [draft, setDraft] = useState({
    risk_level: result.risk_level || 'medium',
    confidence: result.confidence || 'medium',
    suggested_action: result.suggested_action || 'review',
    reason_summary: result.reason_summary || '',
    reason_detail: result.reason_detail || '',
    hit_rules: Array.isArray(result.hit_rules) ? result.hit_rules.join('、') : (result.hit_rules || ''),
  })
  if (!canEdit) {
    const riskColor = result.risk_level === 'high' ? 'var(--color-error)' : result.risk_level === 'medium' ? 'var(--color-warning)' : 'var(--color-success)'
    const riskLabel = result.risk_level === 'high' ? '高风险' : result.risk_level === 'medium' ? '中风险' : '低风险'
    const actionLabel = result.suggested_action === 'freeze' ? '建议冻结' : result.suggested_action === 'delete' ? '建议删除' : result.suggested_action === 'keep' ? '建议保留' : '建议复核'
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-1 flex-wrap">
          <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: riskColor + '20', color: riskColor }}>{riskLabel}</span>
          <span className="px-2 py-0.5 rounded-full text-xs" style={{ background: 'var(--bg-ai-bubble)', color: 'var(--text-secondary)' }}>{actionLabel}</span>
        </div>
        <div className="text-xs" style={{ color: 'var(--text-primary)' }}>{result.reason_summary || '-'}</div>
        <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{result.reason_detail || '-'}</div>
        <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{Array.isArray(result.hit_rules) && result.hit_rules.length ? `命中：${result.hit_rules.join('、')}` : '未命中规则'}</div>
      </div>
    )
  }
  return (
    <div className="space-y-1 min-w-[260px]">
      <div className="flex gap-1 flex-wrap">
        <select value={draft.risk_level} onChange={e => setDraft(prev => ({ ...prev, risk_level: e.target.value }))} className="px-1.5 py-0.5 rounded-lg text-xs border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}>
          <option value="high">高风险</option>
          <option value="medium">中风险</option>
          <option value="low">低风险</option>
        </select>
        <select value={draft.suggested_action} onChange={e => setDraft(prev => ({ ...prev, suggested_action: e.target.value }))} className="px-1.5 py-0.5 rounded-lg text-xs border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}>
          <option value="freeze">冻结</option>
          <option value="delete">删除</option>
          <option value="review">复核</option>
          <option value="keep">保留</option>
        </select>
      </div>
      <input value={draft.reason_summary} onChange={e => setDraft(prev => ({ ...prev, reason_summary: e.target.value }))} placeholder="摘要" className="w-full px-1.5 py-0.5 rounded-lg text-xs border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)' }} />
      <input value={draft.reason_detail} onChange={e => setDraft(prev => ({ ...prev, reason_detail: e.target.value }))} placeholder="原因" className="w-full px-1.5 py-0.5 rounded-lg text-xs border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)' }} />
      <input value={draft.hit_rules} onChange={e => setDraft(prev => ({ ...prev, hit_rules: e.target.value }))} placeholder="命中词，用、分隔" className="w-full px-1.5 py-0.5 rounded-lg text-xs border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)' }} />
      <button onClick={() => onChange({ ...draft, hit_rules: String(draft.hit_rules || '').split(/[、,，]/).map(s => s.trim()).filter(Boolean) })} className="px-2 py-0.5 rounded-lg text-xs text-white" style={{ background: 'var(--accent)' }}>保存</button>
    </div>
  )
}
