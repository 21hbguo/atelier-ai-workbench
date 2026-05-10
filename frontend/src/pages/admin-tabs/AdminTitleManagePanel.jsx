import { useState, useEffect, useCallback } from 'react'
import { adminAPI } from '../../api'
const getItemName=item=>String(item.name||item.title||item.raw_name||item.current_title||item.filename||'').trim()
const getItemPrompt=item=>String(item.prompt||item.item_prompt||item.content||item.text||'').trim()
const getItemAuthor=item=>String(item.author||item.author_name||item.username||item.nickname||'').trim()
const getItemCategory=item=>String(item.category||item.category_label||item.item_category||'').trim()
export default function AdminTitleManagePanel() {
  const [itemType,setItemType]=useState('prompt')
  const [query,setQuery]=useState('')
  const [onlyMissing,setOnlyMissing]=useState(true)
  const [page,setPage]=useState(1)
  const [loading,setLoading]=useState(false)
  const [applying,setApplying]=useState(false)
  const [items,setItems]=useState([])
  const [total,setTotal]=useState(0)
  const [checked,setChecked]=useState(new Set())
  const [previewLoading,setPreviewLoading]=useState('')
  const load=useCallback(async()=>{setLoading(true);try{const { data }=await adminAPI.titleItems(itemType,query,page,20,onlyMissing);setItems(data?.items||[]);setTotal(data?.total||0)}catch{}setLoading(false)},[itemType,query,page,onlyMissing])
  useEffect(()=>{load()},[load])
  useEffect(()=>{setPage(1);setChecked(new Set())},[itemType,onlyMissing,query])
  const toggle=id=>setChecked(prev=>{const next=new Set(prev);next.has(id)?next.delete(id):next.add(id);return next})
  const toggleAll=()=>{if(checked.size===items.length)setChecked(new Set());else setChecked(new Set(items.map(i=>i.id)))}
  const generateOne=async item=>{setPreviewLoading(item.id);try{const { data }=await adminAPI.testTitle({ prompt:getItemPrompt(item), raw_name:getItemName(item), prefer_prompt:itemType==='prompt' });setItems(prev=>prev.map(v=>v.id===item.id?{...v,suggested_title:data?.title||''}:v))}catch(e){setItems(prev=>prev.map(v=>v.id===item.id?{...v,suggested_title:e?.message||'生成失败'}:v))}setPreviewLoading('')}
  const applySelected=async(force=false)=>{const ids=items.filter(i=>checked.has(i.id)).map(i=>i.id);if(!ids.length)return;setApplying(true);try{await adminAPI.applyTitles({ item_type:itemType, item_ids:ids, force });setChecked(new Set());await load()}catch{}setApplying(false)}
  const totalPages = Math.ceil(total / 20)
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border p-4 space-y-3" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-card)' }}>
        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>现有库标题管理</div>
        <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>这里处理现有提示词库和作品库，不是手动测试输入框。可先筛出缺标题项目，再生成并批量应用。</div>
        <div className="flex flex-wrap gap-2 items-center">
          <select value={itemType} onChange={e => setItemType(e.target.value)} className="px-3 py-2 rounded-2xl text-sm border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
            <option value="prompt">提示词库</option>
            <option value="image">作品库</option>
          </select>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索标题、提示词、作者" className="flex-1 min-w-[220px] px-3 py-2 rounded-2xl border text-sm" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
          <label className="flex items-center gap-2 px-3 py-2 rounded-2xl border text-sm" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={onlyMissing} onChange={e => setOnlyMissing(e.target.checked)} className="rounded" />
            仅看缺标题
          </label>
          <button onClick={load} disabled={loading} className="px-4 py-2 rounded-2xl text-sm text-white disabled:opacity-50" style={{ background: 'var(--accent)' }}>
            {loading ? '刷新中...' : '刷新'}
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>共 {total} 项，当前 {items.length} 项，已选 {checked.size} 项</div>
        <div className="flex items-center gap-2">
          {items.length > 0 && <button onClick={toggleAll} className="px-3 py-1.5 rounded-2xl text-xs border" style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>{checked.size === items.length ? '取消全选' : '全选'}</button>}
          <button onClick={() => applySelected(false)} disabled={applying || checked.size === 0} className="px-3 py-1.5 rounded-2xl text-xs text-white disabled:opacity-50" style={{ background: 'var(--accent)' }}>{applying ? '应用中...' : '应用标题'}</button>
          <button onClick={() => applySelected(true)} disabled={applying || checked.size === 0} className="px-3 py-1.5 rounded-2xl text-xs text-white disabled:opacity-50" style={{ background: 'var(--color-warning)' }}>强制覆盖</button>
        </div>
      </div>
      <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-card)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'var(--bg-ai-bubble)' }}>
              <th className="px-3 py-2 w-8"></th>
              <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>项目</th>
              <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>当前标题</th>
              <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>建议标题</th>
              <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-3 py-8 text-center" style={{ color: 'var(--text-secondary)' }}>加载中...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-8 text-center" style={{ color: 'var(--text-secondary)' }}>暂无可处理项目</td></tr>
            ) : items.map(item => (
              <tr key={item.id} className="border-t" style={{ borderColor: 'var(--border-color)' }}>
                <td className="px-3 py-2"><input type="checkbox" checked={checked.has(item.id)} onChange={() => toggle(item.id)} className="rounded" /></td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-3">
                    {item.thumb_url ? <img src={item.thumb_url} alt="" className="w-12 h-12 rounded-lg object-cover border shrink-0" style={{ borderColor: 'var(--border-color)' }} loading="lazy" /> : null}
                    <div className="min-w-0">
                      <div className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>{itemType === 'prompt' ? '提示词库' : '作品库'} · {getItemAuthor(item) || '-'} · {getItemCategory(item) || '未分类'}</div>
                      <div className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>{getItemName(item) || '(无标题)'}</div>
                      <div className="text-xs truncate mt-1" style={{ color: 'var(--text-secondary)' }}>{getItemPrompt(item) || '-'}</div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2" style={{ color: 'var(--text-primary)' }}>{getItemName(item) || '-'}</td>
                <td className="px-3 py-2" style={{ color: 'var(--accent)' }}>{item.suggested_title || '-'}</td>
                <td className="px-3 py-2">
                  <button onClick={() => generateOne(item)} disabled={previewLoading === item.id} className="px-3 py-1.5 rounded-2xl text-xs text-white disabled:opacity-50" style={{ background: 'var(--accent)' }}>
                    {previewLoading === item.id ? '生成中...' : '生成建议'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="px-3 py-1 rounded-lg text-xs" style={{ color: 'var(--text-secondary)' }}>上一页</button>
          <span className="text-xs px-2 py-1" style={{ color: 'var(--text-secondary)' }}>{page}/{totalPages}</span>
          <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} className="px-3 py-1 rounded-lg text-xs" style={{ color: 'var(--text-secondary)' }}>下一页</button>
        </div>
      )}
    </div>
  )
}
