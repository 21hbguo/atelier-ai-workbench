import { useState, useEffect } from 'react'
import { Trash2, Users, Image, Shield } from 'lucide-react'
import { adminAPI } from '../api'
import PageLayout from '../components/PageLayout'

export default function AdminPage() {
  const [tab, setTab] = useState('users')
  const [users, setUsers] = useState([])
  const [images, setImages] = useState([])
  const [userPage, setUserPage] = useState(1)
  const [imagePage, setImagePage] = useState(1)
  const [userTotal, setUserTotal] = useState(0)
  const [imageTotal, setImageTotal] = useState(0)
  const [loading, setLoading] = useState(false)

  useEffect(() => { fetchUsers() }, [userPage])
  useEffect(() => { fetchImages() }, [imagePage])

  const fetchUsers = async () => {
    setLoading(true)
    try {
      const { data } = await adminAPI.users(userPage, 20)
      setUsers(data.users)
      setUserTotal(data.total)
    } catch {} finally { setLoading(false) }
  }

  const fetchImages = async () => {
    setLoading(true)
    try {
      const { data } = await adminAPI.square(imagePage, 20)
      setImages(data.images)
      setImageTotal(data.total)
    } catch {} finally { setLoading(false) }
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
    <PageLayout className="p-4 sm:p-6">
      <div>
        <div className="flex items-center gap-2 mb-4">
          <button onClick={() => history.back()} className="p-2 rounded-lg hover:bg-black/5" style={{ color: 'var(--text-primary)' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>管理后台</h1>
        </div>

        <div className="flex gap-1 p-0.5 rounded-lg mb-4" style={{ background: 'var(--border-color)' }}>
          {[{ k: 'users', l: '用户管理', i: Users }, { k: 'images', l: '广场管理', i: Image }].map(({ k, l, i: Icon }) => (
            <button key={k} onClick={() => setTab(k)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${tab === k ? 'bg-white dark:bg-gray-800 shadow-sm' : ''}`}
              style={{ color: tab === k ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
              <Icon size={14} />{l}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-2 rounded-full animate-spin-slow" style={{ borderTopColor: 'var(--accent)', borderColor: 'var(--border-color)' }} />
          </div>
        ) : tab === 'users' ? (
          <div>
            <div className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>共 {userTotal} 个用户</div>
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: 'var(--bg-ai-bubble)' }}>
                    <th className="text-left px-4 py-3 font-medium" style={{ color: 'var(--text-secondary)' }}>ID</th>
                    <th className="text-left px-4 py-3 font-medium" style={{ color: 'var(--text-secondary)' }}>用户名</th>
                    <th className="text-left px-4 py-3 font-medium" style={{ color: 'var(--text-secondary)' }}>昵称</th>
                    <th className="text-left px-4 py-3 font-medium" style={{ color: 'var(--text-secondary)' }}>角色</th>
                    <th className="text-left px-4 py-3 font-medium" style={{ color: 'var(--text-secondary)' }}>注册时间</th>
                    <th className="text-right px-4 py-3 font-medium" style={{ color: 'var(--text-secondary)' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id} className="border-t" style={{ borderColor: 'var(--border-color)' }}>
                      <td className="px-4 py-3" style={{ color: 'var(--text-primary)' }}>{u.id}</td>
                      <td className="px-4 py-3" style={{ color: 'var(--text-primary)' }}>{u.username}</td>
                      <td className="px-4 py-3" style={{ color: 'var(--text-primary)' }}>{u.nickname}</td>
                      <td className="px-4 py-3">
                        {u.is_admin ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">管理员</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: 'var(--border-color)', color: 'var(--text-secondary)' }}>普通用户</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>{u.created_at}</td>
                      <td className="px-4 py-3 text-right">
                        {!u.is_admin && (
                          <button onClick={() => handleDeleteUser(u.id, u.username)} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {userTotal > 20 && (
              <div className="flex justify-center gap-2 mt-4">
                {Array.from({ length: Math.ceil(userTotal / 20) }, (_, i) => i + 1).map(p => (
                  <button key={p} onClick={() => setUserPage(p)} className={`w-8 h-8 rounded-lg text-sm font-medium ${p === userPage ? 'bg-accent text-white' : 'hover:bg-black/5'}`}
                    style={{ color: p !== userPage ? 'var(--text-primary)' : undefined }}>{p}</button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div>
            <div className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>共 {imageTotal} 张图片</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {images.map(img => (
                <div key={img.id} className="group relative rounded-xl overflow-hidden shadow-sm">
                  <img src={`/api/images/thumb/${img.filename}`} alt="" className="w-full aspect-square object-cover" loading="lazy" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors" />
                  <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                    <p className="text-white text-xs truncate">{img.prompt || '无提示词'}</p>
                    <p className="text-white/70 text-xs mt-0.5">{img.nickname || img.username}</p>
                  </div>
                  <button onClick={() => handleDeleteImage(img.id)}
                    className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500">
                    <Trash2 size={14} />
                  </button>
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
          </div>
        )}
      </div>
    </PageLayout>
  )
}
