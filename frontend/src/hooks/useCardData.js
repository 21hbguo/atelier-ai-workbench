import { useState, useEffect, useCallback, useRef } from 'react'
import { squareAPI, promptAPI } from '../api'
import { normalizeList } from '../utils/cardAdapter'

export function useCardData({ type, apiFn, pageSize = 20, deps = [] }) {
  const [cards, setCards] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    setPage(1)
  }, deps)

  useEffect(() => {
    let cancelled = false
    const fetch = async () => {
      setLoading(true)
      try {
        const { data } = await apiFn(page, pageSize)
        if (cancelled || !mountedRef.current) return
        const rawItems = data.images || data.prompts || []
        setCards(normalizeList(rawItems, type))
        setTotal(data.total || 0)
      } catch {
        if (!cancelled && mountedRef.current) setCards([])
      } finally {
        if (!cancelled && mountedRef.current) setLoading(false)
      }
    }
    fetch()
    return () => { cancelled = true }
  }, [page, ...deps])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const { data } = await apiFn(page, pageSize)
      const rawItems = data.images || data.prompts || []
      setCards(normalizeList(rawItems, type))
      setTotal(data.total || 0)
    } catch {}
    setRefreshing(false)
  }, [page, apiFn, pageSize, type])

  const handleLike = useCallback(async (id) => {
    const card = cards.find(c => c.id === id)
    if (!card) return
    setCards(prev => prev.map(c =>
      c.id === id ? { ...c, isLiked: !c.isLiked, likesCount: c.isLiked ? c.likesCount - 1 : c.likesCount + 1 } : c
    ))
    try {
      if (type === 'image') {
        await squareAPI.like(id)
      } else {
        await promptAPI.like(id)
      }
    } catch {
      setCards(prev => prev.map(c =>
        c.id === id ? { ...c, isLiked: card.isLiked, likesCount: card.likesCount } : c
      ))
    }
  }, [cards, type])

  const updateCard = useCallback((id, updater) => {
    setCards(prev => prev.map(c => c.id === id ? updater(c) : c))
  }, [])

  return { cards, total, page, setPage, loading, refreshing, refresh, handleLike, updateCard }
}
