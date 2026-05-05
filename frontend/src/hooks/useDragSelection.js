import { useState, useCallback, useRef, useEffect } from 'react'

const DRAG_THRESHOLD = 5

export function useDragSelection({
  enabled = false,
  selected = new Set(),
  onSelectionChange,
  cardSelector = '[data-card-id]',
  containerRef,
}) {
  const selectedRef = useRef(selected)
  selectedRef.current = selected

  const dragRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    moved: false,
  })
  const startSelectedRef = useRef(new Set())
  const isToggleRef = useRef(false)

  const [selectionRect, setSelectionRect] = useState(null)
  const [dragSelected, setDragSelected] = useState(new Set())
  const wasDraggedRef = useRef(false)

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

  useEffect(() => {
    if (!enabled) return
    const container = containerRef?.current
    if (!container) return

    const handleMouseDown = (e) => {
      if (e.button !== 0) return
      if (e.target.closest('button') || e.target.closest('input') || e.target.closest('a')) return

      const containerRect = container.getBoundingClientRect()
      if (!containerRect) return
      if (e.clientX < containerRect.left || e.clientX > containerRect.right ||
          e.clientY < containerRect.top || e.clientY > containerRect.bottom) return

      isToggleRef.current = e.ctrlKey || e.metaKey || e.shiftKey
      startSelectedRef.current = new Set(selectedRef.current)

      dragRef.current = {
        active: true,
        startX: e.clientX,
        startY: e.clientY,
        currentX: e.clientX,
        currentY: e.clientY,
        moved: false,
      }
      wasDraggedRef.current = false
      setSelectionRect(null)
      setDragSelected(new Set())
      document.body.classList.add('drag-selection-active')
    }

    const handleMouseMove = (e) => {
      const d = dragRef.current
      if (!d.active) return

      d.currentX = e.clientX
      d.currentY = e.clientY

      const dx = d.currentX - d.startX
      const dy = d.currentY - d.startY
      if (!d.moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
      d.moved = true
      wasDraggedRef.current = true

      const rect = {
        left: Math.min(d.startX, d.currentX),
        top: Math.min(d.startY, d.currentY),
        right: Math.max(d.startX, d.currentX),
        bottom: Math.max(d.startY, d.currentY),
      }
      setSelectionRect({
        left: rect.left,
        top: rect.top,
        width: rect.right - rect.left,
        height: rect.bottom - rect.top,
      })
      setDragSelected(getCardIdsInRect(rect))
    }

    const handleMouseUp = () => {
      const d = dragRef.current
      if (!d.active) return
      d.active = false

      document.body.classList.remove('drag-selection-active')

      if (!d.moved) {
        setSelectionRect(null)
        setDragSelected(new Set())
        return
      }

      setTimeout(() => { wasDraggedRef.current = false }, 0)

      let newSelected
      if (isToggleRef.current) {
        newSelected = new Set(startSelectedRef.current)
        const idsInRect = getCardIdsInRect({
          left: Math.min(d.startX, d.currentX),
          top: Math.min(d.startY, d.currentY),
          right: Math.max(d.startX, d.currentX),
          bottom: Math.max(d.startY, d.currentY),
        })
        idsInRect.forEach(id => {
          if (newSelected.has(id)) {
            newSelected.delete(id)
          } else {
            newSelected.add(id)
          }
        })
      } else {
        const idsInRect = getCardIdsInRect({
          left: Math.min(d.startX, d.currentX),
          top: Math.min(d.startY, d.currentY),
          right: Math.max(d.startX, d.currentX),
          bottom: Math.max(d.startY, d.currentY),
        })
        newSelected = new Set(idsInRect)
      }

      onSelectionChange?.(newSelected)
      setSelectionRect(null)
      setDragSelected(new Set())
    }

    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && dragRef.current.active) {
        dragRef.current.active = false
        wasDraggedRef.current = false
        setSelectionRect(null)
        setDragSelected(new Set())
        document.body.classList.remove('drag-selection-active')
      }
    }

    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('keydown', handleKeyDown)
      document.body.classList.remove('drag-selection-active')
    }
  }, [enabled, containerRef, getCardIdsInRect, onSelectionChange])

  return {
    selectionRect,
    isDragging: dragRef.current.active && dragRef.current.moved,
    dragSelected,
    wasDraggedRef,
  }
}

function rectsIntersect(a, b) {
  return !(b.left > a.right || b.right < a.left || b.top > a.bottom || b.bottom < a.top)
}
