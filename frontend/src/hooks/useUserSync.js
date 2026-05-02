import { useEffect } from 'react'
import { authAPI } from '../api'

export function useUserSync() {
  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) return

    const syncUser = async () => {
      try {
        const { data } = await authAPI.me()
        const local = JSON.parse(localStorage.getItem('user') || 'null')
        if (local) {
          const normalized = { ...data, ...(Object.prototype.hasOwnProperty.call(data, 'is_admin') ? { is_admin: Boolean(data.is_admin) } : {}), ...(Object.prototype.hasOwnProperty.call(data, 'is_frozen') ? { is_frozen: Boolean(data.is_frozen) } : {}) }
          const updated = { ...local, ...normalized }
          localStorage.setItem('user', JSON.stringify(updated))
          window.dispatchEvent(new Event('points-updated'))
        }
      } catch {}
    }

    syncUser()
    const interval = setInterval(syncUser, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])
}
