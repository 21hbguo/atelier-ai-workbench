import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const {
  favoriteListMock,
  favoriteToggleMock,
  useCardDataMock,
  navigateMock,
} = vi.hoisted(() => ({
  favoriteListMock: vi.fn(),
  favoriteToggleMock: vi.fn(),
  useCardDataMock: vi.fn(),
  navigateMock: vi.fn(),
}))

vi.mock('../api', () => ({
  favoriteAPI: {
    list: favoriteListMock,
    toggle: favoriteToggleMock,
  },
}))

vi.mock('../hooks/useCardData', () => ({
  useCardData: useCardDataMock,
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => navigateMock }
})

vi.mock('../LayoutModeContext', () => ({
  useLayoutMode: () => ({ layoutMode: 'masonry', setLayoutMode: vi.fn() }),
  LayoutModeProvider: ({ children }) => children,
}))

vi.mock('../components/MainLayout', () => ({
  default: ({ children }) => <div data-testid="main-layout">{children}</div>,
}))

vi.mock('../components/CardGrid', () => ({
  default: ({ cards, loading, emptyText, onCardClick, onFavorite, onUsePrompt, onUseImage, page, totalPages, total, showTotal, totalUnit, onPageChange }) => (
    <div data-testid="card-grid">
      {showTotal && total !== undefined && <span data-testid="card-total">{total}</span>}
      {totalUnit && <span data-testid="total-unit">{totalUnit}</span>}
      {loading && <div data-testid="loading-skeleton">loading</div>}
      {!loading && cards.length === 0 && <span data-testid="empty-text">{emptyText}</span>}
      {cards.map((card, idx) => (
        <div key={card.id} data-testid={`card-${card.id}`}>
          <span data-testid={`card-title-${card.id}`}>{card.title}</span>
          <button data-testid={`click-${card.id}`} onClick={() => onCardClick?.(card, idx)} />
          <button data-testid={`fav-${card.id}`} onClick={() => onFavorite?.(card.id)} />
          {onUsePrompt && <button data-testid={`use-prompt-${card.id}`} onClick={() => onUsePrompt?.(card.prompt)} />}
          {onUseImage && <button data-testid={`use-image-${card.id}`} onClick={() => onUseImage?.(card)} />}
        </div>
      ))}
      {page !== undefined && totalPages > 1 && (
        <div data-testid="pagination">
          <span data-testid="current-page">{page}</span>
          <span data-testid="total-pages">{totalPages}</span>
          <button data-testid="next-page" onClick={() => onPageChange?.(page + 1)}>next</button>
        </div>
      )}
    </div>
  ),
}))

vi.mock('../components/UnifiedDetailModal', () => ({
  default: ({ card, onClose, onFavorite, onUsePrompt, onUseImage }) => (
    <div data-testid="detail-modal">
      <span data-testid="modal-card-title">{card?.title}</span>
      <button data-testid="modal-close" onClick={onClose} />
      <button data-testid="modal-fav" onClick={() => onFavorite?.(card?.id)} />
      {onUsePrompt && <button data-testid="modal-use-prompt" onClick={() => onUsePrompt?.(card?.prompt)} />}
      {onUseImage && <button data-testid="modal-use-image" onClick={() => onUseImage?.(card)} />}
    </div>
  ),
}))

vi.mock('../utils/cardAdapter', () => ({
  normalizeList: (items) => items,
}))

import FavoritesPage from '../pages/FavoritesPage'
import { LayoutModeProvider } from '../LayoutModeContext'
import { MemoryRouter } from 'react-router-dom'

const sampleImages = [
  { id: '1', title: 'Image One', prompt: 'a cat', _type: 'image', isFavorited: true, isLiked: true, likesCount: 5 },
  { id: '2', title: 'Image Two', prompt: 'a dog', _type: 'image', isFavorited: true, isLiked: false, likesCount: 10 },
]

const samplePrompts = [
  { id: 'p1', title: 'Prompt Alpha', prompt: 'sunset scene', _type: 'prompt', isFavorited: true, isLiked: true, likesCount: 3 },
  { id: 'p2', title: 'Prompt Beta', prompt: 'ocean view', _type: 'prompt', isFavorited: true, isLiked: true, likesCount: 8 },
]

const defaultCardDataReturn = {
  cards: [],
  total: 0,
  page: 1,
  setPage: vi.fn(),
  loading: false,
  paging: false,
  refreshing: false,
  refresh: vi.fn(),
  handleLike: vi.fn(),
  handleFavorite: vi.fn(),
  updateCard: vi.fn(),
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/favorites']}>
      <LayoutModeProvider>
        <FavoritesPage />
      </LayoutModeProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  localStorage.clear()
  useCardDataMock.mockReturnValue({ ...defaultCardDataReturn })
})

describe('FavoritesPage - Tab switching', () => {
  it('renders three tab buttons: all, image, prompt', () => {
    renderPage()
    expect(screen.getByText('全部')).toBeInTheDocument()
    expect(screen.getByText('图片')).toBeInTheDocument()
    expect(screen.getByText('提示词')).toBeInTheDocument()
  })

  it('defaults to all tab', () => {
    renderPage()
    expect(useCardDataMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'image', removeOnUnfavorite: true })
    )
  })

  it('switches to image tab on click', async () => {
    renderPage()
    fireEvent.click(screen.getByText('图片'))
    await waitFor(() => {
      expect(useCardDataMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'image' })
      )
    })
  })

  it('switches to prompt tab on click', async () => {
    renderPage()
    fireEvent.click(screen.getByText('提示词'))
    await waitFor(() => {
      expect(useCardDataMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'prompt' })
      )
    })
  })

  it('resets detailIdx when switching tabs', async () => {
    useCardDataMock.mockReturnValue({
      ...defaultCardDataReturn,
      cards: sampleImages,
      total: 2,
    })
    renderPage()
    fireEvent.click(screen.getByTestId('click-1'))
    await waitFor(() => expect(screen.getByTestId('detail-modal')).toBeInTheDocument())

    fireEvent.click(screen.getByText('提示词'))
    await waitFor(() => {
      expect(screen.queryByTestId('detail-modal')).not.toBeInTheDocument()
    })
  })
})

describe('FavoritesPage - Card rendering', () => {
  it('renders cards from useCardData', () => {
    useCardDataMock.mockReturnValue({
      ...defaultCardDataReturn,
      cards: sampleImages,
      total: 2,
    })
    renderPage()
    expect(screen.getByTestId('card-1')).toBeInTheDocument()
    expect(screen.getByTestId('card-2')).toBeInTheDocument()
    expect(screen.getByTestId('card-title-1')).toHaveTextContent('Image One')
  })

  it('shows total count', () => {
    useCardDataMock.mockReturnValue({
      ...defaultCardDataReturn,
      cards: sampleImages,
      total: 42,
    })
    renderPage()
    expect(screen.getByTestId('card-total')).toHaveTextContent('42')
  })

  it('shows total unit for prompt tab', async () => {
    useCardDataMock.mockReturnValue({
      ...defaultCardDataReturn,
      cards: samplePrompts,
      total: 2,
    })
    renderPage()
    fireEvent.click(screen.getByText('提示词'))
    await waitFor(() => {
      expect(screen.getByTestId('total-unit')).toHaveTextContent('条')
    })
  })

  it('shows total unit for non-prompt tab', () => {
    useCardDataMock.mockReturnValue({
      ...defaultCardDataReturn,
      cards: sampleImages,
      total: 2,
    })
    renderPage()
    expect(screen.getByTestId('total-unit')).toHaveTextContent('项')
  })
})

describe('FavoritesPage - Loading state', () => {
  it('shows loading skeleton when loading', () => {
    useCardDataMock.mockReturnValue({
      ...defaultCardDataReturn,
      loading: true,
    })
    renderPage()
    expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument()
  })
})

describe('FavoritesPage - Empty state', () => {
  it('shows empty text when no cards', () => {
    useCardDataMock.mockReturnValue({
      ...defaultCardDataReturn,
      cards: [],
      loading: false,
    })
    renderPage()
    expect(screen.getByTestId('empty-text')).toHaveTextContent('暂无收藏')
  })
})

describe('FavoritesPage - Unfavorite action', () => {
  it('calls handleFavorite on unfavorite button click', () => {
    const handleFavorite = vi.fn()
    useCardDataMock.mockReturnValue({
      ...defaultCardDataReturn,
      cards: sampleImages,
      total: 2,
      handleFavorite,
    })
    renderPage()
    fireEvent.click(screen.getByTestId('fav-1'))
    expect(handleFavorite).toHaveBeenCalledWith('1')
  })

  it('passes removeOnUnfavorite to useCardData', () => {
    renderPage()
    expect(useCardDataMock).toHaveBeenCalledWith(
      expect.objectContaining({ removeOnUnfavorite: true })
    )
  })

  it('handles unfavorite from detail modal', async () => {
    const handleFavorite = vi.fn().mockResolvedValue(true)
    useCardDataMock.mockReturnValue({
      ...defaultCardDataReturn,
      cards: sampleImages,
      total: 2,
      handleFavorite,
    })
    renderPage()
    fireEvent.click(screen.getByTestId('click-1'))
    await waitFor(() => expect(screen.getByTestId('detail-modal')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('modal-fav'))
    expect(handleFavorite).toHaveBeenCalledWith('1')
  })
})

describe('FavoritesPage - Card click opens detail modal', () => {
  it('opens detail modal on card click', async () => {
    useCardDataMock.mockReturnValue({
      ...defaultCardDataReturn,
      cards: sampleImages,
      total: 2,
    })
    renderPage()
    fireEvent.click(screen.getByTestId('click-1'))
    await waitFor(() => {
      expect(screen.getByTestId('detail-modal')).toBeInTheDocument()
      expect(screen.getByTestId('modal-card-title')).toHaveTextContent('Image One')
    })
  })

  it('closes detail modal on close', async () => {
    useCardDataMock.mockReturnValue({
      ...defaultCardDataReturn,
      cards: sampleImages,
      total: 2,
    })
    renderPage()
    fireEvent.click(screen.getByTestId('click-1'))
    await waitFor(() => expect(screen.getByTestId('detail-modal')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('modal-close'))
    await waitFor(() => {
      expect(screen.queryByTestId('detail-modal')).not.toBeInTheDocument()
    })
  })

  it('opens correct card when clicking different cards', async () => {
    useCardDataMock.mockReturnValue({
      ...defaultCardDataReturn,
      cards: sampleImages,
      total: 2,
    })
    renderPage()
    fireEvent.click(screen.getByTestId('click-2'))
    await waitFor(() => {
      expect(screen.getByTestId('modal-card-title')).toHaveTextContent('Image Two')
    })
  })
})

describe('FavoritesPage - Mixed cards (all tab)', () => {
  it('renders mixed image and prompt cards', () => {
    const mixed = [...sampleImages, ...samplePrompts]
    useCardDataMock.mockReturnValue({
      ...defaultCardDataReturn,
      cards: mixed,
      total: 4,
    })
    renderPage()
    expect(screen.getByTestId('card-1')).toBeInTheDocument()
    expect(screen.getByTestId('card-2')).toBeInTheDocument()
    expect(screen.getByTestId('card-p1')).toBeInTheDocument()
    expect(screen.getByTestId('card-p2')).toBeInTheDocument()
  })
})

describe('FavoritesPage - Use prompt / use image', () => {
  it('passes onUsePrompt and onUseImage to CardGrid', () => {
    useCardDataMock.mockReturnValue({
      ...defaultCardDataReturn,
      cards: samplePrompts,
      total: 2,
    })
    renderPage()
    expect(screen.getByTestId('use-prompt-p1')).toBeInTheDocument()
    expect(screen.getByTestId('use-image-p1')).toBeInTheDocument()
  })

  it('passes onUsePrompt and onUseImage to UnifiedDetailModal', async () => {
    useCardDataMock.mockReturnValue({
      ...defaultCardDataReturn,
      cards: sampleImages,
      total: 2,
    })
    renderPage()
    fireEvent.click(screen.getByTestId('click-1'))
    await waitFor(() => {
      expect(screen.getByTestId('modal-use-prompt')).toBeInTheDocument()
      expect(screen.getByTestId('modal-use-image')).toBeInTheDocument()
    })
  })
})
