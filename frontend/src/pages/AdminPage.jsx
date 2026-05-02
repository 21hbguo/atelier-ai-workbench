import { useState, useEffect, useCallback } from 'react'
import { Trash2, Users, Image, Shield, Snowflake, Sun, Clock, Check, UserCheck, UserX, HardDrive, Download, X, Ban, Ticket, BarChart3, Megaphone, BookOpen, Wallet, Key } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { adminAPI, statsAPI, announcementAPI } from '../api'
import MainLayout from '../components/MainLayout'
import PageLayout from '../components/PageLayout'
import SearchInput from '../components/SearchInput'
import Pagination from '../components/Pagination'

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

  // 图床管理
  const [hostingImages, setHostingImages] = useState([])
  const [hostingTotal, setHostingTotal] = useState(0)
  const [hostingPage, setHostingPage] = useState(1)
  const [hostingStats, setHostingStats] = useState(null)
  const [hostingChecked, setHostingChecked] = useState(new Set())
  const [hostingSelectMode, setHostingSelectMode] = useState(false)
  const [hostingDetail, setHostingDetail] = useState(null)

  // 违禁词管理
  const [bannedWords, setBannedWords] = useState([])
  const [bannedWordsTotal, setBannedWordsTotal] = useState(0)
  const [bannedWordsPage, setBannedWordsPage] = useState(1)
  const [bannedWordsQuery, setBannedWordsQuery] = useState('')
  const [newBannedWord, setNewBannedWord] = useState('')
  const [showBatchImport, setShowBatchImport] = useState(false)
  const [batchImportText, setBatchImportText] = useState('')
  const [batchImporting, setBatchImporting] = useState(false)

  // 兑换码管理
  const [codes, setCodes] = useState([])
  const [codesTotal, setCodesTotal] = useState(0)
  const [codesPage, setCodesPage] = useState(1)
  const [codesSort, setCodesSort] = useState('created_at')
  const [codesOrder, setCodesOrder] = useState('desc')
  const [codePoints, setCodePoints] = useState(10)
  const [codeCount, setCodeCount] = useState(1)
  const [customCode, setCustomCode] = useState('')
  const [generatingCodes, setGeneratingCodes] = useState(false)
  const [generatedCodes, setGeneratedCodes] = useState([])
  const [adjustUserId, setAdjustUserId] = useState(null)
  const [adjustAmount, setAdjustAmount] = useState('')
  const [adjustDesc, setAdjustDesc] = useState('')
  const [proofLightbox, setProofLightbox] = useState(null)
  const [resetPwdUserId, setResetPwdUserId] = useState(null)
  const [resetPwdValue, setResetPwdValue] = useState('')

  // 用户统计
  const [userStats, setUserStats] = useState([])
  const [userStatsLoading, setUserStatsLoading] = useState(false)

  // 公告管理
  const [announcements, setAnnouncements] = useState([])
  const [announcementTotal, setAnnouncementTotal] = useState(0)
  const [announcementPage, setAnnouncementPage] = useState(1)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [creatingAnnouncement, setCreatingAnnouncement] = useState(false)

  // 提示词管理
  const [promptItems, setPromptItems] = useState([])
  const [promptTotal, setPromptTotal] = useState(0)
  const [promptPage, setPromptPage] = useState(1)
  const [promptQuery, setPromptQuery] = useState('')
  const [promptChecked, setPromptChecked] = useState(new Set())
  const [promptSelectMode, setPromptSelectMode] = useState(false)

  useEffect(() => { setUserPage(1) }, [userQuery])
  useEffect(() => { setImagePage(1) }, [imageQuery])
  useEffect(() => { setHistoryPage(1) }, [historyQuery])
  useEffect(() => { setBannedWordsPage(1) }, [bannedWordsQuery])

  useEffect(() => { if (tab === 'users') fetchUsers() }, [tab, userPage, userQuery])
  useEffect(() => { if (tab === 'images') fetchImages() }, [tab, imagePage, imageQuery])
  useEffect(() => { if (tab === 'prompts') fetchPrompts() }, [tab, promptPage, promptQuery])
  useEffect(() => { if (tab === 'history') fetchHistory() }, [tab, historyPage, historyQuery])
  useEffect(() => { if (tab === 'hosting') { fetchHostingImages(); fetchHostingStats() } }, [tab, hostingPage])
  useEffect(() => { if (tab === 'banned') fetchBannedWords() }, [tab, bannedWordsPage, bannedWordsQuery])
  useEffect(() => { if (tab === 'finance') fetchCodes() }, [tab, codesPage, codesSort, codesOrder])
  useEffect(() => { if (tab === 'stats') fetchUserStats() }, [tab])
  useEffect(() => { if (tab === 'announcements') fetchAnnouncements() }, [tab, announcementPage])

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

  const fetchHostingStats = async () => {
    try {
      const { data } = await adminAPI.imageStats()
      setHostingStats(data)
    } catch {}
  }

  const fetchUserStats = async () => {
    setUserStatsLoading(true)
    try {
      const { data } = await statsAPI.users()
      setUserStats(data.users || [])
    } catch {} finally { setUserStatsLoading(false) }
  }

  const fetchAnnouncements = async () => {
    setLoading(true)
    try {
      const { data } = await announcementAPI.list(announcementPage, 20)
      setAnnouncements(data.items)
      setAnnouncementTotal(data.total)
    } catch {} finally { setLoading(false) }
  }

  const fetchPrompts = async () => {
    setLoading(true)
    try {
      const { data } = await adminAPI.prompts(promptPage, 20, promptQuery || undefined)
      setPromptItems(data.items)
      setPromptTotal(data.total)
    } catch {} finally { setLoading(false) }
  }

  const handleDeletePrompt = async (promptId) => {
    if (!confirm('确定删除此提示词？')) return
    try {
      await adminAPI.deletePrompt(promptId)
      fetchPrompts()
    } catch {}
  }

  const handleBatchDeletePrompts = useCallback(async () => {
    if (!confirm(`确定删除选中的 ${promptChecked.size} 条提示词？`)) return
    try {
      await adminAPI.batchDeletePrompts([...promptChecked])
      setPromptChecked(new Set())
      setPromptSelectMode(false)
      fetchPrompts()
    } catch {}
  }, [promptChecked])

  const handleCreateAnnouncement = async () => {
    if (!newTitle.trim() || !newContent.trim()) return
    setCreatingAnnouncement(true)
    try {
      await announcementAPI.create({ title: newTitle.trim(), content: newContent.trim() })
      setNewTitle(''); setNewContent('')
      fetchAnnouncements()
    } catch (e) {
      alert(e.message || '发布失败')
    } finally { setCreatingAnnouncement(false) }
  }

  const handleDeleteAnnouncement = async (id) => {
    if (!confirm('确定删除此公告？')) return
    try {
      await announcementAPI.delete(id)
      fetchAnnouncements()
    } catch {}
  }

  const fetchHostingImages = async () => {
    setLoading(true)
    try {
      const { data } = await adminAPI.hostingImages(hostingPage, 50)
      setHostingImages(data.items)
      setHostingTotal(data.total)
    } catch {} finally { setLoading(false) }
  }

  const fetchBannedWords = async () => {
    setLoading(true)
    try {
      const { data } = await adminAPI.bannedWords(bannedWordsPage, 20, bannedWordsQuery || undefined)
      setBannedWords(data.words)
      setBannedWordsTotal(data.total)
    } catch {} finally { setLoading(false) }
  }

  const handleAddBannedWord = async () => {
    const word = newBannedWord.trim()
    if (!word) return
    try {
      await adminAPI.addBannedWord(word)
      setNewBannedWord('')
      fetchBannedWords()
    } catch (e) {
      alert(e.message || '添加失败')
    }
  }

  const handleDeleteBannedWord = async (wordId, word) => {
    if (!confirm(`确定删除违禁词 "${word}"？`)) return
    try {
      await adminAPI.deleteBannedWord(wordId)
      fetchBannedWords()
    } catch {}
  }

  const fetchCodes = async () => {
    setLoading(true)
    try {
      const { data } = await adminAPI.codes(codesPage, 20, codesSort, codesOrder)
      setCodes(data.items)
      setCodesTotal(data.total)
    } catch {} finally { setLoading(false) }
  }

  const handleGenerateCodes = async () => {
    if (codePoints <= 0) return
    setGeneratingCodes(true)
    try {
      const { data } = await adminAPI.generateCodes({ count: codeCount, points: codePoints, custom_code: customCode.trim() || undefined })
      setGeneratedCodes(data.codes)
      setCustomCode('')
      fetchCodes()
    } catch (e) {
      alert(e.message || '生成失败')
    } finally { setGeneratingCodes(false) }
  }

  const handleDeleteCode = async (codeId, code) => {
    if (!confirm(`确定删除兑换码 "${code}"？`)) return
    try {
      await adminAPI.deleteCode(codeId)
      fetchCodes()
    } catch (e) { alert(e.message || '删除失败') }
  }

  const handleAdjustPoints = async (userId) => {
    const amount = parseInt(adjustAmount)
    if (!amount) return
    try {
      await adminAPI.adjustPoints(userId, { amount, description: adjustDesc || '管理员调整' })
      setAdjustUserId(null); setAdjustAmount(''); setAdjustDesc('')
      fetchUsers()
    } catch (e) { alert(e.message || '调整失败') }
  }

  const handleMigratePoints = async () => {
    if (!confirm('确认给所有现有用户（积分=0）补发 50 积分？')) return
    try {
      const { data } = await adminAPI.migratePoints()
      alert(data.message)
      fetchUsers()
    } catch (e) { alert(e.message || '操作失败') }
  }

  const handleBatchImport = async () => {
    const text = batchImportText.trim()
    if (!text) return
    setBatchImporting(true)
    try {
      const { data } = await adminAPI.batchImportBannedWords(text)
      alert(data.message)
      setShowBatchImport(false)
      setBatchImportText('')
      fetchBannedWords()
    } catch (e) {
      alert(e.message || '导入失败')
    } finally {
      setBatchImporting(false)
    }
  }

  const handleHostingBatchDelete = useCallback(async () => {
    if (!confirm(`确定删除选中的 ${hostingChecked.size} 个图床映射？`)) return
    const urls = hostingImages.filter(i => hostingChecked.has(i.url)).map(i => i.url)
    try {
      await adminAPI.batchDeleteHosting(urls)
      setHostingChecked(new Set()); setHostingSelectMode(false)
      fetchHostingImages(); fetchHostingStats()
    } catch {}
  }, [hostingChecked, hostingImages])

  const handleCleanDuplicates = async () => {
    if (!confirm('确定清理重复的图床映射？将基于URL去重，保留最早的记录。')) return
    try {
      const { data } = await adminAPI.cleanDuplicates()
      alert(`清理完成，删除了 ${data.deleted} 条重复记录`)
      fetchHostingImages(); fetchHostingStats()
    } catch (e) {
      alert(e.message || '清理失败')
    }
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

  const handleResetPassword = async (userId) => {
    if (!resetPwdValue.trim()) return
    if (resetPwdValue.length < 6) { alert('密码长度至少6位'); return }
    try {
      await adminAPI.resetPassword(userId, resetPwdValue)
      alert('密码重置成功')
      setResetPwdUserId(null)
      setResetPwdValue('')
    } catch (e) { alert(e.message || '重置失败') }
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

  const toggleHostingCheck = useCallback((filename) => {
    setHostingChecked(prev => { const next = new Set(prev); next.has(filename) ? next.delete(filename) : next.add(filename); return next })
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
    <>
    <MainLayout>
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="flex gap-1 p-0.5 rounded-lg mb-4 overflow-x-auto scrollbar-hide" style={{ background: 'var(--border-color)', scrollbarWidth: 'none' }}>
          {[{ k: 'users', l: '用户管理', i: Users }, { k: 'images', l: '广场图片', i: Image }, { k: 'prompts', l: '广场提示词', i: BookOpen }, { k: 'history', l: '生成历史', i: Clock }, { k: 'hosting', l: '图床管理', i: HardDrive }, { k: 'banned', l: '违禁词管理', i: Ban }, { k: 'finance', l: '充值与兑换', i: Wallet }, { k: 'stats', l: '用户统计', i: BarChart3 }, { k: 'announcements', l: '公告管理', i: Megaphone }].map(({ k, l, i: Icon }) => (
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
              <button onClick={handleMigratePoints} className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium bg-accent text-white hover:opacity-90">补发积分</button>
            </div>
            {loading ? (
              <div className="flex justify-center py-20">
                <div className="w-8 h-8 border-2 rounded-full animate-spin-slow" style={{ borderTopColor: 'var(--accent)', borderColor: 'var(--border-color)' }} />
              </div>
            ) : (
            <>
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ background: 'var(--bg-primary)' }}>
                      <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>用户</th>
                      <th className="px-3 py-2 text-center font-medium" style={{ color: 'var(--text-secondary)' }}>积分</th>
                      <th className="px-3 py-2 text-center font-medium" style={{ color: 'var(--text-secondary)' }}>成功</th>
                      <th className="px-3 py-2 text-center font-medium" style={{ color: 'var(--text-secondary)' }}>失败</th>
                      <th className="px-3 py-2 text-center font-medium" style={{ color: 'var(--text-secondary)' }}>处理中</th>
                      <th className="px-3 py-2 text-center font-medium" style={{ color: 'var(--text-secondary)' }}>状态</th>
                      <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>IP</th>
                      <th className="px-3 py-2 text-right font-medium" style={{ color: 'var(--text-secondary)' }}>最后活跃</th>
                      <th className="px-3 py-2 text-right font-medium" style={{ color: 'var(--text-secondary)' }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <>
                      <tr key={u.id} className="border-t" style={{ borderColor: 'var(--border-color)' }}>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            {u.is_admin ? <span className="px-1 py-0.5 rounded text-[10px] font-medium" style={{ background: 'var(--accent)20', color: 'var(--accent)' }}>管</span> : null}
                            <span style={{ color: 'var(--text-primary)' }}>{u.nickname || u.username}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button onClick={() => { setAdjustUserId(u.id); setAdjustAmount(''); setAdjustDesc('') }}
                            className="px-1.5 py-0.5 rounded text-xs font-medium hover:bg-black/5" style={{ color: 'var(--accent)' }}>
                            {u.is_admin ? '∞' : (u.points ?? 0)}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-center" style={{ color: '#22c55e' }}>{u.success_count}</td>
                        <td className="px-3 py-2 text-center" style={{ color: '#ef4444' }}>{u.failed_count}</td>
                        <td className="px-3 py-2 text-center" style={{ color: '#f59e0b' }}>{u.processing_count}</td>
                        <td className="px-3 py-2 text-center">
                          {u.is_frozen ? <UserX size={12} className="inline" style={{ color: '#ef4444' }} /> : <UserCheck size={12} className="inline" style={{ color: '#22c55e' }} />}
                        </td>
                        <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>{u.last_ip || '-'}</td>
                        <td className="px-3 py-2 text-right" style={{ color: 'var(--text-secondary)' }}>{u.last_active || '-'}</td>
                        <td className="px-3 py-2 text-right">
                          {!u.is_admin && (
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => { setResetPwdUserId(resetPwdUserId === u.id ? null : u.id); setResetPwdValue('') }} className="p-1.5 rounded-lg hover:bg-black/5"
                                style={{ color: resetPwdUserId === u.id ? 'var(--accent)' : 'var(--text-secondary)' }} title="重置密码">
                                <Key size={14} />
                              </button>
                              <button onClick={() => handleToggleFreeze(u.id, u.username)} className="p-1.5 rounded-lg hover:bg-black/5"
                                style={{ color: u.is_frozen ? '#3b82f6' : 'var(--text-secondary)' }} title={u.is_frozen ? '启用' : '冻结'}>
                                {u.is_frozen ? <Sun size={14} /> : <Snowflake size={14} />}
                              </button>
                              <button onClick={() => handleDeleteUser(u.id, u.username)} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500" title="删除">
                                <Trash2 size={14} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                      {resetPwdUserId === u.id && (
                        <tr>
                          <td colSpan="10" className="px-3 py-2" style={{ background: 'var(--bg-primary)' }}>
                            <div className="flex items-center gap-2">
                              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>新密码</span>
                              <input type="text" value={resetPwdValue} onChange={e => setResetPwdValue(e.target.value)} placeholder="至少6位"
                                className="w-32 px-2 py-1 rounded text-xs border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }} />
                              <button onClick={() => handleResetPassword(u.id)} disabled={!resetPwdValue.trim() || resetPwdValue.length < 6}
                                className="px-2 py-1 rounded text-xs font-medium text-white disabled:opacity-50" style={{ background: 'var(--accent)' }}>确认</button>
                              <button onClick={() => setResetPwdUserId(null)} className="px-2 py-1 rounded text-xs" style={{ color: 'var(--text-secondary)' }}>取消</button>
                            </div>
                          </td>
                        </tr>
                      )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <Pagination page={userPage} totalPages={Math.ceil(userTotal / 20)} onPageChange={setUserPage} />
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
            <Pagination page={imagePage} totalPages={Math.ceil(imageTotal / 20)} onPageChange={setImagePage} />
            </>
            )}
          </div>
        ) : tab === 'prompts' ? (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3 flex-1">
                <span className="text-sm flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>共 {promptTotal} 条提示词</span>
                <SearchInput value={promptQuery} onChange={setPromptQuery} placeholder="搜索名称/内容/用户名..." />
              </div>
              <div className="flex items-center gap-2">
                {promptSelectMode && (
                  <button onClick={() => {
                    if (promptChecked.size === promptItems.length) setPromptChecked(new Set())
                    else setPromptChecked(new Set(promptItems.map(i => i.id)))
                  }} className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>
                    {promptChecked.size === promptItems.length ? '取消全选' : '全选'}
                  </button>
                )}
                {promptSelectMode && promptChecked.size > 0 && (
                  <button onClick={handleBatchDeletePrompts}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500 text-white hover:bg-red-600">
                    <Trash2 size={14} /> 删除 {promptChecked.size} 条
                  </button>
                )}
                {promptSelectMode ? (
                  <button onClick={() => { setPromptSelectMode(false); setPromptChecked(new Set()) }}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>取消</button>
                ) : (
                  <button onClick={() => setPromptSelectMode(true)}
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
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ background: 'var(--bg-primary)' }}>
                      <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>名称</th>
                      <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>提示词</th>
                      <th className="px-3 py-2 text-center font-medium" style={{ color: 'var(--text-secondary)' }}>点赞</th>
                      <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>作者</th>
                      <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>创建时间</th>
                      <th className="px-3 py-2 text-right font-medium" style={{ color: 'var(--text-secondary)' }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {promptItems.map(p => (
                      <tr key={p.id} className="border-t" style={{ borderColor: 'var(--border-color)' }}>
                        <td className="px-3 py-2">
                          {promptSelectMode && (
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input type="checkbox" checked={promptChecked.has(p.id)}
                                onChange={() => setPromptChecked(prev => { const next = new Set(prev); next.has(p.id) ? next.delete(p.id) : next.add(p.id); return next })}
                                className="w-4 h-4 rounded" />
                              <span className="font-medium truncate max-w-[120px]" style={{ color: 'var(--text-primary)' }}>{p.name}</span>
                            </label>
                          )}
                          {!promptSelectMode && <span className="font-medium truncate max-w-[120px] block" style={{ color: 'var(--text-primary)' }}>{p.name}</span>}
                        </td>
                        <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>
                          <span className="truncate max-w-[200px] block">{p.prompt}</span>
                        </td>
                        <td className="px-3 py-2 text-center" style={{ color: 'var(--text-primary)' }}>{p.likes_count}</td>
                        <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>{p.nickname || p.username || '-'}</td>
                        <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>{p.created_at || '-'}</td>
                        <td className="px-3 py-2 text-right">
                          {!promptSelectMode && (
                            <button onClick={() => handleDeletePrompt(p.id)} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500" title="删除">
                              <Trash2 size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {promptItems.length === 0 && (
                      <tr><td colSpan={6} className="text-center py-10" style={{ color: 'var(--text-secondary)' }}>暂无提示词</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <Pagination page={promptPage} totalPages={Math.ceil(promptTotal / 20)} onPageChange={setPromptPage} />
            </>
            )}
          </div>
        ) : tab === 'announcements' ? (
          <div>
            <div className="p-4 rounded-xl border mb-4" style={{ borderColor: 'var(--border-color)' }}>
              <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>发布公告</h3>
              <input type="text" value={newTitle} onChange={e => setNewTitle(e.target.value)}
                placeholder="公告标题" maxLength={200}
                className="w-full px-3 py-2 rounded-lg text-sm border mb-3 outline-none"
                style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              <textarea value={newContent} onChange={e => setNewContent(e.target.value)}
                placeholder="公告内容" rows={4} maxLength={5000}
                className="w-full px-3 py-2 rounded-lg text-sm border resize-none outline-none"
                style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              <div className="flex justify-end mt-3">
                <button onClick={handleCreateAnnouncement} disabled={!newTitle.trim() || !newContent.trim() || creatingAnnouncement}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed">
                  {creatingAnnouncement ? '发布中...' : '发布'}
                </button>
              </div>
            </div>
            <div className="flex items-center gap-3 mb-4">
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>共 {announcementTotal} 条公告</span>
            </div>
            {loading ? (
              <div className="flex justify-center py-20">
                <div className="w-8 h-8 border-2 rounded-full animate-spin-slow" style={{ borderTopColor: 'var(--accent)', borderColor: 'var(--border-color)' }} />
              </div>
            ) : (
            <>
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
              <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ background: 'var(--bg-secondary)' }}>
                    <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>标题</th>
                    <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>作者</th>
                    <th className="px-3 py-2 text-right font-medium" style={{ color: 'var(--text-secondary)' }}>时间</th>
                    <th className="px-3 py-2 text-right font-medium" style={{ color: 'var(--text-secondary)' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {announcements.map(item => (
                    <tr key={item.id} className="border-t" style={{ borderColor: 'var(--border-color)' }}>
                      <td className="px-3 py-2 truncate max-w-[300px] font-medium" style={{ color: 'var(--text-primary)' }}>{item.title}</td>
                      <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>{item.author_name || '管理员'}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{item.created_at}</td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => handleDeleteAnnouncement(item.id)} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500" title="删除">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
            {announcements.length === 0 && (
              <div className="text-center py-20" style={{ color: 'var(--text-secondary)' }}>暂无公告</div>
            )}
            <Pagination page={announcementPage} totalPages={Math.ceil(announcementTotal / 20)} onPageChange={setAnnouncementPage} />
            </>
            )}
          </div>
        ) : tab === 'hosting' ? (
          <div>
            {hostingStats && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                <div className="px-3 py-2 rounded-xl border" style={{ borderColor: 'var(--border-color)' }}>
                  <div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{hostingStats.total_count}</div>
                  <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>图床图片</div>
                </div>
                <div className="px-3 py-2 rounded-xl border" style={{ borderColor: 'var(--border-color)' }}>
                  <div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{hostingStats.total_size_fmt}</div>
                  <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>本地文件大小</div>
                </div>
                <button onClick={handleCleanDuplicates} className="px-3 py-2 rounded-xl border hover:bg-black/5 transition-colors" style={{ borderColor: 'var(--border-color)' }}>
                  <div className="text-sm font-medium" style={{ color: 'var(--accent)' }}>清理重复</div>
                  <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>基于URL去重</div>
                </button>
              </div>
            )}
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>共 {hostingTotal} 条图床映射</span>
              <div className="flex items-center gap-2">
                {hostingSelectMode && (
                  <button onClick={() => {
                    if (hostingChecked.size === hostingImages.length) setHostingChecked(new Set())
                    else setHostingChecked(new Set(hostingImages.map(i => i.url)))
                  }} className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>
                    {hostingChecked.size === hostingImages.length ? '取消全选' : '全选'}
                  </button>
                )}
                {hostingSelectMode && hostingChecked.size > 0 && (
                  <button onClick={handleHostingBatchDelete}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500 text-white hover:bg-red-600">
                    <Trash2 size={14} /> 删除 {hostingChecked.size} 项
                  </button>
                )}
                {hostingSelectMode ? (
                  <button onClick={() => { setHostingSelectMode(false); setHostingChecked(new Set()) }}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>取消</button>
                ) : (
                  <button onClick={() => setHostingSelectMode(true)}
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
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
              {hostingImages.map(img => (
                <div key={img.url}
                  className={`group relative rounded-xl overflow-hidden shadow-sm cursor-pointer ${hostingChecked.has(img.url) ? 'ring-2 ring-accent/50' : ''}`}
                  onClick={() => hostingSelectMode ? toggleHostingCheck(img.url) : setHostingDetail(img)}>
                  {hostingSelectMode && (
                    <div className={`absolute top-2 left-2 z-20 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${hostingChecked.has(img.url) ? 'bg-accent border-accent' : 'bg-white/80 border-gray-300'}`}>
                      {hostingChecked.has(img.url) && <Check size={12} className="text-white" />}
                    </div>
                  )}
                  {hostingSelectMode && hostingChecked.has(img.url) && <div className="absolute inset-0 bg-accent/10 pointer-events-none z-10" />}
                  {img.exists ? (
                    <img src={`/api/images/local-thumb?path=${encodeURIComponent(img.local_path)}&size=400`} alt="" className="w-full aspect-square object-cover" loading="lazy" />
                  ) : (
                    <div className="w-full aspect-square flex items-center justify-center" style={{ background: 'var(--border-color)' }}>
                      <HardDrive size={24} style={{ color: 'var(--text-secondary)', opacity: 0.5 }} />
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                    <p className="text-white text-[10px] truncate">{img.filename}</p>
                  </div>
                  {!img.exists && <div className="absolute inset-0 bg-red-500/20 pointer-events-none" title="本地文件已不存在" />}
                </div>
              ))}
            </div>
            <Pagination page={hostingPage} totalPages={Math.ceil(hostingTotal / 50)} onPageChange={setHostingPage} />
            </>
            )}
          </div>
        ) : tab === 'banned' ? (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3 flex-1">
                <span className="text-sm flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>共 {bannedWordsTotal} 个违禁词</span>
                <SearchInput value={bannedWordsQuery} onChange={setBannedWordsQuery} placeholder="搜索违禁词..." />
              </div>
              <button
                onClick={() => setShowBatchImport(true)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-accent text-white hover:opacity-90"
              >
                批量导入
              </button>
            </div>
            {/* 添加违禁词 */}
            <div className="flex items-center gap-2 mb-4">
              <input
                type="text"
                value={newBannedWord}
                onChange={e => setNewBannedWord(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddBannedWord()}
                placeholder="输入新违禁词..."
                className="flex-1 px-3 py-2 rounded-lg text-sm border"
                style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
                maxLength={50}
              />
              <button
                onClick={handleAddBannedWord}
                disabled={!newBannedWord.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                添加
              </button>
            </div>
            {/* 违禁词列表 */}
            {loading ? (
              <div className="flex justify-center py-20">
                <div className="w-8 h-8 border-2 rounded-full animate-spin-slow" style={{ borderTopColor: 'var(--accent)', borderColor: 'var(--border-color)' }} />
              </div>
            ) : (
            <>
            <div className="space-y-2">
              {bannedWords.map(item => (
                <div key={item.id} className="flex items-center justify-between px-4 py-3 rounded-xl border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)' }}>
                  <div className="flex items-center gap-3">
                    <span className="px-2 py-1 rounded-lg text-xs font-medium" style={{ background: '#ef444420', color: '#ef4444' }}>
                      <Ban size={12} className="inline mr-1" />
                      违禁
                    </span>
                    <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{item.word}</span>
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{item.created_at}</span>
                  </div>
                  <button
                    onClick={() => handleDeleteBannedWord(item.id, item.word)}
                    className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500"
                    title="删除"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {bannedWords.length === 0 && (
                <div className="text-center py-20" style={{ color: 'var(--text-secondary)' }}>暂无违禁词</div>
              )}
            </div>
            <Pagination page={bannedWordsPage} totalPages={Math.ceil(bannedWordsTotal / 20)} onPageChange={setBannedWordsPage} />
            </>
            )}
          </div>
        ) : tab === 'finance' ? (
          <div className="space-y-6">
            {/* 生成兑换码 */}
            <div className="p-4 rounded-xl border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)' }}>
              <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>生成兑换码</h3>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>积分额度</label>
                  <div className="flex gap-1.5 mb-1.5">
                    {[10, 50, 100, 500].map(p => (
                      <button key={p} onClick={() => { setCodePoints(p); setCustomCode('') }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${codePoints === p && !customCode ? 'bg-accent text-white shadow-sm' : 'border hover:border-accent/50'}`}
                        style={codePoints === p && !customCode ? {} : { borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}>
                        {p}
                      </button>
                    ))}
                  </div>
                  <input type="number" value={customCode} onChange={e => { setCustomCode(e.target.value); setCodePoints(parseInt(e.target.value) || 0) }}
                    placeholder="自定义" min={1}
                    className="w-24 px-2.5 py-1.5 rounded-lg text-xs border outline-none focus:border-accent/50 transition-colors"
                    style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>数量</label>
                  <input type="number" value={codeCount} onChange={e => setCodeCount(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                    min={1} max={100}
                    className="w-20 px-2.5 py-1.5 rounded-lg text-xs border outline-none focus:border-accent/50 transition-colors"
                    style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                </div>
                <button onClick={handleGenerateCodes} disabled={generatingCodes || codePoints <= 0}
                  className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-accent text-white hover:opacity-90 disabled:opacity-50 transition-all shadow-sm">
                  {generatingCodes ? '生成中...' : '生成'}
                </button>
              </div>
              {generatedCodes.length > 0 && (
                <div className="mt-3 p-2.5 rounded-lg text-xs" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium" style={{ background: '#22c55e20', color: '#22c55e' }}>成功</span>
                    <span style={{ color: 'var(--text-secondary)' }}>已生成 {generatedCodes.length} 个兑换码</span>
                  </div>
                  <div className="font-mono break-all leading-relaxed" style={{ color: 'var(--accent)' }}>{generatedCodes.join('、')}</div>
                </div>
              )}
            </div>

            {/* 兑换码记录 */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>兑换码记录</h3>
                <div className="flex items-center gap-1.5">
                  <select value={codesSort} onChange={e => setCodesSort(e.target.value)}
                    className="px-2 py-1 rounded-lg text-xs font-medium border outline-none cursor-pointer"
                    style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                    <option value="created_at">按创建时间</option>
                    <option value="is_used">按使用状态</option>
                    <option value="points">按积分额度</option>
                  </select>
                  <button onClick={() => setCodesOrder(o => o === 'desc' ? 'asc' : 'desc')}
                    className="px-2 py-1 rounded-lg text-xs font-medium border hover:bg-black/5 transition-colors"
                    style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}>
                    {codesOrder === 'desc' ? '↓' : '↑'}
                  </button>
                </div>
              </div>
              {loading ? (
                <div className="flex justify-center py-10">
                  <div className="w-8 h-8 border-2 rounded-full animate-spin-slow" style={{ borderTopColor: 'var(--accent)', borderColor: 'var(--border-color)' }} />
                </div>
              ) : (
                <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr style={{ background: 'var(--bg-secondary)' }}>
                          <th className="px-4 py-3 text-left font-semibold" style={{ color: 'var(--text-secondary)' }}>兑换码</th>
                          <th className="px-4 py-3 text-center font-semibold" style={{ color: 'var(--text-secondary)' }}>积分</th>
                          <th className="px-4 py-3 text-center font-semibold" style={{ color: 'var(--text-secondary)' }}>状态</th>
                          <th className="px-4 py-3 text-center font-semibold" style={{ color: 'var(--text-secondary)' }}>渠道</th>
                          <th className="px-4 py-3 text-right font-semibold" style={{ color: 'var(--text-secondary)' }}>金额</th>
                          <th className="px-4 py-3 text-left font-semibold" style={{ color: 'var(--text-secondary)' }}>单号</th>
                          <th className="px-4 py-3 text-center font-semibold" style={{ color: 'var(--text-secondary)' }}>审核状态</th>
                          <th className="px-4 py-3 text-left font-semibold" style={{ color: 'var(--text-secondary)' }}>审核备注</th>
                          <th className="px-4 py-3 text-center font-semibold" style={{ color: 'var(--text-secondary)' }}>支付凭证</th>
                          <th className="px-4 py-3 text-left font-semibold" style={{ color: 'var(--text-secondary)' }}>使用者</th>
                          <th className="px-4 py-3 text-left font-semibold" style={{ color: 'var(--text-secondary)' }}>创建时间</th>
                        </tr>
                      </thead>
                      <tbody>
                        {codes.map(c => (
                          <tr key={c.id} className="border-t transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02]" style={{ borderColor: 'var(--border-color)' }}>
                            <td className="px-4 py-3">
                              <span className="px-2 py-1 rounded-lg text-xs font-mono font-semibold" style={{ background: 'var(--accent)12', color: 'var(--accent)' }}>{c.code}</span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{c.points}</span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${c.is_used ? 'bg-gray-100 text-gray-500 dark:bg-gray-800' : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400'}`}>
                                {c.is_used ? '已使用' : '未使用'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                              {c.recharge_channel ? (c.recharge_channel === 'wechat' ? '微信' : '支付宝') : '-'}
                            </td>
                            <td className="px-4 py-3 text-right text-[11px] tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                              {c.recharge_amount ? `¥${c.recharge_amount}` : '-'}
                            </td>
                            <td className="px-4 py-3 text-left text-[11px] truncate max-w-[100px]" style={{ color: 'var(--text-secondary)' }}>
                              {c.recharge_tx_no || '-'}
                            </td>
                            <td className="px-4 py-3 text-center">
                              {c.recharge_status ? (
                                <span className="px-2 py-0.5 rounded-full text-[11px] font-medium" style={{
                                  color: c.recharge_status === 'approved' ? '#22c55e' : c.recharge_status === 'rejected' ? '#ef4444' : '#f59e0b',
                                  background: c.recharge_status === 'approved' ? '#22c55e20' : c.recharge_status === 'rejected' ? '#ef444420' : '#f59e0b20'
                                }}>
                                  {{ pending: '待审核', approved: '已通过', rejected: '已拒绝' }[c.recharge_status]}
                                </span>
                              ) : '-'}
                            </td>
                            <td className="px-4 py-3 text-left text-[11px] truncate max-w-[120px]" style={{ color: 'var(--text-secondary)' }}>
                              {c.recharge_review_note || '-'}
                            </td>
                            <td className="px-4 py-3 text-center">
                              {c.recharge_proof_url ? (
                                <button onClick={() => setProofLightbox(c.recharge_proof_url)} className="text-xs underline" style={{ color: 'var(--accent)' }}>查看</button>
                              ) : '-'}
                            </td>
                            <td className="px-4 py-3" style={{ color: c.used_by_name ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                              {c.used_by_name || '-'}
                            </td>
                            <td className="px-4 py-3 text-[11px]" style={{ color: 'var(--text-secondary)' }}>{c.created_at || '-'}</td>
                          </tr>
                        ))}
                        {codes.length === 0 && (
                          <tr><td colSpan={11} className="text-center py-16" style={{ color: 'var(--text-secondary)' }}>
                            <Ticket size={32} className="mx-auto mb-2 opacity-30" />
                            <p>暂无兑换码</p>
                          </td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <Pagination page={codesPage} totalPages={Math.ceil(codesTotal / 20)} onPageChange={setCodesPage} />
            </div>
          </div>
        ) : tab === 'stats' ? (
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>共 {userStats.length} 个用户</span>
            </div>
            {userStatsLoading ? (
              <div className="flex justify-center py-20">
                <div className="w-8 h-8 border-2 rounded-full animate-spin-slow" style={{ borderTopColor: 'var(--accent)', borderColor: 'var(--border-color)' }} />
              </div>
            ) : (
              <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: 'var(--bg-secondary)' }}>
                      <th className="text-left px-4 py-2.5 font-medium" style={{ color: 'var(--text-secondary)' }}>用户</th>
                      <th className="text-center px-4 py-2.5 font-medium" style={{ color: 'var(--text-secondary)' }}>成功</th>
                      <th className="text-center px-4 py-2.5 font-medium" style={{ color: 'var(--text-secondary)' }}>失败</th>
                      <th className="text-center px-4 py-2.5 font-medium" style={{ color: 'var(--text-secondary)' }}>处理中</th>
                      <th className="text-right px-4 py-2.5 font-medium" style={{ color: 'var(--text-secondary)' }}>最后活跃</th>
                    </tr>
                  </thead>
                  <tbody>
                    {userStats.map((u) => (
                      <tr key={u.id} className="border-t" style={{ borderColor: 'var(--border-color)' }}>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{u.nickname || u.username}</span>
                            {Boolean(u.is_admin) && <span className="px-1.5 py-0.5 rounded text-xs" style={{ background: 'var(--accent)15', color: 'var(--accent)' }}>管理员</span>}
                            {Boolean(u.is_frozen) && <span className="px-1.5 py-0.5 rounded text-xs bg-red-100 text-red-600 dark:bg-red-900/20">已冻结</span>}
                          </div>
                          <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>@{u.username}</div>
                        </td>
                        <td className="px-4 py-2.5 text-center tabular-nums" style={{ color: '#22c55e' }}>{u.success_count}</td>
                        <td className="px-4 py-2.5 text-center tabular-nums" style={{ color: '#ef4444' }}>{u.failed_count}</td>
                        <td className="px-4 py-2.5 text-center tabular-nums" style={{ color: 'var(--text-secondary)' }}>{u.processing_count}</td>
                        <td className="px-4 py-2.5 text-right text-xs" style={{ color: 'var(--text-secondary)' }}>
                          {u.last_active ? new Date(u.last_active).toLocaleString('zh-CN') : '从未'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
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
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
              <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ background: 'var(--bg-secondary)' }}>
                    <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>用户</th>
                    <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>提示词</th>
                    <th className="px-3 py-2 text-center font-medium" style={{ color: 'var(--text-secondary)' }}>状态</th>
                    <th className="px-3 py-2 text-right font-medium" style={{ color: 'var(--text-secondary)' }}>耗时</th>
                    <th className="px-3 py-2 text-right font-medium" style={{ color: 'var(--text-secondary)' }}>IP</th>
                    <th className="px-3 py-2 text-right font-medium" style={{ color: 'var(--text-secondary)' }}>时间</th>
                    <th className="px-3 py-2 text-right font-medium" style={{ color: 'var(--text-secondary)' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(item => {
                    const st = { pending: { c: '#6b7280', l: '等待中' }, queued: { c: '#f59e0b', l: '排队中' }, processing: { c: '#f59e0b', l: '生成中' }, completed: { c: '#22c55e', l: '已完成' }, failed: { c: '#ef4444', l: '失败' } }
                    const s = st[item.status] || st.pending
                    const duration = item.started_at && item.completed_at
                      ? Math.round((new Date(item.completed_at) - new Date(item.started_at)) / 1000)
                      : null
                    return (
                      <tr key={item.task_id} className="border-t" style={{ borderColor: 'var(--border-color)' }}>
                        <td className="px-3 py-2" style={{ color: 'var(--text-primary)' }}>{item.nickname || item.username || '-'}</td>
                        <td className="px-3 py-2 truncate max-w-[200px]" style={{ color: 'var(--text-secondary)' }}>{item.prompt || '无提示词'}</td>
                        <td className="px-3 py-2 text-center"><span className="px-2 py-0.5 rounded-full" style={{ color: s.c, background: s.c + '20' }}>{s.l}</span></td>
                        <td className="px-3 py-2 text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>{duration !== null ? `${duration}s` : '-'}</td>
                        <td className="px-3 py-2 text-right" style={{ color: 'var(--text-secondary)' }}>{item.last_ip || '-'}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{item.created_at}</td>
                        <td className="px-3 py-2 text-right">
                          <button onClick={() => handleDeleteHistory(item.task_id)} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500" title="删除">
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              </div>
            </div>
            {history.length === 0 && (
              <div className="text-center py-20" style={{ color: 'var(--text-secondary)' }}>暂无记录</div>
            )}
            {historyTotal > 20 && (
              <Pagination page={historyPage} totalPages={Math.ceil(historyTotal / 20)} onPageChange={setHistoryPage} />
            )}
            </>
            )}
          </div>
        )}
      </div>

      {/* 图片详情弹窗 */}
      {hostingDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setHostingDetail(null)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative w-full max-w-4xl max-h-[90vh] rounded-2xl overflow-hidden flex" style={{ background: 'var(--bg-primary)' }} onClick={e => e.stopPropagation()}>
            <div className="flex-1 min-w-0 flex items-center justify-center p-4" style={{ background: '#1a1a1a' }}>
              <img src={hostingDetail.url} alt="" className="max-w-full max-h-[80vh] object-contain" />
            </div>
            <div className="w-72 flex-shrink-0 p-4 overflow-y-auto border-l" style={{ borderColor: 'var(--border-color)' }}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>图片详情</h3>
                <button onClick={() => setHostingDetail(null)} className="p-1 rounded-lg hover:bg-black/5">
                  <X size={16} style={{ color: 'var(--text-secondary)' }} />
                </button>
              </div>
              <div className="space-y-3 text-xs">
                <div>
                  <div style={{ color: 'var(--text-secondary)' }}>文件名</div>
                  <div className="mt-0.5 break-all" style={{ color: 'var(--text-primary)' }}>{hostingDetail.filename}</div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-secondary)' }}>大小</div>
                  <div className="mt-0.5" style={{ color: 'var(--text-primary)' }}>{hostingDetail.size_fmt}</div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-secondary)' }}>图床URL</div>
                  <div className="mt-0.5 break-all" style={{ color: 'var(--accent)' }}>{hostingDetail.url}</div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-secondary)' }}>本地路径</div>
                  <div className="mt-0.5 break-all" style={{ color: 'var(--text-primary)' }}>{hostingDetail.local_path}</div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-secondary)' }}>本地文件</div>
                  <div className="mt-0.5">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${hostingDetail.exists ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}`}>
                      {hostingDetail.exists ? '存在' : '已丢失'}
                    </span>
                  </div>
                </div>
                <div className="pt-3 border-t" style={{ borderColor: 'var(--border-color)' }}>
                  <a href={hostingDetail.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg bg-blue-500 text-white text-xs font-medium hover:bg-blue-600">
                    <Download size={14} /> 打开原图
                  </a>
                </div>
                <div>
                  <button onClick={async () => {
                    if (!confirm('确定删除此图床映射？（仅删除映射记录，不删除图床上的图片）')) return
                    try {
                      await adminAPI.batchDeleteHosting([hostingDetail.url])
                      setHostingDetail(null); fetchHostingImages(); fetchHostingStats()
                    } catch {}
                  }} className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg bg-red-500 text-white text-xs font-medium hover:bg-red-600">
                    <Trash2 size={14} /> 删除映射
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 调整积分弹窗 */}
      {adjustUserId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setAdjustUserId(null)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative w-full max-w-sm rounded-2xl overflow-hidden" style={{ background: 'var(--bg-primary)' }} onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>调整积分</h3>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>积分数量（正数增加，负数扣除）</label>
                <input type="number" value={adjustAmount} onChange={e => setAdjustAmount(e.target.value)}
                  placeholder="例如: 100 或 -50"
                  className="w-full px-3 py-2 rounded-lg text-sm border outline-none"
                  style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>备注</label>
                <input type="text" value={adjustDesc} onChange={e => setAdjustDesc(e.target.value)}
                  placeholder="管理员调整"
                  className="w-full px-3 py-2 rounded-lg text-sm border outline-none"
                  style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)', color: 'var(--text-primary)' }} />
              </div>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
              <button onClick={() => setAdjustUserId(null)} className="px-4 py-2 rounded-lg text-sm font-medium hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>取消</button>
              <button onClick={() => handleAdjustPoints(adjustUserId)} disabled={!adjustAmount}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:opacity-90 disabled:opacity-50">确认</button>
            </div>
          </div>
        </div>
      )}

      {/* 批量导入违禁词弹窗 */}
      {showBatchImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowBatchImport(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative w-full max-w-md rounded-2xl overflow-hidden" style={{ background: 'var(--bg-primary)' }} onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>批量导入违禁词</h3>
            </div>
            <div className="p-4">
              <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
                每行一个违禁词，自动去除空行和首尾空格
              </p>
              <textarea
                value={batchImportText}
                onChange={e => setBatchImportText(e.target.value)}
                placeholder="违禁词1&#10;违禁词2&#10;违禁词3"
                rows={10}
                className="w-full px-3 py-2 rounded-lg text-sm border resize-none"
                style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)', color: 'var(--text-primary)' }}
              />
              {batchImportText.trim() && (
                <p className="text-xs mt-2" style={{ color: 'var(--text-secondary)' }}>
                  待导入 {batchImportText.split('\n').filter(l => l.trim()).length} 个违禁词
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 p-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
              <button
                onClick={() => { setShowBatchImport(false); setBatchImportText('') }}
                className="px-4 py-2 rounded-lg text-sm font-medium hover:bg-black/5"
                style={{ color: 'var(--text-secondary)' }}
              >
                取消
              </button>
              <button
                onClick={handleBatchImport}
                disabled={!batchImportText.trim() || batchImporting}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {batchImporting ? '导入中...' : '确认导入'}
              </button>
            </div>
          </div>
        </div>
      )}
    </MainLayout>
    {proofLightbox && (
      <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setProofLightbox(null)}>
        <img src={proofLightbox} alt="支付凭证" className="max-w-full max-h-full rounded-lg" onClick={e => e.stopPropagation()} />
      </div>
    )}
    </>
  )
}
