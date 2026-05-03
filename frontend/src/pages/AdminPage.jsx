import { useState, useEffect, useCallback } from 'react'
import { Trash2, Users, Shield, Snowflake, Sun, Clock, Check, UserCheck, UserX, HardDrive, Download, X, Ban, Ticket, Megaphone, Wallet, Key, SlidersHorizontal, BarChart3 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { adminAPI, announcementAPI, configAPI, statsAPI } from '../api'
import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip } from 'recharts'
import MainLayout from '../components/MainLayout'
import PageLayout from '../components/PageLayout'
import SearchInput from '../components/SearchInput'
import Pagination from '../components/Pagination'
import UnifiedCard from '../components/UnifiedCard'
import AdminUsersTab from './admin-tabs/AdminUsersTab'
import AdminHistoryTab from './admin-tabs/AdminHistoryTab'
import AdminAnnouncementsTab from './admin-tabs/AdminAnnouncementsTab'
import AdminBannedTab from './admin-tabs/AdminBannedTab'
import AdminHostingTab from './admin-tabs/AdminHostingTab'
import { readUser } from '../auth'
import { useAppDialog } from '../components/AppDialogProvider'

export default function AdminPage() {
  const dialog = useAppDialog()
  const navigate = useNavigate()
  const [tab, setTab] = useState('users')
  const [users, setUsers] = useState([])
  const [history, setHistory] = useState([])
  const [userPage, setUserPage] = useState(1)
  const [historyPage, setHistoryPage] = useState(1)
  const [userTotal, setUserTotal] = useState(0)
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historySummary, setHistorySummary] = useState({ total: 0, pending: 0, queued: 0, processing: 0, running: 0, generating: 0, completed: 0, failed: 0 })
  const [systemStats, setSystemStats] = useState(null)
  const [bizStats, setBizStats] = useState(null)
  const [overviewStats, setOverviewStats] = useState(null)
  const [statsRange, setStatsRange] = useState('7d')
  const [trendMetric, setTrendMetric] = useState('requests')
  const [loading, setLoading] = useState(false)
  const [userQuery, setUserQuery] = useState('')
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
  const [rechargePendingCount, setRechargePendingCount] = useState(0)
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
  const [rechargeStatusFilter, setRechargeStatusFilter] = useState('all')
  const [reviewModal, setReviewModal] = useState(null)
  const [reviewNote, setReviewNote] = useState('')
  const [reviewPoints, setReviewPoints] = useState('')


  // 公告管理
  const [announcements, setAnnouncements] = useState([])
  const [announcementTotal, setAnnouncementTotal] = useState(0)
  const [announcementPage, setAnnouncementPage] = useState(1)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [creatingAnnouncement, setCreatingAnnouncement] = useState(false)
  const [runtimeConfig, setRuntimeConfig] = useState({ api_url: '', image_hosting_upload_url: '', image_hosting_base_url: '', image_hosting_referer: '', wechat_pay_qr_url: '', alipay_pay_qr_url: '', manual_recharge_notice: '', generate_concurrent_limit_per_user: 10, points_cost_per_generation: 10, points_checkin_reward: 10, points_register_bonus: 50, points_migration_amount: 50, login_rate_limit_per_minute_per_ip: 5, register_rate_limit_per_minute_per_ip: 3 })
  const [configSaving, setConfigSaving] = useState(false)
  const [defaultModelId, setDefaultModelId] = useState('image-default')
  const [generationModelsText, setGenerationModelsText] = useState('{}')
  const [generationProvidersText, setGenerationProvidersText] = useState('{}')
  const [showAdvancedGenConfig, setShowAdvancedGenConfig] = useState(false)
  const [genModelsObj, setGenModelsObj] = useState({})
  const [genProvidersObj, setGenProvidersObj] = useState({})
  const [configSubtab, setConfigSubtab] = useState('basic')
  const [costProfitRange, setCostProfitRange] = useState('30d')
  const [costProfitStats, setCostProfitStats] = useState(null)
  const [costProfitLoading, setCostProfitLoading] = useState(false)
  const [costProfitConfigText, setCostProfitConfigText] = useState('{}')
  const [costProfitConfigObj, setCostProfitConfigObj] = useState({})
  const [costProfitLaunchAt, setCostProfitLaunchAt] = useState('')
  const [editingQuotaProviderId, setEditingQuotaProviderId] = useState('')
  const [editingQuotaDraft, setEditingQuotaDraft] = useState({ total_quota: 0, unit_quota_cost: 1, current_balance: 0, enabled: true })
  const [editingCostKey, setEditingCostKey] = useState('')
  const [editingCostValue, setEditingCostValue] = useState('')
  const [selectedGenRow, setSelectedGenRow] = useState('')
  const [editingProviderId, setEditingProviderId] = useState('')
  const [editingProviderDraft, setEditingProviderDraft] = useState({ type: 'wuyin', enabled: true, priority: 100, api_url: '', api_key: '', circuit_fail_threshold: 3, circuit_cooldown_seconds: 60 })
  const [editingModelId, setEditingModelId] = useState('')
  const [editingModelDraft, setEditingModelDraft] = useState({ label: '', capability: 'image', enabled: true, providers: [] })
  const [modelLabelMap, setModelLabelMap] = useState({})

  useEffect(() => { setUserPage(1) }, [userQuery])
  useEffect(() => { setHistoryPage(1) }, [historyQuery])
  useEffect(() => { setBannedWordsPage(1) }, [bannedWordsQuery])

  useEffect(() => { if (tab === 'users') fetchUsers() }, [tab, userPage, userQuery])
  useEffect(() => { if (tab === 'history') fetchHistory() }, [tab, historyPage, historyQuery])
  useEffect(() => { if (tab === 'stats') { fetchSystemStats(statsRange); fetchCostProfitStats(costProfitRange) } }, [tab, statsRange, costProfitRange])
  useEffect(() => { if (tab === 'hosting') { fetchHostingImages(); fetchHostingStats() } }, [tab, hostingPage])
  useEffect(() => { if (tab === 'banned') fetchBannedWords() }, [tab, bannedWordsPage, bannedWordsQuery])
  useEffect(() => { if (tab === 'recharge') fetchRechargeRequests() }, [tab, codesPage, codesSort, codesOrder, rechargeStatusFilter])
  useEffect(() => { if (tab === 'announcements') fetchAnnouncements() }, [tab, announcementPage])
  useEffect(() => { if (tab === 'config') fetchRuntimeConfig() }, [tab])
  useEffect(() => { configAPI.models().then(({ data }) => { const rows = data?.models || []; const m = {}; for (const r of rows) m[r.model_id] = r.label || r.model_id; setModelLabelMap(m) }).catch(() => {}) }, [])

  const fetchUsers = async () => {
    setLoading(true)
    try {
      const { data } = await adminAPI.users(userPage, 20, userQuery || undefined)
      setUsers(data.users)
      setUserTotal(data.total)
    } catch {} finally { setLoading(false) }
  }

  const fetchHistory = async () => {
    setLoading(true)
    try {
      const { data } = await adminAPI.history(historyPage, 20, historyQuery || undefined)
      setHistory(data.items)
      setHistoryTotal(data.total)
      setHistorySummary(data.summary || { total: data.total || 0, pending: 0, queued: 0, processing: 0, running: 0, generating: 0, completed: 0, failed: 0 })
    } catch {} finally { setLoading(false) }
  }
  const fetchSystemStats = async (rangeValue = statsRange) => {
    setLoading(true)
    try {
      const [a, b, c] = await Promise.all([statsAPI.get(), statsAPI.system(), adminAPI.statsOverview(rangeValue)])
      setBizStats(a.data || null)
      setSystemStats(b.data || null)
      setOverviewStats(c.data || null)
    } catch (e) { dialog.alert(e?.message || '系统统计加载失败') } finally { setLoading(false) }
  }

  const fetchHostingStats = async () => {
    try {
      const { data } = await adminAPI.imageStats()
      setHostingStats(data)
    } catch {}
  }
  const fetchRuntimeConfig = async () => {
    setLoading(true)
    try {
      const [baseRes, genRes] = await Promise.all([configAPI.admin(), configAPI.generationAdmin()])
      const data = baseRes.data || {}
      const gen = genRes.data || {}
      setRuntimeConfig({
        api_url: data.api_url || '',
        image_hosting_upload_url: data.image_hosting_upload_url || '',
        image_hosting_base_url: data.image_hosting_base_url || '',
        image_hosting_referer: data.image_hosting_referer || '',
        wechat_pay_qr_url: data.wechat_pay_qr_url || '',
        alipay_pay_qr_url: data.alipay_pay_qr_url || '',
        manual_recharge_notice: data.manual_recharge_notice || '',
        generate_concurrent_limit_per_user: Number(data.generate_concurrent_limit_per_user || 10),
        points_cost_per_generation: Number(data.points_cost_per_generation || 10),
        points_checkin_reward: Number(data.points_checkin_reward || 10),
        points_register_bonus: Number(data.points_register_bonus || 50),
        points_migration_amount: Number(data.points_migration_amount || 50),
        login_rate_limit_per_minute_per_ip: Number(data.login_rate_limit_per_minute_per_ip || 5),
        register_rate_limit_per_minute_per_ip: Number(data.register_rate_limit_per_minute_per_ip || 3),
      })
      const cp = data.cost_profit_config || {}
      setCostProfitConfigObj(cp)
      setCostProfitConfigText(JSON.stringify(cp, null, 2))
      setCostProfitLaunchAt(data.cost_profit_launch_at || '')
      setDefaultModelId(gen.default_model_id || 'image-default')
      const modelsObj = gen.generation_models || {}
      const providersObj = gen.generation_providers || {}
      setGenModelsObj(modelsObj)
      setGenProvidersObj(providersObj)
      setGenerationModelsText(JSON.stringify(modelsObj, null, 2))
      setGenerationProvidersText(JSON.stringify(providersObj, null, 2))
    } catch (e) { dialog.alert(e.message || '加载配置失败') } finally { setLoading(false) }
  }
  const fetchCostProfitStats = async (rangeValue = costProfitRange) => {
    setCostProfitLoading(true)
    try {
      const { data } = await adminAPI.statsCostProfit(rangeValue)
      setCostProfitStats(data || null)
    } catch (e) { dialog.alert(e.message || '成本利润统计加载失败') } finally { setCostProfitLoading(false) }
  }
  const parseCostProfitConfigText = () => {
    try {
      const v = JSON.parse(costProfitConfigText || '{}')
      return v && typeof v === 'object' && !Array.isArray(v) ? v : (costProfitConfigObj || {})
    } catch {
      return costProfitConfigObj || {}
    }
  }
  const applyCostProfitConfigObj = (nextObj) => {
    setCostProfitConfigObj(nextObj)
    setCostProfitConfigText(JSON.stringify(nextObj || {}, null, 2))
  }
  const onConfigInput = (k, v) => setRuntimeConfig(prev => ({ ...prev, [k]: v }))
  const handleSaveConfig = async () => {
    const n = ['generate_concurrent_limit_per_user', 'points_cost_per_generation', 'points_checkin_reward', 'points_register_bonus', 'points_migration_amount', 'login_rate_limit_per_minute_per_ip', 'register_rate_limit_per_minute_per_ip']
    const payload = { ...runtimeConfig }
    for (const k of n) payload[k] = Number(payload[k])
    if (payload.generate_concurrent_limit_per_user < 1 || payload.points_cost_per_generation < 1 || payload.login_rate_limit_per_minute_per_ip < 1 || payload.register_rate_limit_per_minute_per_ip < 1 || payload.points_checkin_reward < 0 || payload.points_register_bonus < 0 || payload.points_migration_amount < 0) { dialog.alert('限制配置不合法'); return }
    let generation_models = {}
    let generation_providers = {}
    try {
      generation_models = JSON.parse(generationModelsText || '{}')
      generation_providers = JSON.parse(generationProvidersText || '{}')
      if (!generation_models || typeof generation_models !== 'object' || Array.isArray(generation_models)) throw new Error('generation_models 需要 JSON 对象')
      if (!generation_providers || typeof generation_providers !== 'object' || Array.isArray(generation_providers)) throw new Error('generation_providers 需要 JSON 对象')
    } catch (e) { dialog.alert(e.message || '模型/供应商配置JSON格式错误'); return }
    if (!generation_models[payload.default_model_id]) { dialog.alert('默认模型ID不存在于 generation_models'); return }
    for (const [modelId, modelCfg] of Object.entries(generation_models)) {
      const pids = Array.isArray(modelCfg?.providers) ? modelCfg.providers : []
      for (const pid of pids) {
        if (!generation_providers[pid]) { dialog.alert(`模型 ${modelId} 引用了不存在的供应商 ${pid}`); return }
      }
    }
    payload.default_model_id = (defaultModelId || '').trim() || 'image-default'
    payload.generation_models = generation_models
    payload.generation_providers = generation_providers
    setConfigSaving(true)
    try {
      await configAPI.update(payload)
      dialog.alert('保存成功')
      fetchRuntimeConfig()
    } catch (e) { dialog.alert(e.message || '保存失败') } finally { setConfigSaving(false) }
  }
  const handleSaveCostProfitConfig = async () => {
    let next = {}
    try {
      next = JSON.parse(costProfitConfigText || '{}')
      if (!next || typeof next !== 'object' || Array.isArray(next)) throw new Error('cost_profit_config 需要 JSON 对象')
    } catch (e) { dialog.alert(e.message || '成本利润配置JSON格式错误'); return }
    setConfigSaving(true)
    try {
      await configAPI.update({ cost_profit_config: next, cost_profit_launch_at: (costProfitLaunchAt || '').trim() })
      dialog.alert('保存成功')
      fetchRuntimeConfig()
      fetchCostProfitStats(costProfitRange)
    } catch (e) { dialog.alert(e.message || '保存失败') } finally { setConfigSaving(false) }
  }
  const syncGenJsonFromForm = (modelsObj, providersObj) => {
    setGenerationModelsText(JSON.stringify(modelsObj, null, 2))
    setGenerationProvidersText(JSON.stringify(providersObj, null, 2))
  }
  const openQuotaEditor = (pid) => {
    const q = (((parseCostProfitConfigText() || {}).provider_quotas || {})[pid]) || {}
    setEditingQuotaProviderId(pid)
    setEditingQuotaDraft({ total_quota: Number(q.total_quota || 0), unit_quota_cost: Number(q.unit_quota_cost || 1), current_balance: Number(q.current_balance || 0), enabled: q.enabled !== false })
  }
  const applyQuotaEditor = () => {
    if (!editingQuotaProviderId) return
    const cp = { ...(parseCostProfitConfigText() || {}) }
    cp.provider_quotas = { ...(cp.provider_quotas || {}), [editingQuotaProviderId]: { total_quota: Number(editingQuotaDraft.total_quota || 0), unit_quota_cost: Number(editingQuotaDraft.unit_quota_cost || 0), current_balance: Number(editingQuotaDraft.current_balance || 0), enabled: editingQuotaDraft.enabled !== false } }
    applyCostProfitConfigObj(cp)
    setEditingQuotaProviderId('')
  }
  const addQuotaLedger = () => {
    if (!editingQuotaProviderId) return
    const delta = Number(window.prompt('输入额度变更值（可正可负）', '0') || 0)
    if (!delta) return
    const note = (window.prompt('备注', '手动调整额度') || '').trim()
    const cp = { ...(parseCostProfitConfigText() || {}) }
    cp.provider_quotas = { ...(cp.provider_quotas || {}) }
    const cur = cp.provider_quotas[editingQuotaProviderId] || { total_quota: 0, unit_quota_cost: 1, current_balance: 0, enabled: true }
    cur.current_balance = Number((Number(cur.current_balance || 0) + delta).toFixed(6))
    cp.provider_quotas[editingQuotaProviderId] = cur
    cp.quota_ledger = [...(Array.isArray(cp.quota_ledger) ? cp.quota_ledger : []), { provider_id: editingQuotaProviderId, change_amount: delta, note, operator: readUser()?.username || 'admin', created_at: new Date().toLocaleString('zh-CN') }]
    applyCostProfitConfigObj(cp)
    setEditingQuotaDraft(prev => ({ ...prev, current_balance: cur.current_balance }))
  }
  const openCostEditor = (modelId, providerId) => {
    const key = `${modelId}__${providerId}`
    const val = (((parseCostProfitConfigText() || {}).model_provider_costs || {})[key])
    setEditingCostKey(key)
    setEditingCostValue(val === undefined ? '' : String(val))
  }
  const applyCostEditor = () => {
    if (!editingCostKey) return
    const n = Number(editingCostValue)
    if (Number.isNaN(n) || n < 0) { dialog.alert('成本必须是>=0的数字'); return }
    const cp = { ...(parseCostProfitConfigText() || {}) }
    cp.model_provider_costs = { ...(cp.model_provider_costs || {}), [editingCostKey]: n }
    applyCostProfitConfigObj(cp)
    setEditingCostKey('')
    setEditingCostValue('')
  }
  const handleAddModel = () => {
    const id = `image-model-${Date.now()}`
    const next = { ...genModelsObj, [id]: { label: '新模型', capability: 'image', enabled: true, providers: [] } }
    setGenModelsObj(next); syncGenJsonFromForm(next, genProvidersObj)
  }
  const handleDeleteModel = (id) => {
    const next = { ...genModelsObj }
    delete next[id]
    setGenModelsObj(next)
    if (defaultModelId === id) setDefaultModelId(Object.keys(next)[0] || 'image-default')
    if (selectedGenRow === `m:${id}`) setSelectedGenRow('')
    syncGenJsonFromForm(next, genProvidersObj)
  }
  const handleRenameModel = (oldId, newId) => {
    const nid = (newId || '').trim()
    if (!nid || nid === oldId) return
    if (genModelsObj[nid]) { dialog.alert('模型ID已存在'); return }
    const next = {}
    for (const [k, v] of Object.entries(genModelsObj)) next[k === oldId ? nid : k] = v
    setGenModelsObj(next)
    if (defaultModelId === oldId) setDefaultModelId(nid)
    syncGenJsonFromForm(next, genProvidersObj)
  }
  const handleModelField = (id, key, value) => {
    const next = { ...genModelsObj, [id]: { ...(genModelsObj[id] || {}), [key]: value } }
    setGenModelsObj(next); syncGenJsonFromForm(next, genProvidersObj)
  }
  const handleModelProviders = (id, providersCsv) => {
    const providers = (providersCsv || '').split(',').map(s => s.trim()).filter(Boolean)
    const next = { ...genModelsObj, [id]: { ...(genModelsObj[id] || {}), providers } }
    setGenModelsObj(next); syncGenJsonFromForm(next, genProvidersObj)
  }
  const handleAddProvider = () => {
    const id = `provider-${Date.now()}`
    const next = { ...genProvidersObj, [id]: { type: 'wuyin', enabled: true, priority: 100, api_url: '', api_key: '', circuit_fail_threshold: 3, circuit_cooldown_seconds: 60 } }
    setGenProvidersObj(next); syncGenJsonFromForm(genModelsObj, next)
  }
  const handleDeleteProvider = (id) => {
    const next = { ...genProvidersObj }
    delete next[id]
    const nextModels = {}
    for (const [mid, m] of Object.entries(genModelsObj)) nextModels[mid] = { ...m, providers: (Array.isArray(m?.providers) ? m.providers : []).filter(pid => pid !== id) }
    if (selectedGenRow === `p:${id}`) setSelectedGenRow('')
    setGenProvidersObj(next); setGenModelsObj(nextModels); syncGenJsonFromForm(nextModels, next)
  }
  const handleRenameProvider = (oldId, newId) => {
    const nid = (newId || '').trim()
    if (!nid || nid === oldId) return
    if (genProvidersObj[nid]) { dialog.alert('供应商ID已存在'); return }
    const next = {}
    for (const [k, v] of Object.entries(genProvidersObj)) next[k === oldId ? nid : k] = v
    const nextModels = {}
    for (const [mid, m] of Object.entries(genModelsObj)) nextModels[mid] = { ...m, providers: (Array.isArray(m?.providers) ? m.providers : []).map(pid => pid === oldId ? nid : pid) }
    setGenProvidersObj(next); setGenModelsObj(nextModels); syncGenJsonFromForm(nextModels, next)
  }
  const handleProviderField = (id, key, value) => {
    const next = { ...genProvidersObj, [id]: { ...(genProvidersObj[id] || {}), [key]: value } }
    setGenProvidersObj(next); syncGenJsonFromForm(genModelsObj, next)
  }
  const openProviderEditor = (id) => {
    const p = genProvidersObj[id] || {}
    setEditingProviderId(id)
    setEditingProviderDraft({ type: p.type || 'wuyin', enabled: p.enabled !== false, priority: Number(p.priority ?? 100), api_url: p.api_url || '', api_key: p.api_key || '', circuit_fail_threshold: Number(p.circuit_fail_threshold ?? 3), circuit_cooldown_seconds: Number(p.circuit_cooldown_seconds ?? 60) })
  }
  const openModelEditor = (id) => {
    const m = genModelsObj[id] || {}
    setEditingModelId(id)
    setEditingModelDraft({ label: m.label || '', capability: m.capability || 'image', enabled: m.enabled !== false, providers: Array.isArray(m.providers) ? m.providers : [] })
  }
  const applyProviderEditor = () => {
    if (!editingProviderId) return
    const next = { ...genProvidersObj, [editingProviderId]: { ...(genProvidersObj[editingProviderId] || {}), ...editingProviderDraft } }
    setGenProvidersObj(next); syncGenJsonFromForm(genModelsObj, next); setEditingProviderId('')
  }
  const applyModelEditor = () => {
    if (!editingModelId) return
    const next = { ...genModelsObj, [editingModelId]: { ...(genModelsObj[editingModelId] || {}), ...editingModelDraft, providers: Array.isArray(editingModelDraft.providers) ? editingModelDraft.providers : [] } }
    setGenModelsObj(next); syncGenJsonFromForm(next, genProvidersObj); setEditingModelId('')
  }
  const handleCopySelectedGenRow = () => {
    if (!selectedGenRow) { dialog.alert('请先选择一行'); return }
    if (selectedGenRow.startsWith('m:')) {
      const id = selectedGenRow.slice(2)
      const src = genModelsObj[id]
      if (!src) return
      const nid = `${id}-copy-${Date.now()}`
      const next = { ...genModelsObj, [nid]: { ...src, label: `${src.label || id} 副本` } }
      setGenModelsObj(next); syncGenJsonFromForm(next, genProvidersObj); setSelectedGenRow(`m:${nid}`)
      return
    }
    if (selectedGenRow.startsWith('p:')) {
      const id = selectedGenRow.slice(2)
      const src = genProvidersObj[id]
      if (!src) return
      const nid = `${id}-copy-${Date.now()}`
      const next = { ...genProvidersObj, [nid]: { ...src } }
      setGenProvidersObj(next); syncGenJsonFromForm(genModelsObj, next); setSelectedGenRow(`p:${nid}`)
    }
  }
  const handleApplyAdvanced = () => {
    try {
      const m = JSON.parse(generationModelsText || '{}')
      const p = JSON.parse(generationProvidersText || '{}')
      if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('generation_models 不是对象')
      if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('generation_providers 不是对象')
      setGenModelsObj(m); setGenProvidersObj(p); dialog.alert('已应用高级JSON到表单')
    } catch (e) { dialog.alert(e.message || 'JSON格式错误') }
  }


  const fetchAnnouncements = async () => {
    setLoading(true)
    try {
      const { data } = await announcementAPI.list(announcementPage, 20)
      setAnnouncements(data.items)
      setAnnouncementTotal(data.total)
    } catch {} finally { setLoading(false) }
  }

  const handleCreateAnnouncement = async () => {
    if (!newTitle.trim() || !newContent.trim()) return
    setCreatingAnnouncement(true)
    try {
      await announcementAPI.create({ title: newTitle.trim(), content: newContent.trim() })
      setNewTitle(''); setNewContent('')
      fetchAnnouncements()
    } catch (e) {
      dialog.alert(e.message || '发布失败')
    } finally { setCreatingAnnouncement(false) }
  }

  const handleDeleteAnnouncement = async (id) => {
    if (!await dialog.confirm('确定删除此公告？')) return
    try {
      await announcementAPI.delete(id)
      fetchAnnouncements()
    } catch (e) { dialog.alert(e.message || '删除失败') }
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
      dialog.alert(e.message || '添加失败')
    }
  }

  const handleDeleteBannedWord = async (wordId, word) => {
    if (!await dialog.confirm(`确定删除违禁词 "${word}"？`)) return
    try {
      await adminAPI.deleteBannedWord(wordId)
      fetchBannedWords()
    } catch (e) { dialog.alert(e.message || '删除失败') }
  }

  const fetchRechargeRequests = async () => {
    setLoading(true)
    try {
      const [listRes, pendingRes] = await Promise.allSettled([adminAPI.rechargeRequests(codesPage, 20, rechargeStatusFilter === 'all' ? undefined : rechargeStatusFilter, undefined, codesSort, codesOrder), adminAPI.rechargeRequests(1, 1, 'pending')])
      if (listRes.status === 'fulfilled') { setCodes(listRes.value.data.items); setCodesTotal(listRes.value.data.total) }
      if (pendingRes.status === 'fulfilled') setRechargePendingCount(pendingRes.value.data.total || 0)
    } catch {} finally { setLoading(false) }
  }

  const handleApproveRecharge = async (id) => {
    const points = parseInt(reviewPoints) || 0
    if (points <= 0) { dialog.alert('发放积分必须大于0'); return }
    try {
      await adminAPI.approveRecharge(id, { points, review_note: reviewNote || '审核通过' })
      setReviewModal(null); setReviewNote(''); setReviewPoints('')
      fetchRechargeRequests()
    } catch (e) { dialog.alert(e.message || '操作失败') }
  }

  const handleRejectRecharge = async (id) => {
    if (!reviewNote.trim()) { dialog.alert('拒绝原因不能为空'); return }
    try {
      await adminAPI.rejectRecharge(id, { review_note: reviewNote })
      setReviewModal(null); setReviewNote('')
      fetchRechargeRequests()
    } catch (e) { dialog.alert(e.message || '操作失败') }
  }

  const handleGenerateCodes = async () => {
    if (codePoints <= 0) return
    setGeneratingCodes(true)
    try {
      const { data } = await adminAPI.generateCodes({ count: codeCount, points: codePoints, custom_code: customCode.trim() || undefined })
      setGeneratedCodes(data.codes)
      setCustomCode('')
      fetchRechargeRequests()
    } catch (e) {
      dialog.alert(e.message || '生成失败')
    } finally { setGeneratingCodes(false) }
  }

  const handleDeleteCode = async (codeId, code) => {
    if (!await dialog.confirm(`确定删除兑换码 "${code}"？`)) return
    try {
      await adminAPI.deleteCode(codeId)
      fetchRechargeRequests()
    } catch (e) { dialog.alert(e.message || '删除失败') }
  }

  const handleAdjustPoints = async (userId) => {
    const amount = parseInt(adjustAmount)
    if (!amount) return
    try {
      await adminAPI.adjustPoints(userId, { amount, description: adjustDesc || '管理员调整' })
      setAdjustUserId(null); setAdjustAmount(''); setAdjustDesc('')
      fetchUsers()
    } catch (e) { dialog.alert(e.message || '调整失败') }
  }

  const handleMigratePoints = async () => {
    if (!await dialog.confirm('确认给所有现有用户（积分=0）补发 50 积分？')) return
    try {
      const { data } = await adminAPI.migratePoints()
      dialog.alert(data.message)
      fetchUsers()
    } catch (e) { dialog.alert(e.message || '操作失败') }
  }

  const handleBatchImport = async () => {
    const text = batchImportText.trim()
    if (!text) return
    setBatchImporting(true)
    try {
      const { data } = await adminAPI.batchImportBannedWords(text)
      dialog.alert(data.message)
      setShowBatchImport(false)
      setBatchImportText('')
      fetchBannedWords()
    } catch (e) {
      dialog.alert(e.message || '导入失败')
    } finally {
      setBatchImporting(false)
    }
  }

  const handleHostingBatchDelete = useCallback(async () => {
    if (!await dialog.confirm(`确定删除选中的 ${hostingChecked.size} 个图床映射？`)) return
    const urls = hostingImages.filter(i => hostingChecked.has(i.url)).map(i => i.url)
    try {
      await adminAPI.batchDeleteHosting(urls)
      setHostingChecked(new Set()); setHostingSelectMode(false)
      fetchHostingImages(); fetchHostingStats()
    } catch (e) { dialog.alert(e.message || '删除失败') }
  }, [hostingChecked, hostingImages])

  const handleCleanDuplicates = async () => {
    if (!await dialog.confirm('确定清理重复的图床映射？将基于URL去重，保留最早的记录。')) return
    try {
      const { data } = await adminAPI.cleanDuplicates()
      dialog.alert(`清理完成，删除了 ${data.deleted} 条重复记录`)
      fetchHostingImages(); fetchHostingStats()
    } catch (e) {
      dialog.alert(e.message || '清理失败')
    }
  }

  const handleDeleteHistory = async (taskId) => {
    if (!await dialog.confirm('确定删除此任务？')) return
    try {
      await adminAPI.deleteHistory(taskId)
      fetchHistory()
    } catch (e) { dialog.alert(e.message || '删除失败') }
  }

  const handleToggleFreeze = async (userId, username) => {
    try {
      const { data } = await adminAPI.toggleFreeze(userId)
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, is_frozen: data.is_frozen } : u))
    } catch {}
  }

  const handleDeleteUser = async (userId, username) => {
    if (!await dialog.confirm(`确定删除用户 "${username}"？该用户的所有广场图片也会被删除。`)) return
    try {
      await adminAPI.deleteUser(userId)
      fetchUsers()
    } catch (e) { dialog.alert(e.message || '删除失败') }
  }

  const handleResetPassword = async (userId) => {
    if (!resetPwdValue.trim()) return
    if (resetPwdValue.length < 6) { dialog.alert('密码长度至少6位'); return }
    try {
      await adminAPI.resetPassword(userId, resetPwdValue)
      dialog.alert('密码重置成功')
      setResetPwdUserId(null)
      setResetPwdValue('')
    } catch (e) { dialog.alert(e.message || '重置失败') }
  }

  const toggleHostingCheck = useCallback((filename) => {
    setHostingChecked(prev => { const next = new Set(prev); next.has(filename) ? next.delete(filename) : next.add(filename); return next })
  }, [])

  const user = readUser()
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
      <div className="admin-dense flex-1 overflow-y-auto p-3 sm:p-4">
        <div className="flex gap-1 p-0.5 rounded-lg mb-4 overflow-x-auto scrollbar-hide" style={{ background: 'var(--border-color)', scrollbarWidth: 'none' }}>
          {[{ k: 'stats', l: '系统统计', i: BarChart3 }, { k: 'users', l: '用户管理', i: Users }, { k: 'history', l: '生成历史', i: Clock }, { k: 'hosting', l: '图床管理', i: HardDrive }, { k: 'banned', l: '违禁词管理', i: Ban }, { k: 'recharge', l: '充值审核', i: Wallet }, { k: 'announcements', l: '公告管理', i: Megaphone }, { k: 'config', l: '配置中心', i: SlidersHorizontal }].map(({ k, l, i: Icon }) => (
            <button key={k} onClick={() => setTab(k)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${tab === k ? 'bg-white dark:bg-gray-800 shadow-sm' : ''}`}
              style={{ color: tab === k ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
              <Icon size={14} />{l}{k === 'recharge' && rechargePendingCount > 0 && <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] text-white" style={{ background: '#ef4444' }}>{rechargePendingCount}</span>}
            </button>
          ))}
        </div>

        {tab === 'stats' ? (
          <div>
            {loading ? (
              <div className="flex justify-center py-20">
                <div className="w-8 h-8 border-2 rounded-full animate-spin-slow" style={{ borderTopColor: 'var(--accent)', borderColor: 'var(--border-color)' }} />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  {[
                    { v: 'all', l: '总计' },
                    { v: 'today', l: '今日' },
                    { v: '7d', l: '7天' },
                    { v: '30d', l: '30天' },
                  ].map(i => (
                    <button key={i.v} onClick={() => { if (statsRange === i.v) return; setStatsRange(i.v); fetchSystemStats(i.v) }} className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${statsRange === i.v ? 'text-white border-transparent' : ''}`} style={statsRange === i.v ? { background: 'var(--accent)' } : { borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>{i.l}</button>
                  ))}
                  <div className="ml-auto text-xs" style={{ color: 'var(--text-secondary)' }}>{overviewStats?.start_date || '-'} ~ {overviewStats?.end_date || '-'}</div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                  <div className="p-3 rounded-xl border" style={{ borderColor: 'var(--border-color)' }}><div className="text-xs" style={{ color: 'var(--text-secondary)' }}>请求数</div><div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{overviewStats?.kpi?.requests ?? 0}</div></div>
                  <div className="p-3 rounded-xl border" style={{ borderColor: 'var(--border-color)' }}><div className="text-xs" style={{ color: 'var(--text-secondary)' }}>成功数</div><div className="text-lg font-semibold" style={{ color: '#22c55e' }}>{overviewStats?.kpi?.success ?? 0}</div></div>
                  <div className="p-3 rounded-xl border" style={{ borderColor: 'var(--border-color)' }}><div className="text-xs" style={{ color: 'var(--text-secondary)' }}>成功率</div><div className="text-lg font-semibold" style={{ color: '#22c55e' }}>{overviewStats?.kpi?.success_rate ?? 0}%</div></div>
                  <div className="p-3 rounded-xl border" style={{ borderColor: 'var(--border-color)' }}><div className="text-xs" style={{ color: 'var(--text-secondary)' }}>平均耗时</div><div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{overviewStats?.kpi?.avg_duration_seconds ?? 0}s</div></div>
                  <div className="p-3 rounded-xl border" style={{ borderColor: 'var(--border-color)' }}><div className="text-xs" style={{ color: 'var(--text-secondary)' }}>新增用户</div><div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{overviewStats?.kpi?.new_users ?? 0}</div></div>
                  <div className="p-3 rounded-xl border" style={{ borderColor: 'var(--border-color)' }}><div className="text-xs" style={{ color: 'var(--text-secondary)' }}>活跃用户</div><div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{overviewStats?.kpi?.active_users ?? 0}</div></div>
                  <div className="p-3 rounded-xl border" style={{ borderColor: 'var(--border-color)' }}><div className="text-xs" style={{ color: 'var(--text-secondary)' }}>处理中</div><div className="text-lg font-semibold" style={{ color: '#f59e0b' }}>{overviewStats?.kpi?.processing_tasks ?? 0}</div></div>
                  <div className="p-3 rounded-xl border" style={{ borderColor: 'var(--border-color)' }}><div className="text-xs" style={{ color: 'var(--text-secondary)' }}>积分消耗</div><div className="text-lg font-semibold" style={{ color: '#ef4444' }}>{(overviewStats?.trends_30d || []).reduce((s, i) => s + Number(i.points_spent || 0), 0)}</div></div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                  <div className="p-3 rounded-xl border lg:col-span-2" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>30天趋势</div>
                      {[
                        { v: 'requests', l: '请求' },
                        { v: 'success', l: '成功' },
                        { v: 'new_users', l: '新增用户' },
                        { v: 'revenue', l: '营收' },
                        { v: 'points_spent', l: '积分消耗' },
                      ].map(i => (
                        <button key={i.v} onClick={() => setTrendMetric(i.v)} className={`px-2 py-1 rounded text-[11px] border ${trendMetric === i.v ? 'text-white border-transparent' : ''}`} style={trendMetric === i.v ? { background: 'var(--accent)' } : { borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>{i.l}</button>
                      ))}
                    </div>
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={overviewStats?.trends_30d || []} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                          <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} />
                          <YAxis tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} />
                          <Tooltip />
                          <Line type="monotone" dataKey={trendMetric} stroke="var(--accent)" strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <div className="p-3 rounded-xl border" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>充值实收</div>
                    <div className="space-y-2 text-sm">
                      <div style={{ color: 'var(--text-primary)' }}>今日：¥{overviewStats?.revenue?.today_amount ?? 0} / {overviewStats?.revenue?.today_orders ?? 0}单</div>
                      <div style={{ color: 'var(--text-primary)' }}>7天：¥{overviewStats?.revenue?.days7_amount ?? 0} / {overviewStats?.revenue?.days7_orders ?? 0}单</div>
                      <div style={{ color: 'var(--text-primary)' }}>30天：¥{overviewStats?.revenue?.days30_amount ?? 0} / {overviewStats?.revenue?.days30_orders ?? 0}单</div>
                    </div>
                    <div className="text-xs mt-4 mb-2" style={{ color: 'var(--text-secondary)' }}>用户盘子</div>
                    <div className="space-y-1 text-sm">
                      <div style={{ color: 'var(--text-primary)' }}>总用户：{overviewStats?.users?.total ?? 0}</div>
                      <div style={{ color: 'var(--text-primary)' }}>冻结：{overviewStats?.users?.frozen ?? 0} ({overviewStats?.users?.frozen_rate ?? 0}%)</div>
                      <div style={{ color: 'var(--text-primary)' }}>管理员：{overviewStats?.users?.admins ?? 0}</div>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl border" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>近30天生成Top用户</div>
                    <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                      {(overviewStats?.leaderboards?.success_top || []).slice(0, 8).map((i, idx) => <div key={`s-${i.user_id}`} className="flex items-center justify-between text-sm gap-2"><span className="truncate" title={`${i.nickname || i.username}`} style={{ color: 'var(--text-primary)' }}>{idx + 1}. {i.nickname || i.username}</span><span className="shrink-0" style={{ color: '#22c55e' }}>{i.success_count}</span></div>)}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl border" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>近30天充值Top用户</div>
                    <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                      {(overviewStats?.leaderboards?.recharge_top || []).slice(0, 8).map((i, idx) => <div key={`r-${i.user_id}`} className="flex items-center justify-between text-sm gap-2"><span className="truncate" title={`${i.nickname || i.username}`} style={{ color: 'var(--text-primary)' }}>{idx + 1}. {i.nickname || i.username}</span><span className="shrink-0" style={{ color: '#f59e0b' }}>¥{i.amount}</span></div>)}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl border" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>提示词分类（管理员全量）</div>
                    <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                      {(overviewStats?.categories?.admin_all || []).slice(0, 10).map(i => <div key={`a-${i.category}`} className="flex items-center justify-between text-sm gap-2"><span className="truncate" title={`${i.category}`} style={{ color: 'var(--text-primary)' }}>{i.category}</span><span className="shrink-0" style={{ color: 'var(--text-secondary)' }}>{i.count}</span></div>)}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl border" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>提示词分类（用户可见，已排除冻结）</div>
                    <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                      {(overviewStats?.categories?.user_visible || []).slice(0, 10).map(i => <div key={`u-${i.category}`} className="flex items-center justify-between text-sm gap-2"><span className="truncate" title={`${i.category}`} style={{ color: 'var(--text-primary)' }}>{i.category}</span><span className="shrink-0" style={{ color: 'var(--text-secondary)' }}>{i.count}</span></div>)}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl border" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>模型调用分布</div>
                    <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                      {(overviewStats?.generation?.models || []).slice(0, 12).map(i => <div key={`m-${i.model_id}`} className="flex items-center justify-between text-sm gap-2"><span className="truncate" title={`${i.model_label || modelLabelMap[i.model_id] || i.model_id}`} style={{ color: 'var(--text-primary)' }}>{i.model_label || modelLabelMap[i.model_id] || i.model_id}</span><span className="shrink-0" style={{ color: 'var(--text-secondary)' }}>{i.total} / {i.success_rate}%</span></div>)}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl border" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>渠道调用分布</div>
                    <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                      {(overviewStats?.generation?.providers || []).slice(0, 12).map(i => <div key={`p-${i.provider_id}`} className="flex items-center justify-between text-sm gap-2"><span className="truncate" title={`${i.provider_id}`} style={{ color: 'var(--text-primary)' }}>{`${i.provider_id === 'unknown' ? 'unknown(历史缺失)' : i.provider_id} (${i.provider_type})`}</span><span className="shrink-0" style={{ color: 'var(--text-secondary)' }}>{i.total} / {i.success_rate}%</span></div>)}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl border" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>渠道类型汇总</div>
                    <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                      {(overviewStats?.generation?.provider_types || []).slice(0, 12).map(i => <div key={`t-${i.provider_type}`} className="flex items-center justify-between text-sm gap-2"><span className="truncate" title={`${i.provider_type}`} style={{ color: 'var(--text-primary)' }}>{i.provider_type}</span><span className="shrink-0" style={{ color: 'var(--text-secondary)' }}>{i.total} / {i.success_rate}%</span></div>)}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl border" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>Fallback 尝试</div>
                    <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                      {(overviewStats?.generation?.fallback_attempts || []).slice(0, 12).map(i => <div key={`f-${i.provider_id}`} className="flex items-center justify-between text-sm gap-2"><span className="truncate" title={`${i.provider_id}`} style={{ color: 'var(--text-primary)' }}>{`${i.provider_id === 'unknown' ? 'unknown(历史缺失)' : i.provider_id} (${i.provider_type})`}</span><span className="shrink-0" style={{ color: 'var(--text-secondary)' }}>{i.attempts} / {i.attempt_ok_rate}%</span></div>)}
                    </div>
                  </div>
                </div>
                <div className="p-3 rounded-xl border" style={{ borderColor: 'var(--border-color)' }}>
                  <div className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>模型 × 渠道交叉矩阵（总量/成功率）</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr>
                          <th className="px-2 py-1.5 text-left font-medium sticky left-0 z-10" style={{ color: 'var(--text-secondary)', background: 'var(--bg-secondary)' }}>模型\\渠道</th>
                          {(overviewStats?.generation?.matrix?.providers || []).map(pid => <th key={`mxh-${pid}`} className="px-2 py-1.5 text-right font-medium whitespace-nowrap" style={{ color: 'var(--text-secondary)', background: 'var(--bg-secondary)' }}>{pid}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {(overviewStats?.generation?.matrix?.models || []).slice(0, 12).map(mid => (
                          <tr key={`mxr-${mid}`} className="border-t" style={{ borderColor: 'var(--border-color)' }}>
                            <td className="px-2 py-1.5 sticky left-0 z-10 whitespace-nowrap" style={{ color: 'var(--text-primary)', background: 'var(--bg-primary)' }}>{overviewStats?.generation?.matrix?.model_labels?.[mid] || modelLabelMap[mid] || mid}</td>
                            {(overviewStats?.generation?.matrix?.providers || []).map(pid => {
                              const cell = overviewStats?.generation?.matrix?.cells?.[mid]?.[pid]
                              return <td key={`mxc-${mid}-${pid}`} className="px-2 py-1.5 text-right whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{cell ? `${cell.total} / ${cell.success_rate}%` : '-'}</td>
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                {systemStats?.limits && (
                  <div className="p-3 rounded-xl border" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>当前限制</div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                      <div style={{ color: 'var(--text-primary)' }}>登录限流：{systemStats.limits.login_rate}</div>
                      <div style={{ color: 'var(--text-primary)' }}>注册限流：{systemStats.limits.register_rate}</div>
                      <div style={{ color: 'var(--text-primary)' }}>生成并发：{systemStats.limits.generate_concurrent}</div>
                      <div style={{ color: 'var(--text-primary)' }}>单次扣分：{systemStats.limits.points_cost_per_generation}</div>
                      <div style={{ color: 'var(--text-primary)' }}>签到奖励：{systemStats.limits.points_checkin_reward}</div>
                      <div style={{ color: 'var(--text-primary)' }}>注册送分：{systemStats.limits.points_register_bonus}</div>
                    </div>
                  </div>
                )}
                <div className="p-3 rounded-xl border" style={{ borderColor: 'var(--border-color)' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>成本利润</div>
                    {['today', '7d', '30d', 'all'].map(v => <button key={v} onClick={() => setCostProfitRange(v)} className={`px-2 py-1 rounded text-[11px] border ${costProfitRange === v ? 'text-white border-transparent' : ''}`} style={costProfitRange === v ? { background: 'var(--accent)' } : { borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>{v}</button>)}
                    <button onClick={handleSaveCostProfitConfig} disabled={configSaving} className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium bg-accent text-white hover:opacity-90 disabled:opacity-50">{configSaving ? '保存中...' : '保存成本配置'}</button>
                  </div>
                  {costProfitLoading ? <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>加载中...</div> : (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                        <div><div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>总收入</div><div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>¥{costProfitStats?.summary?.revenue_amount ?? 0}</div></div>
                        <div><div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>总成本</div><div className="text-sm font-semibold" style={{ color: '#ef4444' }}>¥{costProfitStats?.summary?.cost_amount ?? 0}</div></div>
                        <div><div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>利润</div><div className="text-sm font-semibold" style={{ color: '#22c55e' }}>¥{costProfitStats?.summary?.profit_amount ?? 0}</div></div>
                        <div><div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>利润率</div><div className="text-sm font-semibold" style={{ color: '#22c55e' }}>{costProfitStats?.summary?.profit_rate ?? 0}%</div></div>
                        <div><div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>未定价调用</div><div className="text-sm font-semibold" style={{ color: '#f59e0b' }}>{costProfitStats?.summary?.unpriced_calls ?? 0}</div></div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>统计起始时间(cost_profit_launch_at)</label>
                          <input type="text" value={costProfitLaunchAt} onChange={e => setCostProfitLaunchAt(e.target.value)} placeholder="2026-05-04 00:00:00" className="w-full px-3 py-2 rounded-lg text-xs border outline-none font-mono" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                        </div>
                        <div>
                          <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>cost_profit_config(JSON对象)</label>
                          <textarea value={costProfitConfigText} onChange={e => setCostProfitConfigText(e.target.value)} rows={4} className="w-full px-3 py-2 rounded-lg text-xs border resize-none outline-none font-mono" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <div className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>渠道额度与成本</div>
                        <table className="w-full text-xs"><thead><tr><th className="px-2 py-1.5 text-left" style={{ color: 'var(--text-secondary)' }}>渠道</th><th className="px-2 py-1.5 text-right" style={{ color: 'var(--text-secondary)' }}>调用</th><th className="px-2 py-1.5 text-right" style={{ color: 'var(--text-secondary)' }}>成本</th><th className="px-2 py-1.5 text-right" style={{ color: 'var(--text-secondary)' }}>当前额度</th><th className="px-2 py-1.5 text-right" style={{ color: 'var(--text-secondary)' }}>单次额度</th><th className="px-2 py-1.5 text-right" style={{ color: 'var(--text-secondary)' }}>剩余次数</th><th className="px-2 py-1.5 text-right" style={{ color: 'var(--text-secondary)' }}>操作</th></tr></thead><tbody>{(costProfitStats?.providers || []).map(p => <tr key={p.provider_id} className="border-t" style={{ borderColor: 'var(--border-color)' }}><td className="px-2 py-1.5" style={{ color: 'var(--text-primary)' }}>{p.provider_id}</td><td className="px-2 py-1.5 text-right" style={{ color: 'var(--text-secondary)' }}>{p.calls}</td><td className="px-2 py-1.5 text-right" style={{ color: 'var(--text-secondary)' }}>¥{p.cost_amount}</td><td className="px-2 py-1.5 text-right" style={{ color: 'var(--text-secondary)' }}>{p.current_balance}</td><td className="px-2 py-1.5 text-right" style={{ color: 'var(--text-secondary)' }}>{p.unit_quota_cost}</td><td className="px-2 py-1.5 text-right" style={{ color: 'var(--text-secondary)' }}>{p.remaining_times}</td><td className="px-2 py-1.5 text-right"><button onClick={() => openQuotaEditor(p.provider_id)} className="px-2 py-1 rounded text-[11px] border" style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}>编辑</button></td></tr>)}</tbody></table>
                      </div>
                      <div className="overflow-x-auto">
                        <div className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>模型×渠道成本</div>
                        <table className="w-full text-xs"><thead><tr><th className="px-2 py-1.5 text-left" style={{ color: 'var(--text-secondary)' }}>模型</th><th className="px-2 py-1.5 text-left" style={{ color: 'var(--text-secondary)' }}>渠道</th><th className="px-2 py-1.5 text-right" style={{ color: 'var(--text-secondary)' }}>调用</th><th className="px-2 py-1.5 text-right" style={{ color: 'var(--text-secondary)' }}>单次成本</th><th className="px-2 py-1.5 text-right" style={{ color: 'var(--text-secondary)' }}>成本汇总</th><th className="px-2 py-1.5 text-right" style={{ color: 'var(--text-secondary)' }}>操作</th></tr></thead><tbody>{(costProfitStats?.matrix || []).map(i => <tr key={`${i.model_id}-${i.provider_id}`} className="border-t" style={{ borderColor: 'var(--border-color)' }}><td className="px-2 py-1.5" style={{ color: 'var(--text-primary)' }}>{modelLabelMap[i.model_id] || i.model_id}</td><td className="px-2 py-1.5" style={{ color: 'var(--text-primary)' }}>{i.provider_id}</td><td className="px-2 py-1.5 text-right" style={{ color: 'var(--text-secondary)' }}>{i.calls}</td><td className="px-2 py-1.5 text-right" style={{ color: i.priced ? 'var(--text-secondary)' : '#f59e0b' }}>{i.priced ? i.unit_cost : '未定价'}</td><td className="px-2 py-1.5 text-right" style={{ color: 'var(--text-secondary)' }}>¥{i.cost_amount}</td><td className="px-2 py-1.5 text-right"><button onClick={() => openCostEditor(i.model_id, i.provider_id)} className="px-2 py-1 rounded text-[11px] border" style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}>定价</button></td></tr>)}</tbody></table>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : tab === 'users' ? (
          <AdminUsersTab userTotal={userTotal} userQuery={userQuery} setUserQuery={setUserQuery} handleMigratePoints={handleMigratePoints} loading={loading} users={users} setAdjustUserId={setAdjustUserId} setAdjustAmount={setAdjustAmount} setAdjustDesc={setAdjustDesc} resetPwdUserId={resetPwdUserId} setResetPwdUserId={setResetPwdUserId} resetPwdValue={resetPwdValue} setResetPwdValue={setResetPwdValue} handleToggleFreeze={handleToggleFreeze} handleDeleteUser={handleDeleteUser} handleResetPassword={handleResetPassword} userPage={userPage} setUserPage={setUserPage} />
        ) : tab === 'announcements' ? (
          <AdminAnnouncementsTab newTitle={newTitle} setNewTitle={setNewTitle} newContent={newContent} setNewContent={setNewContent} handleCreateAnnouncement={handleCreateAnnouncement} creatingAnnouncement={creatingAnnouncement} announcementTotal={announcementTotal} loading={loading} announcements={announcements} handleDeleteAnnouncement={handleDeleteAnnouncement} announcementPage={announcementPage} setAnnouncementPage={setAnnouncementPage} />
        ) : tab === 'hosting' ? (
          <AdminHostingTab hostingStats={hostingStats} handleCleanDuplicates={handleCleanDuplicates} hostingTotal={hostingTotal} hostingSelectMode={hostingSelectMode} hostingChecked={hostingChecked} hostingImages={hostingImages} setHostingChecked={setHostingChecked} handleHostingBatchDelete={handleHostingBatchDelete} setHostingSelectMode={setHostingSelectMode} loading={loading} toggleHostingCheck={toggleHostingCheck} setHostingDetail={setHostingDetail} hostingPage={hostingPage} setHostingPage={setHostingPage} />
        ) : tab === 'banned' ? (
          <AdminBannedTab bannedWordsTotal={bannedWordsTotal} bannedWordsQuery={bannedWordsQuery} setBannedWordsQuery={setBannedWordsQuery} setShowBatchImport={setShowBatchImport} newBannedWord={newBannedWord} setNewBannedWord={setNewBannedWord} handleAddBannedWord={handleAddBannedWord} loading={loading} bannedWords={bannedWords} handleDeleteBannedWord={handleDeleteBannedWord} bannedWordsPage={bannedWordsPage} setBannedWordsPage={setBannedWordsPage} />
        ) : tab === 'recharge' ? (
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

            {/* 充值记录 */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>充值记录</h3>
                  {rechargePendingCount > 0 && <span className="px-2 py-0.5 rounded-full text-[11px] text-white" style={{ background: '#ef4444' }}>待审 {rechargePendingCount}</span>}
                </div>
                <div className="flex items-center gap-1.5">
                  {rechargePendingCount > 0 && rechargeStatusFilter !== 'pending' && <button onClick={() => { setRechargeStatusFilter('pending'); setCodesPage(1) }} className="px-2 py-1 rounded-lg text-xs font-medium text-white" style={{ background: '#ef4444' }}>只看待审</button>}
                  <select value={rechargeStatusFilter} onChange={e => { setRechargeStatusFilter(e.target.value); setCodesPage(1) }}
                    className="px-2 py-1 rounded-lg text-xs font-medium border outline-none cursor-pointer"
                    style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                    <option value="all">全部</option>
                    <option value="pending">待审核</option>
                    <option value="approved">已通过</option>
                    <option value="rejected">已拒绝</option>
                  </select>
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
              {rechargePendingCount > 0 && (
                <div className="mb-3 px-3 py-2 rounded-xl border text-sm flex items-center justify-between gap-3" style={{ borderColor: '#f59e0b', background: 'rgba(245,158,11,0.12)', color: '#b45309' }}>
                  <span>当前有 {rechargePendingCount} 条充值申请待审核。</span>
                  <button onClick={() => { setRechargeStatusFilter('pending'); setCodesPage(1) }} className="px-2 py-1 rounded-lg text-xs font-medium text-white" style={{ background: '#f59e0b' }}>直达待审</button>
                </div>
              )}
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
                          <th className="px-4 py-3 text-left font-semibold" style={{ color: 'var(--text-secondary)' }}>用户</th>
                          <th className="px-4 py-3 text-center font-semibold" style={{ color: 'var(--text-secondary)' }}>渠道</th>
                          <th className="px-4 py-3 text-right font-semibold" style={{ color: 'var(--text-secondary)' }}>金额</th>
                          <th className="px-4 py-3 text-center font-semibold" style={{ color: 'var(--text-secondary)' }}>积分</th>
                          <th className="px-4 py-3 text-left font-semibold" style={{ color: 'var(--text-secondary)' }}>交易号</th>
                          <th className="px-4 py-3 text-center font-semibold" style={{ color: 'var(--text-secondary)' }}>审核状态</th>
                          <th className="px-4 py-3 text-left font-semibold" style={{ color: 'var(--text-secondary)' }}>审核备注</th>
                          <th className="px-4 py-3 text-center font-semibold" style={{ color: 'var(--text-secondary)' }}>支付凭证</th>
                          <th className="px-4 py-3 text-center font-semibold" style={{ color: 'var(--text-secondary)' }}>创建时间</th>
                          <th className="px-4 py-3 text-center font-semibold" style={{ color: 'var(--text-secondary)' }}>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {codes.map(c => (
                          <tr key={c.id} className="border-t transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02]" style={{ borderColor: 'var(--border-color)' }}>
                            <td className="px-4 py-3">
                              <div style={{ color: 'var(--text-primary)' }}>{c.nickname || c.username}</div>
                              <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>@{c.username}</div>
                            </td>
                            <td className="px-4 py-3 text-center text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                              {c.channel === 'wechat' ? '微信' : '支付宝'}
                            </td>
                            <td className="px-4 py-3 text-right text-[11px] tabular-nums font-medium" style={{ color: 'var(--text-primary)' }}>
                              ¥{c.amount}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className="text-sm font-bold" style={{ color: 'var(--accent)' }}>{c.points}</span>
                            </td>
                            <td className="px-4 py-3 text-left text-[11px] truncate max-w-[120px]" style={{ color: 'var(--text-secondary)' }}>
                              {c.tx_no || '-'}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className="px-2 py-0.5 rounded-full text-[11px] font-medium" style={{
                                color: c.status === 'approved' ? '#22c55e' : c.status === 'rejected' ? '#ef4444' : '#f59e0b',
                                background: c.status === 'approved' ? '#22c55e20' : c.status === 'rejected' ? '#ef444420' : '#f59e0b20'
                              }}>
                                {{ pending: '待审核', approved: '已通过', rejected: '已拒绝' }[c.status]}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-left text-[11px] truncate max-w-[120px]" style={{ color: 'var(--text-secondary)' }}>
                              {c.review_note || '-'}
                            </td>
                            <td className="px-4 py-3 text-center">
                              {c.proof_url ? (
                                <button onClick={() => setProofLightbox(c.proof_url)} className="text-xs underline" style={{ color: 'var(--accent)' }}>查看</button>
                              ) : '-'}
                            </td>
                            <td className="px-4 py-3 text-center text-[11px]" style={{ color: 'var(--text-secondary)' }}>{c.created_at || '-'}</td>
                            <td className="px-4 py-3 text-center">
                              {c.status === 'pending' && (
                                <div className="flex items-center justify-center gap-1">
                                  <button onClick={async () => { try { await adminAPI.approveRecharge(c.id, { points: Number(c.points) || 0, review_note: '快速审核通过' }); fetchRechargeRequests() } catch (e) { dialog.alert(e.message || '操作失败') } }}
                                    className="px-2 py-1 rounded-lg text-[11px] font-medium bg-emerald-500 text-white hover:bg-emerald-600">
                                    快速通过
                                  </button>
                                  <button onClick={() => { setReviewModal({ ...c, action: 'approve' }); setReviewPoints(String(c.points || 10)); setReviewNote('') }}
                                    className="px-2 py-1 rounded-lg text-[11px] font-medium bg-green-500 text-white hover:bg-green-600">
                                    通过
                                  </button>
                                  <button onClick={() => { setReviewModal({ ...c, action: 'reject' }); setReviewNote('') }}
                                    className="px-2 py-1 rounded-lg text-[11px] font-medium bg-red-500 text-white hover:bg-red-600">
                                    拒绝
                                  </button>
                                </div>
                              )}
                              {c.status === 'approved' && c.redeem_code && (
                                <span className="text-[10px] font-mono" style={{ color: 'var(--accent)' }}>{c.redeem_code}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                        {codes.length === 0 && (
                          <tr><td colSpan={10} className="text-center py-16" style={{ color: 'var(--text-secondary)' }}>
                            <Ticket size={32} className="mx-auto mb-2 opacity-30" />
                            <p>暂无记录</p>
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
        ) : tab === 'config' ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              {[{ k: 'basic', l: '基础配置' }, { k: 'route', l: '模型路由' }].map(i => <button key={i.k} onClick={() => setConfigSubtab(i.k)} className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${configSubtab === i.k ? 'text-white border-transparent' : ''}`} style={configSubtab === i.k ? { background: 'var(--accent)' } : { borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>{i.l}</button>)}
            </div>
            {configSubtab === 'basic' ? (
            <>
            <div className="p-4 rounded-xl border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)' }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>核心限制配置</h3>
                <button onClick={handleSaveConfig} disabled={configSaving} className="px-4 py-2 rounded-lg text-xs font-medium bg-accent text-white hover:opacity-90 disabled:opacity-50">{configSaving ? '保存中...' : '保存配置'}</button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[{ k: 'generate_concurrent_limit_per_user', l: '生成并发上限/用户', min: 1 }, { k: 'points_cost_per_generation', l: '每次生成扣分', min: 1 }, { k: 'points_checkin_reward', l: '每日签到奖励', min: 0 }, { k: 'points_register_bonus', l: '注册送分', min: 0 }, { k: 'points_migration_amount', l: '补发积分值', min: 0 }, { k: 'login_rate_limit_per_minute_per_ip', l: '登录限流/分钟/IP', min: 1 }, { k: 'register_rate_limit_per_minute_per_ip', l: '注册限流/分钟/IP', min: 1 }].map(item => (
                  <div key={item.k}>
                    <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>{item.l}</label>
                    <input type="number" min={item.min} value={runtimeConfig[item.k]} onChange={e => onConfigInput(item.k, e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                  </div>
                ))}
              </div>
            </div>
            <div className="p-4 rounded-xl border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)' }}>
              <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>运行时配置</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[{ k: 'api_url', l: '生成 API URL' }, { k: 'image_hosting_upload_url', l: '图床上传 URL' }, { k: 'image_hosting_base_url', l: '图床基础 URL' }, { k: 'image_hosting_referer', l: '图床 Referer' }, { k: 'wechat_pay_qr_url', l: '微信收款码 URL' }, { k: 'alipay_pay_qr_url', l: '支付宝收款码 URL' }].map(item => (
                  <div key={item.k}>
                    <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>{item.l}</label>
                    <input type="text" value={runtimeConfig[item.k]} onChange={e => onConfigInput(item.k, e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                  </div>
                ))}
              </div>
              <div className="mt-3">
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>手动充值提示文案</label>
                <textarea value={runtimeConfig.manual_recharge_notice} onChange={e => onConfigInput('manual_recharge_notice', e.target.value)} rows={3} className="w-full px-3 py-2 rounded-lg text-sm border resize-none outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
            </div>
            </>
            ) : configSubtab === 'route' ? (
            <>
            <div className="p-4 rounded-xl border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)' }}>
              <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>模型与供应商路由配置</h3>
              <div className="mb-3">
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>默认模型ID</label>
                <input type="text" value={defaultModelId} onChange={e => setDefaultModelId(e.target.value)} placeholder="例如：image-default（必须存在于模型列表）" className="w-full px-3 py-2 rounded-lg text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div className="rounded-lg border p-3 mb-3" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)' }}>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>融合路由配置表</div>
                  <div className="flex items-center gap-2">
                    <button onClick={handleCopySelectedGenRow} className="px-2 py-1 rounded text-xs font-medium border" style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}>复制</button>
                    <button onClick={handleAddModel} className="px-2 py-1 rounded text-xs font-medium bg-accent text-white">新增模型</button>
                    <button onClick={handleAddProvider} className="px-2 py-1 rounded text-xs font-medium bg-accent text-white">新增供应商</button>
                  </div>
                </div>
                <div className="overflow-x-auto overflow-y-auto max-h-[28rem] rounded border" style={{ borderColor: 'var(--border-color)' }}>
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ background: 'var(--bg-secondary)' }}>
                        <th className="px-3 py-2 text-center font-medium" style={{ color: 'var(--text-secondary)' }}>选择</th>
                        <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>类别</th>
                        <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>ID</th>
                        <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>主要信息</th>
                        <th className="px-3 py-2 text-center font-medium" style={{ color: 'var(--text-secondary)' }}>状态</th>
                        <th className="px-3 py-2 text-right font-medium" style={{ color: 'var(--text-secondary)' }}>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(genModelsObj).map(([mid, m]) => (
                        <tr key={`m:${mid}`} className="border-t" style={{ borderColor: 'var(--border-color)' }}>
                          <td className="px-3 py-2 text-center"><input type="radio" name="gen-row" checked={selectedGenRow === `m:${mid}`} onChange={() => setSelectedGenRow(`m:${mid}`)} /></td>
                          <td className="px-3 py-2" style={{ color: '#2563eb' }}>模型</td>
                          <td className="px-3 py-2 font-mono" style={{ color: 'var(--text-primary)' }}>{mid}</td>
                          <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>{`${m?.label || '-'} | ${m?.capability || 'image'} | providers: ${(Array.isArray(m?.providers) ? m.providers : []).join(',') || '-'}`}</td>
                          <td className="px-3 py-2 text-center"><span className={`px-2 py-0.5 rounded-full text-[11px] ${m?.enabled !== false ? 'bg-green-500/15 text-green-600' : 'bg-gray-500/15 text-gray-500'}`}>{m?.enabled !== false ? '启用' : '禁用'}</span></td>
                          <td className="px-3 py-2 text-right">
                            <div className="inline-flex items-center gap-2">
                              <button onClick={() => openModelEditor(mid)} className="px-2 py-1 rounded text-xs border" style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}>编辑</button>
                              <button onClick={() => handleDeleteModel(mid)} className="px-2 py-1 rounded text-xs border text-red-500" style={{ borderColor: 'var(--border-color)' }}>删除</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {Object.entries(genProvidersObj).map(([pid, p]) => (
                        <tr key={`p:${pid}`} className="border-t" style={{ borderColor: 'var(--border-color)' }}>
                          <td className="px-3 py-2 text-center"><input type="radio" name="gen-row" checked={selectedGenRow === `p:${pid}`} onChange={() => setSelectedGenRow(`p:${pid}`)} /></td>
                          <td className="px-3 py-2" style={{ color: '#7c3aed' }}>供应商</td>
                          <td className="px-3 py-2 font-mono" style={{ color: 'var(--text-primary)' }}>{pid}</td>
                          <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>{`${p?.type || 'wuyin'} | priority:${Number(p?.priority ?? 100)} | ${p?.api_url || '全局api_url'}`}</td>
                          <td className="px-3 py-2 text-center"><span className={`px-2 py-0.5 rounded-full text-[11px] ${p?.enabled !== false ? 'bg-green-500/15 text-green-600' : 'bg-gray-500/15 text-gray-500'}`}>{p?.enabled !== false ? '启用' : '禁用'}</span></td>
                          <td className="px-3 py-2 text-right">
                            <div className="inline-flex items-center gap-2">
                              <button onClick={() => openProviderEditor(pid)} className="px-2 py-1 rounded text-xs border" style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}>编辑</button>
                              <button onClick={() => handleDeleteProvider(pid)} className="px-2 py-1 rounded text-xs border text-red-500" style={{ borderColor: 'var(--border-color)' }}>删除</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>提示：先“选择”某一行，再点“复制”可快速克隆该配置并二次编辑；模型行绑定供应商ID，供应商行定义真实API参数。</div>
              </div>
              <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)' }}>
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>高级模式(JSON)</div>
                  <button onClick={() => setShowAdvancedGenConfig(v => !v)} className="px-2 py-1 rounded text-xs border" style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>{showAdvancedGenConfig ? '收起' : '展开'}</button>
                </div>
                {showAdvancedGenConfig && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                    <div>
                      <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>generation_models(JSON对象)</label>
                      <textarea value={generationModelsText} onChange={e => setGenerationModelsText(e.target.value)} rows={14} className="w-full px-3 py-2 rounded-lg text-xs border resize-none outline-none font-mono" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                      <div className="text-[11px] mt-1 text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>{generationModelsText.length} chars</div>
                    </div>
                    <div>
                      <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>generation_providers(JSON对象)</label>
                      <textarea value={generationProvidersText} onChange={e => setGenerationProvidersText(e.target.value)} rows={14} className="w-full px-3 py-2 rounded-lg text-xs border resize-none outline-none font-mono" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                      <div className="text-[11px] mt-1 text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>{generationProvidersText.length} chars</div>
                    </div>
                    <div className="md:col-span-2 flex justify-end">
                      <button onClick={handleApplyAdvanced} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-accent text-white hover:opacity-90">应用到表单</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            </>
            ) : null}
          </div>
        ) : (
          <AdminHistoryTab historyTotal={historyTotal} historyQuery={historyQuery} setHistoryQuery={setHistoryQuery} historySummary={historySummary} loading={loading} history={history} modelLabelMap={modelLabelMap} handleDeleteHistory={handleDeleteHistory} historyPage={historyPage} setHistoryPage={setHistoryPage} />
        )}
      </div>

      {editingModelId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setEditingModelId('')}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative w-full max-w-lg rounded-2xl overflow-hidden" style={{ background: 'var(--bg-primary)' }} onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>编辑模型</h3>
              <div className="text-xs mt-1 font-mono" style={{ color: 'var(--text-secondary)' }}>{editingModelId}</div>
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>模型ID</label>
                <input type="text" value={editingModelId} readOnly className="w-full px-3 py-2 rounded-lg text-sm border outline-none font-mono" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>显示名</label>
                <input type="text" value={editingModelDraft.label || ''} onChange={e => setEditingModelDraft(prev => ({ ...prev, label: e.target.value }))} placeholder="如 默认模型" className="w-full px-3 py-2 rounded-lg text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>能力</label>
                <select value={editingModelDraft.capability || 'image'} onChange={e => setEditingModelDraft(prev => ({ ...prev, capability: e.target.value }))} className="w-full px-3 py-2 rounded-lg text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}><option value="image">image</option><option value="video">video</option></select>
              </div>
              <div className="flex items-end">
                <label className="inline-flex items-center gap-2 text-sm" style={{ color: 'var(--text-primary)' }}><input type="checkbox" checked={editingModelDraft.enabled !== false} onChange={e => setEditingModelDraft(prev => ({ ...prev, enabled: e.target.checked }))} />启用该模型</label>
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>绑定供应商ID</label>
                <input type="text" value={(Array.isArray(editingModelDraft.providers) ? editingModelDraft.providers : []).join(',')} onChange={e => setEditingModelDraft(prev => ({ ...prev, providers: (e.target.value || '').split(',').map(s => s.trim()).filter(Boolean) }))} placeholder="逗号分隔，如 wuyin-main,wuyin-backup" className="w-full px-3 py-2 rounded-lg text-sm border outline-none font-mono" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
              <button onClick={() => setEditingModelId('')} className="px-4 py-2 rounded-lg text-sm font-medium hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>取消</button>
              <button onClick={applyModelEditor} className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:opacity-90">保存</button>
            </div>
          </div>
        </div>
      )}

      {/* 供应商编辑弹窗 */}
      {editingProviderId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setEditingProviderId('')}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative w-full max-w-lg rounded-2xl overflow-hidden" style={{ background: 'var(--bg-primary)' }} onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>编辑供应商</h3>
              <div className="text-xs mt-1 font-mono" style={{ color: 'var(--text-secondary)' }}>{editingProviderId}</div>
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>供应商ID</label>
                <input type="text" value={editingProviderId} readOnly className="w-full px-3 py-2 rounded-lg text-sm border outline-none font-mono" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>类型</label>
                <input type="text" value={editingProviderDraft.type || ''} onChange={e => setEditingProviderDraft(prev => ({ ...prev, type: e.target.value }))} placeholder="如 wuyin" className="w-full px-3 py-2 rounded-lg text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>优先级</label>
                <input type="number" value={Number(editingProviderDraft.priority ?? 100)} onChange={e => setEditingProviderDraft(prev => ({ ...prev, priority: Number(e.target.value || 0) }))} placeholder="越大越优先" className="w-full px-3 py-2 rounded-lg text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>连续失败阈值</label>
                <input type="number" value={Number(editingProviderDraft.circuit_fail_threshold ?? 3)} onChange={e => setEditingProviderDraft(prev => ({ ...prev, circuit_fail_threshold: Number(e.target.value || 0) }))} placeholder="达到阈值触发熔断" className="w-full px-3 py-2 rounded-lg text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>熔断冷却秒数</label>
                <input type="number" value={Number(editingProviderDraft.circuit_cooldown_seconds ?? 60)} onChange={e => setEditingProviderDraft(prev => ({ ...prev, circuit_cooldown_seconds: Number(e.target.value || 0) }))} placeholder="如 60" className="w-full px-3 py-2 rounded-lg text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div className="flex items-end">
                <label className="inline-flex items-center gap-2 text-sm" style={{ color: 'var(--text-primary)' }}><input type="checkbox" checked={editingProviderDraft.enabled !== false} onChange={e => setEditingProviderDraft(prev => ({ ...prev, enabled: e.target.checked }))} />启用该供应商</label>
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>API URL</label>
                <input type="text" value={editingProviderDraft.api_url || ''} onChange={e => setEditingProviderDraft(prev => ({ ...prev, api_url: e.target.value }))} placeholder="例如 https://xxx/api/async，留空则使用全局api_url" className="w-full px-3 py-2 rounded-lg text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>API Key</label>
                <input type="text" value={editingProviderDraft.api_key || ''} onChange={e => setEditingProviderDraft(prev => ({ ...prev, api_key: e.target.value }))} placeholder="留空则使用全局api_key" className="w-full px-3 py-2 rounded-lg text-sm border outline-none font-mono" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
              <button onClick={() => setEditingProviderId('')} className="px-4 py-2 rounded-lg text-sm font-medium hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>取消</button>
              <button onClick={applyProviderEditor} className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:opacity-90">保存</button>
            </div>
          </div>
        </div>
      )}

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
                    if (!await dialog.confirm('确定删除此图床映射？（仅删除映射记录，不删除图床上的图片）')) return
                    try {
                      await adminAPI.batchDeleteHosting([hostingDetail.url])
                      setHostingDetail(null); fetchHostingImages(); fetchHostingStats()
                    } catch (e) { dialog.alert(e.message || '删除失败') }
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
      {editingQuotaProviderId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setEditingQuotaProviderId('')}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative w-full max-w-md rounded-2xl overflow-hidden" style={{ background: 'var(--bg-primary)' }} onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b" style={{ borderColor: 'var(--border-color)' }}><h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>编辑渠道额度</h3><div className="text-xs mt-1 font-mono" style={{ color: 'var(--text-secondary)' }}>{editingQuotaProviderId}</div></div>
            <div className="p-4 grid grid-cols-1 gap-3">
              <div><label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>总额度</label><input type="number" value={editingQuotaDraft.total_quota} onChange={e => setEditingQuotaDraft(prev => ({ ...prev, total_quota: Number(e.target.value || 0) }))} className="w-full px-3 py-2 rounded-lg text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)', color: 'var(--text-primary)' }} /></div>
              <div><label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>当前余额</label><input type="number" value={editingQuotaDraft.current_balance} onChange={e => setEditingQuotaDraft(prev => ({ ...prev, current_balance: Number(e.target.value || 0) }))} className="w-full px-3 py-2 rounded-lg text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)', color: 'var(--text-primary)' }} /></div>
              <div><label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>单次额度消耗</label><input type="number" value={editingQuotaDraft.unit_quota_cost} onChange={e => setEditingQuotaDraft(prev => ({ ...prev, unit_quota_cost: Number(e.target.value || 0) }))} className="w-full px-3 py-2 rounded-lg text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)', color: 'var(--text-primary)' }} /></div>
            </div>
            <div className="flex justify-between p-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
              <button onClick={addQuotaLedger} className="px-4 py-2 rounded-lg text-sm font-medium border" style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}>补充/扣减额度</button>
              <div className="flex gap-2"><button onClick={() => setEditingQuotaProviderId('')} className="px-4 py-2 rounded-lg text-sm font-medium hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>取消</button><button onClick={applyQuotaEditor} className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:opacity-90">保存</button></div>
            </div>
          </div>
        </div>
      )}
      {editingCostKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setEditingCostKey('')}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative w-full max-w-md rounded-2xl overflow-hidden" style={{ background: 'var(--bg-primary)' }} onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b" style={{ borderColor: 'var(--border-color)' }}><h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>设置单次成本</h3><div className="text-xs mt-1 font-mono" style={{ color: 'var(--text-secondary)' }}>{editingCostKey}</div></div>
            <div className="p-4"><input type="number" value={editingCostValue} onChange={e => setEditingCostValue(e.target.value)} placeholder="输入>=0成本金额" className="w-full px-3 py-2 rounded-lg text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)', color: 'var(--text-primary)' }} /></div>
            <div className="flex justify-end gap-2 p-4 border-t" style={{ borderColor: 'var(--border-color)' }}><button onClick={() => setEditingCostKey('')} className="px-4 py-2 rounded-lg text-sm font-medium hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>取消</button><button onClick={applyCostEditor} className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:opacity-90">保存</button></div>
          </div>
        </div>
      )}

      {/* 审核弹窗 */}
      {reviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setReviewModal(null)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative w-full max-w-md rounded-2xl overflow-hidden" style={{ background: 'var(--bg-primary)' }} onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {reviewModal.action === 'approve' ? '审核通过' : '拒绝申请'}
              </h3>
              <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                {reviewModal.username || reviewModal.code} - ¥{reviewModal.recharge_amount}
              </p>
            </div>
            <div className="p-4 space-y-3">
              {reviewModal.action === 'approve' && (
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>发放积分</label>
                  <input type="number" value={reviewPoints} onChange={e => setReviewPoints(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-sm border outline-none"
                    style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)', color: 'var(--text-primary)' }} />
                </div>
              )}
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                  {reviewModal.action === 'approve' ? '审核备注（可选）' : '拒绝原因（必填）'}
                </label>
                {reviewModal.action === 'reject' && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {['凭证不清晰', '金额不符', '重复提交', '信息不完整'].map(text => (
                      <button key={text} onClick={() => setReviewNote(text)}
                        className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-colors ${reviewNote === text ? 'bg-red-500 text-white' : 'border hover:border-red-500/50'}`}
                        style={reviewNote === text ? {} : { borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}>
                        {text}
                      </button>
                    ))}
                  </div>
                )}
                <textarea value={reviewNote} onChange={e => setReviewNote(e.target.value)}
                  rows={3} placeholder={reviewModal.action === 'approve' ? '审核通过' : '请输入拒绝原因'}
                  className="w-full px-3 py-2 rounded-lg text-sm border resize-none outline-none"
                  style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)', color: 'var(--text-primary)' }} />
              </div>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
              <button onClick={() => setReviewModal(null)} className="px-4 py-2 rounded-lg text-sm font-medium hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>取消</button>
              <button onClick={() => reviewModal.action === 'approve' ? handleApproveRecharge(reviewModal.id) : handleRejectRecharge(reviewModal.id)}
                disabled={reviewModal.action === 'reject' && !reviewNote.trim()}
                className={`px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 ${reviewModal.action === 'approve' ? 'bg-green-500 hover:bg-green-600' : 'bg-red-500 hover:bg-red-600'}`}>
                {reviewModal.action === 'approve' ? '确认通过' : '确认拒绝'}
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
