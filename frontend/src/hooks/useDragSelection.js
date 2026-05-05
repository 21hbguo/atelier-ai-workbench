import { useState, useCallback, useRef, useEffect } from 'react'

export function useDragSelection({
  enabled = false,
  selected = new Set(),
  onSelectionChange,
  cardSelector = '[data-card-id]',
  containerRef,
}) {
  const [dragState, setDragState] = useState({
    isDragging: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
  })
  const [dragSelected, setDragSelected] = useState(new Set())
  const startSelectedRef = useRef(new Set())
  const isCtrlRef = useRef(false)
  const isShiftRef = useRef(false)

  const getCardIdsInRect = useCallback((rect) => {
    if (!containerRef?.current) return new Set()
    const cards = containerRef.current.querySelectorAll(cardSelector)
    const ids = new Set()
    cards.forEach(card => {
      const cardRect = card.getBoundingClientRect()
      const cardId = card.dataset.cardId
      if (cardId && rectsIntersect(rect, cardRect)) {
        ids.add(cardId)
      }
    })
    return ids
  }, [containerRef, cardSelector])

  const handleMouseDown = useCallback((e) => {
    if (!enabled) return
    if (e.button !== 0) return
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('a')) return

    isCtrlRef.current = e.ctrlKey || e.metaKey
    isShiftRef.current = e.shiftKey

    const rect = containerRef?.current?.getBoundingClientRect()
    if (!rect) return

    startSelectedRef.current = new Set(selected)
    setDragState({
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY,
    })
    setDragSelected(new Set())
    document.body.classList.add('drag-selection-active')
  }, [enabled, selected, containerRef])

  const handleMouseMove = useCallback((e) => {
    if (!dragState.isDragging) return

    setDragState(prev => ({
      ...prev,
      currentX: e.clientX,
      currentY: e.clientY,
    }))

    const rect = {
      left: Math.min(dragState.startX, e.clientX),
      top: Math.min(dragState.startY, e.clientY),
      right: Math.max(dragState.startX, e.clientX),
      bottom: Math.max(dragState.startY, e.clientY),
    }

    const idsInRect = getCardIdsInRect(rect)
    setDragSelected(idsInRect)
  }, [dragState.isDragging, dragState.startX, dragState.startY, getCardIdsInRect])

  const handleMouseUp = useCallback(() => {
    if (!dragState.isDragging) return

    let newSelected
    if (isCtrlRef.current || isShiftRef.current) {
      newSelected = new Set(startSelectedRef.current)
      dragSelected.forEach(id => {
        if (newSelected.has(id)) {
          newSelected.delete(id)
        } else {
          newSelected.add(id)
        }
      })
    } else {
      newSelected = new Set(dragSelected)
    }

    onSelectionChange?.(newSelected)
    setDragState({
      isDragging: false,
      startX: 0,
      startY: 0,
      currentX: 0,
      currentY: 0,
    })
    setDragSelected(new Set())
    document.body.classList.remove('drag-selection-active')
  }, [dragState.isDragging, dragSelected, onSelectionChange])

  useEffect(() => {
    if (!enabled) return
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [enabled, handleMouseDown, handleMouseMove, handleMouseUp])

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && dragState.isDragging) {
        setDragState({
          isDragging: false,
          startX: 0,
          startY: 0,
          currentX: 0,
          currentY: 0,
        })
        setDragSelected(new Set())
        document.body.classList.remove('drag-selection-active')
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [dragState.isDragging])

  const selectionRect = dragState.isDragging ? {
    left: Math.min(dragState.startX, dragState.currentX),
    top: Math.min(dragState.startY, dragState.currentY),
    width: Math.abs(dragState.currentX - dragState.startX),
    height: Math.abs(dragState.currentY - dragState.startY),
  } : null

  return {
    selectionRect,
    isDragging: dragState.isDragging,
    dragSelected,
  }
}

function rectsIntersect(a, b) {
  return !(b.left > a.right || b.right < a.left || b.top > a.bottom || b.bottom < a.top)
}
