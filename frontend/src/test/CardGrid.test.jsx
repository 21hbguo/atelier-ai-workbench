import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('../api', () => ({
  promptAPI: {
    categories: vi.fn(async () => ({ data: { categories: [] } })),
  },
}))

vi.mock('../components/Pagination', () => ({
  default: ({ page, totalPages, onPageChange }) => {
    if (totalPages <= 1) return null
    return (
      <div data-testid="pagination">
        <span>{page}/{totalPages}</span>
        <button onClick={() => onPageChange(page + 1)}>next</button>
        <button onClick={() => onPageChange(page - 1)}>prev</button>
      </div>
    )
  },
}))

vi.mock('../components/UnifiedCard', () => ({
  default: ({ onClick, mediaNode, hoverNode, footerNode, overlayNode, topLeftNode, topRightNode, bottomNode, selectNode, className, 'data-card-id': cardId, checked }) => (
    <div
      data-testid="unified-card"
      data-card-id={cardId}
      data-checked={checked}
      className={className}
      onClick={onClick}
    >
      {mediaNode}
      {hoverNode}
      {bottomNode}
      {topLeftNode}
      {topRightNode}
      {selectNode}
      {overlayNode}
      {footerNode}
    </div>
  ),
}))

vi.mock('../hooks/useDragSelection', () => ({
  useDragSelection: () => ({
    selectionRect: null,
    dragSelected: new Set(),
    wasDraggedRef: { current: false },
  }),
}))

import CardGrid, { CardGridSkeleton } from '../components/CardGrid'

const makeCards = (n, opts = {}) =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    title: `Card ${i + 1}`,
    subtitle: `Subtitle ${i + 1}`,
    prompt: `prompt text ${i + 1}`,
    thumbUrl: opts.noThumb ? undefined : `https://cdn/img${i + 1}.png`,
    author: opts.withAuthor ? `Author${i + 1}` : undefined,
    authorId: opts.withAuthor ? `author-${i + 1}` : undefined,
    authorName: opts.withAuthor ? `Author${i + 1}` : undefined,
    likesCount: i * 3,
    isLiked: i % 2 === 0,
    width: 100,
    height: 100,
    ...opts.extra,
  }))

describe('CardGridSkeleton', () => {
  beforeEach(() => cleanup())

  it('renders skeleton cards in grid layout', () => {
    const { container } = render(<CardGridSkeleton layoutMode="grid" count={5} />)
    const items = container.querySelectorAll('.card-feed-skeleton-card')
    expect(items.length).toBe(5)
    expect(container.querySelector('.card-feed-grid')).toBeTruthy()
  })

  it('renders skeleton cards in masonry layout', () => {
    const { container } = render(<CardGridSkeleton layoutMode="masonry" count={3} />)
    expect(container.querySelector('.card-feed-masonry')).toBeTruthy()
    const masonryItems = container.querySelectorAll('.card-feed-item-masonry')
    expect(masonryItems.length).toBe(3)
  })

  it('shows custom label', () => {
    render(<CardGridSkeleton label="Please wait..." />)
    expect(screen.getByText('Please wait...')).toBeInTheDocument()
  })
})

describe('CardGrid', () => {
  beforeEach(() => cleanup())

  it('shows empty state when no cards and not loading', () => {
    render(<CardGrid cards={[]} emptyText="Nothing here" />)
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
  })

  it('shows default empty text', () => {
    render(<CardGrid cards={[]} />)
    expect(screen.getByText('暂无作品')).toBeInTheDocument()
  })

  it('shows skeleton when loading with no cards', () => {
    const { container } = render(<CardGrid cards={[]} loading={true} />)
    expect(container.querySelector('.card-feed-skeleton-card')).toBeTruthy()
  })

  it('renders cards with images', () => {
    const cards = makeCards(3)
    const { container } = render(<CardGrid cards={cards} />)
    const imgs = container.querySelectorAll('img')
    expect(imgs.length).toBe(3)
    expect(imgs[0]).toHaveAttribute('src', 'https://cdn/img1.png')
  })

  it('renders text fallback when no thumbUrl', () => {
    const cards = makeCards(1, { noThumb: true })
    render(<CardGrid cards={cards} />)
    // text fallback uses card.title, not prompt
    expect(screen.getByText('Card 1')).toBeInTheDocument()
  })

  it('renders in masonry layout', () => {
    const cards = makeCards(2)
    const { container } = render(<CardGrid cards={cards} layoutMode="masonry" />)
    expect(container.querySelector('.card-feed-masonry')).toBeTruthy()
    expect(container.querySelector('.card-feed-media-masonry')).toBeTruthy()
  })

  it('renders in grid layout by default', () => {
    const cards = makeCards(1)
    const { container } = render(<CardGrid cards={cards} />)
    expect(container.querySelector('.card-feed-grid')).toBeTruthy()
  })

  it('shows total count', () => {
    const cards = makeCards(2)
    render(<CardGrid cards={cards} total={42} totalUnit="张" />)
    expect(screen.getByText('42 张')).toBeInTheDocument()
  })

  it('hides total when showTotal is false', () => {
    const cards = makeCards(1)
    render(<CardGrid cards={cards} total={10} showTotal={false} />)
    expect(screen.queryByText(/10/)).not.toBeInTheDocument()
  })

  it('hides refresh button when hideRefresh is true', () => {
    const cards = makeCards(1)
    const { container } = render(<CardGrid cards={cards} hideRefresh onRefresh={vi.fn()} />)
    const refreshBtn = container.querySelector('button.p-1\\.5')
    expect(refreshBtn).toBeFalsy()
  })

  it('calls onRefresh when refresh button clicked', () => {
    const onRefresh = vi.fn()
    const cards = makeCards(1)
    const { container } = render(<CardGrid cards={cards} onRefresh={onRefresh} />)
    const btn = container.querySelector('button.p-1\\.5')
    fireEvent.click(btn)
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('disables refresh button when refreshing', () => {
    const cards = makeCards(1)
    const { container } = render(<CardGrid cards={cards} onRefresh={vi.fn()} refreshing />)
    const btn = container.querySelector('button.p-1\\.5')
    expect(btn).toBeDisabled()
  })

  it('calls onCardClick when card clicked', () => {
    const onCardClick = vi.fn()
    const cards = makeCards(2)
    const { container } = render(<CardGrid cards={cards} onCardClick={onCardClick} />)
    const cardEls = container.querySelectorAll('[data-testid="unified-card"]')
    fireEvent.click(cardEls[0])
    expect(onCardClick).toHaveBeenCalledWith(cards[0], 0)
  })

  it('calls onToggleSelect in selectable mode', () => {
    const onToggleSelect = vi.fn()
    const cards = makeCards(1)
    const { container } = render(
      <CardGrid cards={cards} selectable selected={new Set()} onToggleSelect={onToggleSelect} />
    )
    const cardEl = container.querySelector('[data-testid="unified-card"]')
    fireEvent.click(cardEl)
    expect(onToggleSelect).toHaveBeenCalledWith(1)
  })

  it('shows pagination when totalPages > 1', () => {
    const cards = makeCards(1)
    render(<CardGrid cards={cards} page={1} totalPages={5} onPageChange={vi.fn()} />)
    expect(screen.getByText('1/5')).toBeInTheDocument()
    expect(screen.getByText('next')).toBeInTheDocument()
  })

  it('hides pagination when totalPages <= 1', () => {
    const cards = makeCards(1)
    render(<CardGrid cards={cards} page={1} totalPages={1} />)
    expect(screen.queryByTestId('pagination')).not.toBeInTheDocument()
  })

  it('calls onPageChange from pagination', () => {
    const onPageChange = vi.fn()
    const cards = makeCards(1)
    render(<CardGrid cards={cards} page={2} totalPages={5} onPageChange={onPageChange} />)
    fireEvent.click(screen.getByText('next'))
    expect(onPageChange).toHaveBeenCalledWith(3)
  })

  it('shows author node when showAuthor is true', () => {
    const cards = makeCards(1, { withAuthor: true })
    const { container } = render(<CardGrid cards={cards} showAuthor />)
    expect(container.textContent).toContain('Author1')
  })

  it('renders overlay when renderOverlay provided', () => {
    const cards = makeCards(1)
    render(
      <CardGrid cards={cards} renderOverlay={(card) => <span>overlay-{card.id}</span>} />
    )
    expect(screen.getByText('overlay-1')).toBeInTheDocument()
  })

  it('marks selected cards as checked', () => {
    const cards = makeCards(2)
    const { container } = render(
      <CardGrid cards={cards} selectable selected={new Set([1])} />
    )
    const cardEls = container.querySelectorAll('[data-testid="unified-card"]')
    expect(cardEls[0].getAttribute('data-checked')).toBe('true')
    expect(cardEls[1].getAttribute('data-checked')).toBe('false')
  })

  it('passes masonry class names correctly', () => {
    const cards = makeCards(1)
    const { container } = render(<CardGrid cards={cards} layoutMode="masonry" />)
    const cardEl = container.querySelector('[data-testid="unified-card"]')
    expect(cardEl.className).toContain('card-feed-item-masonry')
  })

  it('renders square card mode', () => {
    const cards = makeCards(1, { extra: { category: 'nature' } })
    const { container } = render(<CardGrid cards={cards} cardUiMode="square" />)
    const cardEl = container.querySelector('[data-testid="unified-card"]')
    expect(cardEl.className).toContain('rounded-[1.75rem]')
  })

  it('renders multiple cards with correct count', () => {
    const cards = makeCards(8)
    const { container } = render(<CardGrid cards={cards} />)
    const cardEls = container.querySelectorAll('[data-testid="unified-card"]')
    expect(cardEls.length).toBe(8)
  })

  it('handles cards with 2x srcSet', () => {
    const cards = [{ id: 1, title: '2x card', thumbUrl: 'img.png', thumbUrl2x: 'img@2x.png', width: 200, height: 200 }]
    const { container } = render(<CardGrid cards={cards} />)
    const img = container.querySelector('img')
    expect(img.getAttribute('srcset')).toContain('img@2x.png')
  })

  it('renders like button with count in square mode', () => {
    const cards = makeCards(1, { extra: { likesCount: 5 } })
    render(<CardGrid cards={cards} cardUiMode="square" showLike onLike={vi.fn()} />)
    expect(screen.getByText('5')).toBeInTheDocument()
  })
})
