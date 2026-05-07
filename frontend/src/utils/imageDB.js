const DB_NAME = 'image_cache_db'
const DB_VERSION = 1
const STORE_NAME = 'images'
const CACHED_IMAGES_KEY = '__cached_images__'
const PENDING_IMAGE_KEY = '__pending_image__'
const SUBMISSION_QUEUE_PREFIX = '__submission_queue__'
const SUBMISSION_TIMEOUT_MS = 20 * 60 * 1000

let _dbPromise = null

function getDB() {
  if (!_dbPromise) {
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => { _dbPromise = null; reject(req.error) }
    })
  }
  return _dbPromise
}

export async function getCachedImage(key) {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(key)
    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => reject(req.error)
  })
}

export async function setCachedImage(key, blob) {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(blob, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function clearCachedImage(key) {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function clearAllCachedImages() {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getCachedImages() {
  const list = await getCachedImage(CACHED_IMAGES_KEY)
  return Array.isArray(list) ? list : []
}

export async function setCachedImages(items) {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(Array.isArray(items) ? items : [], CACHED_IMAGES_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getPendingImage() {
  return await getCachedImage(PENDING_IMAGE_KEY)
}

export async function setPendingImage(item) {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(item || null, PENDING_IMAGE_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function clearPendingImage() {
  await clearCachedImage(PENDING_IMAGE_KEY)
}

export async function getSubmissionQueue(key = 'default') {
  const list = await getCachedImage(`${SUBMISSION_QUEUE_PREFIX}_${key}`)
  return Array.isArray(list) ? list : []
}

export async function setSubmissionQueue(key = 'default', items) {
  await setCachedImage(`${SUBMISSION_QUEUE_PREFIX}_${key}`, Array.isArray(items) ? items : [])
}

function parseTimeMs(v) {
  const s = String(v || '').trim()
  if (!s) return 0
  const ts = Date.parse(s.includes('T') || s.endsWith('Z') || /[+-]\d\d:\d\d$/.test(s) ? s : s.replace(' ', 'T') + '+08:00')
  return Number.isNaN(ts) ? 0 : ts
}

export function pruneSubmissionQueueItems(items, now = Date.now()) {
  const list = Array.isArray(items) ? items : []
  const next = []
  for (const item of list) {
    if (!item || item.status === 'completed') continue
    if (item.status === 'failed') {
      const completedAt = parseTimeMs(item.completed_at)
      if (completedAt > 0 && now - completedAt > 5 * 60 * 1000) continue
      next.push(item)
      continue
    }
    const baseTs = parseTimeMs(item.started_at) || parseTimeMs(item.created_at)
    if (baseTs > 0 && now - baseTs > SUBMISSION_TIMEOUT_MS) continue
    next.push(item)
  }
  return next
}

export async function getPrunedSubmissionQueue(key = 'default') {
  const list = pruneSubmissionQueueItems(await getSubmissionQueue(key))
  await setSubmissionQueue(key, list)
  return list
}
