import { useState, useEffect, useCallback } from 'react'
import { Trash2, Users, Shield, Snowflake, Sun, Clock, Check, UserCheck, UserX, HardDrive, Download, X, Ban, Ticket, Megaphone, Wallet, Key, SlidersHorizontal, BarChart3, Mail, Tags, MessageSquare, Cpu, CreditCard } from 'lucide-react'
import { useNavigate, useLocation } from 'react-router-dom'
import { adminAPI, announcementAPI, configAPI, statsAPI, promptAPI, uploadAPI } from '../api'
import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip } from 'recharts'
import MainLayout from '../components/MainLayout'
import PageLayout from '../components/PageLayout'
import SearchInput from '../components/SearchInput'
import Pagination from '../components/Pagination'
import UnifiedCard from '../components/UnifiedCard'
import AdminUsersTab from './admin-tabs/AdminUsersTab'
import AdminHistoryTab from './admin-tabs/AdminHistoryTab'
import AdminChatTab from './admin-tabs/AdminChatTab'
import AdminLlmModelsTab from './admin-tabs/AdminLlmModelsTab'
import AdminAnnouncementsTab from './admin-tabs/AdminAnnouncementsTab'
import AdminBannedTab from './admin-tabs/AdminBannedTab'
import AdminHostingTab from './admin-tabs/AdminHostingTab'
import AdminFinanceTab from './admin-tabs/AdminFinanceTab'
import AdminClassificationTab from './admin-tabs/AdminClassificationTab'
import AdminSubscriptionTab from './admin-tabs/AdminSubscriptionTab'
import { readUser } from '../auth'
import { useAppDialog } from '../components/AppDialogProvider'

const nowFinanceTime=()=>{const d=new Date(),p=n=>String(n).padStart(2,'0');return`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`}
const defaultRechargePackages=[{amount:9.9,points:120,label:'体验包'},{amount:29.9,points:400,label:'进阶包'},{amount:59.9,points:900,label:'超值包'}]
const isVipModelId=id=>id==='grsai-vip'

export default function AdminPage() {
  const dialog = useAppDialog()
  const navigate = useNavigate()
  const location = useLocation()
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
  const [createUserDraft, setCreateUserDraft] = useState({ username: '', password: '', nickname: '' })
  const [creatingUser, setCreatingUser] = useState(false)
  const [historyQuery, setHistoryQuery] = useState('')

  // 聊天记录
  const [chatSessions, setChatSessions] = useState([])
  const [chatTotal, setChatTotal] = useState(0)
  const [chatPage, setChatPage] = useState(1)
  const [chatQuery, setChatQuery] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [chatViewSession, setChatViewSession] = useState(null)

  // 模型档案
  const [llmModels, setLlmModels] = useState([])
  const [llmModelsLoading, setLlmModelsLoading] = useState(false)
  const [globalModelId, setGlobalModelId] = useState('')

  // 图床管理
  const [hostingImages, setHostingImages] = useState([])
  const [hostingTotal, setHostingTotal] = useState(0)
  const [hostingPage, setHostingPage] = useState(1)
  const [hostingStats, setHostingStats] = useState(null)
  const [hostingChecked, setHostingChecked] = useState(new Set())
  const [hostingTypeFilter, setHostingTypeFilter] = useState('')
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
  const [runtimeConfig, setRuntimeConfig] = useState({
    api_url: '',
    register_enabled: true,
    show_login_sessions: false,
    image_hosting_upload_url: '',
    image_hosting_base_url: '',
    image_hosting_referer: '',
    wechat_pay_qr_url: '',
    alipay_pay_qr_url: '',
    manual_recharge_notice: '',
    recharge_packages: defaultRechargePackages,
    recharge_random_discount_min: 0.01,
    recharge_random_discount_max: 0.5,
    generate_concurrent_limit_per_user: 10,
    home_page_size: 24,
    square_page_size: 20,
    points_cost_per_generation: 10,
    points_cost_per_optimize: 10,
    points_cost_per_optimize_refine: 20,
    points_cost_per_chat: 1,
    ai_daily_free_quota: 5,
    points_cost_per_image_extend: 2,
    points_checkin_reward: 10,
    points_register_bonus: 50,
    points_migration_amount: 50,
    invite_enabled: true,
    invite_register_reward_points: 20,
    invite_recharge_rebate_percent: 10,
    invite_recharge_bonus_percent: 10,
    login_rate_limit_per_minute_per_ip: 5,
    register_rate_limit_per_minute_per_ip: 3,
    github_hosting_enabled: false,
    github_hosting_repo: '',
    github_hosting_token: '',
    github_hosting_branch: 'main',
    smtp_server: 'smtp.qq.com',
    smtp_port: 465,
    smtp_password: '',
    smtp_sender: '',
    smtp_sender_name: 'Atelier · AI 工作台',
    sendgrid_api_key: '',
    sendgrid_sender: '',
  })
  const [configSaving, setConfigSaving] = useState(false)
  const [defaultModelId, setDefaultModelId] = useState('gpt-image-2')
  const [generationModelsText, setGenerationModelsText] = useState('{}')
  const [generationProvidersText, setGenerationProvidersText] = useState('{}')
  const [evLogs, setEvLogs] = useState([])
  const [evTotal, setEvTotal] = useState(0)
  const [evPage, setEvPage] = useState(1)
  const [evQuery, setEvQuery] = useState('')
  const [showAdvancedGenConfig, setShowAdvancedGenConfig] = useState(false)
  const [jsonDirty, setJsonDirty] = useState(false)
  const [genModelsObj, setGenModelsObj] = useState({})
  const [genProvidersObj, setGenProvidersObj] = useState({})
  const [configSubtab, setConfigSubtab] = useState('basic')
  const [editingProviderId, setEditingProviderId] = useState('')
  const [editingProviderDraft, setEditingProviderDraft] = useState({ type: 'wuyin', enabled: true, priority: 100, api_url: '', api_key: '', circuit_fail_threshold: 3, circuit_cooldown_seconds: 60, unit_name: '供应商额度', unit_code: 'vendor_quota' })
  const [editingModelId, setEditingModelId] = useState('')
  const [editingModelDraft, setEditingModelDraft] = useState({ label: '', capability: 'image', enabled: true, providers: [], points_cost: '', resolution_cost_low: '', resolution_cost_medium: '', resolution_cost_high: '' })
  const [draggingModelProviderId, setDraggingModelProviderId] = useState('')
  const [modelLabelMap, setModelLabelMap] = useState({})
  const [financeRange, setFinanceRange] = useState('30d')
  const [financeOverview, setFinanceOverview] = useState(null)
  const [financeProviders, setFinanceProviders] = useState([])
  const [financePurchasePage, setFinancePurchasePage] = useState(1)
  const [financePurchaseTotal, setFinancePurchaseTotal] = useState(0)
  const [financePurchases, setFinancePurchases] = useState([])
  const [financeProviderFilter, setFinanceProviderFilter] = useState('')
  const [financeTaskProviderFilter, setFinanceTaskProviderFilter] = useState('')
  const [financeModelFilter, setFinanceModelFilter] = useState('')
  const [financeStatusFilter, setFinanceStatusFilter] = useState('')
  const [financeTaskPage, setFinanceTaskPage] = useState(1)
  const [financeTaskTotal, setFinanceTaskTotal] = useState(0)
  const [financeTasks, setFinanceTasks] = useState([])
  const [financeLoading, setFinanceLoading] = useState(false)
  const [financeCreatingPurchase, setFinanceCreatingPurchase] = useState(false)
  const [financePurchaseDraft, setFinancePurchaseDraft] = useState({ id: null, provider_id: '', amount_rmb: '', quota_amount: '', purchase_date: nowFinanceTime(), remark: '', can_edit_core: true, consumed_quota: 0, adjust_consumed: '' })
  const [financeRules, setFinanceRules] = useState([])
  const [financeRuleSaving, setFinanceRuleSaving] = useState(false)
  const [financeRuleDraft, setFinanceRuleDraft] = useState({ id: null, provider_id: '', model_id: '', quota_per_success: '', enabled: true, remark: '' })
  const [qrUploading, setQrUploading] = useState('')

  // AI 分类
  const [clsTasks, setClsTasks] = useState([])
  const [clsTotal, setClsTotal] = useState(0)
  const [clsPage, setClsPage] = useState(1)
  const [clsDetail, setClsDetail] = useState(null)
  const [clsSelected, setClsSelected] = useState(new Set())
  const [clsCategories, setClsCategories] = useState([])
  const [auditTasks, setAuditTasks] = useState([])
  const [auditTotal, setAuditTotal] = useState(0)
  const [auditPage, setAuditPage] = useState(1)
  const [auditDetail, setAuditDetail] = useState(null)
  const [auditSelected, setAuditSelected] = useState(new Set())

  useEffect(() => { setUserPage(1) }, [userQuery])
  useEffect(() => { setHistoryPage(1) }, [historyQuery])
  useEffect(() => { setChatPage(1) }, [chatQuery])
  useEffect(() => { setBannedWordsPage(1) }, [bannedWordsQuery])
  useEffect(() => { setFinancePurchasePage(1) }, [financeProviderFilter])
  useEffect(() => { setFinanceTaskPage(1) }, [financeTaskProviderFilter, financeModelFilter, financeStatusFilter, financeRange])

  useEffect(() => { if (tab === 'users') fetchUsers() }, [tab, userPage, userQuery])
  useEffect(() => { if (tab === 'history') fetchHistory() }, [tab, historyPage, historyQuery])
  useEffect(() => { if (tab === 'chat') fetchChatSessions() }, [tab, chatPage, chatQuery])
  useEffect(() => { if (tab === 'llm_models') fetchLlmModels() }, [tab])
  useEffect(() => { if (tab === 'stats') fetchSystemStats(statsRange) }, [tab, statsRange])
  useEffect(() => { if (tab === 'hosting') { fetchHostingImages(); fetchHostingStats() } }, [tab, hostingPage, hostingTypeFilter])
  useEffect(() => { if (tab === 'banned') fetchBannedWords() }, [tab, bannedWordsPage, bannedWordsQuery])
  useEffect(() => { if (tab === 'codes' || tab === 'recharge_review') fetchRechargeRequests() }, [tab, codesPage, codesSort, codesOrder, rechargeStatusFilter])
  useEffect(() => { if (tab === 'announcements') fetchAnnouncements() }, [tab, announcementPage])
  useEffect(() => { if (tab === 'config' || tab === 'finance') fetchRuntimeConfig() }, [tab])
  useEffect(() => { if (!proofLightbox) return; const onPop = () => setProofLightbox(null); window.history.pushState({ __adminProofLightbox: true }, ''); window.addEventListener('popstate', onPop); return () => { window.removeEventListener('popstate', onPop); if (window.history.state?.__adminProofLightbox) window.history.back() } }, [proofLightbox])
  useEffect(() => {
    if (!editingModelId) return
    const m = genModelsObj[editingModelId]
    if (!m) { setEditingModelId(''); return }
    setEditingModelDraft(prev => ({ ...prev, enabled: m.enabled !== false }))
  }, [editingModelId, genModelsObj])
  useEffect(() => {
    if (!editingProviderId) return
    const p = genProvidersObj[editingProviderId]
    if (!p) { setEditingProviderId(''); return }
    setEditingProviderDraft(prev => ({ ...prev, enabled: p.enabled !== false }))
  }, [editingProviderId, genProvidersObj])
  useEffect(() => { if (tab === 'finance') fetchFinanceOverview() }, [tab, financeRange])
  useEffect(() => { if (tab === 'finance') fetchFinanceProviders() }, [tab, financeRange])
  useEffect(() => { if (tab === 'finance') fetchFinancePurchases() }, [tab, financePurchasePage, financeProviderFilter])
  useEffect(() => { if (tab === 'finance') fetchFinanceRules() }, [tab, financeProviderFilter])
  useEffect(() => { if (tab === 'finance') fetchFinanceTasks() }, [tab, financeRange, financeTaskPage, financeTaskProviderFilter, financeModelFilter, financeStatusFilter])
  useEffect(() => { configAPI.models().then(({ data }) => { const rows = data?.models || []; const m = {}; for (const r of rows) m[r.model_id] = r.label || r.model_id; setModelLabelMap(m) }).catch(() => {}) }, [])
  useEffect(() => { if (tab === 'evlogs') fetchEvLogs() }, [tab, evPage, evQuery])
  useEffect(() => { setEvPage(1) }, [evQuery])
  useEffect(() => { if (tab === 'classification') fetchClsTasks() }, [tab, clsPage])
  useEffect(() => { if (tab === 'classification') fetchAuditTasks() }, [tab, auditPage])
  useEffect(() => { promptAPI.categories().then(({ data }) => setClsCategories(data?.categories || data || [])).catch(() => {}) }, [])
  useEffect(() => {
    const handle=e=>setClsCategories(e.detail||[])
    window.addEventListener('admin-categories-updated',handle)
    return ()=>window.removeEventListener('admin-categories-updated',handle)
  }, [])
  useEffect(() => {
    const q=new URLSearchParams(location.search).get('tab')
    if(q&&['stats','finance','subscription','users','history','chat','llm_models','hosting','banned','classification','codes','recharge_review','announcements','evlogs','config'].includes(q))setTab(q)
  }, [location.search])
  const switchTab = useCallback((next) => { setTab(next); navigate(next==='users'?'/admin':`/admin?tab=${next}`, { replace: location.pathname === '/admin' }) }, [navigate,location.pathname])

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

  const fetchEvLogs = async () => {
    setLoading(true)
    try {
      const { data } = await adminAPI.emailVerifications(evPage, 20, evQuery || undefined)
      setEvLogs(data?.items || [])
      setEvTotal(data?.total || 0)
    } catch (e) { dialog.alert(e.message || '加载失败') } finally { setLoading(false) }
  }
  const fetchClsTasks = async () => {
    try {
      const { data } = await adminAPI.listClassificationTasks(clsPage, 20)
      setClsTasks(data?.items || [])
      setClsTotal(data?.total || 0)
    } catch (e) { dialog.alert(e.message || '加载失败') }
  }
  const handleCreateClsTask = async (itemType = 'prompt', limit = 200) => {
    try {
      const { data } = await adminAPI.createClassificationTask(itemType, limit)
      fetchClsTasks()
      return data
    } catch (e) { dialog.alert(e.message || '创建失败'); throw e }
  }
  const fetchAuditTasks = async () => {
    try {
      const { data } = await adminAPI.listAuditTasks(auditPage, 20)
      setAuditTasks(data?.items || [])
      setAuditTotal(data?.total || 0)
    } catch (e) { dialog.alert(e.message || '加载失败') }
  }
  const handleCreateAuditTask = async (itemType = 'prompt', limit = 200) => {
    try {
      const { data } = await adminAPI.createAuditTask(itemType, limit)
      fetchAuditTasks()
      return data
    } catch (e) { dialog.alert(e.message || '创建失败'); throw e }
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
        register_enabled: data.register_enabled !== false,
        image_hosting_upload_url: data.image_hosting_upload_url || '',
        image_hosting_base_url: data.image_hosting_base_url || '',
        image_hosting_referer: data.image_hosting_referer || '',
        wechat_pay_qr_url: data.wechat_pay_qr_url || '',
        alipay_pay_qr_url: data.alipay_pay_qr_url || '',
        donation_contact: data.donation_contact || '',
        manual_recharge_notice: data.manual_recharge_notice || '',
        recharge_packages: Array.isArray(data.recharge_packages) && data.recharge_packages.length ? data.recharge_packages.map(item => ({ amount: item.amount, points: item.points, label: item.label })) : defaultRechargePackages.map(item => ({ ...item })),
        recharge_random_discount_min: Number(data.recharge_random_discount_min ?? 0.01),
        recharge_random_discount_max: Number(data.recharge_random_discount_max ?? 0.5),
        generate_concurrent_limit_per_user: Number(data.generate_concurrent_limit_per_user || 10),
        home_page_size: Number(data.home_page_size || 24),
        square_page_size: Number(data.square_page_size || 20),
        points_cost_per_generation: Number(data.points_cost_per_generation || 10),
        points_cost_per_optimize: Number(data.points_cost_per_optimize || 10),
        points_cost_per_optimize_refine: Number(data.points_cost_per_optimize_refine || 20),
        points_cost_per_chat: Number(data.points_cost_per_chat || 10),
        ai_daily_free_quota: Number(data.ai_daily_free_quota ?? 5),
        points_cost_per_image_extend: Number(data.points_cost_per_image_extend || 2),
        points_checkin_reward: Number(data.points_checkin_reward || 10),
        points_register_bonus: Number(data.points_register_bonus || 50),
        points_migration_amount: Number(data.points_migration_amount || 50),
        invite_enabled: data.invite_enabled !== false,
        invite_register_reward_points: Number(data.invite_register_reward_points ?? 20),
        invite_recharge_rebate_percent: Number(data.invite_recharge_rebate_percent ?? 10),
        invite_recharge_bonus_percent: Number(data.invite_recharge_bonus_percent ?? 10),
        login_rate_limit_per_minute_per_ip: Number(data.login_rate_limit_per_minute_per_ip || 5),
        register_rate_limit_per_minute_per_ip: Number(data.register_rate_limit_per_minute_per_ip || 3),
        github_hosting_enabled: data.github_hosting_enabled === true || data.github_hosting_enabled === 'true',
        github_hosting_repo: data.github_hosting_repo || '',
        github_hosting_token: data.github_hosting_token || '',
        github_hosting_branch: data.github_hosting_branch || 'main',
        smtp_server: data.smtp_server || 'smtp.qq.com',
        smtp_port: Number(data.smtp_port || 465),
        smtp_password: data.smtp_password || '',
        smtp_sender: data.smtp_sender || '',
        smtp_sender_name: data.smtp_sender_name || 'Atelier · AI 工作台',
        sendgrid_api_key: data.sendgrid_api_key || '',
        sendgrid_sender: data.sendgrid_sender || '',
        llm_base_url: data.llm_base_url || '',
        llm_api_key: data.llm_api_key || '',
        llm_model: data.llm_model || '',
        llm_max_tokens: Number(data.llm_max_tokens || 2000),
        llm_timeout_seconds: Number(data.llm_timeout_seconds || 30),
        prompt_optimize_enabled: data.prompt_optimize_enabled !== false,
      })
      setDefaultModelId(gen.default_model_id || 'gpt-image-2')
      const modelsObj = gen.generation_models || {}
      const providersObj = gen.generation_providers || {}
      setGenModelsObj(modelsObj)
      setGenProvidersObj(providersObj)
      setGenerationModelsText(JSON.stringify(modelsObj, null, 2))
      setGenerationProvidersText(JSON.stringify(providersObj, null, 2))
    } catch (e) { dialog.alert(e.message || '加载配置失败') } finally { setLoading(false) }
  }
  const fetchFinanceOverview = async (rangeValue = financeRange) => {
    setFinanceLoading(true)
    try {
      const { data } = await adminAPI.financeOverview(rangeValue)
      setFinanceOverview(data || null)
    } catch (e) { dialog.alert(e.message || '财务总览加载失败') } finally { setFinanceLoading(false) }
  }
  const fetchFinanceProviders = async (rangeValue = financeRange) => {
    try {
      const { data } = await adminAPI.financeProviders(rangeValue)
      setFinanceProviders(data?.providers || [])
    } catch (e) { dialog.alert(e.message || '供应商财务统计加载失败') }
  }
  const fetchFinancePurchases = async () => {
    try {
      const { data } = await adminAPI.financePurchases(financePurchasePage, 20, financeProviderFilter || undefined)
      setFinancePurchases(data?.items || [])
      setFinancePurchaseTotal(data?.total || 0)
    } catch (e) { dialog.alert(e.message || '采购批次加载失败') }
  }
  const fetchFinanceRules = async () => {
    try {
      const { data } = await adminAPI.financeQuotaRules(1, 200, financeProviderFilter || undefined)
      setFinanceRules(data?.items || [])
    } catch (e) { dialog.alert(e.message || '消耗规则加载失败') }
  }
  const fetchFinanceTasks = async () => {
    try {
      const { data } = await adminAPI.financeTasks(financeRange, financeTaskPage, 20, financeTaskProviderFilter || undefined, financeModelFilter || undefined, financeStatusFilter || undefined)
      setFinanceTasks(data?.items || [])
      setFinanceTaskTotal(data?.total || 0)
    } catch (e) { dialog.alert(e.message || '调用明细加载失败') }
  }
  const handleCreateFinancePurchase = async () => {
    const draft = financePurchaseDraft
    const payload = { ...draft, amount_rmb: Number(draft.amount_rmb || 0), quota_amount: Number(draft.quota_amount || 0) }
    if (draft.id && draft.adjust_consumed !== '' && draft.adjust_consumed !== undefined) {
      payload.adjust_consumed = Number(draft.adjust_consumed)
    }
    if (!payload.provider_id) { dialog.alert('请选择供应商'); return }
    if (payload.amount_rmb < 0 || payload.quota_amount <= 0) { dialog.alert('采购金额不能小于0，供应商单位数量必须大于0'); return }
    setFinanceCreatingPurchase(true)
    try {
      if (payload.id) {
        await adminAPI.updateFinancePurchase(payload.id, payload)
        dialog.alert('采购批次已更新')
      } else {
        await adminAPI.createFinancePurchase(payload)
        dialog.alert('采购批次已记录')
      }
      setFinancePurchaseDraft({ id: null, provider_id: payload.provider_id, amount_rmb: '', quota_amount: '', purchase_date: nowFinanceTime(), remark: '', can_edit_core: true, consumed_quota: 0, adjust_consumed: '' })
      fetchFinanceOverview(financeRange)
      fetchFinanceProviders(financeRange)
      fetchFinancePurchases()
      fetchFinanceTasks()
    } catch (e) { dialog.alert(e.message || (payload.id ? '更新采购失败' : '新增采购失败')) } finally { setFinanceCreatingPurchase(false) }
  }
  const handleEditFinancePurchase = row => setFinancePurchaseDraft({ id: row.id, provider_id: row.provider_id, amount_rmb: String(row.amount_rmb ?? ''), quota_amount: String(row.quota_amount ?? ''), purchase_date: row.purchase_date || nowFinanceTime(), remark: row.remark || '', can_edit_core: row.can_edit_core !== false, consumed_quota: row.consumed_quota ?? 0, adjust_consumed: '' })
  const handleCancelFinancePurchaseEdit = () => setFinancePurchaseDraft({ id: null, provider_id: financeProviderFilter || '', amount_rmb: '', quota_amount: '', purchase_date: nowFinanceTime(), remark: '', can_edit_core: true, consumed_quota: 0, adjust_consumed: '' })
  const handleDeleteFinancePurchase = async row => {
    if (!await dialog.confirm(`确定删除采购批次 #${row.id}？`)) return
    try {
      await adminAPI.deleteFinancePurchase(row.id)
      if (financePurchaseDraft.id === row.id) handleCancelFinancePurchaseEdit()
      fetchFinanceOverview(financeRange)
      fetchFinanceProviders(financeRange)
      fetchFinancePurchases()
      fetchFinanceTasks()
    } catch (e) { dialog.alert(e.message || '删除采购失败') }
  }
  const handleSaveFinanceRule = async () => {
    const payload = { ...financeRuleDraft, quota_per_success: Number(financeRuleDraft.quota_per_success || 0) }
    if (!payload.provider_id) { dialog.alert('请选择渠道'); return }
    if (!payload.model_id) { dialog.alert('请选择模型'); return }
    if (payload.quota_per_success <= 0) { dialog.alert('单次消耗必须大于0'); return }
    setFinanceRuleSaving(true)
    try {
      await adminAPI.saveFinanceQuotaRule(payload)
      dialog.alert('消耗规则已保存')
      setFinanceRuleDraft({ id: null, provider_id: payload.provider_id, model_id: '', quota_per_success: '', enabled: true, remark: '' })
      fetchFinanceRules()
      fetchFinanceOverview(financeRange)
      fetchFinanceProviders(financeRange)
      fetchFinanceTasks()
    } catch (e) { dialog.alert(e.message || '保存规则失败') } finally { setFinanceRuleSaving(false) }
  }
  const handleDeleteFinanceRule = async (ruleId) => {
    if (!await dialog.confirm('确定删除这条消耗规则？')) return
    try {
      await adminAPI.deleteFinanceQuotaRule(ruleId)
      if (financeRuleDraft.id === ruleId) setFinanceRuleDraft({ id: null, provider_id: '', model_id: '', quota_per_success: '', enabled: true, remark: '' })
      fetchFinanceRules()
      fetchFinanceOverview(financeRange)
      fetchFinanceProviders(financeRange)
    } catch (e) { dialog.alert(e.message || '删除规则失败') }
  }
  const handleEditFinanceRule = (rule) => setFinanceRuleDraft({ id: rule.id, provider_id: rule.provider_id, model_id: rule.model_id, quota_per_success: String(rule.quota_per_success ?? ''), enabled: rule.enabled !== false, remark: rule.remark || '' })
  const onConfigInput = (k, v) => setRuntimeConfig(prev => ({ ...prev, [k]: v }))
  const onConfigToggle = (k, v) => setRuntimeConfig(prev => ({ ...prev, [k]: v }))
  const handleUploadQr = async (key, file) => {
    if (!file) return
    setQrUploading(key)
    try {
      const { data } = await uploadAPI.uploadLocalPublic(file)
      setRuntimeConfig(prev => ({ ...prev, [key]: data?.url || '' }))
      dialog.alert('二维码上传成功')
    } catch (e) { dialog.alert(e.message || '二维码上传失败') } finally { setQrUploading('') }
  }
  const handleRechargePackageField = (idx, key, value) => setRuntimeConfig(prev => ({ ...prev, recharge_packages: (Array.isArray(prev.recharge_packages) ? prev.recharge_packages : []).map((item, i) => i === idx ? { ...item, [key]: value } : item) }))
  const handleAddRechargePackage = () => setRuntimeConfig(prev => { const list = Array.isArray(prev.recharge_packages) ? prev.recharge_packages : []; return { ...prev, recharge_packages: [...list, { amount: '', points: '', label: `套餐${list.length + 1}` }] } })
  const handleDeleteRechargePackage = (idx) => setRuntimeConfig(prev => { const list = Array.isArray(prev.recharge_packages) ? prev.recharge_packages : []; return { ...prev, recharge_packages: list.length <= 1 ? list : list.filter((_, i) => i !== idx) } })
  const handleSaveConfig = async () => {
    const n = [
      'generate_concurrent_limit_per_user', 'home_page_size', 'square_page_size',
      'points_cost_per_generation', 'points_cost_per_optimize', 'points_cost_per_optimize_refine',
      'points_cost_per_chat', 'ai_daily_free_quota', 'chat_context_max_chars',
      'points_cost_per_image_extend', 'points_checkin_reward', 'points_register_bonus',
      'points_migration_amount', 'invite_register_reward_points', 'invite_recharge_rebate_percent',
      'invite_recharge_bonus_percent', 'login_rate_limit_per_minute_per_ip',
      'register_rate_limit_per_minute_per_ip', 'smtp_port', 'llm_max_tokens', 'llm_timeout_seconds',
      'recharge_random_discount_min', 'recharge_random_discount_max',
    ]
    const payload = { ...runtimeConfig }
    payload.default_model_id = (defaultModelId || '').trim() || 'gpt-image-2'
    let recharge_packages
    for (const k of n) payload[k] = Number(payload[k])
    if (
      payload.generate_concurrent_limit_per_user < 1 ||
      payload.home_page_size < 1 ||
      payload.square_page_size < 1 ||
      payload.points_cost_per_generation <= 0 ||
      payload.points_cost_per_optimize <= 0 ||
      payload.points_cost_per_optimize_refine <= 0 ||
      payload.points_cost_per_chat <= 0 ||
      payload.ai_daily_free_quota < 0 ||
      payload.chat_context_max_chars < 1000 ||
      payload.points_cost_per_image_extend <= 0 ||
      payload.login_rate_limit_per_minute_per_ip < 1 ||
      payload.register_rate_limit_per_minute_per_ip < 1 ||
      payload.points_checkin_reward < 0 ||
      payload.points_register_bonus < 0 ||
      payload.points_migration_amount < 0 ||
      payload.invite_register_reward_points < 0 ||
      payload.invite_recharge_rebate_percent < 0 ||
      payload.invite_recharge_bonus_percent < 0 ||
      payload.recharge_random_discount_min < 0.01 ||
      payload.recharge_random_discount_max < 0.01 ||
      payload.recharge_random_discount_max < payload.recharge_random_discount_min
    ) {
      dialog.alert('限制配置不合法')
      return
    }
    try {
      recharge_packages = Array.isArray(payload.recharge_packages) ? payload.recharge_packages : []
      if (!Array.isArray(recharge_packages) || !recharge_packages.length) throw new Error('充值档位需要 JSON 数组且至少保留一项')
      recharge_packages = recharge_packages.map((item, idx) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`充值档位第 ${idx + 1} 项不是对象`)
        const amount = Number(item.amount), points = Number(item.points), label = String(item.label || `套餐${idx + 1}`).trim()
        if (!(amount > 0) || !(points > 0) || !Number.isFinite(amount) || !Number.isFinite(points)) throw new Error(`充值档位第 ${idx + 1} 项金额或积分不合法`)
        if (!label) throw new Error(`充值档位第 ${idx + 1} 项标题不能为空`)
        return { amount: Math.round(amount * 100) / 100, points: Math.round(points), label }
      })
    } catch (e) { dialog.alert(e.message || '充值档位 JSON 格式错误'); return }
    let generation_models
    let generation_providers
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
    payload.recharge_packages = recharge_packages
    payload.generation_models = generation_models
    payload.generation_providers = generation_providers
    setConfigSaving(true)
    try {
      await configAPI.update(payload)
      dialog.alert('保存成功')
      fetchRuntimeConfig()
    } catch (e) { dialog.alert(e.message || '保存失败') } finally { setConfigSaving(false) }
  }
  const syncGenJsonFromForm = (modelsObj, providersObj) => {
    setGenerationModelsText(JSON.stringify(modelsObj, null, 2))
    setGenerationProvidersText(JSON.stringify(providersObj, null, 2))
    setJsonDirty(false)
  }
  const handleAddModel = () => {
    const id = `image-model-${Date.now()}`
    const next = { ...genModelsObj, [id]: { label: '新模型', capability: 'image', enabled: true, providers: [], params: {} } }
    setGenModelsObj(next); syncGenJsonFromForm(next, genProvidersObj)
  }
  const handleDeleteModel = (id) => {
    const next = { ...genModelsObj }
    delete next[id]
    setGenModelsObj(next)
    if (defaultModelId === id) setDefaultModelId(Object.keys(next)[0] || 'gpt-image-2')
    syncGenJsonFromForm(next, genProvidersObj)
  }
  const handleModelField = (id, key, value) => {
    const next = { ...genModelsObj, [id]: { ...(genModelsObj[id] || {}), [key]: value } }
    setGenModelsObj(next); syncGenJsonFromForm(next, genProvidersObj)
  }
  const handleAddProvider = () => {
    const id = `provider-${Date.now()}`
    const next = { ...genProvidersObj, [id]: { type: 'wuyin', enabled: true, priority: 100, api_url: '', api_key: '', circuit_fail_threshold: 3, circuit_cooldown_seconds: 60, unit_name: '供应商额度', unit_code: 'vendor_quota' } }
    setGenProvidersObj(next); syncGenJsonFromForm(genModelsObj, next)
  }
  const handleDeleteProvider = (id) => {
    const next = { ...genProvidersObj }
    delete next[id]
    const nextModels = {}
    for (const [mid, m] of Object.entries(genModelsObj)) nextModels[mid] = { ...m, providers: (Array.isArray(m?.providers) ? m.providers : []).filter(pid => pid !== id) }
    setGenProvidersObj(next); setGenModelsObj(nextModels); syncGenJsonFromForm(nextModels, next)
  }
  const handleProviderField = (id, key, value) => {
    const next = { ...genProvidersObj, [id]: { ...(genProvidersObj[id] || {}), [key]: value } }
    setGenProvidersObj(next); syncGenJsonFromForm(genModelsObj, next)
  }
  const openProviderEditor = (id) => {
    const p = genProvidersObj[id] || {}
    setEditingProviderId(id)
    setEditingProviderDraft({ type: p.type || 'wuyin', enabled: p.enabled !== false, priority: Number(p.priority ?? 100), api_url: p.api_url || '', api_key: p.api_key || '', circuit_fail_threshold: Number(p.circuit_fail_threshold ?? 3), circuit_cooldown_seconds: Number(p.circuit_cooldown_seconds ?? 60), unit_name: p.unit_name || '供应商额度', unit_code: p.unit_code || 'vendor_quota' })
  }
  const openModelEditor = (id) => {
    const m = genModelsObj[id] || {}
    const resolutionCosts = m?.params?.resolution_costs || {}
    setDraggingModelProviderId('')
    setEditingModelId(id)
    setEditingModelDraft({ label: m.label || '', capability: m.capability || 'image', enabled: m.enabled !== false, providers: Array.isArray(m.providers) ? m.providers : [], points_cost: m?.params?.points_cost ?? '', resolution_cost_low: resolutionCosts.low ?? m?.params?.points_cost ?? '', resolution_cost_medium: resolutionCosts.medium ?? '', resolution_cost_high: resolutionCosts.high ?? '' })
  }
  const applyProviderEditor = () => {
    if (!editingProviderId) return
    const next = { ...genProvidersObj, [editingProviderId]: { ...(genProvidersObj[editingProviderId] || {}), ...editingProviderDraft } }
    setGenProvidersObj(next); syncGenJsonFromForm(genModelsObj, next); setEditingProviderId('')
  }
  const applyModelEditor = () => {
    if (!editingModelId) return
    const providers = Array.isArray(editingModelDraft.providers) ? [...new Set(editingModelDraft.providers.map(i => String(i || '').trim()).filter(Boolean))] : []
    const prev = genModelsObj[editingModelId] || {}
    const params = { ...(prev.params || {}) }
    if (isVipModelId(editingModelId)) {
      const lowCost = Number(editingModelDraft.resolution_cost_low || 0)
      const mediumCost = Number(editingModelDraft.resolution_cost_medium || 0)
      const highCost = Number(editingModelDraft.resolution_cost_high || 0)
      if (lowCost > 0) params.points_cost = Math.round(lowCost * 10000) / 10000
      else delete params.points_cost
      const nextResolutionCosts = {}
      if (lowCost > 0) nextResolutionCosts.low = Math.round(lowCost * 10000) / 10000
      if (mediumCost > 0) nextResolutionCosts.medium = Math.round(mediumCost * 10000) / 10000
      if (highCost > 0) nextResolutionCosts.high = Math.round(highCost * 10000) / 10000
      if (lowCost > 0) nextResolutionCosts.auto = Math.round(lowCost * 10000) / 10000
      if (Object.keys(nextResolutionCosts).length) params.resolution_costs = nextResolutionCosts
      else delete params.resolution_costs
    } else {
      const pointsCost = Number(editingModelDraft.points_cost || 0)
      if (pointsCost > 0) params.points_cost = Math.round(pointsCost * 10000) / 10000
      else delete params.points_cost
      delete params.resolution_costs
    }
    const next = { ...genModelsObj, [editingModelId]: { ...prev, label: editingModelDraft.label, capability: editingModelDraft.capability, enabled: editingModelDraft.enabled, providers, params } }
    setGenModelsObj(next); syncGenJsonFromForm(next, genProvidersObj); setDraggingModelProviderId(''); setEditingModelId('')
  }
  const reorderEditingModelProviders = (fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return
    setEditingModelDraft(prev => {
      const arr = Array.isArray(prev.providers) ? [...prev.providers] : []
      const from = arr.indexOf(fromId), to = arr.indexOf(toId)
      if (from < 0 || to < 0 || from === to) return prev
      const [item] = arr.splice(from, 1)
      arr.splice(to, 0, item)
      return { ...prev, providers: arr }
    })
  }
  const toggleEditingModelProvider = (providerId) => {
    setEditingModelDraft(prev => {
      const arr = Array.isArray(prev.providers) ? [...prev.providers] : []
      return arr.includes(providerId) ? { ...prev, providers: arr.filter(i => i !== providerId) } : { ...prev, providers: [...arr, providerId] }
    })
  }
  const handleApplyAdvanced = () => {
    try {
      const m = JSON.parse(generationModelsText || '{}')
      const p = JSON.parse(generationProvidersText || '{}')
      if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('generation_models 不是对象')
      if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('generation_providers 不是对象')
      setGenModelsObj(m); setGenProvidersObj(p); setJsonDirty(false); dialog.alert('已应用高级JSON到表单')
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
      const { data } = await adminAPI.hostingImages(hostingPage, 50, hostingTypeFilter || undefined)
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
      window.dispatchEvent(new CustomEvent('admin-recharge-updated',{ detail:{ pending: pendingRes.status === 'fulfilled' ? (pendingRes.value.data.total || 0) : rechargePendingCount } }))
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

  const handleRefundRecharge = async (row) => {
    if (!await dialog.confirm(`确认回退发放？将扣除用户 ${row.points} 积分（当前余额不足则扣至0）`)) return
    try {
      const { data } = await adminAPI.refundRecharge(row.id, { review_note: '管理员回退发放' })
      dialog.alert(data.message || '回退发放成功')
      fetchRechargeRequests()
    } catch (e) { dialog.alert(e.message || '回退发放失败') }
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
    const amount = Number(adjustAmount)
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

  const chatFetch = async (url, options = {}) => {
    const res = await fetch(url, { credentials: 'include', ...options })
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}))
      throw new Error(errData.detail || errData.message || `请求失败(${res.status})`)
    }
    return res.json()
  }

  const fetchChatSessions = async () => {
    setChatLoading(true)
    try {
      const params = new URLSearchParams({ page: String(chatPage), size: '20' })
      if (chatQuery) params.set('query', chatQuery)
      const data = await chatFetch(`/api/admin/chat/sessions?${params.toString()}`)
      setChatSessions(data.items || [])
      setChatTotal(data.total || 0)
    } catch (e) { dialog.alert(e.message || '加载失败') } finally { setChatLoading(false) }
  }

  const openChatSession = async (session) => {
    setChatViewSession({ session, messages: null, loading: true, error: '' })
    try {
      const data = await chatFetch(`/api/admin/chat/sessions/${session.id}/messages`)
      setChatViewSession(prev => prev?.session?.id === session.id ? { session, messages: data.items || [], loading: false, error: '' } : prev)
    } catch (e) {
      setChatViewSession(prev => prev?.session?.id === session.id ? { session, messages: [], loading: false, error: e.message } : prev)
    }
  }

  const closeChatSession = () => setChatViewSession(null)

  const handleDeleteChatSession = async (sessionId) => {
    if (!await dialog.confirm('确定删除该聊天记录？删除后不可恢复。')) return
    try {
      await chatFetch(`/api/admin/chat/sessions/${sessionId}`, { method: 'DELETE' })
      setChatViewSession(prev => prev?.session?.id === sessionId ? null : prev)
      fetchChatSessions()
    } catch (e) { dialog.alert(e.message || '删除失败') }
  }

  const fetchLlmModels = async () => {
    setLlmModelsLoading(true)
    try {
      const data = await chatFetch('/api/admin/llm-models')
      setLlmModels(data.items || [])
      setGlobalModelId(data.global_model_id || '')
    } catch (e) { dialog.alert(e.message || '加载失败') } finally { setLlmModelsLoading(false) }
  }

  const saveLlmModel = async (payload) => {
    await chatFetch('/api/admin/llm-models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    fetchLlmModels()
  }

  const addLlmModels = async (models) => {
    await chatFetch('/api/admin/llm-models/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ models }) })
    fetchLlmModels()
  }

  const updateLlmModels = async (modelIds, data) => {
    await chatFetch('/api/admin/llm-models/batch', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model_ids: modelIds, data }) })
    fetchLlmModels()
  }

  const deleteLlmModel = async (modelId) => {
    await chatFetch(`/api/admin/llm-models/${encodeURIComponent(modelId)}`, { method: 'DELETE' })
    fetchLlmModels()
  }

  // 测试 LLM 连接：传表单当前值（可未保存），后端返回 { ok, text|error, latency_ms }
  const testLlmModel = async (payload) => {
    return chatFetch('/api/admin/llm-models/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  }
  const handleCreateUser = async () => {
    const payload = { account: (createUserDraft.username || '').trim(), password: (createUserDraft.password || '').trim(), nickname: (createUserDraft.nickname || '').trim() }
    if (!/^[A-Za-z0-9_]{4,16}$/.test(payload.account)) { dialog.alert('账号需为4到16位字母、数字或下划线'); return }
    if (payload.password.length < 6 || payload.password.length > 50) { dialog.alert('密码长度需在6到50位之间'); return }
    setCreatingUser(true)
    try {
      const { data } = await adminAPI.createUser(payload)
      dialog.alert(`账号 ${data?.user?.account || payload.account} 已创建`)
      setCreateUserDraft({ username: '', password: '', nickname: '' })
      fetchUsers()
    } catch (e) { dialog.alert(e.message || '创建失败') } finally { setCreatingUser(false) }
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
  const financeProviderOptions = Object.keys(genProvidersObj || {}).map(id => ({ id, label: `${id}${genProvidersObj?.[id]?.unit_name ? ` (${genProvidersObj[id].unit_name})` : ''}` }))
  const financeModelOptions = Object.keys({ ...(genModelsObj || {}), ...(modelLabelMap || {}) }).map(id => ({ id, label: modelLabelMap[id] || genModelsObj?.[id]?.label || id }))
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
        <div className="flex gap-1 p-0.5 rounded-2xl mb-4 overflow-x-auto scrollbar-hide" style={{ background: 'var(--border-color)', scrollbarWidth: 'none' }}>
          {[
            { k: 'stats', l: '系统统计', i: BarChart3 },
            { k: 'finance', l: '财务中心', i: Wallet },
            { k: 'subscription', l: '订阅与用量', i: CreditCard },
            { k: 'users', l: '用户管理', i: Users },
            { k: 'history', l: '生成历史', i: Clock },
            { k: 'chat', l: '聊天记录', i: MessageSquare },
            { k: 'llm_models', l: '模型档案', i: Cpu },
            { k: 'hosting', l: '图床管理', i: HardDrive },
            { k: 'banned', l: '违禁词管理', i: Ban },
            { k: 'classification', l: 'AI分类', i: Tags },
            { k: 'codes', l: '兑换码', i: Key },
            { k: 'recharge_review', l: '充值审核', i: Ticket },
            { k: 'announcements', l: '公告管理', i: Megaphone },
            { k: 'evlogs', l: '邮件验证', i: Mail },
            { k: 'config', l: '配置中心', i: SlidersHorizontal },
          ].map(({ k, l, i: Icon }) => (
            <button
              key={k}
              onClick={() => switchTab(k)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${tab === k ? 'bg-[var(--bg-card)] shadow-sm' : ''}`}
              style={{ color: tab === k ? 'var(--text-primary)' : 'var(--text-secondary)' }}
            >
              <Icon size={14} />{l}
              {k === 'recharge_review' && rechargePendingCount > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] text-white" style={{ background: 'var(--color-error)' }}>
                  {rechargePendingCount}
                </span>
              )}
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
                    <button key={i.v} onClick={() => { if (statsRange === i.v) return; setStatsRange(i.v); fetchSystemStats(i.v) }} className={`px-3 py-1.5 rounded-2xl text-xs font-medium border ${statsRange === i.v ? 'text-white border-transparent' : ''}`} style={statsRange === i.v ? { background: 'var(--accent)' } : { borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>{i.l}</button>
                  ))}
                  <div className="ml-auto text-xs" style={{ color: 'var(--text-secondary)' }}>{overviewStats?.start_date || '-'} ~ {overviewStats?.end_date || '-'}</div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                  <div className="p-3 rounded-2xl border" style={{ borderColor: 'var(--border-color)' }}><div className="text-xs" style={{ color: 'var(--text-secondary)' }}>请求数</div><div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{overviewStats?.kpi?.requests ?? 0}</div></div>
                  <div className="p-3 rounded-2xl border" style={{ borderColor: 'var(--border-color)' }}><div className="text-xs" style={{ color: 'var(--text-secondary)' }}>成功数</div><div className="text-lg font-semibold" style={{ color: 'var(--color-success)' }}>{overviewStats?.kpi?.success ?? 0}</div></div>
                  <div className="p-3 rounded-2xl border" style={{ borderColor: 'var(--border-color)' }}><div className="text-xs" style={{ color: 'var(--text-secondary)' }}>成功率</div><div className="text-lg font-semibold" style={{ color: 'var(--color-success)' }}>{overviewStats?.kpi?.success_rate ?? 0}%</div></div>
                  <div className="p-3 rounded-2xl border" style={{ borderColor: 'var(--border-color)' }}><div className="text-xs" style={{ color: 'var(--text-secondary)' }}>平均耗时</div><div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{overviewStats?.kpi?.avg_duration_seconds ?? 0}s</div></div>
                  <div className="p-3 rounded-2xl border" style={{ borderColor: 'var(--border-color)' }}><div className="text-xs" style={{ color: 'var(--text-secondary)' }}>新增用户</div><div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{overviewStats?.kpi?.new_users ?? 0}</div></div>
                  <div className="p-3 rounded-2xl border" style={{ borderColor: 'var(--border-color)' }}><div className="text-xs" style={{ color: 'var(--text-secondary)' }}>活跃用户</div><div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{overviewStats?.kpi?.active_users ?? 0}</div></div>
                  <div className="p-3 rounded-2xl border" style={{ borderColor: 'var(--border-color)' }}><div className="text-xs" style={{ color: 'var(--text-secondary)' }}>处理中</div><div className="text-lg font-semibold" style={{ color: 'var(--color-warning)' }}>{overviewStats?.kpi?.processing_tasks ?? 0}</div></div>
                  <div className="p-3 rounded-2xl border" style={{ borderColor: 'var(--border-color)' }}><div className="text-xs" style={{ color: 'var(--text-secondary)' }}>积分消耗</div><div className="text-lg font-semibold" style={{ color: 'var(--color-error)' }}>{(overviewStats?.trends || []).reduce((s, i) => s + Number(i.points_spent || 0), 0)}</div></div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                  <div className="p-3 rounded-2xl border lg:col-span-2" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{{all:'总计',today:'今日','7d':'7天','30d':'30天'}[statsRange] || '7天'}趋势</div>
                      {[
                        { v: 'requests', l: '请求' },
                        { v: 'success', l: '成功' },
                        { v: 'new_users', l: '新增用户' },
                        { v: 'revenue', l: '营收' },
                        { v: 'points_spent', l: '积分消耗' },
                      ].map(i => (
                        <button key={i.v} onClick={() => setTrendMetric(i.v)} className={`px-2 py-1 rounded-lg text-[11px] border ${trendMetric === i.v ? 'text-white border-transparent' : ''}`} style={trendMetric === i.v ? { background: 'var(--accent)' } : { borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>{i.l}</button>
                      ))}
                    </div>
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={overviewStats?.trends || []} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                          <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} />
                          <YAxis tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} />
                          <Tooltip />
                          <Line type="monotone" dataKey={trendMetric} stroke="var(--accent)" strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <div className="p-3 rounded-2xl border" style={{ borderColor: 'var(--border-color)' }}>
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
                  <div className="p-3 rounded-2xl border" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>{{all:'总计',today:'今日','7d':'近7天','30d':'近30天'}[statsRange] || '近7天'}生成Top用户</div>
                    <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                      {(overviewStats?.leaderboards?.success_top || []).slice(0, 8).map((i, idx) => <div key={`s-${i.user_id}`} className="flex items-center justify-between text-sm gap-2"><span className="truncate" title={`${i.nickname || i.account || i.username}`} style={{ color: 'var(--text-primary)' }}>{idx + 1}. {i.nickname || i.account || i.username}</span><span className="shrink-0" style={{ color: 'var(--color-success)' }}>{i.success_count}</span></div>)}
                    </div>
                  </div>
                  <div className="p-3 rounded-2xl border" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>{{all:'总计',today:'今日','7d':'近7天','30d':'近30天'}[statsRange] || '近7天'}充值Top用户</div>
                    <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                      {(overviewStats?.leaderboards?.recharge_top || []).slice(0, 8).map((i, idx) => <div key={`r-${i.user_id}`} className="flex items-center justify-between text-sm gap-2"><span className="truncate" title={`${i.nickname || i.account || i.username}`} style={{ color: 'var(--text-primary)' }}>{idx + 1}. {i.nickname || i.account || i.username}</span><span className="shrink-0" style={{ color: 'var(--color-warning)' }}>¥{i.amount}</span></div>)}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div className="p-3 rounded-2xl border" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>提示词分类（管理员全量）</div>
                    <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                      {(overviewStats?.categories?.admin_all || []).slice(0, 10).map(i => <div key={`a-${i.category}`} className="flex items-center justify-between text-sm gap-2"><span className="truncate" title={`${i.category}`} style={{ color: 'var(--text-primary)' }}>{i.category}</span><span className="shrink-0" style={{ color: 'var(--text-secondary)' }}>{i.count}</span></div>)}
                    </div>
                  </div>
                  <div className="p-3 rounded-2xl border" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>提示词分类（用户可见，已排除冻结）</div>
                    <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                      {(overviewStats?.categories?.user_visible || []).slice(0, 10).map(i => <div key={`u-${i.category}`} className="flex items-center justify-between text-sm gap-2"><span className="truncate" title={`${i.category}`} style={{ color: 'var(--text-primary)' }}>{i.category}</span><span className="shrink-0" style={{ color: 'var(--text-secondary)' }}>{i.count}</span></div>)}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div className="p-3 rounded-2xl border" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>模型调用分布</div>
                    <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                      {(overviewStats?.generation?.models || []).slice(0, 12).map(i => <div key={`m-${i.model_id}`} className="flex items-center justify-between text-sm gap-2"><span className="truncate" title={`${i.model_label || modelLabelMap[i.model_id] || i.model_id}`} style={{ color: 'var(--text-primary)' }}>{i.model_label || modelLabelMap[i.model_id] || i.model_id}</span><span className="shrink-0" style={{ color: 'var(--text-secondary)' }}>{i.total} / {i.success_rate}%</span></div>)}
                    </div>
                  </div>
                  <div className="p-3 rounded-2xl border" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>渠道调用分布</div>
                    <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                      {(overviewStats?.generation?.providers || []).slice(0, 12).map(i => <div key={`p-${i.provider_id}`} className="flex items-center justify-between text-sm gap-2"><span className="truncate" title={`${i.provider_id}`} style={{ color: 'var(--text-primary)' }}>{`${i.provider_id === 'unknown' ? 'unknown(历史缺失)' : i.provider_id} (${i.provider_type})`}</span><span className="shrink-0" style={{ color: 'var(--text-secondary)' }}>{i.total} / {i.success_rate}%</span></div>)}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div className="p-3 rounded-2xl border" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>渠道类型汇总</div>
                    <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                      {(overviewStats?.generation?.provider_types || []).slice(0, 12).map(i => <div key={`t-${i.provider_type}`} className="flex items-center justify-between text-sm gap-2"><span className="truncate" title={`${i.provider_type}`} style={{ color: 'var(--text-primary)' }}>{i.provider_type}</span><span className="shrink-0" style={{ color: 'var(--text-secondary)' }}>{i.total} / {i.success_rate}%</span></div>)}
                    </div>
                  </div>
                  <div className="p-3 rounded-2xl border" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>Fallback 尝试</div>
                    <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                      {(overviewStats?.generation?.fallback_attempts || []).slice(0, 12).map(i => (
                        <div key={`f-${i.provider_id}`} className="flex items-center justify-between text-sm gap-2">
                          <span className="truncate" title={`${i.provider_id}`} style={{ color: 'var(--text-primary)' }}>
                            {`${i.provider_id === 'unknown' ? 'unknown(历史缺失)' : i.provider_id} (${i.provider_type})`}
                          </span>
                          <span className="shrink-0" style={{ color: 'var(--text-secondary)' }}>{i.attempts} / {i.attempt_ok_rate}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="p-3 rounded-2xl border" style={{ borderColor: 'var(--border-color)' }}>
                  <div className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>模型 × 渠道交叉矩阵（总量/成功率）</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr>
                          <th className="px-2 py-1.5 text-left font-medium sticky left-0 z-10" style={{ color: 'var(--text-secondary)', background: 'var(--bg-card)' }}>模型\\渠道</th>
                          {(overviewStats?.generation?.matrix?.providers || []).map(pid => <th key={`mxh-${pid}`} className="px-2 py-1.5 text-right font-medium whitespace-nowrap" style={{ color: 'var(--text-secondary)', background: 'var(--bg-card)' }}>{pid}</th>)}
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
                  <div className="p-3 rounded-2xl border" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>当前限制</div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                      <div style={{ color: 'var(--text-primary)' }}>登录限流：{systemStats.limits.login_rate}</div>
                      <div style={{ color: 'var(--text-primary)' }}>注册限流：{systemStats.limits.register_rate}</div>
                      <div style={{ color: 'var(--text-primary)' }}>生成并发：{systemStats.limits.generate_concurrent}</div>
                      <div style={{ color: 'var(--text-primary)' }}>默认生成扣分：{systemStats.limits.points_cost_per_generation}</div>
                      <div style={{ color: 'var(--text-primary)' }}>图片续期扣分：{systemStats.limits.points_cost_per_image_extend}</div>
                      <div style={{ color: 'var(--text-primary)' }}>签到奖励：{systemStats.limits.points_checkin_reward}</div>
                      <div style={{ color: 'var(--text-primary)' }}>注册送分：{systemStats.limits.points_register_bonus}</div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : tab === 'finance' ? (
          <AdminFinanceTab
            financeRange={financeRange} setFinanceRange={setFinanceRange}
            financeOverview={financeOverview} financeProviders={financeProviders}
            financePurchases={financePurchases} financePurchaseTotal={financePurchaseTotal}
            financePurchasePage={financePurchasePage} setFinancePurchasePage={setFinancePurchasePage}
            financeTasks={financeTasks} financeTaskTotal={financeTaskTotal}
            financeTaskPage={financeTaskPage} setFinanceTaskPage={setFinanceTaskPage}
            financeProviderFilter={financeProviderFilter} setFinanceProviderFilter={setFinanceProviderFilter}
            financeTaskProviderFilter={financeTaskProviderFilter} setFinanceTaskProviderFilter={setFinanceTaskProviderFilter}
            financeModelFilter={financeModelFilter} setFinanceModelFilter={setFinanceModelFilter}
            financeStatusFilter={financeStatusFilter} setFinanceStatusFilter={setFinanceStatusFilter}
            financeLoading={financeLoading} financeCreatingPurchase={financeCreatingPurchase}
            financePurchaseDraft={financePurchaseDraft} setFinancePurchaseDraft={setFinancePurchaseDraft}
            handleCreatePurchase={handleCreateFinancePurchase}
            handleEditPurchase={handleEditFinancePurchase}
            handleDeletePurchase={handleDeleteFinancePurchase}
            handleCancelPurchaseEdit={handleCancelFinancePurchaseEdit}
            providerOptions={financeProviderOptions} modelOptions={financeModelOptions}
            financeRules={financeRules} financeRuleDraft={financeRuleDraft}
            setFinanceRuleDraft={setFinanceRuleDraft} financeRuleSaving={financeRuleSaving}
            handleSaveFinanceRule={handleSaveFinanceRule}
            handleEditFinanceRule={handleEditFinanceRule}
            handleDeleteFinanceRule={handleDeleteFinanceRule}
          />
        ) : tab === 'subscription' ? (
          <AdminSubscriptionTab />
        ) : tab === 'users' ? (
          <AdminUsersTab
            userTotal={userTotal} userQuery={userQuery} setUserQuery={setUserQuery}
            handleMigratePoints={handleMigratePoints} loading={loading} users={users}
            setAdjustUserId={setAdjustUserId} setAdjustAmount={setAdjustAmount} setAdjustDesc={setAdjustDesc}
            resetPwdUserId={resetPwdUserId} setResetPwdUserId={setResetPwdUserId}
            resetPwdValue={resetPwdValue} setResetPwdValue={setResetPwdValue}
            handleToggleFreeze={handleToggleFreeze} handleDeleteUser={handleDeleteUser}
            handleResetPassword={handleResetPassword} userPage={userPage} setUserPage={setUserPage}
            createUserDraft={createUserDraft} setCreateUserDraft={setCreateUserDraft}
            creatingUser={creatingUser} handleCreateUser={handleCreateUser}
          />
        ) : tab === 'announcements' ? (
          <AdminAnnouncementsTab newTitle={newTitle} setNewTitle={setNewTitle} newContent={newContent} setNewContent={setNewContent} handleCreateAnnouncement={handleCreateAnnouncement} creatingAnnouncement={creatingAnnouncement} announcementTotal={announcementTotal} loading={loading} announcements={announcements} handleDeleteAnnouncement={handleDeleteAnnouncement} announcementPage={announcementPage} setAnnouncementPage={setAnnouncementPage} />
        ) : tab === 'evlogs' ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex-1"><SearchInput value={evQuery} onChange={setEvQuery} placeholder="搜索邮箱或 IP" /></div>
            </div>
            {loading ? (
              <div className="flex justify-center py-20"><div className="w-8 h-8 border-2 rounded-full animate-spin-slow" style={{ borderTopColor: 'var(--accent)', borderColor: 'var(--border-color)' }} /></div>
            ) : (
              <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr style={{ background: 'var(--bg-card)' }}>
                      <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>ID</th>
                      <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>邮箱</th>
                      <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>验证码</th>
                      <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>IP</th>
                      <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>使用状态</th>
                      <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>注册状态</th>
                      <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>创建时间</th>
                    </tr></thead>
                    <tbody>
                      {evLogs.map(item => (
                        <tr key={item.id} className="border-t" style={{ borderColor: 'var(--border-color)' }}>
                          <td className="px-3 py-2" style={{ color: 'var(--text-primary)' }}>{item.id}</td>
                          <td className="px-3 py-2" style={{ color: 'var(--text-primary)' }}>{item.email}</td>
                          <td className="px-3 py-2 font-mono" style={{ color: 'var(--text-primary)' }}>{item.code}</td>
                          <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>{item.ip}</td>
                          <td className="px-3 py-2">
                            <span className="px-2 py-0.5 rounded-full" style={{ color: item.used ? 'var(--color-success)' : 'var(--text-secondary)', background: item.used ? 'color-mix(in srgb, var(--color-success) 15%, transparent)' : 'color-mix(in srgb, var(--text-secondary) 10%, transparent)' }}>
                              {item.used ? '已使用' : '未使用'}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <span className="px-2 py-0.5 rounded-full" style={{ color: item.registered ? 'var(--color-success)' : 'var(--text-secondary)', background: item.registered ? 'color-mix(in srgb, var(--color-success) 15%, transparent)' : 'color-mix(in srgb, var(--text-secondary) 10%, transparent)' }}>
                              {item.registered ? '已注册' : '未注册'}
                            </span>
                          </td>
                          <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>{item.created_at ? (() => { const s = String(item.created_at); const withTz = s.includes('T') ? (s.includes('+') || s.includes('Z') ? s : s + '+08:00') : s.replace(' ', 'T') + '+08:00'; return new Date(withTz).toLocaleString('zh-CN') })() : '-'}</td>
                        </tr>
                      ))}
                      {evLogs.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center" style={{ color: 'var(--text-secondary)' }}>暂无数据</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <Pagination page={evPage} totalPages={Math.ceil(evTotal / 20)} onPageChange={setEvPage} />
          </div>
        ) : tab === 'hosting' ? (
          <AdminHostingTab
            hostingStats={hostingStats} handleCleanDuplicates={handleCleanDuplicates}
            hostingTotal={hostingTotal} hostingSelectMode={hostingSelectMode}
            hostingChecked={hostingChecked} hostingImages={hostingImages}
            setHostingChecked={setHostingChecked} handleHostingBatchDelete={handleHostingBatchDelete}
            setHostingSelectMode={setHostingSelectMode} loading={loading}
            toggleHostingCheck={toggleHostingCheck} setHostingDetail={setHostingDetail}
            hostingPage={hostingPage} setHostingPage={setHostingPage}
            hostingTypeFilter={hostingTypeFilter} setHostingTypeFilter={setHostingTypeFilter}
          />
        ) : tab === 'banned' ? (
          <AdminBannedTab bannedWordsTotal={bannedWordsTotal} bannedWordsQuery={bannedWordsQuery} setBannedWordsQuery={setBannedWordsQuery} setShowBatchImport={setShowBatchImport} newBannedWord={newBannedWord} setNewBannedWord={setNewBannedWord} handleAddBannedWord={handleAddBannedWord} loading={loading} bannedWords={bannedWords} handleDeleteBannedWord={handleDeleteBannedWord} bannedWordsPage={bannedWordsPage} setBannedWordsPage={setBannedWordsPage} />
        ) : tab === 'codes' ? (
          <div className="space-y-6">
            <div className="p-4 rounded-2xl border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)' }}>
              <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>生成兑换码</h3>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>积分额度</label>
                  <div className="flex gap-1.5 mb-1.5">
                    {[10, 50, 100, 500].map(p => (
                      <button key={p} onClick={() => { setCodePoints(p); setCustomCode('') }}
                        className={`px-2.5 py-1 rounded-2xl text-xs font-semibold transition-all ${codePoints === p && !customCode ? 'bg-accent text-white shadow-sm' : 'border hover:border-accent/50'}`}
                        style={codePoints === p && !customCode ? {} : { borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}>
                        {p}
                      </button>
                    ))}
                  </div>
                  <input type="number" value={customCode} onChange={e => { setCustomCode(e.target.value); setCodePoints(parseInt(e.target.value) || 0) }}
                    placeholder="自定义" min={1}
                    className="w-24 px-2.5 py-1.5 rounded-2xl text-xs border outline-none focus:border-accent/50 transition-colors"
                    style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>数量</label>
                  <input type="number" value={codeCount} onChange={e => setCodeCount(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                    min={1} max={100}
                    className="w-20 px-2.5 py-1.5 rounded-2xl text-xs border outline-none focus:border-accent/50 transition-colors"
                    style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                </div>
                <button onClick={handleGenerateCodes} disabled={generatingCodes || codePoints <= 0}
                  className="px-4 py-1.5 rounded-2xl text-xs font-semibold bg-accent text-white hover:opacity-90 disabled:opacity-50 transition-all shadow-sm">
                  {generatingCodes ? '生成中...' : '生成'}
                </button>
              </div>
              {generatedCodes.length > 0 && (
                <div className="mt-3 p-2.5 rounded-2xl text-xs" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium" style={{ background: 'color-mix(in srgb, var(--color-success) 12%, transparent)', color: 'var(--color-success)' }}>成功</span>
                    <span style={{ color: 'var(--text-secondary)' }}>已生成 {generatedCodes.length} 个兑换码</span>
                  </div>
                  <div className="font-mono break-all leading-relaxed" style={{ color: 'var(--accent)' }}>{generatedCodes.join('、')}</div>
                </div>
              )}
            </div>
          </div>
        ) : tab === 'recharge_review' ? (
          <div className="space-y-6">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>充值记录</h3>
                  {rechargePendingCount > 0 && <span className="px-2 py-0.5 rounded-full text-[11px] text-white" style={{ background: 'var(--color-error)' }}>待审 {rechargePendingCount}</span>}
                </div>
                <div className="flex items-center gap-1.5">
                  {rechargePendingCount > 0 && rechargeStatusFilter !== 'pending' && <button onClick={() => { setRechargeStatusFilter('pending'); setCodesPage(1) }} className="px-2 py-1 rounded-2xl text-xs font-medium text-white" style={{ background: 'var(--color-error)' }}>只看待审</button>}
                  <select value={rechargeStatusFilter} onChange={e => { setRechargeStatusFilter(e.target.value); setCodesPage(1) }}
                    className="px-2 py-1 rounded-2xl text-xs font-medium border outline-none cursor-pointer"
                    style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                    <option value="all">全部</option>
                    <option value="pending">待审核</option>
                    <option value="approved">已通过</option>
                    <option value="rejected">已拒绝</option>
                    <option value="refunded">已回退</option>
                  </select>
                  <select value={codesSort} onChange={e => setCodesSort(e.target.value)}
                    className="px-2 py-1 rounded-2xl text-xs font-medium border outline-none cursor-pointer"
                    style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                    <option value="created_at">按创建时间</option>
                    <option value="is_used">按使用状态</option>
                    <option value="points">按积分额度</option>
                  </select>
                  <button onClick={() => setCodesOrder(o => o === 'desc' ? 'asc' : 'desc')}
                    className="px-2 py-1 rounded-2xl text-xs font-medium border hover:bg-bg-hover transition-colors"
                    style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}>
                    {codesOrder === 'desc' ? '↓' : '↑'}
                  </button>
                </div>
              </div>
              {rechargePendingCount > 0 && (
                <div className="mb-3 px-3 py-2 rounded-2xl border text-sm flex items-center justify-between gap-3" style={{ borderColor: 'var(--color-warning)', background: 'color-mix(in srgb, var(--color-warning) 12%, transparent)', color: 'var(--color-warning)' }}>
                  <span>当前有 {rechargePendingCount} 条充值凭证待审核。</span>
                  <button onClick={() => { setRechargeStatusFilter('pending'); setCodesPage(1) }} className="px-2 py-1 rounded-2xl text-xs font-medium text-white" style={{ background: 'var(--color-warning)' }}>直达待审</button>
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
                        <tr style={{ background: 'var(--bg-card)' }}>
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
                          <tr key={c.id} className="border-t transition-colors hover:bg-bg-hover" style={{ borderColor: 'var(--border-color)' }}>
                            <td className="px-4 py-3">
                              <div style={{ color: 'var(--text-primary)' }}>{c.nickname || c.account || c.username}</div>
                              <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>账号 {c.account || c.username}</div>
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
                                color: c.status === 'approved' ? 'var(--color-success)' : c.status === 'rejected' || c.status === 'refunded' ? 'var(--color-error)' : 'var(--color-warning)',
                                background: c.status === 'approved' ? 'color-mix(in srgb, var(--color-success) 12%, transparent)' : c.status === 'rejected' || c.status === 'refunded' ? 'color-mix(in srgb, var(--color-error) 12%, transparent)' : 'color-mix(in srgb, var(--color-warning) 12%, transparent)'
                              }}>
                                {{ pending: '待审核', approved: '已通过', rejected: '已拒绝', refunded: '已回退' }[c.status]}
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
                                    className="px-2 py-1 rounded-2xl text-[11px] font-medium bg-emerald-500 text-white hover:bg-emerald-600">
                                    快速通过
                                  </button>
                                  <button onClick={() => { setReviewModal({ ...c, action: 'approve' }); setReviewPoints(String(c.points || 10)); setReviewNote('') }}
                                    className="px-2 py-1 rounded-2xl text-[11px] font-medium bg-green-500 text-white hover:bg-green-600">
                                    通过
                                  </button>
                                  <button onClick={() => { setReviewModal({ ...c, action: 'reject' }); setReviewNote('') }}
                                    className="px-2 py-1 rounded-2xl text-[11px] font-medium bg-[var(--color-error)] text-white hover:opacity-90">
                                    拒绝
                                  </button>
                                </div>
                              )}
                              {c.status === 'approved' && (
                                <div className="flex items-center justify-center gap-1">
                                  {c.redeem_code && <span className="text-[10px] font-mono" style={{ color: 'var(--accent)' }}>{c.redeem_code}</span>}
                                  <button onClick={() => handleRefundRecharge(c)} className="px-2 py-1 rounded-2xl text-[11px] font-medium bg-[var(--color-error)] text-white hover:opacity-90">回退发放</button>
                                </div>
                              )}
                              {c.status === 'refunded' && (
                                <span className="text-[10px]" style={{ color: 'var(--color-error)' }}>已回退</span>
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
        ) : tab === 'classification' ? (
          <AdminClassificationTab
            tasks={clsTasks}
            total={clsTotal}
            page={clsPage}
            setPage={setClsPage}
            detail={clsDetail}
            setDetail={setClsDetail}
            selected={clsSelected}
            setSelected={setClsSelected}
            onCreateTask={handleCreateClsTask}
            categories={clsCategories}
            onRefreshTasks={fetchClsTasks}
            auditTasks={auditTasks}
            auditTotal={auditTotal}
            auditPage={auditPage}
            setAuditPage={setAuditPage}
            auditDetail={auditDetail}
            setAuditDetail={setAuditDetail}
            auditSelected={auditSelected}
            setAuditSelected={setAuditSelected}
            onCreateAuditTask={handleCreateAuditTask}
            onRefreshAuditTasks={fetchAuditTasks}
          />
        ) : tab === 'config' ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              {[{ k: 'basic', l: '基础配置' }, { k: 'route', l: '模型路由' }].map(i => <button key={i.k} onClick={() => setConfigSubtab(i.k)} className={`px-3 py-1.5 rounded-2xl text-xs font-medium border ${configSubtab === i.k ? 'text-white border-transparent' : ''}`} style={configSubtab === i.k ? { background: 'var(--accent)' } : { borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>{i.l}</button>)}
            </div>
            {configSubtab === 'basic' ? (
            <>
            <div className="p-4 rounded-2xl border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)' }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>核心限制配置</h3>
                <button onClick={handleSaveConfig} disabled={configSaving} className="px-4 py-2 rounded-2xl text-xs font-medium bg-accent text-white hover:opacity-90 disabled:opacity-50">{configSaving ? '保存中...' : '保存配置'}</button>
              </div>
              <div className="mb-3 p-3 rounded-2xl border flex items-center justify-between gap-3" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)' }}>
                <div>
                  <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>允许新用户注册</div>
                  <div className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{runtimeConfig.register_enabled ? '开启后登录页显示注册入口，并允许新账号创建' : '关闭后登录页隐藏注册入口，注册接口同时拒绝请求'}</div>
                </div>
                <button type="button" onClick={() => onConfigToggle('register_enabled', !runtimeConfig.register_enabled)} className="relative inline-flex h-7 w-12 items-center rounded-full transition-colors" style={{ background: runtimeConfig.register_enabled ? 'var(--accent)' : 'var(--border-color)' }}>
                  <span className="inline-block h-5 w-5 transform rounded-full bg-white transition-transform" style={{ transform: runtimeConfig.register_enabled ? 'translateX(22px)' : 'translateX(3px)' }} />
                </button>
              </div>
              <div className="mb-3 p-3 rounded-2xl border flex items-center justify-between gap-3" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)' }}>
                <div>
                  <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>显示最近登录会话</div>
                  <div className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>开启后设置页展示用户最近登录会话列表与多IP登录风险提示</div>
                </div>
                <button type="button" onClick={() => onConfigToggle('show_login_sessions', !runtimeConfig.show_login_sessions)} className="relative inline-flex h-7 w-12 items-center rounded-full transition-colors" style={{ background: runtimeConfig.show_login_sessions ? 'var(--accent)' : 'var(--border-color)' }}>
                  <span className="inline-block h-5 w-5 transform rounded-full bg-white transition-transform" style={{ transform: runtimeConfig.show_login_sessions ? 'translateX(22px)' : 'translateX(3px)' }} />
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  { k: 'generate_concurrent_limit_per_user', l: '生成并发上限/用户', min: 1 },
                  { k: 'home_page_size', l: '首页每页卡片数', min: 1 },
                  { k: 'square_page_size', l: '广场每页卡片数', min: 1 },
                  { k: 'points_cost_per_generation', l: '默认生成扣分', min: 0.0001, step: 0.0001 },
                  { k: 'points_cost_per_optimize', l: '简单优化扣分', min: 0.0001, step: 0.0001 },
                  { k: 'points_cost_per_optimize_refine', l: '精细优化扣分', min: 0.0001, step: 0.0001 },
                  { k: 'points_cost_per_chat', l: 'AI助手对话扣分', min: 0.0001, step: 0.0001 },
                  { k: 'ai_daily_free_quota', l: 'AI助手每日免费次数', min: 0 },
                  { k: 'chat_context_max_chars', l: '聊天上下文预算(字符)', min: 1000 },
                  { k: 'points_cost_per_image_extend', l: '图片续期扣分/张', min: 0.0001, step: 0.0001 },
                  { k: 'points_checkin_reward', l: '每日签到奖励', min: 0 },
                  { k: 'points_register_bonus', l: '注册送分', min: 0 },
                  { k: 'points_migration_amount', l: '补发积分值', min: 0 },
                  { k: 'invite_register_reward_points', l: '邀请注册奖励', min: 0 },
                  { k: 'invite_recharge_rebate_percent', l: '充值返利百分比', min: 0 },
                  { k: 'invite_recharge_bonus_percent', l: '充值加赠百分比', min: 0 },
                  { k: 'login_rate_limit_per_minute_per_ip', l: '登录限流/分钟/IP', min: 1 },
                  { k: 'register_rate_limit_per_minute_per_ip', l: '注册限流/分钟/IP', min: 1 },
                ].map(item => (
                  <div key={item.k}>
                    <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>{item.l}</label>
                    <input
                      type="number"
                      min={item.min}
                      step={item.step}
                      value={runtimeConfig[item.k]}
                      onChange={e => onConfigInput(item.k, e.target.value)}
                      className="w-full px-3 py-2 rounded-2xl text-sm border outline-none"
                      style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-3 p-3 rounded-2xl border flex items-center justify-between gap-3" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)' }}>
                <div><div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>启用邀请码系统</div><div className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>关闭后隐藏邀请权益，已有邀请关系保留但不再发放新奖励</div></div>
                <button type="button" onClick={() => onConfigToggle('invite_enabled', !runtimeConfig.invite_enabled)} className="relative inline-flex h-7 w-12 items-center rounded-full transition-colors" style={{ background: runtimeConfig.invite_enabled ? 'var(--accent)' : 'var(--border-color)' }}>
                  <span className="inline-block h-5 w-5 transform rounded-full bg-white transition-transform" style={{ transform: runtimeConfig.invite_enabled ? 'translateX(22px)' : 'translateX(3px)' }} />
                </button>
              </div>
            </div>
            <div className="p-4 rounded-2xl border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)' }}>
              <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>运行时配置</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  { k: 'api_url', l: '生成 API URL' },
                  { k: 'image_hosting_upload_url', l: '图床上传 URL' },
                  { k: 'image_hosting_base_url', l: '图床基础 URL' },
                  { k: 'image_hosting_referer', l: '图床 Referer' },
                  { k: 'wechat_pay_qr_url', l: '微信收款码 URL' },
                  { k: 'alipay_pay_qr_url', l: '支付宝收款码 URL' },
                  { k: 'donation_contact', l: '充值联系方式' },
                ].map(item => (
                  <div key={item.k}>
                    <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>{item.l}</label>
                    <input
                      type="text"
                      value={runtimeConfig[item.k]}
                      onChange={e => onConfigInput(item.k, e.target.value)}
                      className="w-full px-3 py-2 rounded-2xl text-sm border outline-none"
                      style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
                    />
                    {(item.k === 'wechat_pay_qr_url' || item.k === 'alipay_pay_qr_url') && (
                      <label
                        className="mt-2 inline-flex items-center gap-1.5 px-3 py-2 rounded-2xl text-xs font-medium cursor-pointer border hover:bg-bg-hover"
                        style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                      >
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          onChange={e => {
                            const file = e.target.files?.[0]
                            handleUploadQr(item.k, file)
                            e.target.value = ''
                          }}
                        />
                        {qrUploading === item.k ? '上传中...' : '上传二维码图片'}
                      </label>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-3">
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>充值提示文案</label>
                <textarea value={runtimeConfig.manual_recharge_notice} onChange={e => onConfigInput('manual_recharge_notice', e.target.value)} rows={3} className="w-full px-3 py-2 rounded-2xl text-sm border resize-none outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div className="mt-3">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs" style={{ color: 'var(--text-secondary)' }}>充值档位</label>
                  <button type="button" onClick={handleAddRechargePackage} className="px-2 py-1 rounded-lg text-xs font-medium border" style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}>新增套餐</button>
                </div>
                <div className="space-y-2">
                  {(Array.isArray(runtimeConfig.recharge_packages) ? runtimeConfig.recharge_packages : []).map((item, idx) => (
                    <div key={`pkg:${idx}`} className="grid grid-cols-12 gap-2 items-center">
                      <input type="text" value={item.label ?? ''} onChange={e => handleRechargePackageField(idx, 'label', e.target.value)} placeholder="套餐标题" className="col-span-4 px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                      <input type="number" min="0" step="0.01" value={item.amount ?? ''} onChange={e => handleRechargePackageField(idx, 'amount', e.target.value)} placeholder="金额" className="col-span-3 px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                      <input type="number" min="0" step="1" value={item.points ?? ''} onChange={e => handleRechargePackageField(idx, 'points', e.target.value)} placeholder="积分" className="col-span-4 px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                      <button type="button" onClick={() => handleDeleteRechargePackage(idx)} disabled={(Array.isArray(runtimeConfig.recharge_packages) ? runtimeConfig.recharge_packages.length : 0) <= 1} className="col-span-1 inline-flex items-center justify-center h-10 rounded-2xl border disabled:opacity-40" style={{ borderColor: 'var(--border-color)', color: 'var(--color-error)' }}><Trash2 size={14} /></button>
                    </div>
                  ))}
                </div>
                <div className="text-[11px] mt-1" style={{ color: 'var(--text-secondary)' }}>每项填写：套餐标题、支付金额、到账积分。</div>
              </div>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>随机减免最小值</label>
                  <input type="number" min="0.01" step="0.01" value={runtimeConfig.recharge_random_discount_min} onChange={e => onConfigInput('recharge_random_discount_min', e.target.value)} className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>随机减免最大值</label>
                  <input type="number" min="0.01" step="0.01" value={runtimeConfig.recharge_random_discount_max} onChange={e => onConfigInput('recharge_random_discount_max', e.target.value)} className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                </div>
              </div>
              <div className="text-[11px] mt-1" style={{ color: 'var(--text-secondary)' }}>用于控制每笔充值生成的随机减免范围，例如 0.01 到 0.50。</div>
            </div>
            <div className="p-4 rounded-2xl border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)' }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>GitHub 图床（jsdelivr CDN）</h3>
                <button type="button" onClick={() => onConfigToggle('github_hosting_enabled', !runtimeConfig.github_hosting_enabled)} className="relative inline-flex h-7 w-12 items-center rounded-full transition-colors" style={{ background: runtimeConfig.github_hosting_enabled ? 'var(--accent)' : 'var(--border-color)' }}>
                  <span className="inline-block h-5 w-5 transform rounded-full bg-white transition-transform" style={{ transform: runtimeConfig.github_hosting_enabled ? 'translateX(22px)' : 'translateX(3px)' }} />
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>仓库（owner/repo）</label>
                  <input type="text" value={runtimeConfig.github_hosting_repo} onChange={e => onConfigInput('github_hosting_repo', e.target.value)} placeholder="user/repo" className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>Personal Access Token</label>
                  <input type="password" value={runtimeConfig.github_hosting_token} onChange={e => onConfigInput('github_hosting_token', e.target.value)} placeholder="ghp_..." className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>分支</label>
                  <input type="text" value={runtimeConfig.github_hosting_branch} onChange={e => onConfigInput('github_hosting_branch', e.target.value)} placeholder="main" className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                </div>
              </div>
              <p className="text-xs mt-2" style={{ color: 'var(--text-secondary)' }}>启用后参考图上传将通过 GitHub 仓库 + jsdelivr CDN 提供。Token 需要 contents:write 权限。</p>
            </div>
            <div className="p-4 rounded-2xl border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)' }}>
              <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>SMTP 邮件配置</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>发件人邮箱</label>
                  <input type="email" value={runtimeConfig.smtp_sender} onChange={e => onConfigInput('smtp_sender', e.target.value)} placeholder="your@qq.com" className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>发件人名称</label>
                  <input type="text" value={runtimeConfig.smtp_sender_name} onChange={e => onConfigInput('smtp_sender_name', e.target.value)} placeholder="Atelier · AI 工作台" className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>授权码</label>
                  <input type="password" value={runtimeConfig.smtp_password} onChange={e => onConfigInput('smtp_password', e.target.value)} placeholder="邮箱授权码" className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>SMTP 服务器</label>
                  <input type="text" value={runtimeConfig.smtp_server} onChange={e => onConfigInput('smtp_server', e.target.value)} placeholder="smtp.qq.com" className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>端口</label>
                  <input type="number" min={1} max={65535} value={runtimeConfig.smtp_port} onChange={e => onConfigInput('smtp_port', e.target.value)} className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                </div>
              </div>
              <p className="text-xs mt-2" style={{ color: 'var(--text-secondary)' }}>填写发件人邮箱和授权码即可，服务器默认 smtp.qq.com:465。QQ 邮箱请在设置中开启 SMTP 并获取授权码。</p>
            </div>
            <div className="p-4 rounded-2xl border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)' }}>
              <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>SendGrid 邮件配置</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>SendGrid API Key</label>
                  <input type="password" value={runtimeConfig.sendgrid_api_key || ''} onChange={e => onConfigInput('sendgrid_api_key', e.target.value)} placeholder="SG.xxxxx" className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>SendGrid 发件邮箱</label>
                  <input type="email" value={runtimeConfig.sendgrid_sender || ''} onChange={e => onConfigInput('sendgrid_sender', e.target.value)} placeholder="noreply@atelier-ai.me" className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                </div>
              </div>
              <p className="text-xs mt-2" style={{ color: 'var(--text-secondary)' }}>系统会优先使用 SendGrid 发送验证码，发件邮箱需在 SendGrid 完成 Sender Identity 或域名验证。</p>
            </div>
            <div className="p-4 rounded-2xl border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)' }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>AI 提示词优化（LLM）</h3>
                <button type="button" onClick={() => onConfigToggle('prompt_optimize_enabled', !runtimeConfig.prompt_optimize_enabled)} className="relative inline-flex h-7 w-12 items-center rounded-full transition-colors" style={{ background: runtimeConfig.prompt_optimize_enabled ? 'var(--accent)' : 'var(--border-color)' }}>
                  <span className="inline-block h-5 w-5 transform rounded-full bg-white transition-transform" style={{ transform: runtimeConfig.prompt_optimize_enabled ? 'translateX(22px)' : 'translateX(3px)' }} />
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>API Base URL</label>
                  <input type="text" value={runtimeConfig.llm_base_url || ''} onChange={e => onConfigInput('llm_base_url', e.target.value)} placeholder="https://api.anthropic.com" className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>API Key</label>
                  <input type="password" value={runtimeConfig.llm_api_key || ''} onChange={e => onConfigInput('llm_api_key', e.target.value)} placeholder="sk-..." className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>模型名称</label>
                  <input type="text" value={runtimeConfig.llm_model || ''} onChange={e => onConfigInput('llm_model', e.target.value)} placeholder="mimo-v2.5" className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>Max Tokens</label>
                  <input type="number" min={100} max={10000} value={runtimeConfig.llm_max_tokens || 2000} onChange={e => onConfigInput('llm_max_tokens', e.target.value)} className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>超时（秒）</label>
                  <input type="number" min={5} max={120} value={runtimeConfig.llm_timeout_seconds || 30} onChange={e => onConfigInput('llm_timeout_seconds', e.target.value)} className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                </div>
              </div>
              <p className="text-xs mt-2" style={{ color: 'var(--text-secondary)' }}>用于提示词优化功能，调用 Anthropic 兼容 API。关闭开关将禁用优化按钮，用户输入直接进入生图流程。</p>
            </div>
            </>
            ) : configSubtab === 'route' ? (
            <>
            <div className="p-4 rounded-2xl border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)' }}>
              <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>模型路由配置</h3>
              <div className="mb-4">
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>默认模型ID</label>
                <input type="text" value={defaultModelId} onChange={e => setDefaultModelId(e.target.value)} placeholder="例如：gpt-image-2（必须存在于模型列表）" className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>

              {/* 模型列表 */}
              <div className="rounded-2xl border p-3 mb-3" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)' }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium" style={{ color: 'var(--color-info)' }}>模型</span>
                    <span className="text-[11px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--color-info)', color: 'white', opacity: 0.8 }}>{Object.keys(genModelsObj).length}</span>
                  </div>
                  <button onClick={handleAddModel} className="px-2 py-1 rounded-lg text-xs font-medium bg-accent text-white">+ 新增模型</button>
                </div>
                <div className="space-y-2">
                  {Object.entries(genModelsObj).map(([mid, m]) => {
                    const isDefault = mid === defaultModelId
                    const boundProviders = Array.isArray(m?.providers) ? m.providers : []
                    return (
                      <div key={mid} className="rounded-2xl border p-3 flex items-center gap-3" style={{ borderColor: isDefault ? 'var(--color-info)' : 'var(--border-color)', background: isDefault ? 'color-mix(in srgb, var(--color-info) 5%, var(--bg-card))' : 'var(--bg-card)' }}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{m?.label || mid}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-mono" style={{ background: 'var(--color-info)', color: 'white', opacity: 0.8 }}>{m?.capability || 'image'}</span>
                            {isDefault && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--accent)', color: 'white' }}>默认</span>}
                          </div>
                          <div className="text-[11px] font-mono truncate mb-1" style={{ color: 'var(--text-secondary)' }}>{mid}</div>
                          {isVipModelId(mid)&&m?.params?.resolution_costs&&<div className="text-[10px] mb-1" style={{ color: 'var(--text-secondary)' }}>{`扣分 1K:${m.params.resolution_costs.low??m.params.resolution_costs.auto??'-'} / 2K:${m.params.resolution_costs.medium??'-'} / 4K:${m.params.resolution_costs.high??'-'}`}</div>}
                          {boundProviders.length > 0 && (
                            <div className="flex items-center gap-1 flex-wrap">
                              <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>供应商:</span>
                              {boundProviders.map((pid, idx) => (
                                <span key={pid} className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-mono" style={{ background: idx === 0 ? 'var(--color-success)' : 'var(--text-secondary)', color: 'white', opacity: idx === 0 ? 0.85 : 0.6 }}>
                                  {idx === 0 && '▶'}{pid}
                                </span>
                              ))}
                            </div>
                          )}
                          {boundProviders.length === 0 && <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>未绑定供应商</div>}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleModelField(mid, 'enabled', !m?.enabled)}
                            className="relative inline-flex h-4 w-7 items-center rounded-full transition-colors"
                            style={{ background: m?.enabled !== false ? 'var(--color-success)' : 'var(--border-color)' }}
                          >
                            <span className="inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform" style={{ transform: m?.enabled !== false ? 'translateX(14px)' : 'translateX(2px)' }} />
                          </button>
                          <button onClick={() => openModelEditor(mid)} className="px-2 py-1 rounded-lg text-xs border" style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}>编辑</button>
                          <button onClick={() => { if (mid === defaultModelId) { dialog.alert('不能删除默认模型'); return } handleDeleteModel(mid) }} className="px-2 py-1 rounded-lg text-xs border text-[var(--color-error)]" style={{ borderColor: 'var(--border-color)' }}>删除</button>
                        </div>
                      </div>
                    )
                  })}
                  {Object.keys(genModelsObj).length === 0 && <div className="text-center py-6 text-xs" style={{ color: 'var(--text-secondary)' }}>暂无模型，点击上方按钮新增</div>}
                </div>
              </div>

              {/* 供应商列表 */}
              <div className="rounded-2xl border p-3 mb-3" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)' }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium" style={{ color: '#8B7BA8' }}>供应商</span>
                    <span className="text-[11px] px-1.5 py-0.5 rounded-full" style={{ background: '#8B7BA8', color: 'white', opacity: 0.8 }}>{Object.keys(genProvidersObj).length}</span>
                  </div>
                  <button onClick={handleAddProvider} className="px-2 py-1 rounded-lg text-xs font-medium bg-accent text-white">+ 新增供应商</button>
                </div>
                <div className="space-y-2">
                  {Object.entries(genProvidersObj).map(([pid, p]) => (
                    <div key={pid} className="rounded-2xl border p-3 flex items-center gap-3" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-card)' }}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: '#8B7BA8', color: 'white', opacity: 0.8 }}>{p?.type || 'wuyin'}</span>
                          <span className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{pid}</span>
                        </div>
                        <div className="text-[11px] font-mono truncate mb-1" style={{ color: 'var(--text-secondary)' }}>
                          {p?.api_url || '(使用全局api_url)'}
                        </div>
                        <div className="flex items-center gap-3 text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                          <span>优先级: {Number(p?.priority ?? 100)}</span>
                          <span>熔断: {p?.circuit_fail_threshold ?? 3}次/{p?.circuit_cooldown_seconds ?? 60}s</span>
                          <span>单位: {p?.unit_name || '供应商额度'}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleProviderField(pid, 'enabled', !p?.enabled)}
                          className="relative inline-flex h-4 w-7 items-center rounded-full transition-colors"
                          style={{ background: p?.enabled !== false ? 'var(--color-success)' : 'var(--border-color)' }}
                        >
                          <span className="inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform" style={{ transform: p?.enabled !== false ? 'translateX(14px)' : 'translateX(2px)' }} />
                        </button>
                        <button onClick={() => openProviderEditor(pid)} className="px-2 py-1 rounded-lg text-xs border" style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}>编辑</button>
                        <button onClick={() => handleDeleteProvider(pid)} className="px-2 py-1 rounded-lg text-xs border text-[var(--color-error)]" style={{ borderColor: 'var(--border-color)' }}>删除</button>
                      </div>
                    </div>
                  ))}
                  {Object.keys(genProvidersObj).length === 0 && <div className="text-center py-6 text-xs" style={{ color: 'var(--text-secondary)' }}>暂无供应商，点击上方按钮新增</div>}
                </div>
              </div>

              <div className="rounded-2xl border p-3" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)' }}>
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>高级模式(JSON)</div>
                  <button onClick={() => setShowAdvancedGenConfig(v => !v)} className="px-2 py-1 rounded-lg text-xs border" style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>{showAdvancedGenConfig ? '收起' : '展开'}</button>
                </div>
                {showAdvancedGenConfig && (
                  <>
                  {jsonDirty && (
                    <div className="mt-3 px-3 py-2 rounded-2xl text-[11px]" style={{ background: 'var(--color-warning, #f59e0b)', color: '#000', opacity: 0.9 }}>
                      JSON 已被修改，但尚未应用到表单。点击"应用到表单"使其生效，或直接保存配置。
                    </div>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                    <div>
                      <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>generation_models(JSON对象)</label>
                      <textarea value={generationModelsText} onChange={e => { setGenerationModelsText(e.target.value); setJsonDirty(true) }} rows={14} className="w-full px-3 py-2 rounded-2xl text-xs border resize-none outline-none font-mono" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                      <div className="text-[11px] mt-1 text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>{generationModelsText.length} chars</div>
                    </div>
                    <div>
                      <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>generation_providers(JSON对象)</label>
                      <textarea value={generationProvidersText} onChange={e => { setGenerationProvidersText(e.target.value); setJsonDirty(true) }} rows={14} className="w-full px-3 py-2 rounded-2xl text-xs border resize-none outline-none font-mono" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                      <div className="text-[11px] mt-1 text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>{generationProvidersText.length} chars</div>
                    </div>
                    <div className="md:col-span-2 flex justify-end">
                      <button onClick={handleApplyAdvanced} className="px-3 py-1.5 rounded-2xl text-xs font-medium bg-accent text-white hover:opacity-90">应用到表单</button>
                    </div>
                  </div>
                  </>
                )}
              </div>
            </div>
            </>
            ) : null}
          </div>
        ) : tab === 'llm_models' ? (
          <AdminLlmModelsTab items={llmModels} loading={llmModelsLoading} globalModelId={globalModelId} onRefresh={fetchLlmModels}
            onSave={saveLlmModel} onBatchSave={addLlmModels} onBatchUpdate={updateLlmModels} onDelete={deleteLlmModel} onTest={testLlmModel} dialog={dialog} />
        ) : tab === 'history' ? (
          <AdminHistoryTab historyTotal={historyTotal} historyQuery={historyQuery} setHistoryQuery={setHistoryQuery} historySummary={historySummary} loading={loading} history={history} modelLabelMap={modelLabelMap} handleDeleteHistory={handleDeleteHistory} historyPage={historyPage} setHistoryPage={setHistoryPage} />
        ) : (
          <AdminChatTab
            chatTotal={chatTotal}
            chatQuery={chatQuery}
            setChatQuery={setChatQuery}
            loading={chatLoading}
            sessions={chatSessions}
            chatPage={chatPage}
            setChatPage={setChatPage}
            onRefresh={fetchChatSessions}
            handleDeleteChatSession={handleDeleteChatSession}
            openChatSession={openChatSession}
            viewSession={chatViewSession}
            closeChatSession={closeChatSession}
          />
        )}
      </div>

      {editingModelId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => { setDraggingModelProviderId(''); setEditingModelId('') }}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative w-full max-w-lg rounded-2xl overflow-hidden" style={{ background: 'var(--bg-primary)' }} onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>编辑模型</h3>
              <div className="text-xs mt-1 font-mono" style={{ color: 'var(--text-secondary)' }}>{editingModelId}</div>
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>模型ID</label>
                <input type="text" value={editingModelId} readOnly className="w-full px-3 py-2 rounded-2xl text-sm border outline-none font-mono" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-secondary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>显示名</label>
                <input type="text" value={editingModelDraft.label || ''} onChange={e => setEditingModelDraft(prev => ({ ...prev, label: e.target.value }))} placeholder="如 默认模型" className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>能力</label>
                <select value={editingModelDraft.capability || 'image'} onChange={e => setEditingModelDraft(prev => ({ ...prev, capability: e.target.value }))} className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}><option value="image">image</option><option value="video">video</option></select>
              </div>
              {isVipModelId(editingModelId)?<>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>1K 扣分</label>
                <input type="number" step="0.0001" min="0" value={editingModelDraft.resolution_cost_low ?? ''} onChange={e => setEditingModelDraft(prev => ({ ...prev, resolution_cost_low: e.target.value, points_cost: e.target.value }))} placeholder="15" className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>2K 扣分</label>
                <input type="number" step="0.0001" min="0" value={editingModelDraft.resolution_cost_medium ?? ''} onChange={e => setEditingModelDraft(prev => ({ ...prev, resolution_cost_medium: e.target.value }))} placeholder="25" className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>4K 扣分</label>
                <input type="number" step="0.0001" min="0" value={editingModelDraft.resolution_cost_high ?? ''} onChange={e => setEditingModelDraft(prev => ({ ...prev, resolution_cost_high: e.target.value }))} placeholder="40" className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              </>:<div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>模型扣分（留空走默认）</label>
                <input type="number" step="0.0001" min="0" value={editingModelDraft.points_cost ?? ''} onChange={e => setEditingModelDraft(prev => ({ ...prev, points_cost: e.target.value }))} placeholder={`默认 ${runtimeConfig.points_cost_per_generation}`} className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>}
              <div className="flex items-end">
                <label className="inline-flex items-center gap-2 text-sm" style={{ color: 'var(--text-primary)' }}><input type="checkbox" checked={editingModelDraft.enabled !== false} onChange={e => setEditingModelDraft(prev => ({ ...prev, enabled: e.target.checked }))} />启用该模型</label>
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>绑定供应商（按顺序优先级从高到低）</label>
                <div className="rounded-2xl border p-3" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-card)' }}>
                  <div className="text-[11px] mb-2" style={{ color: 'var(--text-secondary)' }}>拖拽调整优先级（越靠前越优先）；点击下方按钮添加/移除。</div>
                  <div className="space-y-2 mb-3">
                    {(Array.isArray(editingModelDraft.providers) ? editingModelDraft.providers : []).map((pid, idx) => (
                      <div
                        key={pid}
                        draggable
                        onDragStart={() => setDraggingModelProviderId(pid)}
                        onDragEnd={() => setDraggingModelProviderId('')}
                        onDragOver={e => e.preventDefault()}
                        onDrop={() => { reorderEditingModelProviders(draggingModelProviderId, pid); setDraggingModelProviderId('') }}
                        className="flex items-center gap-2 px-3 py-2 rounded-2xl border"
                        style={{ borderColor: draggingModelProviderId === pid ? 'var(--accent)' : 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)', opacity: draggingModelProviderId === pid ? 0.6 : 1 }}
                      >
                        <span className="text-xs font-mono w-5 text-center shrink-0" style={{ color: 'var(--text-secondary)' }}>{idx + 1}</span>
                        <span className="text-[10px] cursor-grab select-none shrink-0" style={{ color: 'var(--text-secondary)' }}>⣿</span>
                        <span className="flex-1 font-mono text-sm truncate">{pid}</span>
                        <span className="text-[10px] shrink-0" style={{ color: 'var(--text-secondary)' }}>{genProvidersObj?.[pid]?.type || '?'}</span>
                        <button type="button" onClick={() => toggleEditingModelProvider(pid)} className="px-2 py-1 rounded-lg text-[11px] border shrink-0" style={{ borderColor: 'var(--border-color)', color: 'var(--color-error)' }}>移除</button>
                      </div>
                    ))}
                    {!(Array.isArray(editingModelDraft.providers) ? editingModelDraft.providers : []).length && (
                      <div className="px-3 py-6 rounded-2xl border text-center text-xs" style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>未绑定任何供应商</div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {Object.keys(genProvidersObj || {}).map(pid => {
                      const active = (Array.isArray(editingModelDraft.providers) ? editingModelDraft.providers : []).includes(pid)
                      return (
                        <button key={pid} type="button" onClick={() => toggleEditingModelProvider(pid)}
                          className={`px-2.5 py-1.5 rounded-2xl text-xs border font-mono ${active ? 'text-white border-transparent' : ''}`}
                          style={active ? { background: 'var(--accent)' } : { borderColor: 'var(--border-color)', color: 'var(--text-primary)', background: 'var(--bg-primary)' }}>
                          {pid}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
              <button onClick={() => { setDraggingModelProviderId(''); setEditingModelId('') }} className="px-4 py-2 rounded-2xl text-sm font-medium hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}>取消</button>
              <button onClick={applyModelEditor} className="px-4 py-2 rounded-2xl text-sm font-medium bg-accent text-white hover:opacity-90">保存</button>
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
                <input type="text" value={editingProviderId} readOnly className="w-full px-3 py-2 rounded-2xl text-sm border outline-none font-mono" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-secondary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>类型</label>
                <input type="text" value={editingProviderDraft.type || ''} onChange={e => setEditingProviderDraft(prev => ({ ...prev, type: e.target.value }))} placeholder="如 wuyin" className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>全局权重</label>
                <input type="number" value={Number(editingProviderDraft.priority ?? 100)} onChange={e => setEditingProviderDraft(prev => ({ ...prev, priority: Number(e.target.value || 0) }))} placeholder="当前模型内顺序优先，这里仅作备用展示" className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>单位名称</label>
                <input type="text" value={editingProviderDraft.unit_name || ''} onChange={e => setEditingProviderDraft(prev => ({ ...prev, unit_name: e.target.value }))} placeholder="如 供应商积分 / 点数" className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>单位编码</label>
                <input type="text" value={editingProviderDraft.unit_code || ''} onChange={e => setEditingProviderDraft(prev => ({ ...prev, unit_code: e.target.value }))} placeholder="如 vendor_points / credits" className="w-full px-3 py-2 rounded-2xl text-sm border outline-none font-mono" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>连续失败阈值</label>
                <input type="number" value={Number(editingProviderDraft.circuit_fail_threshold ?? 3)} onChange={e => setEditingProviderDraft(prev => ({ ...prev, circuit_fail_threshold: Number(e.target.value || 0) }))} placeholder="达到阈值触发熔断" className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>熔断冷却秒数</label>
                <input type="number" value={Number(editingProviderDraft.circuit_cooldown_seconds ?? 60)} onChange={e => setEditingProviderDraft(prev => ({ ...prev, circuit_cooldown_seconds: Number(e.target.value || 0) }))} placeholder="如 60" className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div className="flex items-end">
                <label className="inline-flex items-center gap-2 text-sm" style={{ color: 'var(--text-primary)' }}><input type="checkbox" checked={editingProviderDraft.enabled !== false} onChange={e => setEditingProviderDraft(prev => ({ ...prev, enabled: e.target.checked }))} />启用该供应商</label>
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>API URL</label>
                <input type="text" value={editingProviderDraft.api_url || ''} onChange={e => setEditingProviderDraft(prev => ({ ...prev, api_url: e.target.value }))} placeholder="例如 https://xxx/api/async，留空则使用全局api_url" className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>API Key</label>
                <input type="text" value={editingProviderDraft.api_key || ''} onChange={e => setEditingProviderDraft(prev => ({ ...prev, api_key: e.target.value }))} placeholder="留空则使用全局api_key" className="w-full px-3 py-2 rounded-2xl text-sm border outline-none font-mono" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
              <button onClick={() => setEditingProviderId('')} className="px-4 py-2 rounded-2xl text-sm font-medium hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}>取消</button>
              <button onClick={applyProviderEditor} className="px-4 py-2 rounded-2xl text-sm font-medium bg-accent text-white hover:opacity-90">保存</button>
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
                <button onClick={() => setHostingDetail(null)} className="p-1 rounded-2xl hover:bg-bg-hover">
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
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${hostingDetail.exists ? 'bg-[var(--color-success)]/20 text-[var(--color-success)]' : 'bg-[var(--color-error)]/20 text-[var(--color-error)]'}`}>
                      {hostingDetail.exists ? '存在' : '已丢失'}
                    </span>
                  </div>
                </div>
                <div className="pt-3 border-t" style={{ borderColor: 'var(--border-color)' }}>
                  <a href={hostingDetail.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1.5 w-full py-2 rounded-2xl bg-[var(--color-info)] text-white text-xs font-medium hover:opacity-90">
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
                  }} className="flex items-center justify-center gap-1.5 w-full py-2 rounded-2xl bg-red-500 text-white text-xs font-medium hover:bg-red-600">
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
                  className="w-full px-3 py-2 rounded-2xl text-sm border outline-none"
                  style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>备注</label>
                <input type="text" value={adjustDesc} onChange={e => setAdjustDesc(e.target.value)}
                  placeholder="管理员调整"
                  className="w-full px-3 py-2 rounded-2xl text-sm border outline-none"
                  style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)', color: 'var(--text-primary)' }} />
              </div>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
              <button onClick={() => setAdjustUserId(null)} className="px-4 py-2 rounded-2xl text-sm font-medium hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}>取消</button>
              <button onClick={() => handleAdjustPoints(adjustUserId)} disabled={!adjustAmount}
                className="px-4 py-2 rounded-2xl text-sm font-medium bg-accent text-white hover:opacity-90 disabled:opacity-50">确认</button>
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
                className="w-full px-3 py-2 rounded-2xl text-sm border resize-none"
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
                className="px-4 py-2 rounded-2xl text-sm font-medium hover:bg-bg-hover"
                style={{ color: 'var(--text-secondary)' }}
              >
                取消
              </button>
              <button
                onClick={handleBatchImport}
                disabled={!batchImportText.trim() || batchImporting}
                className="px-4 py-2 rounded-2xl text-sm font-medium bg-accent text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {batchImporting ? '导入中...' : '确认导入'}
              </button>
            </div>
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
                {reviewModal.account || reviewModal.username || reviewModal.code} - ¥{reviewModal.recharge_amount}
              </p>
            </div>
            <div className="p-4 space-y-3">
              {reviewModal.action === 'approve' && (
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>发放积分</label>
                  <input type="number" value={reviewPoints} onChange={e => setReviewPoints(e.target.value)}
                    className="w-full px-3 py-2 rounded-2xl text-sm border outline-none"
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
                        className={`px-2 py-1 rounded-2xl text-[11px] font-medium transition-colors ${reviewNote === text ? 'bg-[var(--color-error)] text-white' : 'border hover:border-[var(--color-error)]/50'}`}
                        style={reviewNote === text ? {} : { borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}>
                        {text}
                      </button>
                    ))}
                  </div>
                )}
                <textarea value={reviewNote} onChange={e => setReviewNote(e.target.value)}
                  rows={3} placeholder={reviewModal.action === 'approve' ? '审核通过' : '请输入拒绝原因'}
                  className="w-full px-3 py-2 rounded-2xl text-sm border resize-none outline-none"
                  style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)', color: 'var(--text-primary)' }} />
              </div>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
              <button onClick={() => setReviewModal(null)} className="px-4 py-2 rounded-2xl text-sm font-medium hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}>取消</button>
              <button onClick={() => reviewModal.action === 'approve' ? handleApproveRecharge(reviewModal.id) : handleRejectRecharge(reviewModal.id)}
                disabled={reviewModal.action === 'reject' && !reviewNote.trim()}
                className={`px-4 py-2 rounded-2xl text-sm font-medium text-white disabled:opacity-50 ${reviewModal.action === 'approve' ? 'bg-[var(--color-success)] hover:opacity-90' : 'bg-red-500 hover:bg-red-600'}`}>
                {reviewModal.action === 'approve' ? '确认通过' : '确认拒绝'}
              </button>
            </div>
          </div>
        </div>
      )}
    </MainLayout>
    {proofLightbox && (
      <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setProofLightbox(null)}>
        <button type="button" onClick={e => { e.stopPropagation(); setProofLightbox(null) }} className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-black/55 text-white flex items-center justify-center"><X size={18} /></button>
        <img src={proofLightbox} alt="支付凭证" className="max-w-full max-h-full rounded-2xl" onClick={e => e.stopPropagation()} />
      </div>
    )}
    </>
  )
}
