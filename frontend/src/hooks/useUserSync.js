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
          const updated = { ...local, ...data }
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
