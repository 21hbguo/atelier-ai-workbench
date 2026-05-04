import { useState, useEffect, useCallback, useRef } from 'react'
import { squareAPI, promptAPI, favoriteAPI } from '../api'
import { normalizeList } from '../utils/cardAdapter'
async function preloadThumbs(cards, maxCount, timeoutMs) {
  if (!maxCount || maxCount <= 0) return
  const urls = (cards || []).map(c => c.thumbUrl).filter(Boolean).slice(0, maxCount)
  if (urls.length === 0) return
  await Promise.race([
    Promise.all(urls.map(url => new Promise(resolve => {
      const img = new Image()
      img.onload = () => resolve(true)
      img.onerror = () => resolve(false)
      img.src = url
    }))),
    new Promise(resolve => setTimeout(resolve, timeoutMs || 800)),
  ])
}

export function useCardData({ type, apiFn, pageSize = 20, deps = [], atomicPaging = false, preloadCount = 0, preloadTimeoutMs = 800, mapCards, removeOnUnfavorite = false }) {
  const [cards, setCards] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPageState] = useState(1)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [paging, setPaging] = useState(false)
  const mountedRef = useRef(true)
  const depsRef = useRef(deps)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    setPageState(1)
    setPaging(false)
  }, deps)

  useEffect(() => {
    let cancelled = false
    const fetch = async () => {
      setLoading(true)
      try {
        const { data } = await apiFn(page, pageSize)
        if (cancelled || !mountedRef.current) return
        const rawItems = data.images || data.prompts || []
        const nextCards = mapCards ? mapCards(rawItems, type) : normalizeList(rawItems, type)
        if (atomicPaging) await preloadThumbs(nextCards, preloadCount, preloadTimeoutMs)
        if (cancelled || !mountedRef.current) return
        setCards(nextCards)
        setTotal(data.total || 0)
      } catch {
        if (!cancelled && mountedRef.current) setCards([])
      } finally {
        if (!cancelled && mountedRef.current) { setLoading(false); setPaging(false) }
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
      const nextCards = mapCards ? mapCards(rawItems, type) : normalizeList(rawItems, type)
      if (atomicPaging) await preloadThumbs(nextCards, preloadCount, preloadTimeoutMs)
      setCards(nextCards)
      setTotal(data.total || 0)
    } catch {}
    setRefreshing(false)
  }, [page, apiFn, pageSize, type, atomicPaging, preloadCount, preloadTimeoutMs, mapCards])

  const handleLike = useCallback(async (id) => {
    const card = cards.find(c => c.id === id)
    if (!card) return
    setCards(prev => prev.map(c =>
      c.id === id ? { ...c, isLiked: !c.isLiked, likesCount: c.isLiked ? c.likesCount - 1 : c.likesCount + 1 } : c
    ))
    try {
      const currentType = card._type || type
      if (currentType === 'image') {
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

  const handleFavorite = useCallback(async (id) => {
    const cardIndex = cards.findIndex(c => c.id === id)
    const card = cardIndex >= 0 ? cards[cardIndex] : null
    if (!card) return
    const nextFavorited = !card.isFavorited
    const nextLiked = nextFavorited ? true : card.isLiked
    const nextLikesCount = nextFavorited && !card.isLiked ? card.likesCount + 1 : card.likesCount
    setCards(prev => removeOnUnfavorite && !nextFavorited ? prev.filter(c => c.id !== id) : prev.map(c => c.id === id ? { ...c, isFavorited: nextFavorited, isLiked: nextLiked, likesCount: nextLikesCount } : c))
    if (removeOnUnfavorite && !nextFavorited) setTotal(prev => Math.max(0, prev - 1))
    try {
      await favoriteAPI.toggle(card._type === 'image' ? 'image' : 'prompt', id)
      return true
    } catch {
      if (removeOnUnfavorite && !nextFavorited) setTotal(prev => prev + 1)
      setCards(prev => removeOnUnfavorite && !nextFavorited ? [...prev.slice(0, cardIndex), card, ...prev.slice(cardIndex)] : prev.map(c => c.id === id ? { ...c, isFavorited: card.isFavorited, isLiked: card.isLiked, likesCount: card.likesCount } : c))
      return false
    }
  }, [cards, removeOnUnfavorite])

  const updateCard = useCallback((id, updater) => {
    setCards(prev => prev.map(c => c.id === id ? updater(c) : c))
  }, [])
  const setPage = useCallback((next) => {
    setPageState(prev => {
      if (next === prev) return prev
      if (atomicPaging) setPaging(true)
      return next
    })
  }, [atomicPaging])

  return { cards, total, page, setPage, loading, paging, refreshing, refresh, handleLike, handleFavorite, updateCard }
}
