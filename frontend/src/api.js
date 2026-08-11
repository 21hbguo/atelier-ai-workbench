import axios from 'axios'
import { clearUser, writeUser } from './auth'

const api = axios.create({ baseURL: '/api', timeout: 1800000, withCredentials: true, headers: { 'Content-Type': 'application/json' } })
const refreshClient = axios.create({ baseURL: '/api', timeout: 1800000, withCredentials: true, headers: { 'Content-Type': 'application/json' } })
let refreshPromise = null
let promptCategoryCache = null
let promptCategoryPromise = null
const PROMPT_CATEGORY_CACHE_TTL = 60000
function invalidatePromptCategoryCache() {
  promptCategoryCache = null
  promptCategoryPromise = null
}
function loadPromptCategories(force = false) {
  const now = Date.now()
  if (!force && promptCategoryCache && now - promptCategoryCache.ts < PROMPT_CATEGORY_CACHE_TTL) return Promise.resolve(promptCategoryCache.response)
  if (!force && promptCategoryPromise) return promptCategoryPromise
  promptCategoryPromise = api.get('/prompts/categories').then((res) => {
    promptCategoryCache = { ts: Date.now(), response: res }
    return res
  }).finally(() => { promptCategoryPromise = null })
  return promptCategoryPromise
}

api.interceptors.response.use(
  res => res,
  async err => {
    const cfg = err.config || {}
    const url = cfg.url || ''
    const canRefresh = err.response?.status === 401 && !cfg._retry && !url.includes('/auth/login') && !url.includes('/auth/register') && !url.includes('/auth/refresh') && !url.includes('/auth/logout') && !url.includes('/auth/send-code')
    if (canRefresh) {
      cfg._retry = true
      try {
        if (!refreshPromise) refreshPromise = refreshClient.post('/auth/refresh').finally(() => { refreshPromise = null })
        const { data } = await refreshPromise
        if (data?.user) writeUser(data.user)
        return api(cfg)
      } catch {
        clearUser()
        if (window.location.pathname !== '/login') window.location.href = '/login'
      }
    }
    const detail = err.response?.data?.detail
    const translateMsg = (s) => {
      if (typeof s !== 'string') return String(s)
      const map = [
        [/String should have at least (\d+) character/, '内容至少需要 $1 个字符'],
        [/String should have at most (\d+) character/, '内容最多 $1 个字符'],
        [/ensure this value is less than or equal to (\d+)/, '值不能超过 $1'],
        [/ensure this value is greater than or equal to (\d+)/, '值不能小于 $1'],
        [/field required/, '必填字段缺失'],
        [/value is not a valid /, '格式不正确'],
        [/invalid json/, '请求格式错误'],
      ]
      for (const [re, t] of map) { const m = s.match(re); if (m) return t.replace('$1', m[1]) }
      return s
    }
    const msg = Array.isArray(detail) ? detail.map(d => translateMsg(d.msg || d.message || String(d))).join('；') : (typeof detail === 'string' ? detail : null) || err.message || '请求失败'
    return Promise.reject(new Error(msg))
  }
)

export const generateAPI = { submitText: data => api.post('/generate/text', data), submitTextImage: data => api.post('/generate/text-image', data) }
function resolveUploadPercent(event,fileSize=0){
  const total=Number(event?.total)||Number(fileSize)||0
  const loaded=Math.max(0,Number(event?.loaded)||0)
  if(total<=0)return 0
  return Math.max(0,Math.min(100,Math.round(loaded/total*100)))
}

export const uploadAPI = {
  upload: (file,options={}) => { const fd = new FormData(); fd.append('file', file); return api.post('/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' }, signal: options?.signal, onUploadProgress: e => { if (!options?.onProgress) return; options.onProgress(resolveUploadPercent(e,file?.size), e) } }) },
  uploadLocal: file => { const fd = new FormData(); fd.append('file', file); return api.post('/upload/local', fd, { headers: { 'Content-Type': 'multipart/form-data' } }) },
  uploadLocalPublic: file => { const fd = new FormData(); fd.append('file', file); return api.post('/upload/local/public', fd, { headers: { 'Content-Type': 'multipart/form-data' } }) },
  uploadBatch: files => { const fd = new FormData(); files.forEach(f => fd.append('files', f)); return api.post('/upload/batch', fd, { headers: { 'Content-Type': 'multipart/form-data' } }) },
}

export const taskAPI = {
  list: (limit = 50, offset = 0, userId, query, options = {}) => { const params = { limit, offset }; if (userId) params.user_id = userId; if (query) params.query = query; return api.get('/tasks', { params, ...(options?.signal ? { signal: options.signal } : {}) }) },
  activeSummary: () => api.get('/tasks/active-summary'),
  getByClientRequestId: clientRequestId => api.get(`/tasks/by-client/${clientRequestId}`),
  get: id => api.get(`/tasks/${id}`),
  retry: id => api.post(`/tasks/${id}/retry`),
  delete: id => api.post(`/tasks/${id}/delete`),
  batchDelete: ids => api.post('/tasks/batch-delete', { ids }),
  deleteFailed: userId => { const params = {}; if (userId) params.user_id = userId; return api.post('/tasks/delete-failed', null, { params }) },
}

export const imageAPI = {
  list: (page = 1, pageSize = 20, userId, options = {}) => { const params = { page, page_size: pageSize }; if (userId) params.user_id = userId; return api.get('/images', { params, ...(options?.signal ? { signal: options.signal } : {}) }) },
  get: filename => api.get(`/images/${filename}`),
  getBlobByUrl: url => api.get((url || '').startsWith('/api/') ? (url || '').slice(4) : (url || ''), { responseType: 'blob' }),
  downloadBatch: filenames => api.post('/images/download-batch', { filenames }, { responseType: 'blob' }),
  delete: filename => api.post(`/images/${filename}/delete`),
  batchDelete: filenames => api.post('/images/batch-delete', { filenames }),
  saveMetadata: (filename, metadata) => api.post(`/images/${filename}/metadata`, metadata),
  extend: filenames => api.post('/images/extend', { filenames }),
}

export const promptAPI = {
  list: (query, tags, scope = 'private', sort = 'likes', category, page = 1, size = 50, authorId, authorName) => { const params = { scope, sort, page, size }; if (query) params.query = query; if (tags) params.tags = tags; if (category) params.category = category; if (authorId) params.author_id = authorId; if (authorName) params.author_name = authorName; return api.get('/prompts', { params }) },
  listPublic: (query, sort = 'likes', category, page = 1, size = 50, authorId, authorName) => { const params = { sort, page, size }; if (query) params.query = query; if (category) params.category = category; if (authorId) params.author_id = authorId; if (authorName) params.author_name = authorName; return api.get('/prompts/public', { params }) },
  categories: (force = false) => loadPromptCategories(force),
  createCategory: data => api.post('/prompts/categories', data).then((res) => { invalidatePromptCategoryCache(); return res }),
  updateCategory: (id, data) => api.put(`/prompts/categories/${id}`, data).then((res) => { invalidatePromptCategoryCache(); return res }),
  deleteCategory: id => api.post(`/prompts/categories/${id}/delete`).then((res) => { invalidatePromptCategoryCache(); return res }),
  like: promptId => api.post(`/prompts/like?prompt_id=${promptId}`),
  create: data => api.post('/prompts', data),
  createPublic: data => api.post('/prompts/public', data),
  update: (id, data) => api.put(`/prompts/${id}`, data),
  delete: id => api.post(`/prompts/${id}/delete`),
  batchDelete: ids => api.post('/prompts/batch-delete', { ids }),
  import: file => { const fd = new FormData(); fd.append('file', file); return api.post('/prompts/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } }) },
  importPublic: file => { const fd = new FormData(); fd.append('file', file); return api.post('/prompts/import/public', fd, { headers: { 'Content-Type': 'multipart/form-data' } }) },
  export: (ids, format = 'json') => { const params = { format }; if (ids) params.ids = ids.join(','); return api.get('/prompts/export', { params, responseType: 'blob' }) },
}

export const statsAPI = { get: () => api.get('/stats'), system: () => api.get('/stats/system'), daily: () => api.get('/stats/daily'), users: () => api.get('/stats/users') }

export const promptOptimizeAPI = {
  optimize: (prompt, count = 1, format = 'text', mode = 'simple') => api.post('/prompt/optimize', { prompt, count, stream: false, format, mode }, { timeout: 60000 }),
  optimizeStream: async (prompt, count, { onChunk, onDone, onError, format = 'text', mode = 'simple' }) => {
    try {
      const resp = await fetch('/api/prompt/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ prompt, count, stream: true, format, mode }),
      })
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}))
        onError?.(data.detail || `请求失败 (${resp.status})`)
        return
      }
      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()
        let eventType = ''
        for (const line of lines) {
          if (line.startsWith('event: ')) { eventType = line.slice(7).trim() }
          else if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6))
            if (eventType === 'chunk') onChunk?.(data)
            else if (eventType === 'done') onDone?.(data)
            else if (eventType === 'error') onError?.(data.detail)
          }
        }
      }
    } catch (e) {
      onError?.(e.message || '网络错误')
    }
  },
}

export const chatAPI = {
  cost: (modelId = '') => api.get(`/chat/cost${modelId ? `?model_id=${encodeURIComponent(modelId)}` : ''}`),
  sessions: () => api.get('/chat/sessions'),
  createSession: () => api.post('/chat/sessions'),
  renameSession: (id, title) => api.patch(`/chat/sessions/${id}`, { title }),
  deleteSession: id => api.delete(`/chat/sessions/${id}`),
  batchDeleteSessions: ids => api.post('/chat/sessions/batch-delete', { ids }),
  messages: id => api.get(`/chat/sessions/${id}/messages`),
  model: () => api.get('/chat/model'),
  models: () => api.get('/chat/models'),
  // SSE 流式发送消息：仿 promptOptimizeAPI.optimizeStream 的 fetch + ReadableStream 解析
  sendStream: async (sessionId, content, { onChunk, onDone, onError, signal, reasoning_effort = 'auto', model_id = '' } = {}) => {
    try {
      const resp = await fetch(`/api/chat/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ content, reasoning_effort, ...(model_id ? { model_id } : {}) }),
        signal,
      })
      if (!resp.ok) {
        let detail = `请求失败 (${resp.status})`
        try {
          const data = await resp.json()
          if (data?.detail) detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail)
        } catch {}
        onError?.(detail)
        return
      }
      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()
        let eventType = ''
        for (const line of lines) {
          if (line.startsWith('event: ')) { eventType = line.slice(7).trim() }
          else if (line.startsWith('data: ')) {
            let data = null
            try { data = JSON.parse(line.slice(6)) } catch {}
            if (!data) continue
            if (eventType === 'chunk') onChunk?.(data)
            else if (eventType === 'done') onDone?.(data)
            else if (eventType === 'error') onError?.(data.detail)
          }
        }
      }
    } catch (e) {
      if (e?.name === 'AbortError') { onError?.('已停止生成'); return }
      onError?.(e?.message || '网络错误')
    }
  },
}

export const authAPI = {
  register: data => api.post('/auth/register', data),
  login: data => api.post('/auth/login', data),
  me: () => api.get('/auth/me'),
  refresh: () => api.post('/auth/refresh'),
  logout: () => api.post('/auth/logout'),
  sendCode: (email, turnstile_token) => api.post('/auth/send-code', { email, turnstile_token }),
  sendResetCode: (email, turnstile_token) => api.post('/auth/send-reset-code', { email, turnstile_token }),
  resetPassword: data => api.post('/auth/reset-password', data),
}

export const squareAPI = {
  list: (page = 1, size = 20, query, sort = 'likes', authorId, category) => { const params = { page, size, sort }; if (query) params.query = query; if (authorId) params.author_id = authorId; if (category) params.category = category; return api.get('/square', { params }) },
  shared: (page = 1, size = 20) => api.get('/square/shared', { params: { page, size } }),
  my: (page = 1, size = 20) => api.get('/square/my', { params: { page, size: Math.min(Number(size) || 20, 100) } }),
  share: data => api.post('/square/share', data),
  unshare: imageId => api.post(`/square/unshare?image_id=${imageId}`),
  like: imageId => api.post(`/square/like?image_id=${imageId}`),
}
export const favoriteAPI = {
  toggle: (targetType, targetId) => api.post('/favorites/toggle', { target_type: targetType, target_id: String(targetId) }),
  list: (type = 'all', page = 1, size = 20) => api.get('/favorites', { params: { type, page, size } }),
}

export const adminAPI = {
  users: (page = 1, size = 20, query) => { const params = { page, size }; if (query) params.query = query; return api.get('/admin/users', { params }) },
  createUser: data => api.post('/admin/users', data),
  deleteUser: userId => api.post(`/admin/users/${userId}/delete`),
  toggleFreeze: userId => api.post(`/admin/users/${userId}/freeze`),
  square: (page = 1, size = 20, query, status = 'all', sort = 'likes', authorId, category) => { const params = { page, size, status, sort }; if (query) params.query = query; if (authorId) params.author_id = authorId; if (category) params.category = category; return api.get('/admin/square', { params }) },
  deleteSquare: imageId => api.post(`/admin/square/${imageId}/delete`),
  freezeSquare: (ids, frozen = true) => api.post('/admin/square/freeze', { ids, frozen }),
  batchDeleteSquare: ids => api.post('/admin/square/batch-delete', { ids }),
  prompts: (page = 1, size = 20, query, category, status = 'all', sort = 'likes', authorId, authorName) => { const params = { page, size, status, sort }; if (query) params.query = query; if (category) params.category = category; if (authorId) params.author_id = authorId; if (authorName) params.author_name = authorName; return api.get('/admin/prompts', { params }) },
  freezePrompts: (ids, frozen = true) => api.post('/admin/prompts/freeze', { ids, frozen }),
  deletePrompt: promptId => api.post(`/admin/prompts/${promptId}/delete`),
  batchDeletePrompts: ids => api.post('/admin/prompts/batch-delete', { ids }),
  history: (page = 1, size = 20, query) => { const params = { page, size }; if (query) params.query = query; return api.get('/admin/history', { params }) },
  deleteHistory: taskId => api.post(`/admin/history/${taskId}/delete`),
  imageStats: () => api.get('/admin/hosting/stats'),
  hostingImages: (page = 1, size = 50, hostingType) => { const params = { page, size }; if (hostingType) params.hosting_type = hostingType; return api.get('/admin/hosting', { params }) },
  batchDeleteHosting: urls => api.post('/admin/hosting/batch-delete', { urls }),
  cleanDuplicates: () => api.post('/admin/hosting/clean-duplicates'),
  bannedWords: (page = 1, size = 20, query) => { const params = { page, size }; if (query) params.query = query; return api.get('/admin/banned-words', { params }) },
  addBannedWord: word => api.post('/admin/banned-words', { word }),
  batchImportBannedWords: text => api.post('/admin/banned-words/batch-import', { text }),
  deleteBannedWord: wordId => api.post(`/admin/banned-words/${wordId}/delete`),
  codes: (page = 1, size = 20, sort = 'created_at', order = 'desc') => api.get('/admin/codes', { params: { page, size, sort, order } }),
  generateCodes: data => api.post('/admin/codes', data),
  deleteCode: codeId => api.post(`/admin/codes/${codeId}/delete`),
  adjustPoints: (userId, data) => api.post(`/admin/users/${userId}/points`, data),
  resetPassword: (userId, password) => api.post(`/admin/users/${userId}/reset-password`, { password }),
  userInviteHistory: (userId, page = 1, size = 20) => api.get(`/admin/users/${userId}/invite-history`, { params: { page, size } }),
  migratePoints: () => api.post('/admin/migrate-points'),
  rechargeRequests: (page = 1, size = 20, status = 'all', query, sort = 'created_at', order = 'desc') => { const params = { page, size, status, sort, order }; if (query) params.query = query; return api.get('/admin/recharge-requests', { params }) },
  approveRecharge: (id, data) => api.post(`/admin/recharge-requests/${id}/approve`, data || {}),
  rejectRecharge: (id, data) => api.post(`/admin/recharge-requests/${id}/reject`, data || {}),
  refundRecharge: (id, data) => api.post(`/admin/recharge-requests/${id}/refund`, data || {}),
  statsOverview: (range = '7d') => api.get('/admin/stats/overview', { params: { range } }),
  statsCostProfit: (range = '30d') => api.get('/admin/stats/cost-profit', { params: { range } }),
  financeOverview: (range = '30d') => api.get('/admin/finance/overview', { params: { range } }),
  financeProviders: (range = '30d') => api.get('/admin/finance/providers', { params: { range } }),
  financePurchases: (page = 1, size = 20, provider_id) => { const params = { page, size }; if (provider_id) params.provider_id = provider_id; return api.get('/admin/finance/purchases', { params }) },
  createFinancePurchase: data => api.post('/admin/finance/purchases', data),
  updateFinancePurchase: (batchId, data) => api.post(`/admin/finance/purchases/${batchId}`, data),
  deleteFinancePurchase: batchId => api.post(`/admin/finance/purchases/${batchId}/delete`),
  financeQuotaRules: (page = 1, size = 50, provider_id) => { const params = { page, size }; if (provider_id) params.provider_id = provider_id; return api.get('/admin/finance/quota-rules', { params }) },
  saveFinanceQuotaRule: data => api.post('/admin/finance/quota-rules', data),
  deleteFinanceQuotaRule: ruleId => api.post(`/admin/finance/quota-rules/${ruleId}/delete`),
  financeTasks: (range = '30d', page = 1, size = 20, provider_id, model_id, status) => { const params = { range, page, size }; if (provider_id) params.provider_id = provider_id; if (model_id) params.model_id = model_id; if (status) params.status = status; return api.get('/admin/finance/tasks', { params }) },
  emailVerifications: (page = 1, size = 20, query) => { const params = { page, size }; if (query) params.query = query; return api.get('/admin/email-verifications', { params }) },
  createClassificationTask: (itemType = 'prompt', limit = 200) => api.post('/admin/classification/tasks', { item_type: itemType, limit }),
  reviewClassification: (itemType, categorySlug, limit = 200) => api.post('/admin/classification/review', { item_type: itemType, category_slug: categorySlug, limit }),
  listClassificationTasks: (page = 1, size = 20) => api.get('/admin/classification/tasks', { params: { page, size } }),
  getClassificationTask: taskId => api.get(`/admin/classification/tasks/${taskId}`),
  approveClassification: (taskId, resultIds) => api.post(`/admin/classification/tasks/${taskId}/approve`, { result_ids: resultIds }),
  rejectClassification: (taskId, resultIds) => api.post(`/admin/classification/tasks/${taskId}/reject`, { result_ids: resultIds }),
  updateClassificationResult: (resultId, data) => api.post(`/admin/classification/results/${resultId}`, data),
  createAuditTask: (itemType = 'prompt', limit = 200) => api.post('/admin/audit/tasks', { item_type: itemType, limit }),
  listAuditTasks: (page = 1, size = 20) => api.get('/admin/audit/tasks', { params: { page, size } }),
  getAuditTask: taskId => api.get(`/admin/audit/tasks/${taskId}`),
  approveAudit: (taskId, resultIds) => api.post(`/admin/audit/tasks/${taskId}/approve`, { result_ids: resultIds }),
  rejectAudit: (taskId, resultIds) => api.post(`/admin/audit/tasks/${taskId}/reject`, { result_ids: resultIds }),
  updateAuditResult: (resultId, data) => api.post(`/admin/audit/results/${resultId}`, data),
  titleItems: (itemType = 'prompt', query = '', page = 1, size = 20, onlyMissing = true, filters = {}) => { const params = { item_type: itemType, query, page, size, only_missing: onlyMissing }; if (filters.language) params.language = filters.language; if (filters.minChars !== '' && filters.minChars != null) params.min_chars = filters.minChars; if (filters.maxChars !== '' && filters.maxChars != null) params.max_chars = filters.maxChars; return api.get('/admin/title/items', { params }) },
  applyTitles: data => api.post('/admin/title/apply', data),
  testTitle: data => api.post('/admin/title/test', data),
}
export const configAPI = { get: () => api.get('/config'), admin: () => api.get('/config/admin'), update: data => api.post('/config', data), generationAdmin: () => api.get('/config/generation/admin'), models: () => api.get('/config/models') }

export const pointsAPI = {
  balance: () => api.get('/points/balance'),
  checkinStatus: () => api.get('/points/checkin/status'),
  checkin: () => api.post('/points/checkin'),
  redeem: code => api.post('/points/redeem', { code }),
  transactions: (page = 1, size = 20) => api.get('/points/transactions', { params: { page, size } }),
  inviteInfo: () => api.get('/points/invite'),
  generateInviteCode: () => api.post('/points/invite/generate'),
  inviteHistory: (page = 1, size = 20) => api.get('/points/invite/history', { params: { page, size } }),
  createRechargeRequest: data => api.post('/points/recharge/requests', data),
  getRechargeRequest: id => api.get(`/points/recharge/requests/${id}`),
  confirmRechargeRequest: id => api.post(`/points/recharge/requests/${id}/confirm`),
  rechargeRequests: (page = 1, size = 20) => api.get('/points/recharge/requests', { params: { page, size } }),
}

export const announcementAPI = {
  create: data => api.post('/announcements', data),
  list: (page = 1, size = 20) => api.get('/announcements', { params: { page, size } }),
  delete: id => api.post(`/announcements/${id}/delete`),
  getUnread: () => api.get('/announcements/unread'),
  markRead: id => api.post(`/announcements/${id}/read`),
}

export const notificationAPI = {
  list: (page = 1, size = 20) => api.get('/notifications', { params: { page, size } }),
  unreadCount: () => api.get('/notifications/unread-count'),
  markRead: id => api.post(`/notifications/${id}/read`),
  markAllRead: () => api.post('/notifications/read-all'),
  clearRead: () => api.post('/notifications/clear-read'),
}

export const accountAPI = {
  changePassword: data => api.post('/account/change-password', data),
  sessions: (page = 1, size = 20) => api.get('/account/security-sessions', { params: { page, size } }),
}

export const shareAPI = {
  create: data => api.post('/shares', data),
  list: () => api.get('/shares'),
  revoke: id => api.post(`/shares/${id}/revoke`),
}

export default api
