import { useState, useEffect, useCallback } from 'react'
import { Trash2, Users, Image, Shield, Snowflake, Sun, Clock, Check } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { adminAPI } from '../api'
import MainLayout from '../components/MainLayout'
import SearchInput from '../components/SearchInput'

export default function AdminPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState('users')
  const [users, setUsers] = useState([])
  const [images, setImages] = useState([])
  const [history, setHistory] = useState([])
  const [userPage, setUserPage] = useState(1)
  const [imagePage, setImagePage] = useState(1)
  const [historyPage, setHistoryPage] = useState(1)
  const [userTotal, setUserTotal] = useState(0)
  const [imageTotal, setImageTotal] = useState(0)
  const [historyTotal, setHistoryTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [checked, setChecked] = useState(new Set())
  const [userQuery, setUserQuery] = useState('')
  const [imageQuery, setImageQuery] = useState('')
  const [historyQuery, setHistoryQuery] = useState('')

  useEffect(() => { setUserPage(1) }, [userQuery])
  useEffect(() => { setImagePage(1) }, [imageQuery])
  useEffect(() => { setHistoryPage(1) }, [historyQuery])
  useEffect(() => { fetchUsers() }, [userPage, userQuery])
  useEffect(() => { fetchImages() }, [imagePage, imageQuery])
  useEffect(() => { fetchHistory() }, [historyPage, historyQuery])

  const fetchUsers = async () => {
    setLoading(true)
    try {
      const { data } = await adminAPI.users(userPage, 20, userQuery || undefined)
      setUsers(data.users)
      setUserTotal(data.total)
    } catch {} finally { setLoading(false) }
  }

  const fetchImages = async () => {
    setLoading(true)
    try {
      const { data } = await adminAPI.square(imagePage, 20, imageQuery || undefined)
      setImages(data.images)
      setImageTotal(data.total)
    } catch {} finally { setLoading(false) }
  }

  const fetchHistory = async () => {
    setLoading(true)
    try {
      const { data } = await adminAPI.history(historyPage, 20, historyQuery || undefined)
      setHistory(data.items)
      setHistoryTotal(data.total)
    } catch {} finally { setLoading(false) }
  }

  const handleDeleteHistory = async (taskId) => {
    if (!confirm('确定删除此任务？')) return
    try {
      await adminAPI.deleteHistory(taskId)
      fetchHistory()
    } catch {}
  }

  const handleToggleFreeze = async (userId, username) => {
    try {
      const { data } = await adminAPI.toggleFreeze(userId)
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, is_frozen: data.is_frozen } : u))
    } catch {}
  }

  const handleDeleteUser = async (userId, username) => {
    if (!confirm(`确定删除用户 "${username}"？该用户的所有广场图片也会被删除。`)) return
    try {
      await adminAPI.deleteUser(userId)
      fetchUsers()
    } catch {}
  }

  const handleDeleteImage = async (imageId) => {
    if (!confirm('确定删除这张图片？')) return
    try {
      await adminAPI.deleteSquare(imageId)
      fetchImages()
    } catch {}
  }

  const toggleCheck = useCallback((imageId) => {
    setChecked(prev => { const next = new Set(prev); next.has(imageId) ? next.delete(imageId) : next.add(imageId); return next })
  }, [])

  const toggleSelectAll = useCallback(() => {
    if (checked.size === images.length) setChecked(new Set())
    else setChecked(new Set(images.map(i => i.id)))
  }, [checked.size, images])

  const handleBatchDelete = useCallback(async () => {
    if (!confirm(`确定删除选中的 ${checked.size} 张图片？`)) return
    for (const imageId of checked) {
      try { await adminAPI.deleteSquare(imageId) } catch {}
    }
    setChecked(new Set()); setSelectMode(false)
    fetchImages()
  }, [checked])

  const user = JSON.parse(localStorage.getItem('user') || 'null')
  if (!user?.is_admin) {
    return (
      <PageLayout className="p-4 sm:p-6">
        <div className="text-center py-20" style={{ color: 'var(--text-secondary)' }}>
          <Shield size={48} className="mx-auto mb-4 opacity-50" />
          <p>需要管理员权限</p>
        </div>
      </PageLayout>
    )
  }

  return (
    <MainLayout>
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="flex items-center gap-2 mb-4">
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>管理后台</h1>
        </div>

        <div className="flex gap-1 p-0.5 rounded-lg mb-4" style={{ background: 'var(--border-color)' }}>
          {[{ k: 'users', l: '用户管理', i: Users }, { k: 'images', l: '广场管理', i: Image }, { k: 'history', l: '生成历史', i: Clock }].map(({ k, l, i: Icon }) => (
            <button key={k} onClick={() => setTab(k)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${tab === k ? 'bg-white dark:bg-gray-800 shadow-sm' : ''}`}
              style={{ color: tab === k ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
              <Icon size={14} />{l}
            </button>
          ))}
        </div>

        {tab === 'users' ? (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>共 {userTotal} 个用户</span>
              <SearchInput value={userQuery} onChange={setUserQuery} placeholder="搜索用户名/昵称..." />
            </div>
            {loading ? (
              <div className="flex justify-center py-20">
                <div className="w-8 h-8 border-2 rounded-full animate-spin-slow" style={{ borderTopColor: 'var(--accent)', borderColor: 'var(--border-color)' }} />
              </div>
            ) : (
            <>
            <div className="space-y-2">
              {users.map(u => (
                <div key={u.id} className="flex items-center gap-4 px-4 py-3 rounded-xl border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)' }}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>{u.nickname || u.username}</span>
                      {u.is_admin ? (
                        <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">管理员</span>
                      ) : null}
                      {u.is_frozen ? (
                        <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">已冻结</span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      <span>ID: {u.id}</span>
                      <span>用户名: {u.username}</span>
                      <span>IP: {u.last_ip || '未知'}</span>
                      <span>注册: {u.created_at}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-6 text-center">
                    <div>
                      <div className="text-lg font-semibold text-green-500">{u.success_count}</div>
                      <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>成功</div>
                    </div>
                    <div>
                      <div className="text-lg font-semibold text-red-500">{u.failed_count}</div>
                      <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>失败</div>
                    </div>
                    <div>
                      <div className="text-lg font-semibold text-amber-500">{u.processing_count}</div>
                      <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>进行中</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    {!u.is_admin && (
                      <>
                        <button
                          onClick={() => handleToggleFreeze(u.id, u.username)}
                          className="p-2 rounded-lg hover:bg-black/5"
                          style={{ color: u.is_frozen ? '#3b82f6' : 'var(--text-secondary)' }}
                          title={u.is_frozen ? '启用' : '冻结'}
                        >
                          {u.is_frozen ? <Sun size={16} /> : <Snowflake size={16} />}
                        </button>
                        <button
                          onClick={() => handleDeleteUser(u.id, u.username)}
                          className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500"
                          title="删除"
                        >
                          <Trash2 size={16} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {userTotal > 20 && (
              <div className="flex justify-center gap-2 mt-4">
                {Array.from({ length: Math.ceil(userTotal / 20) }, (_, i) => i + 1).map(p => (
                  <button key={p} onClick={() => setUserPage(p)} className={`w-8 h-8 rounded-lg text-sm font-medium ${p === userPage ? 'bg-accent text-white' : 'hover:bg-black/5'}`}
                    style={{ color: p !== userPage ? 'var(--text-primary)' : undefined }}>{p}</button>
                ))}
              </div>
            )}
            </>
            )}
          </div>
        ) : tab === 'images' ? (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3 flex-1">
                <span className="text-sm flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>共 {imageTotal} 张图片</span>
                <SearchInput value={imageQuery} onChange={setImageQuery} placeholder="搜索提示词/用户名..." />
              </div>
              <div className="flex items-center gap-2">
                {selectMode && (
                  <button onClick={toggleSelectAll}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>
                    {checked.size === images.length ? '取消全选' : '全选'}
                  </button>
                )}
                {selectMode && checked.size > 0 && (
                  <button onClick={handleBatchDelete}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500 text-white hover:bg-red-600">
                    <Trash2 size={14} /> 删除 {checked.size} 项
                  </button>
                )}
                {selectMode ? (
                  <button onClick={() => { setSelectMode(false); setChecked(new Set()) }}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>取消</button>
                ) : (
                  <button onClick={() => setSelectMode(true)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>选择</button>
                )}
              </div>
            </div>
            {loading ? (
              <div className="flex justify-center py-20">
                <div className="w-8 h-8 border-2 rounded-full animate-spin-slow" style={{ borderTopColor: 'var(--accent)', borderColor: 'var(--border-color)' }} />
              </div>
            ) : (
            <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {images.map(img => (
                <div key={img.id}
                  className={`group relative rounded-xl overflow-hidden shadow-sm cursor-pointer ${checked.has(img.id) ? 'ring-2 ring-accent/50' : ''}`}
                  onClick={() => selectMode && toggleCheck(img.id)}>
                  {selectMode && (
                    <div className={`absolute top-2 left-2 z-20 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${checked.has(img.id) ? 'bg-accent border-accent' : 'bg-white/80 border-gray-300'}`}>
                      {checked.has(img.id) && <Check size={12} className="text-white" />}
                    </div>
                  )}
                  {selectMode && checked.has(img.id) && <div className="absolute inset-0 bg-accent/10 pointer-events-none z-10" />}
                  <img src={`/api/images/thumb/${img.filename}`} alt="" className="w-full aspect-square object-cover" loading="lazy" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors" />
                  <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                    <p className="text-white text-xs truncate">{img.prompt || '无提示词'}</p>
                    <p className="text-white/70 text-xs mt-0.5">{img.nickname || img.username}</p>
                  </div>
                  {!selectMode && (
                    <button onClick={(e) => { e.stopPropagation(); handleDeleteImage(img.id) }}
                      className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {imageTotal > 20 && (
              <div className="flex justify-center gap-2 mt-4">
                {Array.from({ length: Math.ceil(imageTotal / 20) }, (_, i) => i + 1).map(p => (
                  <button key={p} onClick={() => setImagePage(p)} className={`w-8 h-8 rounded-lg text-sm font-medium ${p === imagePage ? 'bg-accent text-white' : 'hover:bg-black/5'}`}
                    style={{ color: p !== imagePage ? 'var(--text-primary)' : undefined }}>{p}</button>
                ))}
              </div>
            )}
            </>
            )}
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>共 {historyTotal} 条记录</span>
              <SearchInput value={historyQuery} onChange={setHistoryQuery} placeholder="搜索提示词/用户名..." />
            </div>
            {loading ? (
              <div className="flex justify-center py-20">
                <div className="w-8 h-8 border-2 rounded-full animate-spin-slow" style={{ borderTopColor: 'var(--accent)', borderColor: 'var(--border-color)' }} />
              </div>
            ) : (
            <>
            <div className="space-y-2">
              {history.map(item => {
                const st = { pending: { c: '#6b7280', l: '等待中' }, queued: { c: '#f59e0b', l: '排队中' }, processing: { c: '#f59e0b', l: '生成中' }, completed: { c: '#22c55e', l: '已完成' }, failed: { c: '#ef4444', l: '失败' } }
                const s = st[item.status] || st.pending
                const thumbFile = item.result_urls?.[0]?.split('/').pop()
                return (
                  <div key={item.task_id} className="flex items-center gap-3 px-4 py-3 rounded-xl border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)' }}>
                    <div className="w-14 h-14 rounded-lg overflow-hidden flex-shrink-0" style={{ background: 'var(--border-color)' }}>
                      {thumbFile ? (
                        <img src={`/api/images/thumb/${thumbFile}`} alt="" className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs" style={{ color: 'var(--text-secondary)' }}>无图</div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{item.prompt || '无提示词'}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                        <span>{item.nickname || item.username || '未知用户'}</span>
                        <span>IP: {item.last_ip || '未知'}</span>
                        <span>{item.created_at}</span>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0" style={{ color: s.c, background: s.c + '20' }}>{s.l}</span>
                    <button onClick={() => handleDeleteHistory(item.task_id)} className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 flex-shrink-0" title="删除">
                      <Trash2 size={14} />
                    </button>
                  </div>
                )
              })}
              {history.length === 0 && (
                <div className="text-center py-20" style={{ color: 'var(--text-secondary)' }}>暂无记录</div>
              )}
            </div>
            {historyTotal > 20 && (
              <div className="flex justify-center gap-2 mt-4">
                {Array.from({ length: Math.ceil(historyTotal / 20) }, (_, i) => i + 1).map(p => (
                  <button key={p} onClick={() => setHistoryPage(p)} className={`w-8 h-8 rounded-lg text-sm font-medium ${p === historyPage ? 'bg-accent text-white' : 'hover:bg-black/5'}`}
                    style={{ color: p !== historyPage ? 'var(--text-primary)' : undefined }}>{p}</button>
                ))}
              </div>
            )}
            </>
            )}
          </div>
        )}
      </div>
    </MainLayout>
  )
}
