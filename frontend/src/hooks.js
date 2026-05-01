import { useState, useEffect, useCallback } from 'react'
import { taskAPI } from './api'

export function useTasks() {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(false)

  const fetchTasks = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await taskAPI.list()
      setTasks(data)
    } catch {
      setTasks([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  return { tasks, loading, refresh: fetchTasks }
}

export function useTaskStatus(taskId, enabled = true) {
  const [status, setStatus] = useState(null)

  useEffect(() => {
    if (!taskId || !enabled) return

    let cancelled = false
    const poll = async () => {
      try {
        const { data } = await taskAPI.get(taskId)
        if (!cancelled) {
          setStatus(data)
          if (data.status === 'completed' || data.status === 'failed') return
        }
      } catch {
        if (!cancelled) setStatus({ task_id: taskId, status: 'error' })
      }
    }

    poll()
    const interval = setInterval(poll, 2000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [taskId, enabled])

  return status
}
