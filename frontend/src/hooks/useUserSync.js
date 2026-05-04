import { useEffect } from 'react'
import { authAPI } from '../api'
import { readUser, writeUser } from '../auth'

export function useUserSync() {
  useEffect(() => {
    if (!readUser()) return
    const syncUser = async () => {
      try {
        const { data } = await authAPI.me()
        const local = readUser()
        if (local) {
          const normalized = { ...data, account: data?.account || data?.username || '', ...(Object.prototype.hasOwnProperty.call(data, 'is_admin') ? { is_admin: Boolean(data.is_admin) } : {}), ...(Object.prototype.hasOwnProperty.call(data, 'is_frozen') ? { is_frozen: Boolean(data.is_frozen) } : {}) }
          writeUser({ ...local, ...normalized })
          window.dispatchEvent(new Event('points-updated'))
        }
      } catch {}
    }
    syncUser()
    const interval = setInterval(syncUser, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])
}
