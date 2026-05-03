import axios from 'axios'
import { clearUser, writeUser } from './auth'

const api = axios.create({ baseURL: '/api', timeout: 1800000, withCredentials: true, headers: { 'Content-Type': 'application/json' } })
const refreshClient = axios.create({ baseURL: '/api', timeout: 1800000, withCredentials: true, headers: { 'Content-Type': 'application/json' } })
let refreshPromise = null

api.interceptors.response.use(
  res => res,
  async err => {
    const cfg = err.config || {}
    const url = cfg.url || ''
    const canRefresh = err.response?.status === 401 && !cfg._retry && !url.includes('/auth/login') && !url.includes('/auth/register') && !url.includes('/auth/refresh') && !url.includes('/auth/logout')
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
    const msg = err.response?.data?.detail || err.message || '请求失败'
    return Promise.reject(new Error(msg))
  }
)

export const generateAPI = { submitText: data => api.post('/generate/text', data), submitTextImage: data => api.post('/generate/text-image', data) }

export const uploadAPI = {
  upload: file => { const fd = new FormData(); fd.append('file', file); return api.post('/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } }) },
  uploadLocal: file => { const fd = new FormData(); fd.append('file', file); return api.post('/upload/local', fd, { headers: { 'Content-Type': 'multipart/form-data' } }) },
  uploadBatch: files => { const fd = new FormData(); files.forEach(f => fd.append('files', f)); return api.post('/upload/batch', fd, { headers: { 'Content-Type': 'multipart/form-data' } }) },
}

export const taskAPI = {
  list: (limit = 50, offset = 0, userId, query) => { const params = { limit, offset }; if (userId) params.user_id = userId; if (query) params.query = query; return api.get('/tasks', { params }) },
  get: id => api.get(`/tasks/${id}`),
  retry: id => api.post(`/tasks/${id}/retry`),
  delete: id => api.post(`/tasks/${id}/delete`),
}

export const imageAPI = {
  list: (page = 1, pageSize = 20, userId) => { const params = { page, page_size: pageSize }; if (userId) params.user_id = userId; return api.get('/images', { params }) },
  get: filename => api.get(`/images/${filename}`),
  delete: filename => api.post(`/images/${filename}/delete`),
  saveMetadata: (filename, metadata) => api.post(`/images/${filename}/metadata`, metadata),
  extend: filenames => api.post('/images/extend', { filenames }),
}

export const promptAPI = {
  list: (query, tags, scope = 'private', sort = 'likes', category, page = 1, size = 50) => { const params = { scope, sort, page, size }; if (query) params.query = query; if (tags) params.tags = tags; if (category) params.category = category; return api.get('/prompts', { params }) },
  listPublic: (query, sort = 'likes', category, page = 1, size = 50) => { const params = { sort, page, size }; if (query) params.query = query; if (category) params.category = category; return api.get('/prompts/public', { params }) },
  categories: () => api.get('/prompts/categories'),
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

export const authAPI = {
  register: data => api.post('/auth/register', data),
  login: data => api.post('/auth/login', data),
  me: () => api.get('/auth/me'),
  refresh: () => api.post('/auth/refresh'),
  logout: () => api.post('/auth/logout'),
}

export const squareAPI = {
  list: (page = 1, size = 20, query, sort = 'likes') => { const params = { page, size, sort }; if (query) params.query = query; return api.get('/square', { params }) },
  my: (page = 1, size = 20) => api.get('/square/my', { params: { page, size } }),
  share: data => api.post('/square/share', data),
  like: imageId => api.post(`/square/like?image_id=${imageId}`),
}

export const adminAPI = {
  users: (page = 1, size = 20, query) => { const params = { page, size }; if (query) params.query = query; return api.get('/admin/users', { params }) },
  deleteUser: userId => api.post(`/admin/users/${userId}/delete`),
  toggleFreeze: userId => api.post(`/admin/users/${userId}/freeze`),
  square: (page = 1, size = 20, query, status = 'all') => { const params = { page, size, status }; if (query) params.query = query; return api.get('/admin/square', { params }) },
  deleteSquare: imageId => api.post(`/admin/square/${imageId}/delete`),
  freezeSquare: (ids, frozen = true) => api.post('/admin/square/freeze', { ids, frozen }),
  batchDeleteSquare: ids => api.post('/admin/square/batch-delete', { ids }),
  prompts: (page = 1, size = 20, query, category, status = 'all') => { const params = { page, size, status }; if (query) params.query = query; if (category) params.category = category; return api.get('/admin/prompts', { params }) },
  freezePrompts: (ids, frozen = true) => api.post('/admin/prompts/freeze', { ids, frozen }),
  deletePrompt: promptId => api.post(`/admin/prompts/${promptId}/delete`),
  batchDeletePrompts: ids => api.post('/admin/prompts/batch-delete', { ids }),
  history: (page = 1, size = 20, query) => { const params = { page, size }; if (query) params.query = query; return api.get('/admin/history', { params }) },
  deleteHistory: taskId => api.post(`/admin/history/${taskId}/delete`),
  imageStats: () => api.get('/admin/hosting/stats'),
  hostingImages: (page = 1, size = 50) => api.get('/admin/hosting', { params: { page, size } }),
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
  migratePoints: () => api.post('/admin/migrate-points'),
  rechargeRequests: (page = 1, size = 20, status = 'all', query, sort = 'created_at', order = 'desc') => { const params = { page, size, status, sort, order }; if (query) params.query = query; return api.get('/admin/recharge-requests', { params }) },
  approveRecharge: (id, data) => api.post(`/admin/recharge-requests/${id}/approve`, data || {}),
  rejectRecharge: (id, data) => api.post(`/admin/recharge-requests/${id}/reject`, data || {}),
  statsOverview: (range = '7d') => api.get('/admin/stats/overview', { params: { range } }),
}
export const configAPI = { admin: () => api.get('/config/admin'), update: data => api.post('/config', data), generationAdmin: () => api.get('/config/generation/admin') }

export const pointsAPI = {
  balance: () => api.get('/points/balance'),
  checkinStatus: () => api.get('/points/checkin/status'),
  checkin: () => api.post('/points/checkin'),
  redeem: code => api.post('/points/redeem', { code }),
  transactions: (page = 1, size = 20) => api.get('/points/transactions', { params: { page, size } }),
  createRechargeRequest: data => api.post('/points/recharge/requests', data),
  rechargeRequests: (page = 1, size = 20) => api.get('/points/recharge/requests', { params: { page, size } }),
}

export const announcementAPI = {
  create: data => api.post('/announcements', data),
  list: (page = 1, size = 20) => api.get('/announcements', { params: { page, size } }),
  delete: id => api.post(`/announcements/${id}/delete`),
  getUnread: () => api.get('/announcements/unread'),
  markRead: id => api.post(`/announcements/${id}/read`),
}

export default api
