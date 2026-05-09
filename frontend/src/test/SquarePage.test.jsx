import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const {
  squareListMock,
  squareSharedMock,
  squareMyMock,
  squareLikeMock,
  squareUnshareMock,
  promptListMock,
  promptListPublicMock,
  promptCategoriesMock,
  promptLikeMock,
  favoriteListMock,
  favoriteToggleMock,
  configGetMock,
  adminSquareMock,
  adminPromptsMock,
  useCardDataMock,
  navigateMock,
  alertMock,
  confirmMock,
  readUserMock,
} = vi.hoisted(() => {
  const navigateMock = vi.fn()
  return {
    squareListMock: vi.fn(),
    squareSharedMock: vi.fn(),
    squareMyMock: vi.fn(),
    squareLikeMock: vi.fn(),
    squareUnshareMock: vi.fn(),
    promptListMock: vi.fn(),
    promptListPublicMock: vi.fn(),
    promptCategoriesMock: vi.fn(),
    promptLikeMock: vi.fn(),
    favoriteListMock: vi.fn(),
    favoriteToggleMock: vi.fn(),
    configGetMock: vi.fn(),
    adminSquareMock: vi.fn(),
    adminPromptsMock: vi.fn(),
    useCardDataMock: vi.fn(),
    navigateMock,
    alertMock: vi.fn(),
    confirmMock: vi.fn(async () => true),
    readUserMock: vi.fn(),
  }
})

vi.mock('../api', () => ({
  squareAPI: {
    list: squareListMock,
    shared: squareSharedMock,
    my: squareMyMock,
    like: squareLikeMock,
    unshare: squareUnshareMock,
  },
  promptAPI: {
    list: promptListMock,
    listPublic: promptListPublicMock,
    categories: promptCategoriesMock,
    like: promptLikeMock,
  },
  favoriteAPI: {
    list: favoriteListMock,
    toggle: favoriteToggleMock,
  },
  configAPI: {
    get: configGetMock,
  },
  adminAPI: {
    square: adminSquareMock,
    prompts: adminPromptsMock,
    freezeSquare: vi.fn(async () => ({})),
    batchDeleteSquare: vi.fn(async () => ({})),
    freezePrompts: vi.fn(async () => ({})),
    batchDeletePrompts: vi.fn(async () => ({})),
    deletePrompt: vi.fn(async () => ({})),
  },
}))

vi.mock('../hooks/useCardData', () => ({
  useCardData: useCardDataMock,
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useLocation: () => ({ state: null }),
  }
})

vi.mock('../LayoutModeContext', () => ({
  useLayoutMode: () => ({ layoutMode: 'masonry', setLayoutMode: vi.fn() }),
  LayoutModeProvider: ({ children }) => children,
}))

vi.mock('../auth', () => ({
  readUser: readUserMock,
}))

vi.mock('../components/AppDialogProvider', () => ({
  useAppDialog: () => ({ alert: alertMock, confirm: confirmMock }),
}))

vi.mock('../components/MainLayout', () => ({
  default: ({ children }) => <div data-testid="main-layout">{children}</div>,
}))

vi.mock('../components/SearchInput', () => ({
  default: ({ value, onChange, placeholder }) => (
    <input
      data-testid="search-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  ),
}))

vi.mock('../components/CardGrid', () => ({
  default: ({ cards, loading, emptyText, onCardClick, onLike, onFavorite, onPageChange, page, totalPages, total, showTotal }) => (
    <div data-testid="card-grid">
      {showTotal && total !== undefined && <span data-testid="card-total">{total}</span>}
      {loading && <div data-testid="loading-skeleton">loading</div>}
      {!loading && cards.length === 0 && <span data-testid="empty-text">{emptyText}</span>}
      {cards.map((card, idx) => (
        <div key={card.id} data-testid={`card-${card.id}`}>
          <span data-testid={`card-title-${card.id}`}>{card.title}</span>
          <button data-testid={`click-${card.id}`} onClick={() => onCardClick?.(card, idx)} />
          <button data-testid={`like-${card.id}`} onClick={() => onLike?.(card.id)} />
          <button data-testid={`fav-${card.id}`} onClick={() => onFavorite?.(card.id)} />
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
  default: ({ card, onClose, onLike, onFavorite }) => (
    <div data-testid="detail-modal">
      <span data-testid="modal-card-title">{card?.title}</span>
      <button data-testid="modal-close" onClick={onClose} />
      <button data-testid="modal-like" onClick={() => onLike?.(card?.id)} />
      <button data-testid="modal-fav" onClick={() => onFavorite?.(card?.id)} />
    </div>
  ),
}))

vi.mock('../components/CategoryFilter', () => ({
  default: ({ active, onChange }) => (
    <div data-testid="category-filter">
      <button data-testid="cat-a" onClick={() => onChange('catA')}>catA</button>
      <button data-testid="cat-clear" onClick={() => onChange(null)}>clear</button>
      {active && <span data-testid="active-cat">{active}</span>}
    </div>
  ),
}))

vi.mock('../utils/cardAdapter', () => ({
  normalizeList: (items) => items,
  normalizePrompt: (raw) => raw,
  normalizeImage: (raw) => raw,
}))

import SquarePage from '../pages/SquarePage'
import { LayoutModeProvider } from '../LayoutModeContext'
import { MemoryRouter } from 'react-router-dom'

const sampleImages = [
  { id: '1', title: 'Image One', prompt: 'a cat', author: 'alice', authorId: '10', authorName: 'alice', likesCount: 5, isLiked: false, isFavorited: false, _type: 'image' },
  { id: '2', title: 'Image Two', prompt: 'a dog', author: 'bob', authorId: '20', authorName: 'bob', likesCount: 10, isLiked: true, isFavorited: true, _type: 'image' },
]

const samplePrompts = [
  { id: 'p1', title: 'Prompt Alpha', prompt: 'sunset scene', author: 'carol', authorId: '30', authorName: 'carol', likesCount: 3, isLiked: false, isFavorited: false, _type: 'prompt' },
  { id: 'p2', title: 'Prompt Beta', prompt: 'ocean view', author: 'dave', authorId: '40', authorName: 'dave', likesCount: 8, isLiked: false, isFavorited: false, _type: 'prompt' },
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

function renderPage(routeState = null) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/square', state: routeState }]}>
      <LayoutModeProvider>
        <SquarePage />
      </LayoutModeProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  localStorage.clear()
  localStorage.setItem('user', JSON.stringify({ id: 1, username: 'tester', is_admin: false }))
  readUserMock.mockReturnValue({ id: 1, username: 'tester', is_admin: false })
  configGetMock.mockResolvedValue({ data: { square_page_size: 20 } })
  promptCategoriesMock.mockResolvedValue({ data: { categories: [] } })
  useCardDataMock.mockReturnValue({ ...defaultCardDataReturn })
})

describe('SquarePage', () => {
  it('renders main layout with tab buttons', () => {
    renderPage()
    expect(screen.getByText('提示词库')).toBeInTheDocument()
    expect(screen.getByText('用户作品库')).toBeInTheDocument()
    expect(screen.getByText('分享与收藏')).toBeInTheDocument()
  })

  it('defaults to prompts tab', () => {
    renderPage()
    expect(useCardDataMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'prompt' })
    )
  })

  it('switches to works tab on click', async () => {
    renderPage()
    fireEvent.click(screen.getByText('用户作品库'))
    await waitFor(() => {
      expect(useCardDataMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'image' })
      )
    })
  })

  it('switches to shared tab on click', async () => {
    useCardDataMock.mockReturnValue({
      ...defaultCardDataReturn,
      cards: sampleImages,
      total: 2,
    })
    renderPage()
    fireEvent.click(screen.getByText('分享与收藏'))
    await waitFor(() => {
      expect(screen.getByTestId('card-grid')).toBeInTheDocument()
    })
  })

  it('resets query and sort on tab change', async () => {
    renderPage()
    const searchInput = screen.getByTestId('search-input')
    fireEvent.change(searchInput, { target: { value: 'test query' } })
    fireEvent.click(screen.getByText('用户作品库'))
    await waitFor(() => {
      expect(screen.getByTestId('search-input').value).toBe('')
    })
  })
})

describe('SquarePage - Card rendering', () => {
  it('renders cards from useCardData', () => {
    useCardDataMock.mockReturnValue({
      ...defaultCardDataReturn,
      cards: samplePrompts,
      total: 2,
    })
    renderPage()
    expect(screen.getByTestId('card-p1')).toBeInTheDocument()
    expect(screen.getByTestId('card-p2')).toBeInTheDocument()
    expect(screen.getByTestId('card-title-p1')).toHaveTextContent('Prompt Alpha')
  })

  it('shows total count', () => {
    useCardDataMock.mockReturnValue({
      ...defaultCardDataReturn,
      cards: samplePrompts,
      total: 42,
    })
    renderPage()
    expect(screen.getByTestId('card-total')).toHaveTextContent('42')
  })

  it('renders pagination when totalPages > 1', () => {
    useCardDataMock.mockReturnValue({
      ...defaultCardDataReturn,
      cards: sampleImages,
      total: 100,
      page: 1,
    })
    renderPage()
    fireEvent.click(screen.getByText('用户作品库'))
    expect(screen.getByTestId('pagination')).toBeInTheDocument()
    expect(screen.getByTestId('current-page')).toHaveTextContent('1')
  })
})

describe('SquarePage - Loading state', () => {
  it('shows loading skeleton when loading', () => {
    useCardDataMock.mockReturnValue({
      ...defaultCardDataReturn,
      loading: true,
    })
    renderPage()
    expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument()
  })
})

describe('SquarePage - Empty state', () => {
  it('shows empty text when no cards', () => {
    useCardDataMock.mockReturnValue({
      ...defaultCardDataReturn,
      cards: [],
      loading: false,
    })
    renderPage()
    expect(screen.getByTestId('empty-text')).toBeInTheDocument()
  })
})

describe('SquarePage - Detail modal', () => {
  it('opens detail modal on card click', async () => {
    useCardDataMock.mockReturnValue({
      ...defaultCardDataReturn,
      cards: samplePrompts,
      total: 2,
    })
    renderPage()
    fireEvent.click(screen.getByTestId('click-p1'))
    await waitFor(() => {
      expect(screen.getByTestId('detail-modal')).toBeInTheDocument()
      expect(screen.getByTestId('modal-card-title')).toHaveTextContent('Prompt Alpha')
    })
  })

  it('closes detail modal on close', async () => {
    useCardDataMock.mockReturnValue({
      ...defaultCardDataReturn,
      cards: samplePrompts,
      total: 2,
    })
    renderPage()
    fireEvent.click(screen.getByTestId('click-p1'))
    await waitFor(() => expect(screen.getByTestId('detail-modal')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('modal-close'))
    await waitFor(() => {
      expect(screen.queryByTestId('detail-modal')).not.toBeInTheDocument()
    })
  })
})

describe('SquarePage - Like and Favorite', () => {
  it('calls handleLike on like button click', () => {
    const handleLike = vi.fn()
    useCardDataMock.mockReturnValue({
      ...defaultCardDataReturn,
      cards: samplePrompts,
      total: 2,
      handleLike,
    })
    renderPage()
    fireEvent.click(screen.getByTestId('like-p1'))
    expect(handleLike).toHaveBeenCalledWith('p1')
  })

  it('calls handleFavorite on favorite button click', () => {
    const handleFavorite = vi.fn()
    useCardDataMock.mockReturnValue({
      ...defaultCardDataReturn,
      cards: samplePrompts,
      total: 2,
      handleFavorite,
    })
    renderPage()
    fireEvent.click(screen.getByTestId('fav-p1'))
    expect(handleFavorite).toHaveBeenCalledWith('p1')
  })

  it('handles like from detail modal', async () => {
    const handleLike = vi.fn()
    useCardDataMock.mockReturnValue({
      ...defaultCardDataReturn,
      cards: samplePrompts,
      total: 2,
      handleLike,
    })
    renderPage()
    fireEvent.click(screen.getByTestId('click-p1'))
    await waitFor(() => expect(screen.getByTestId('detail-modal')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('modal-like'))
    expect(handleLike).toHaveBeenCalledWith('p1')
  })

  it('handles favorite from detail modal', async () => {
    const handleFavorite = vi.fn()
    useCardDataMock.mockReturnValue({
      ...defaultCardDataReturn,
      cards: samplePrompts,
      total: 2,
      handleFavorite,
    })
    renderPage()
    fireEvent.click(screen.getByTestId('click-p1'))
    await waitFor(() => expect(screen.getByTestId('detail-modal')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('modal-fav'))
    expect(handleFavorite).toHaveBeenCalledWith('p1')
  })
})

describe('SquarePage - Search', () => {
  it('updates search query on input', () => {
    renderPage()
    const input = screen.getByTestId('search-input')
    fireEvent.change(input, { target: { value: 'nature' } })
    expect(input.value).toBe('nature')
  })

  it('shows correct placeholder for prompts tab', () => {
    renderPage()
    expect(screen.getByTestId('search-input')).toHaveAttribute('placeholder', '搜索提示词...')
  })

  it('shows correct placeholder for works tab', async () => {
    renderPage()
    fireEvent.click(screen.getByText('用户作品库'))
    await waitFor(() => {
      expect(screen.getByTestId('search-input')).toHaveAttribute('placeholder', '搜索提示词/作者...')
    })
  })

  it('hides search on shared tab', () => {
    useCardDataMock.mockReturnValue({
      ...defaultCardDataReturn,
      cards: sampleImages,
      total: 2,
    })
    renderPage()
    fireEvent.click(screen.getByText('分享与收藏'))
    expect(screen.queryByTestId('search-input')).not.toBeInTheDocument()
  })
})

describe('SquarePage - Sort', () => {
  it('shows sort buttons on prompts tab', () => {
    renderPage()
    expect(screen.getByText('最热')).toBeInTheDocument()
    expect(screen.getByText('最新')).toBeInTheDocument()
  })

  it('hides sort buttons on shared tab', () => {
    useCardDataMock.mockReturnValue({
      ...defaultCardDataReturn,
      cards: sampleImages,
      total: 2,
    })
    renderPage()
    fireEvent.click(screen.getByText('分享与收藏'))
    expect(screen.queryByText('最热')).not.toBeInTheDocument()
    expect(screen.queryByText('最新')).not.toBeInTheDocument()
  })
})

describe('SquarePage - Category filter', () => {
  it('shows category filter on prompts tab when categories exist', async () => {
    promptCategoriesMock.mockResolvedValue({
      data: { categories: [{ key: 'a', label: 'Cat A' }] },
    })
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('category-filter')).toBeInTheDocument()
    })
  })

  it('hides category filter on shared tab', () => {
    useCardDataMock.mockReturnValue({
      ...defaultCardDataReturn,
      cards: sampleImages,
      total: 2,
    })
    renderPage()
    fireEvent.click(screen.getByText('分享与收藏'))
    expect(screen.queryByTestId('category-filter')).not.toBeInTheDocument()
  })
})

describe('SquarePage - Admin mode', () => {
  beforeEach(() => {
    readUserMock.mockReturnValue({ id: 1, username: 'admin', is_admin: true })
    localStorage.setItem('user', JSON.stringify({ id: 1, username: 'admin', is_admin: true }))
  })

  it('renders admin status filter on works tab', async () => {
    useCardDataMock.mockReturnValue({
      ...defaultCardDataReturn,
      cards: sampleImages,
      total: 2,
    })
    renderPage()
    fireEvent.click(screen.getByText('用户作品库'))
    await waitFor(() => {
      expect(screen.getByText('全部')).toBeInTheDocument()
      expect(screen.getByText('正常')).toBeInTheDocument()
      expect(screen.getByText('冻结')).toBeInTheDocument()
    })
  })

  it('renders admin status filter on prompts tab', () => {
    useCardDataMock.mockReturnValue({
      ...defaultCardDataReturn,
      cards: samplePrompts,
      total: 2,
    })
    renderPage()
    expect(screen.getByText('全部')).toBeInTheDocument()
    expect(screen.getByText('正常')).toBeInTheDocument()
    expect(screen.getByText('冻结')).toBeInTheDocument()
  })

  it('shows select button on prompts tab', () => {
    renderPage()
    expect(screen.getByText('选择')).toBeInTheDocument()
  })
})

describe('SquarePage - Config loading', () => {
  it('fetches square_page_size from config', async () => {
    renderPage()
    await waitFor(() => {
      expect(configGetMock).toHaveBeenCalled()
    })
  })
})

describe('SquarePage - Shared tab sub-tabs', () => {
  it('renders sub-tabs in shared tab', () => {
    useCardDataMock.mockReturnValue({
      ...defaultCardDataReturn,
      cards: sampleImages,
      total: 2,
    })
    renderPage()
    fireEvent.click(screen.getByText('分享与收藏'))
    expect(screen.getByText('全部')).toBeInTheDocument()
    expect(screen.getByText('分享')).toBeInTheDocument()
    expect(screen.getByText('图片')).toBeInTheDocument()
    expect(screen.getByText('提示词')).toBeInTheDocument()
  })
})

describe('SquarePage - Refresh', () => {
  it('renders refresh button', () => {
    renderPage()
    const refreshBtn = document.querySelector('.inline-flex.h-8.w-8')
    expect(refreshBtn).toBeInTheDocument()
  })
})
