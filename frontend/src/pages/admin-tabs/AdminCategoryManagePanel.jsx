export default function AdminCategoryManagePanel({ categories, categoryDraft, setCategoryDraft, savingCategory, handleSaveCategory, handleDeleteCategory }) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border p-4 space-y-3" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-card)' }}>
        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{categoryDraft.id ? '编辑分类' : '新建分类'}</div>
        <div className="grid grid-cols-1 sm:grid-cols-[12rem_minmax(0,1fr)_auto] gap-2">
          <input value={categoryDraft.slug} onChange={e => setCategoryDraft(prev => ({ ...prev, slug: e.target.value }))} disabled={!!categoryDraft.id} placeholder="slug" className="px-3 py-2 rounded-2xl border text-sm" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
          <input value={categoryDraft.label} onChange={e => setCategoryDraft(prev => ({ ...prev, label: e.target.value }))} placeholder="分类名称" className="px-3 py-2 rounded-2xl border text-sm" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
          <button onClick={handleSaveCategory} disabled={savingCategory || !categoryDraft.slug || !categoryDraft.label} className="px-4 py-2 rounded-2xl text-sm text-white disabled:opacity-50" style={{ background: 'var(--accent)' }}>{savingCategory ? '保存中...' : categoryDraft.id ? '保存' : '新增'}</button>
        </div>
        {categoryDraft.id && <button onClick={() => setCategoryDraft({ id: null, slug: '', label: '' })} className="text-xs" style={{ color: 'var(--text-secondary)' }}>取消编辑</button>}
      </div>
      <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-card)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'var(--bg-ai-bubble)' }}>
              <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>ID</th>
              <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>Slug</th>
              <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>名称</th>
              <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {categories.length === 0 ? (
              <tr><td colSpan={4} className="px-3 py-8 text-center" style={{ color: 'var(--text-secondary)' }}>暂无分类</td></tr>
            ) : categories.map(c => (
              <tr key={c.id || c.slug} className="border-t" style={{ borderColor: 'var(--border-color)' }}>
                <td className="px-3 py-2" style={{ color: 'var(--text-primary)' }}>{c.id || '-'}</td>
                <td className="px-3 py-2" style={{ color: 'var(--text-primary)' }}>{c.slug}</td>
                <td className="px-3 py-2" style={{ color: 'var(--text-primary)' }}>{c.label}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <button onClick={() => setCategoryDraft({ id: c.id, slug: c.slug, label: c.label })} className="text-xs font-medium hover:underline" style={{ color: 'var(--accent)' }}>编辑</button>
                    <button onClick={() => handleDeleteCategory(c.id)} className="text-xs font-medium hover:underline" style={{ color: 'var(--color-error)' }}>删除</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
