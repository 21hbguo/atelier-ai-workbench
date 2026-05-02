import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 1800000,
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = '/login'
    }
    const msg = err.response?.data?.detail || err.message || '请求失败'
    return Promise.reject(new Error(msg))
  }
)

export const generateAPI = {
  submitText: (data) => api.post('/generate/text', data),
  submitTextImage: (data) => api.post('/generate/text-image', data),
}

export const uploadAPI = {
  upload: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post('/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
  uploadBatch: (files) => {
    const fd = new FormData()
    files.forEach(f => fd.append('files', f))
    return api.post('/upload/batch', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
}

export const taskAPI = {
  list: (limit = 50, offset = 0, userId, query) => {
    const params = { limit, offset }
    if (userId) params.user_id = userId
    if (query) params.query = query
    return api.get('/tasks', { params })
  },
  get: (id) => api.get(`/tasks/${id}`),
  retry: (id) => api.post(`/tasks/${id}/retry`),
  delete: (id) => api.delete(`/tasks/${id}`),
}

export const imageAPI = {
  list: (page = 1, pageSize = 20, userId) => {
    const params = { page, page_size: pageSize }
    if (userId) params.user_id = userId
    return api.get('/images', { params })
  },
  get: (filename) => api.get(`/images/${filename}`),
  delete: (filename) => api.delete(`/images/${filename}`),
  saveMetadata: (filename, metadata) => api.post(`/images/${filename}/metadata`, metadata),
}

export const promptAPI = {
  list: (query, tags, scope = 'private', sort = 'likes', category, page = 1, size = 50) => {
    const params = { scope, sort, page, size }
    if (query) params.query = query
    if (tags) params.tags = tags
    if (category) params.category = category
    return api.get('/prompts', { params })
  },
  listPublic: (query, sort = 'likes', category, page = 1, size = 50) => {
    const params = { sort, page, size }
    if (query) params.query = query
    if (category) params.category = category
    return api.get('/prompts/public', { params })
  },
  categories: () => api.get('/prompts/categories'),
  like: (promptId) => api.post(`/prompts/like?prompt_id=${promptId}`),
  create: (data) => api.post('/prompts', data),
  createPublic: (data) => api.post('/prompts/public', data),
  update: (id, data) => api.put(`/prompts/${id}`, data),
  delete: (id) => api.delete(`/prompts/${id}`),
  batchDelete: (ids) => api.post('/prompts/batch-delete', { ids }),
  import: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post('/prompts/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
  importPublic: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post('/prompts/import/public', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
  export: (ids, format = 'json') => {
    const params = { format }
    if (ids) params.ids = ids.join(',')
    return api.get('/prompts/export', { params, responseType: 'blob' })
  },
}

export const statsAPI = {
  get: () => api.get('/stats'),
  system: () => api.get('/stats/system'),
  daily: () => api.get('/stats/daily'),
  users: () => api.get('/stats/users'),
}

export const authAPI = {
  register: (data) => api.post('/auth/register', data),
  login: (data) => api.post('/auth/login', data),
  me: () => api.get('/auth/me'),
}

export const squareAPI = {
  list: (page = 1, size = 20, query, sort = 'likes') => {
    const params = { page, size, sort }
    if (query) params.query = query
    return api.get('/square', { params })
  },
  my: (page = 1, size = 20) => api.get('/square/my', { params: { page, size } }),
  share: (data) => api.post('/square/share', data),
  like: (imageId) => api.post(`/square/like?image_id=${imageId}`),
}

export const adminAPI = {
  users: (page = 1, size = 20, query) => {
    const params = { page, size }
    if (query) params.query = query
    return api.get('/admin/users', { params })
  },
  deleteUser: (userId) => api.delete(`/admin/users/${userId}`),
  toggleFreeze: (userId) => api.post(`/admin/users/${userId}/freeze`),
  square: (page = 1, size = 20, query) => {
    const params = { page, size }
    if (query) params.query = query
    return api.get('/admin/square', { params })
  },
  deleteSquare: (imageId) => api.delete(`/admin/square/${imageId}`),
  prompts: (page = 1, size = 20, query) => {
    const params = { page, size }
    if (query) params.query = query
    return api.get('/admin/prompts', { params })
  },
  deletePrompt: (promptId) => api.delete(`/admin/prompts/${promptId}`),
  batchDeletePrompts: (ids) => api.post('/admin/prompts/batch-delete', { ids }),
  history: (page = 1, size = 20, query) => {
    const params = { page, size }
    if (query) params.query = query
    return api.get('/admin/history', { params })
  },
  deleteHistory: (taskId) => api.delete(`/admin/history/${taskId}`),
  imageStats: () => api.get('/admin/hosting/stats'),
  hostingImages: (page = 1, size = 50) => {
    const params = { page, size }
    return api.get('/admin/hosting', { params })
  },
  batchDeleteHosting: (urls) => api.post('/admin/hosting/batch-delete', { urls }),
  bannedWords: (page = 1, size = 20, query) => {
    const params = { page, size }
    if (query) params.query = query
    return api.get('/admin/banned-words', { params })
  },
  addBannedWord: (word) => api.post('/admin/banned-words', { word }),
  batchImportBannedWords: (text) => api.post('/admin/banned-words/batch-import', { text }),
  deleteBannedWord: (wordId) => api.delete(`/admin/banned-words/${wordId}`),
  codes: (page = 1, size = 20, sort = 'created_at', order = 'desc') => {
    const params = { page, size, sort, order }
    return api.get('/admin/codes', { params })
  },
  generateCodes: (data) => api.post('/admin/codes', data),
  adjustPoints: (userId, data) => api.post(`/admin/users/${userId}/points`, data),
  migratePoints: () => api.post('/admin/migrate-points'),
}

export const pointsAPI = {
  balance: () => api.get('/points/balance'),
  checkinStatus: () => api.get('/points/checkin/status'),
  checkin: () => api.post('/points/checkin'),
  redeem: (code) => api.post('/points/redeem', { code }),
  transactions: (page = 1, size = 20) => api.get('/points/transactions', { params: { page, size } }),
}

export const announcementAPI = {
  create: (data) => api.post('/announcements', data),
  list: (page = 1, size = 20) => api.get('/announcements', { params: { page, size } }),
  delete: (id) => api.delete(`/announcements/${id}`),
  getUnread: () => api.get('/announcements/unread'),
  markRead: (id) => api.post(`/announcements/${id}/read`),
}

export default api
