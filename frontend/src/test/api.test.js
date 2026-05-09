import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'

vi.mock('axios', () => {
  const mockApi = {
    get: vi.fn(() => Promise.resolve({ data: {} })),
    post: vi.fn(() => Promise.resolve({ data: {} })),
    put: vi.fn(() => Promise.resolve({ data: {} })),
    interceptors: { response: { use: vi.fn() } },
  }
  return { default: { create: vi.fn(() => mockApi) } }
})

let mockApi, errorHandler

beforeAll(async () => {
  await import('../api')
  const axios = (await import('axios')).default
  mockApi = axios.create.mock.results[0].value
  errorHandler = mockApi.interceptors.response.use.mock.calls[0][1]
})

let api
beforeEach(async () => {
  vi.clearAllMocks()
  api = await import('../api')
})

describe('generateAPI', () => {
  it('submitText posts to /generate/text', () => {
    api.generateAPI.submitText({ prompt: 'hi' })
    expect(mockApi.post).toHaveBeenCalledWith('/generate/text', { prompt: 'hi' })
  })

  it('submitTextImage posts to /generate/text-image', () => {
    api.generateAPI.submitTextImage({ prompt: 'hi', image: 'url' })
    expect(mockApi.post).toHaveBeenCalledWith('/generate/text-image', { prompt: 'hi', image: 'url' })
  })
})

describe('uploadAPI', () => {
  it('upload posts FormData to /upload with multipart header', () => {
    const file = new File(['data'], 'test.png', { type: 'image/png' })
    api.uploadAPI.upload(file)
    expect(mockApi.post).toHaveBeenCalledWith('/upload', expect.any(FormData), expect.objectContaining({
      headers: { 'Content-Type': 'multipart/form-data' },
    }))
  })

  it('upload passes signal option', () => {
    const file = new File(['data'], 'test.png')
    const ctrl = new AbortController()
    api.uploadAPI.upload(file, { signal: ctrl.signal })
    const opts = mockApi.post.mock.calls[0][2]
    expect(opts.signal).toBe(ctrl.signal)
  })

  it('uploadLocal posts to /upload/local', () => {
    const file = new File(['data'], 'test.png')
    api.uploadAPI.uploadLocal(file)
    expect(mockApi.post).toHaveBeenCalledWith('/upload/local', expect.any(FormData), expect.objectContaining({
      headers: { 'Content-Type': 'multipart/form-data' },
    }))
  })

  it('uploadLocalPublic posts to /upload/local/public', () => {
    const file = new File(['data'], 'test.png')
    api.uploadAPI.uploadLocalPublic(file)
    expect(mockApi.post).toHaveBeenCalledWith('/upload/local/public', expect.any(FormData), expect.objectContaining({
      headers: { 'Content-Type': 'multipart/form-data' },
    }))
  })

  it('uploadBatch posts multiple files to /upload/batch', () => {
    const files = [new File(['a'], 'a.png'), new File(['b'], 'b.png')]
    api.uploadAPI.uploadBatch(files)
    expect(mockApi.post).toHaveBeenCalledWith('/upload/batch', expect.any(FormData), expect.objectContaining({
      headers: { 'Content-Type': 'multipart/form-data' },
    }))
  })
})

describe('taskAPI', () => {
  it('list with defaults', () => {
    api.taskAPI.list()
    expect(mockApi.get).toHaveBeenCalledWith('/tasks', { params: { limit: 50, offset: 0 } })
  })

  it('list with userId and query', () => {
    api.taskAPI.list(10, 0, 'u1', 'q')
    expect(mockApi.get).toHaveBeenCalledWith('/tasks', { params: { limit: 10, offset: 0, user_id: 'u1', query: 'q' } })
  })

  it('list passes signal option', () => {
    const ctrl = new AbortController()
    api.taskAPI.list(10, 0, 'u1', 'q', { signal: ctrl.signal })
    expect(mockApi.get).toHaveBeenCalledWith('/tasks', { params: { limit: 10, offset: 0, user_id: 'u1', query: 'q' }, signal: ctrl.signal })
  })

  it('activeSummary', () => {
    api.taskAPI.activeSummary()
    expect(mockApi.get).toHaveBeenCalledWith('/tasks/active-summary')
  })

  it('getByClientRequestId', () => {
    api.taskAPI.getByClientRequestId('req-123')
    expect(mockApi.get).toHaveBeenCalledWith('/tasks/by-client/req-123')
  })

  it('get', () => {
    api.taskAPI.get('t1')
    expect(mockApi.get).toHaveBeenCalledWith('/tasks/t1')
  })

  it('retry', () => {
    api.taskAPI.retry('t1')
    expect(mockApi.post).toHaveBeenCalledWith('/tasks/t1/retry')
  })

  it('delete', () => {
    api.taskAPI.delete('t1')
    expect(mockApi.post).toHaveBeenCalledWith('/tasks/t1/delete')
  })

  it('batchDelete', () => {
    api.taskAPI.batchDelete(['t1', 't2'])
    expect(mockApi.post).toHaveBeenCalledWith('/tasks/batch-delete', { ids: ['t1', 't2'] })
  })
})

describe('imageAPI', () => {
  it('list with defaults', () => {
    api.imageAPI.list()
    expect(mockApi.get).toHaveBeenCalledWith('/images', { params: { page: 1, page_size: 20 } })
  })

  it('list with userId', () => {
    api.imageAPI.list(2, 10, 'u1')
    expect(mockApi.get).toHaveBeenCalledWith('/images', { params: { page: 2, page_size: 10, user_id: 'u1' } })
  })

  it('list passes signal option', () => {
    const ctrl = new AbortController()
    api.imageAPI.list(2, 10, 'u1', { signal: ctrl.signal })
    expect(mockApi.get).toHaveBeenCalledWith('/images', { params: { page: 2, page_size: 10, user_id: 'u1' }, signal: ctrl.signal })
  })

  it('get', () => {
    api.imageAPI.get('img.png')
    expect(mockApi.get).toHaveBeenCalledWith('/images/img.png')
  })

  it('getBlobByUrl strips /api/ prefix', () => {
    api.imageAPI.getBlobByUrl('/api/images/test.png')
    expect(mockApi.get).toHaveBeenCalledWith('/images/test.png', { responseType: 'blob' })
  })

  it('getBlobByUrl uses url as-is when no /api/ prefix', () => {
    api.imageAPI.getBlobByUrl('https://cdn.example.com/img.png')
    expect(mockApi.get).toHaveBeenCalledWith('https://cdn.example.com/img.png', { responseType: 'blob' })
  })

  it('getBlobByUrl handles null url', () => {
    api.imageAPI.getBlobByUrl(null)
    expect(mockApi.get).toHaveBeenCalledWith('', { responseType: 'blob' })
  })

  it('downloadBatch', () => {
    api.imageAPI.downloadBatch(['a.png', 'b.png'])
    expect(mockApi.post).toHaveBeenCalledWith('/images/download-batch', { filenames: ['a.png', 'b.png'] }, { responseType: 'blob' })
  })

  it('delete', () => {
    api.imageAPI.delete('img.png')
    expect(mockApi.post).toHaveBeenCalledWith('/images/img.png/delete')
  })

  it('batchDelete', () => {
    api.imageAPI.batchDelete(['a.png', 'b.png'])
    expect(mockApi.post).toHaveBeenCalledWith('/images/batch-delete', { filenames: ['a.png', 'b.png'] })
  })

  it('saveMetadata', () => {
    api.imageAPI.saveMetadata('img.png', { tag: 'test' })
    expect(mockApi.post).toHaveBeenCalledWith('/images/img.png/metadata', { tag: 'test' })
  })

  it('extend', () => {
    api.imageAPI.extend(['a.png'])
    expect(mockApi.post).toHaveBeenCalledWith('/images/extend', { filenames: ['a.png'] })
  })
})

describe('promptAPI', () => {
  beforeEach(() => {
    mockApi.get.mockResolvedValue({ data: { categories: [] } })
  })
  it('list with defaults', () => {
    api.promptAPI.list()
    expect(mockApi.get).toHaveBeenCalledWith('/prompts', { params: { scope: 'private', sort: 'likes', page: 1, size: 50 } })
  })

  it('list with all filters', () => {
    api.promptAPI.list('q', 'tag1', 'public', 'new', 'cat', 2, 10, 'a1', 'alice')
    expect(mockApi.get).toHaveBeenCalledWith('/prompts', { params: { scope: 'public', sort: 'new', page: 2, size: 10, query: 'q', tags: 'tag1', category: 'cat', author_id: 'a1', author_name: 'alice' } })
  })

  it('listPublic', () => {
    api.promptAPI.listPublic()
    expect(mockApi.get).toHaveBeenCalledWith('/prompts/public', { params: { sort: 'likes', page: 1, size: 50 } })
  })

  it('categories', async () => {
    await api.promptAPI.categories(true)
    expect(mockApi.get).toHaveBeenCalledWith('/prompts/categories')
  })

  it('categories uses cache by default', async () => {
    await api.promptAPI.categories(true)
    await api.promptAPI.categories()
    expect(mockApi.get).toHaveBeenCalledTimes(1)
  })

  it('createCategory', () => {
    api.promptAPI.createCategory({ name: 'c1' })
    expect(mockApi.post).toHaveBeenCalledWith('/prompts/categories', { name: 'c1' })
  })

  it('updateCategory', () => {
    api.promptAPI.updateCategory('c1', { name: 'c2' })
    expect(mockApi.put).toHaveBeenCalledWith('/prompts/categories/c1', { name: 'c2' })
  })

  it('deleteCategory', () => {
    api.promptAPI.deleteCategory('c1')
    expect(mockApi.post).toHaveBeenCalledWith('/prompts/categories/c1/delete')
  })

  it('like', () => {
    api.promptAPI.like('p1')
    expect(mockApi.post).toHaveBeenCalledWith('/prompts/like?prompt_id=p1')
  })

  it('create', () => {
    api.promptAPI.create({ title: 't' })
    expect(mockApi.post).toHaveBeenCalledWith('/prompts', { title: 't' })
  })

  it('createPublic', () => {
    api.promptAPI.createPublic({ title: 't' })
    expect(mockApi.post).toHaveBeenCalledWith('/prompts/public', { title: 't' })
  })

  it('update', () => {
    api.promptAPI.update('p1', { title: 't' })
    expect(mockApi.put).toHaveBeenCalledWith('/prompts/p1', { title: 't' })
  })

  it('delete', () => {
    api.promptAPI.delete('p1')
    expect(mockApi.post).toHaveBeenCalledWith('/prompts/p1/delete')
  })

  it('batchDelete', () => {
    api.promptAPI.batchDelete(['p1', 'p2'])
    expect(mockApi.post).toHaveBeenCalledWith('/prompts/batch-delete', { ids: ['p1', 'p2'] })
  })

  it('import', () => {
    const file = new File(['{}'], 'data.json')
    api.promptAPI.import(file)
    expect(mockApi.post).toHaveBeenCalledWith('/prompts/import', expect.any(FormData), expect.objectContaining({
      headers: { 'Content-Type': 'multipart/form-data' },
    }))
  })

  it('importPublic', () => {
    const file = new File(['{}'], 'data.json')
    api.promptAPI.importPublic(file)
    expect(mockApi.post).toHaveBeenCalledWith('/prompts/import/public', expect.any(FormData), expect.objectContaining({
      headers: { 'Content-Type': 'multipart/form-data' },
    }))
  })

  it('export with defaults', () => {
    api.promptAPI.export()
    expect(mockApi.get).toHaveBeenCalledWith('/prompts/export', { params: { format: 'json' }, responseType: 'blob' })
  })

  it('export with ids and format', () => {
    api.promptAPI.export(['p1', 'p2'], 'csv')
    expect(mockApi.get).toHaveBeenCalledWith('/prompts/export', { params: { format: 'csv', ids: 'p1,p2' }, responseType: 'blob' })
  })
})

describe('statsAPI', () => {
  it('get', () => { api.statsAPI.get(); expect(mockApi.get).toHaveBeenCalledWith('/stats') })
  it('system', () => { api.statsAPI.system(); expect(mockApi.get).toHaveBeenCalledWith('/stats/system') })
  it('daily', () => { api.statsAPI.daily(); expect(mockApi.get).toHaveBeenCalledWith('/stats/daily') })
  it('users', () => { api.statsAPI.users(); expect(mockApi.get).toHaveBeenCalledWith('/stats/users') })
})

describe('promptOptimizeAPI', () => {
  it('optimize posts with defaults', () => {
    api.promptOptimizeAPI.optimize('prompt')
    expect(mockApi.post).toHaveBeenCalledWith('/prompt/optimize', { prompt: 'prompt', count: 1, stream: false, format: 'text', mode: 'simple' }, { timeout: 60000 })
  })

  it('optimize with custom params', () => {
    api.promptOptimizeAPI.optimize('p', 3, 'json', 'detail')
    expect(mockApi.post).toHaveBeenCalledWith('/prompt/optimize', { prompt: 'p', count: 3, stream: false, format: 'json', mode: 'detail' }, { timeout: 60000 })
  })

  describe('optimizeStream', () => {
    let origFetch
    beforeEach(() => {
      origFetch = global.fetch
    })
    afterEach(() => {
      global.fetch = origFetch
    })

    it('calls onChunk for chunk events', async () => {
      const encoder = new TextEncoder()
      const chunks = [
        'event: chunk\ndata: {"text":"hello"}\n\n',
        'event: done\ndata: {"text":"done"}\n\n',
      ]
      let i = 0
      global.fetch = vi.fn(() => Promise.resolve({
        ok: true,
        body: {
          getReader: () => ({
            read: () => {
              if (i < chunks.length) {
                const val = { value: encoder.encode(chunks[i]), done: false }
                i++
                return Promise.resolve(val)
              }
              return Promise.resolve({ done: true })
            },
          }),
        },
      }))

      const onChunk = vi.fn()
      const onDone = vi.fn()
      await api.promptOptimizeAPI.optimizeStream('p', 1, { onChunk, onDone })
      expect(onChunk).toHaveBeenCalledWith({ text: 'hello' })
      expect(onDone).toHaveBeenCalledWith({ text: 'done' })
    })

    it('calls onError for error events', async () => {
      const encoder = new TextEncoder()
      global.fetch = vi.fn(() => Promise.resolve({
        ok: true,
        body: {
          getReader: () => ({
            read: vi.fn()
              .mockResolvedValueOnce({ value: encoder.encode('event: error\ndata: {"detail":"bad"}\n\n'), done: false })
              .mockResolvedValueOnce({ done: true }),
          }),
        },
      }))

      const onError = vi.fn()
      await api.promptOptimizeAPI.optimizeStream('p', 1, { onError })
      expect(onError).toHaveBeenCalledWith('bad')
    })

    it('calls onError when response is not ok', async () => {
      global.fetch = vi.fn(() => Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ detail: 'server error' }),
      }))

      const onError = vi.fn()
      await api.promptOptimizeAPI.optimizeStream('p', 1, { onError })
      expect(onError).toHaveBeenCalledWith('server error')
    })

    it('calls onError with status when json fails', async () => {
      global.fetch = vi.fn(() => Promise.resolve({
        ok: false,
        status: 502,
        json: () => Promise.reject(new Error('bad json')),
      }))

      const onError = vi.fn()
      await api.promptOptimizeAPI.optimizeStream('p', 1, { onError })
      expect(onError).toHaveBeenCalledWith('请求失败 (502)')
    })

    it('calls onError on network error', async () => {
      global.fetch = vi.fn(() => Promise.reject(new Error('network down')))
      const onError = vi.fn()
      await api.promptOptimizeAPI.optimizeStream('p', 1, { onError })
      expect(onError).toHaveBeenCalledWith('network down')
    })
  })
})

describe('authAPI', () => {
  it('register', () => { api.authAPI.register({ email: 'a@b.com' }); expect(mockApi.post).toHaveBeenCalledWith('/auth/register', { email: 'a@b.com' }) })
  it('login', () => { api.authAPI.login({ email: 'a@b.com' }); expect(mockApi.post).toHaveBeenCalledWith('/auth/login', { email: 'a@b.com' }) })
  it('me', () => { api.authAPI.me(); expect(mockApi.get).toHaveBeenCalledWith('/auth/me') })
  it('refresh', () => { api.authAPI.refresh(); expect(mockApi.post).toHaveBeenCalledWith('/auth/refresh') })
  it('logout', () => { api.authAPI.logout(); expect(mockApi.post).toHaveBeenCalledWith('/auth/logout') })
  it('sendCode', () => { api.authAPI.sendCode('a@b.com', 'tk'); expect(mockApi.post).toHaveBeenCalledWith('/auth/send-code', { email: 'a@b.com', turnstile_token: 'tk' }) })
  it('sendResetCode', () => { api.authAPI.sendResetCode('a@b.com', 'tk'); expect(mockApi.post).toHaveBeenCalledWith('/auth/send-reset-code', { email: 'a@b.com', turnstile_token: 'tk' }) })
  it('resetPassword', () => { api.authAPI.resetPassword({ code: '123' }); expect(mockApi.post).toHaveBeenCalledWith('/auth/reset-password', { code: '123' }) })
})

describe('squareAPI', () => {
  it('list with defaults', () => {
    api.squareAPI.list()
    expect(mockApi.get).toHaveBeenCalledWith('/square', { params: { page: 1, size: 20, sort: 'likes' } })
  })

  it('list with all filters', () => {
    api.squareAPI.list(2, 10, 'q', 'new', 'a1', 'cat')
    expect(mockApi.get).toHaveBeenCalledWith('/square', { params: { page: 2, size: 10, sort: 'new', query: 'q', author_id: 'a1', category: 'cat' } })
  })

  it('shared', () => { api.squareAPI.shared(); expect(mockApi.get).toHaveBeenCalledWith('/square/shared', { params: { page: 1, size: 20 } }) })
  it('my', () => { api.squareAPI.my(); expect(mockApi.get).toHaveBeenCalledWith('/square/my', { params: { page: 1, size: 20 } }) })
  it('my caps size at 100', () => { api.squareAPI.my(1, 500); expect(mockApi.get).toHaveBeenCalledWith('/square/my', { params: { page: 1, size: 100 } }) })
  it('share', () => { api.squareAPI.share({ image_id: 'i1' }); expect(mockApi.post).toHaveBeenCalledWith('/square/share', { image_id: 'i1' }) })
  it('unshare', () => { api.squareAPI.unshare('i1'); expect(mockApi.post).toHaveBeenCalledWith('/square/unshare?image_id=i1') })
  it('like', () => { api.squareAPI.like('i1'); expect(mockApi.post).toHaveBeenCalledWith('/square/like?image_id=i1') })
})

describe('favoriteAPI', () => {
  it('toggle', () => { api.favoriteAPI.toggle('prompt', 'p1'); expect(mockApi.post).toHaveBeenCalledWith('/favorites/toggle', { target_type: 'prompt', target_id: 'p1' }) })
  it('list with defaults', () => { api.favoriteAPI.list(); expect(mockApi.get).toHaveBeenCalledWith('/favorites', { params: { type: 'all', page: 1, size: 20 } }) })
})

describe('configAPI', () => {
  it('get', () => { api.configAPI.get(); expect(mockApi.get).toHaveBeenCalledWith('/config') })
  it('admin', () => { api.configAPI.admin(); expect(mockApi.get).toHaveBeenCalledWith('/config/admin') })
  it('update', () => { api.configAPI.update({ key: 'val' }); expect(mockApi.post).toHaveBeenCalledWith('/config', { key: 'val' }) })
  it('generationAdmin', () => { api.configAPI.generationAdmin(); expect(mockApi.get).toHaveBeenCalledWith('/config/generation/admin') })
  it('models', () => { api.configAPI.models(); expect(mockApi.get).toHaveBeenCalledWith('/config/models') })
})

describe('pointsAPI', () => {
  it('balance', () => { api.pointsAPI.balance(); expect(mockApi.get).toHaveBeenCalledWith('/points/balance') })
  it('checkinStatus', () => { api.pointsAPI.checkinStatus(); expect(mockApi.get).toHaveBeenCalledWith('/points/checkin/status') })
  it('checkin', () => { api.pointsAPI.checkin(); expect(mockApi.post).toHaveBeenCalledWith('/points/checkin') })
  it('redeem', () => { api.pointsAPI.redeem('CODE'); expect(mockApi.post).toHaveBeenCalledWith('/points/redeem', { code: 'CODE' }) })
  it('transactions', () => { api.pointsAPI.transactions(); expect(mockApi.get).toHaveBeenCalledWith('/points/transactions', { params: { page: 1, size: 20 } }) })
  it('inviteInfo', () => { api.pointsAPI.inviteInfo(); expect(mockApi.get).toHaveBeenCalledWith('/points/invite') })
  it('generateInviteCode', () => { api.pointsAPI.generateInviteCode(); expect(mockApi.post).toHaveBeenCalledWith('/points/invite/generate') })
  it('inviteHistory', () => { api.pointsAPI.inviteHistory(); expect(mockApi.get).toHaveBeenCalledWith('/points/invite/history', { params: { page: 1, size: 20 } }) })
  it('createRechargeRequest', () => { api.pointsAPI.createRechargeRequest({ amount: 100 }); expect(mockApi.post).toHaveBeenCalledWith('/points/recharge/requests', { amount: 100 }) })
  it('getRechargeRequest', () => { api.pointsAPI.getRechargeRequest('r1'); expect(mockApi.get).toHaveBeenCalledWith('/points/recharge/requests/r1') })
  it('confirmRechargeRequest', () => { api.pointsAPI.confirmRechargeRequest('r1'); expect(mockApi.post).toHaveBeenCalledWith('/points/recharge/requests/r1/confirm') })
  it('rechargeRequests', () => { api.pointsAPI.rechargeRequests(); expect(mockApi.get).toHaveBeenCalledWith('/points/recharge/requests', { params: { page: 1, size: 20 } }) })
})

describe('announcementAPI', () => {
  it('create', () => { api.announcementAPI.create({ title: 't' }); expect(mockApi.post).toHaveBeenCalledWith('/announcements', { title: 't' }) })
  it('list', () => { api.announcementAPI.list(); expect(mockApi.get).toHaveBeenCalledWith('/announcements', { params: { page: 1, size: 20 } }) })
  it('delete', () => { api.announcementAPI.delete('a1'); expect(mockApi.post).toHaveBeenCalledWith('/announcements/a1/delete') })
  it('getUnread', () => { api.announcementAPI.getUnread(); expect(mockApi.get).toHaveBeenCalledWith('/announcements/unread') })
  it('markRead', () => { api.announcementAPI.markRead('a1'); expect(mockApi.post).toHaveBeenCalledWith('/announcements/a1/read') })
})

describe('notificationAPI', () => {
  it('list', () => { api.notificationAPI.list(); expect(mockApi.get).toHaveBeenCalledWith('/notifications', { params: { page: 1, size: 20 } }) })
  it('unreadCount', () => { api.notificationAPI.unreadCount(); expect(mockApi.get).toHaveBeenCalledWith('/notifications/unread-count') })
  it('markRead', () => { api.notificationAPI.markRead('n1'); expect(mockApi.post).toHaveBeenCalledWith('/notifications/n1/read') })
  it('markAllRead', () => { api.notificationAPI.markAllRead(); expect(mockApi.post).toHaveBeenCalledWith('/notifications/read-all') })
  it('clearRead', () => { api.notificationAPI.clearRead(); expect(mockApi.post).toHaveBeenCalledWith('/notifications/clear-read') })
})

describe('accountAPI', () => {
  it('changePassword', () => { api.accountAPI.changePassword({ old: 'a', new: 'b' }); expect(mockApi.post).toHaveBeenCalledWith('/account/change-password', { old: 'a', new: 'b' }) })
  it('sessions', () => { api.accountAPI.sessions(); expect(mockApi.get).toHaveBeenCalledWith('/account/security-sessions', { params: { page: 1, size: 20 } }) })
})

describe('shareAPI', () => {
  it('create', () => { api.shareAPI.create({ image_id: 'i1' }); expect(mockApi.post).toHaveBeenCalledWith('/shares', { image_id: 'i1' }) })
  it('list', () => { api.shareAPI.list(); expect(mockApi.get).toHaveBeenCalledWith('/shares') })
  it('revoke', () => { api.shareAPI.revoke('s1'); expect(mockApi.post).toHaveBeenCalledWith('/shares/s1/revoke') })
})

describe('adminAPI', () => {
  it('users with defaults', () => {
    api.adminAPI.users()
    expect(mockApi.get).toHaveBeenCalledWith('/admin/users', { params: { page: 1, size: 20 } })
  })

  it('users with query', () => {
    api.adminAPI.users(2, 10, 'q')
    expect(mockApi.get).toHaveBeenCalledWith('/admin/users', { params: { page: 2, size: 10, query: 'q' } })
  })

  it('createUser', () => { api.adminAPI.createUser({ email: 'a@b.com' }); expect(mockApi.post).toHaveBeenCalledWith('/admin/users', { email: 'a@b.com' }) })
  it('deleteUser', () => { api.adminAPI.deleteUser('u1'); expect(mockApi.post).toHaveBeenCalledWith('/admin/users/u1/delete') })
  it('toggleFreeze', () => { api.adminAPI.toggleFreeze('u1'); expect(mockApi.post).toHaveBeenCalledWith('/admin/users/u1/freeze') })
  it('deleteSquare', () => { api.adminAPI.deleteSquare('i1'); expect(mockApi.post).toHaveBeenCalledWith('/admin/square/i1/delete') })
  it('freezeSquare', () => { api.adminAPI.freezeSquare(['i1', 'i2']); expect(mockApi.post).toHaveBeenCalledWith('/admin/square/freeze', { ids: ['i1', 'i2'], frozen: true }) })
  it('freezeSquare unfreeze', () => { api.adminAPI.freezeSquare(['i1'], false); expect(mockApi.post).toHaveBeenCalledWith('/admin/square/freeze', { ids: ['i1'], frozen: false }) })
  it('batchDeleteSquare', () => { api.adminAPI.batchDeleteSquare(['i1']); expect(mockApi.post).toHaveBeenCalledWith('/admin/square/batch-delete', { ids: ['i1'] }) })
  it('deletePrompt', () => { api.adminAPI.deletePrompt('p1'); expect(mockApi.post).toHaveBeenCalledWith('/admin/prompts/p1/delete') })
  it('freezePrompts', () => { api.adminAPI.freezePrompts(['p1']); expect(mockApi.post).toHaveBeenCalledWith('/admin/prompts/freeze', { ids: ['p1'], frozen: true }) })
  it('batchDeletePrompts', () => { api.adminAPI.batchDeletePrompts(['p1']); expect(mockApi.post).toHaveBeenCalledWith('/admin/prompts/batch-delete', { ids: ['p1'] }) })
  it('deleteHistory', () => { api.adminAPI.deleteHistory('t1'); expect(mockApi.post).toHaveBeenCalledWith('/admin/history/t1/delete') })
  it('imageStats', () => { api.adminAPI.imageStats(); expect(mockApi.get).toHaveBeenCalledWith('/admin/hosting/stats') })
  it('batchDeleteHosting', () => { api.adminAPI.batchDeleteHosting(['u1']); expect(mockApi.post).toHaveBeenCalledWith('/admin/hosting/batch-delete', { urls: ['u1'] }) })
  it('cleanDuplicates', () => { api.adminAPI.cleanDuplicates(); expect(mockApi.post).toHaveBeenCalledWith('/admin/hosting/clean-duplicates') })
  it('addBannedWord', () => { api.adminAPI.addBannedWord('bad'); expect(mockApi.post).toHaveBeenCalledWith('/admin/banned-words', { word: 'bad' }) })
  it('batchImportBannedWords', () => { api.adminAPI.batchImportBannedWords('a\nb'); expect(mockApi.post).toHaveBeenCalledWith('/admin/banned-words/batch-import', { text: 'a\nb' }) })
  it('deleteBannedWord', () => { api.adminAPI.deleteBannedWord('w1'); expect(mockApi.post).toHaveBeenCalledWith('/admin/banned-words/w1/delete') })
  it('generateCodes', () => { api.adminAPI.generateCodes({ count: 5 }); expect(mockApi.post).toHaveBeenCalledWith('/admin/codes', { count: 5 }) })
  it('deleteCode', () => { api.adminAPI.deleteCode('c1'); expect(mockApi.post).toHaveBeenCalledWith('/admin/codes/c1/delete') })
  it('adjustPoints', () => { api.adminAPI.adjustPoints('u1', { delta: 10 }); expect(mockApi.post).toHaveBeenCalledWith('/admin/users/u1/points', { delta: 10 }) })
  it('resetPassword', () => { api.adminAPI.resetPassword('u1', 'newpw'); expect(mockApi.post).toHaveBeenCalledWith('/admin/users/u1/reset-password', { password: 'newpw' }) })
  it('userInviteHistory', () => { api.adminAPI.userInviteHistory('u1'); expect(mockApi.get).toHaveBeenCalledWith('/admin/users/u1/invite-history', { params: { page: 1, size: 20 } }) })
  it('migratePoints', () => { api.adminAPI.migratePoints(); expect(mockApi.post).toHaveBeenCalledWith('/admin/migrate-points') })
  it('approveRecharge', () => { api.adminAPI.approveRecharge('r1', { note: 'ok' }); expect(mockApi.post).toHaveBeenCalledWith('/admin/recharge-requests/r1/approve', { note: 'ok' }) })
  it('rejectRecharge', () => { api.adminAPI.rejectRecharge('r1'); expect(mockApi.post).toHaveBeenCalledWith('/admin/recharge-requests/r1/reject', {}) })
  it('refundRecharge', () => { api.adminAPI.refundRecharge('r1', { reason: 'dup' }); expect(mockApi.post).toHaveBeenCalledWith('/admin/recharge-requests/r1/refund', { reason: 'dup' }) })
  it('statsOverview', () => { api.adminAPI.statsOverview(); expect(mockApi.get).toHaveBeenCalledWith('/admin/stats/overview', { params: { range: '7d' } }) })
  it('statsCostProfit', () => { api.adminAPI.statsCostProfit(); expect(mockApi.get).toHaveBeenCalledWith('/admin/stats/cost-profit', { params: { range: '30d' } }) })
  it('financeOverview', () => { api.adminAPI.financeOverview(); expect(mockApi.get).toHaveBeenCalledWith('/admin/finance/overview', { params: { range: '30d' } }) })
  it('financeProviders', () => { api.adminAPI.financeProviders(); expect(mockApi.get).toHaveBeenCalledWith('/admin/finance/providers', { params: { range: '30d' } }) })
  it('createFinancePurchase', () => { api.adminAPI.createFinancePurchase({ amount: 100 }); expect(mockApi.post).toHaveBeenCalledWith('/admin/finance/purchases', { amount: 100 }) })
  it('updateFinancePurchase', () => { api.adminAPI.updateFinancePurchase('b1', { amount: 200 }); expect(mockApi.post).toHaveBeenCalledWith('/admin/finance/purchases/b1', { amount: 200 }) })
  it('deleteFinancePurchase', () => { api.adminAPI.deleteFinancePurchase('b1'); expect(mockApi.post).toHaveBeenCalledWith('/admin/finance/purchases/b1/delete') })
  it('saveFinanceQuotaRule', () => { api.adminAPI.saveFinanceQuotaRule({ rule: 1 }); expect(mockApi.post).toHaveBeenCalledWith('/admin/finance/quota-rules', { rule: 1 }) })
  it('deleteFinanceQuotaRule', () => { api.adminAPI.deleteFinanceQuotaRule('r1'); expect(mockApi.post).toHaveBeenCalledWith('/admin/finance/quota-rules/r1/delete') })
  it('createClassificationTask', () => { api.adminAPI.createClassificationTask(); expect(mockApi.post).toHaveBeenCalledWith('/admin/classification/tasks', { item_type: 'prompt', limit: 200 }) })
  it('reviewClassification', () => { api.adminAPI.reviewClassification('prompt', 'cat-slug', 50); expect(mockApi.post).toHaveBeenCalledWith('/admin/classification/review', { item_type: 'prompt', category_slug: 'cat-slug', limit: 50 }) })
  it('getClassificationTask', () => { api.adminAPI.getClassificationTask('t1'); expect(mockApi.get).toHaveBeenCalledWith('/admin/classification/tasks/t1') })
  it('approveClassification', () => { api.adminAPI.approveClassification('t1', ['r1']); expect(mockApi.post).toHaveBeenCalledWith('/admin/classification/tasks/t1/approve', { result_ids: ['r1'] }) })
  it('rejectClassification', () => { api.adminAPI.rejectClassification('t1', ['r1']); expect(mockApi.post).toHaveBeenCalledWith('/admin/classification/tasks/t1/reject', { result_ids: ['r1'] }) })
  it('updateClassificationResult', () => { api.adminAPI.updateClassificationResult('r1', { cat: 'c' }); expect(mockApi.post).toHaveBeenCalledWith('/admin/classification/results/r1', { cat: 'c' }) })
  it('createAuditTask', () => { api.adminAPI.createAuditTask(); expect(mockApi.post).toHaveBeenCalledWith('/admin/audit/tasks', { item_type: 'prompt', limit: 200 }) })
  it('getAuditTask', () => { api.adminAPI.getAuditTask('t1'); expect(mockApi.get).toHaveBeenCalledWith('/admin/audit/tasks/t1') })
  it('approveAudit', () => { api.adminAPI.approveAudit('t1', ['r1']); expect(mockApi.post).toHaveBeenCalledWith('/admin/audit/tasks/t1/approve', { result_ids: ['r1'] }) })
  it('rejectAudit', () => { api.adminAPI.rejectAudit('t1', ['r1']); expect(mockApi.post).toHaveBeenCalledWith('/admin/audit/tasks/t1/reject', { result_ids: ['r1'] }) })
  it('updateAuditResult', () => { api.adminAPI.updateAuditResult('r1', { ok: true }); expect(mockApi.post).toHaveBeenCalledWith('/admin/audit/results/r1', { ok: true }) })
  it('titleItems', () => { api.adminAPI.titleItems(); expect(mockApi.get).toHaveBeenCalledWith('/admin/title/items', { params: { item_type: 'prompt', query: '', page: 1, size: 20, only_missing: true } }) })
  it('applyTitles', () => { api.adminAPI.applyTitles({ items: [] }); expect(mockApi.post).toHaveBeenCalledWith('/admin/title/apply', { items: [] }) })
  it('testTitle', () => { api.adminAPI.testTitle({ text: 't' }); expect(mockApi.post).toHaveBeenCalledWith('/admin/title/test', { text: 't' }) })
})

describe('interceptor error handling', () => {
  const makeErr = (status, data, url = '/test') => ({
    config: { url },
    response: { status, data },
    message: 'request failed',
  })

  it('rejects with detail string', async () => {
    await expect(errorHandler(makeErr(400, { detail: 'bad input' }))).rejects.toThrow('bad input')
  })

  it('rejects with translated validation errors', async () => {
    const detail = [
      { msg: 'String should have at least 3 characters' },
      { msg: 'String should have at most 100 characters' },
      { msg: 'field required' },
      { msg: 'value is not a valid email' },
      { msg: 'invalid json' },
    ]
    await expect(errorHandler(makeErr(422, { detail }))).rejects.toThrow(
      /内容至少需要 3 个字符/
    )
  })

  it('joins multiple validation errors with semicolon', async () => {
    const detail = [
      { msg: 'field required' },
      { msg: 'ensure this value is less than or equal to 100' },
    ]
    await expect(errorHandler(makeErr(422, { detail }))).rejects.toThrow(
      '必填字段缺失；值不能超过 100'
    )
  })

  it('falls back to err.message when no detail', async () => {
    await expect(errorHandler(makeErr(500, {}))).rejects.toThrow('request failed')
  })

  it('falls back to "请求失败" when no detail and no message', async () => {
    await expect(errorHandler({ config: { url: '/x' }, response: { status: 500, data: {} } })).rejects.toThrow('请求失败')
  })

  it('translates "ensure this value is greater than or equal to" pattern', async () => {
    const detail = [{ msg: 'ensure this value is greater than or equal to 0' }]
    await expect(errorHandler(makeErr(422, { detail }))).rejects.toThrow('值不能小于 0')
  })

  it('handles non-string detail items gracefully', async () => {
    const detail = [{ msg: 123 }]
    await expect(errorHandler(makeErr(422, { detail }))).rejects.toThrow('123')
  })
})

describe('interceptor refresh logic', () => {
  const make401 = (url = '/test') => ({
    config: { url },
    response: { status: 401, data: {} },
    message: 'unauthorized',
  })

  it('skips refresh for login endpoint', async () => {
    await expect(errorHandler(make401('/auth/login'))).rejects.toThrow()
    expect(mockApi.post).not.toHaveBeenCalledWith('/auth/refresh')
  })

  it('skips refresh for register endpoint', async () => {
    await expect(errorHandler(make401('/auth/register'))).rejects.toThrow()
  })

  it('skips refresh when already retried', async () => {
    const err = make401('/test')
    err.config._retry = true
    await expect(errorHandler(err)).rejects.toThrow()
  })

  it('skips refresh for refresh endpoint itself', async () => {
    await expect(errorHandler(make401('/auth/refresh'))).rejects.toThrow()
  })

  it('skips refresh for logout endpoint', async () => {
    await expect(errorHandler(make401('/auth/logout'))).rejects.toThrow()
  })

  it('skips refresh for send-code endpoint', async () => {
    await expect(errorHandler(make401('/auth/send-code'))).rejects.toThrow()
  })

  it('skips refresh for non-401 errors', async () => {
    const err = { config: { url: '/test' }, response: { status: 403, data: { detail: 'forbidden' } }, message: 'no' }
    await expect(errorHandler(err)).rejects.toThrow('forbidden')
  })
})
