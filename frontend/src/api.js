import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 120000,
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
  list: (limit = 50, offset = 0) => api.get(`/tasks?limit=${limit}&offset=${offset}`),
  get: (id) => api.get(`/tasks/${id}`),
  retry: (id) => api.post(`/tasks/${id}/retry`),
  delete: (id) => api.delete(`/tasks/${id}`),
}

export const hostingAPI = {
  list: () => api.get('/hosting'),
  delete: (urls) => api.delete('/hosting', { data: { urls } }),
}

export const imageAPI = {
  list: (page = 1, pageSize = 20) => api.get(`/images?page=${page}&page_size=${pageSize}`),
  get: (filename) => api.get(`/images/${filename}`),
  delete: (filename) => api.delete(`/images/${filename}`),
  saveMetadata: (filename, metadata) => api.post(`/images/${filename}/metadata`, metadata),
}

export const promptAPI = {
  list: (query, tags) => {
    const params = {}
    if (query) params.query = query
    if (tags) params.tags = tags
    return api.get('/prompts', { params })
  },
  create: (data) => api.post('/prompts', data),
  update: (id, data) => api.put(`/prompts/${id}`, data),
  delete: (id) => api.delete(`/prompts/${id}`),
  batchDelete: (ids) => api.post('/prompts/batch-delete', { ids }),
  import: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post('/prompts/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
  export: (ids, format = 'json') => {
    const params = { format }
    if (ids) params.ids = ids.join(',')
    return api.get('/prompts/export', { params, responseType: 'blob' })
  },
}

export const statsAPI = {
  get: () => api.get('/stats'),
}

export const authAPI = {
  register: (data) => api.post('/auth/register', data),
  login: (data) => api.post('/auth/login', data),
  me: () => api.get('/auth/me'),
}

export const squareAPI = {
  list: (page = 1, size = 20) => api.get(`/square?page=${page}&size=${size}`),
  share: (data) => api.post('/square/share', data),
  like: (imageId) => api.post(`/square/like?image_id=${imageId}`),
  my: (page = 1, size = 20) => api.get(`/square/my?page=${page}&size=${size}`),
}

export const adminAPI = {
  users: (page = 1, size = 20) => api.get(`/admin/users?page=${page}&size=${size}`),
  deleteUser: (userId) => api.delete(`/admin/users/${userId}`),
  toggleFreeze: (userId) => api.post(`/admin/users/${userId}/freeze`),
  square: (page = 1, size = 20) => api.get(`/admin/square?page=${page}&size=${size}`),
  deleteSquare: (imageId) => api.delete(`/admin/square/${imageId}`),
}

export default api
