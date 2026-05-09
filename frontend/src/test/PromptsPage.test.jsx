import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const {
  promptListMock,
  promptCategoriesMock,
  promptCreateMock,
  promptDeleteMock,
  promptBatchDeleteMock,
  promptUpdateMock,
  promptImportMock,
  promptExportMock,
  useCardDataMock,
  navigateMock,
  alertMock,
  confirmMock,
} = vi.hoisted(() => {
  const navigateMock = vi.fn()
  return {
    promptListMock: vi.fn(),
    promptCategoriesMock: vi.fn(),
    promptCreateMock: vi.fn(),
    promptDeleteMock: vi.fn(),
    promptBatchDeleteMock: vi.fn(),
    promptUpdateMock: vi.fn(),
    promptImportMock: vi.fn(),
    promptExportMock: vi.fn(),
    useCardDataMock: vi.fn(),
    navigateMock,
    alertMock: vi.fn(),
    confirmMock: vi.fn(async () => true),
  }
})

vi.mock('../api', () => ({
  promptAPI: {
    list: promptListMock,
    categories: promptCategoriesMock,
    create: promptCreateMock,
    delete: promptDeleteMock,
    batchDelete: promptBatchDeleteMock,
    update: promptUpdateMock,
    import: promptImportMock,
    export: promptExportMock,
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
  }
})

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
  default: ({ cards, loading, emptyText, onCardClick, onFavorite, onUsePrompt, selectable, selected, onToggleSelect, onPageChange, page, totalPages, total }) => (
    <div data-testid="card-grid">
      {loading && <div data-testid="loading-skeleton">loading</div>}
      {!loading && cards.length === 0 && <span data-testid="empty-text">{emptyText}</span>}
      {cards.map((card, idx) => (
        <div key={card.id} data-testid={`card-${card.id}`}>
          <span data-testid={`card-title-${card.id}`}>{card.title}</span>
          {selectable && (
            <button
              data-testid={`toggle-${card.id}`}
              onClick={() => onToggleSelect?.(card.id)}
            >
              {selected?.has(card.id) ? 'selected' : 'unselected'}
            </button>
          )}
          <button data-testid={`click-${card.id}`} onClick={() => onCardClick?.(card, idx)} />
          <button data-testid={`fav-${card.id}`} onClick={() => onFavorite?.(card.id)} />
          {onUsePrompt && (
            <button data-testid={`use-${card.id}`} onClick={() => onUsePrompt?.(card)} />
          )}
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
  default: ({ card, onClose, onFavorite, onUsePrompt, onDelete, onPromptSave }) => (
    <div data-testid="detail-modal">
      <span data-testid="modal-card-title">{card?.title}</span>
      <button data-testid="modal-close" onClick={onClose} />
      <button data-testid="modal-fav" onClick={() => onFavorite?.(card?.id)} />
      <button data-testid="modal-use" onClick={() => onUsePrompt?.(card)} />
      <button data-testid="modal-delete" onClick={() => onDelete?.(card?.id)} />
      <button data-testid="modal-save" onClick={() => onPromptSave?.(card?.id, { name: 'updated' })} />
    </div>
  ),
}))

import PromptsPage from '../pages/PromptsPage'
import { MemoryRouter } from 'react-router-dom'

const samplePrompts = [
  { id: '1', title: 'Prompt One', prompt: 'a cat sitting', author: 'alice', authorId: '10', authorName: 'alice', likesCount: 5, isLiked: false, isFavorited: false, _type: 'prompt', category: 'nature' },
  { id: '2', title: 'Prompt Two', prompt: 'a dog running', author: 'bob', authorId: '20', authorName: 'bob', likesCount: 10, isLiked: true, isFavorited: true, _type: 'prompt', category: null },
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
  handleFavorite: vi.fn(),
  updateCard: vi.fn(),
}

function renderPage() {
  return render(
    <MemoryRouter>
      <PromptsPage />
    </MemoryRouter>
  )
}

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  confirmMock.mockResolvedValue(true)
  localStorage.clear()
  promptCategoriesMock.mockResolvedValue({ data: { categories: [] } })
  useCardDataMock.mockReturnValue({ ...defaultCardDataReturn })
})

describe('PromptsPage - Rendering', () => {
  it('renders main layout', () => {
    renderPage()
    expect(screen.getByTestId('main-layout')).toBeInTheDocument()
  })

  it('renders search input with correct placeholder', () => {
    renderPage()
    expect(screen.getByTestId('search-input')).toHaveAttribute('placeholder', '搜索...')
  })

  it('renders action buttons', () => {
    renderPage()
    expect(screen.getByText('新增')).toBeInTheDocument()
    expect(screen.getByText(/导入/)).toBeInTheDocument()
  })

  it('renders CardGrid', () => {
    renderPage()
    expect(screen.getByTestId('card-grid')).toBeInTheDocument()
  })

  it('renders select all button when cards exist', () => {
    useCardDataMock.mockReturnValue({ ...defaultCardDataReturn, cards: samplePrompts, total: 2 })
    renderPage()
    expect(screen.getByText('全选')).toBeInTheDocument()
  })

  it('hides select all button when no cards', () => {
    renderPage()
    expect(screen.queryByText('全选')).not.toBeInTheDocument()
  })
})

describe('PromptsPage - Loading state', () => {
  it('shows loading skeleton when loading', () => {
    useCardDataMock.mockReturnValue({ ...defaultCardDataReturn, loading: true })
    renderPage()
    expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument()
  })
})

describe('PromptsPage - Empty state', () => {
  it('shows empty text when no prompts', () => {
    renderPage()
    expect(screen.getByTestId('empty-text')).toHaveTextContent('暂无提示词')
  })
})

describe('PromptsPage - Prompt list display', () => {
  it('renders prompt cards', () => {
    useCardDataMock.mockReturnValue({ ...defaultCardDataReturn, cards: samplePrompts, total: 2 })
    renderPage()
    expect(screen.getByTestId('card-1')).toBeInTheDocument()
    expect(screen.getByTestId('card-2')).toBeInTheDocument()
    expect(screen.getByTestId('card-title-1')).toHaveTextContent('Prompt One')
  })

  it('renders pagination when total exceeds page size', () => {
    useCardDataMock.mockReturnValue({ ...defaultCardDataReturn, cards: samplePrompts, total: 100, page: 1 })
    renderPage()
    expect(screen.getByTestId('pagination')).toBeInTheDocument()
  })
})

describe('PromptsPage - Search', () => {
  it('updates search query on input', () => {
    renderPage()
    const input = screen.getByTestId('search-input')
    fireEvent.change(input, { target: { value: 'nature' } })
    expect(input.value).toBe('nature')
  })
})

describe('PromptsPage - Categories', () => {
  it('fetches categories on mount', () => {
    renderPage()
    expect(promptCategoriesMock).toHaveBeenCalledTimes(1)
  })

  it('populates category options in new form', async () => {
    promptCategoriesMock.mockResolvedValue({
      data: { categories: [{ slug: 'nature', label: '自然' }, { slug: 'art', label: '艺术' }] },
    })
    renderPage()
    fireEvent.click(screen.getByText('新增'))
    await waitFor(() => {
      expect(screen.getByText('自然')).toBeInTheDocument()
      expect(screen.getByText('艺术')).toBeInTheDocument()
    })
  })
})

describe('PromptsPage - New prompt form', () => {
  it('opens form on new button click', () => {
    renderPage()
    fireEvent.click(screen.getByText('新增'))
    expect(screen.getByPlaceholderText('标题')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('提示词内容')).toBeInTheDocument()
  })

  it('closes form on cancel click', () => {
    renderPage()
    fireEvent.click(screen.getByText('新增'))
    expect(screen.getByPlaceholderText('标题')).toBeInTheDocument()
    fireEvent.click(screen.getByText('取消'))
    expect(screen.queryByPlaceholderText('标题')).not.toBeInTheDocument()
  })

  it('does not create when name is empty', async () => {
    renderPage()
    fireEvent.click(screen.getByText('新增'))
    fireEvent.change(screen.getByPlaceholderText('提示词内容'), { target: { value: 'some prompt' } })
    fireEvent.click(screen.getByText('保存'))
    expect(promptCreateMock).not.toHaveBeenCalled()
  })

  it('does not create when prompt content is empty', async () => {
    renderPage()
    fireEvent.click(screen.getByText('新增'))
    fireEvent.change(screen.getByPlaceholderText('标题'), { target: { value: 'Test Title' } })
    fireEvent.click(screen.getByText('保存'))
    expect(promptCreateMock).not.toHaveBeenCalled()
  })

  it('creates prompt and refreshes on valid submit', async () => {
    const refresh = vi.fn()
    useCardDataMock.mockReturnValue({ ...defaultCardDataReturn, refresh })
    promptCreateMock.mockResolvedValue({})
    renderPage()
    fireEvent.click(screen.getByText('新增'))
    fireEvent.change(screen.getByPlaceholderText('标题'), { target: { value: 'New Title' } })
    fireEvent.change(screen.getByPlaceholderText('提示词内容'), { target: { value: 'New prompt text' } })
    fireEvent.click(screen.getByText('保存'))
    await waitFor(() => {
      expect(promptCreateMock).toHaveBeenCalledWith({ name: 'New Title', prompt: 'New prompt text', category: null })
      expect(refresh).toHaveBeenCalled()
    })
    expect(screen.queryByPlaceholderText('标题')).not.toBeInTheDocument()
  })

  it('submits with category when selected', async () => {
    promptCategoriesMock.mockResolvedValue({
      data: { categories: [{ slug: 'art', label: '艺术' }] },
    })
    promptCreateMock.mockResolvedValue({})
    renderPage()
    fireEvent.click(screen.getByText('新增'))
    await waitFor(() => {
      expect(screen.getByText('艺术')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByPlaceholderText('标题'), { target: { value: 'Titled' } })
    fireEvent.change(screen.getByPlaceholderText('提示词内容'), { target: { value: 'Content' } })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'art' } })
    fireEvent.click(screen.getByText('保存'))
    await waitFor(() => {
      expect(promptCreateMock).toHaveBeenCalledWith({ name: 'Titled', prompt: 'Content', category: 'art' })
    })
  })

  it('shows alert on create failure', async () => {
    promptCreateMock.mockRejectedValue(new Error('create failed'))
    renderPage()
    fireEvent.click(screen.getByText('新增'))
    fireEvent.change(screen.getByPlaceholderText('标题'), { target: { value: 'T' } })
    fireEvent.change(screen.getByPlaceholderText('提示词内容'), { target: { value: 'P' } })
    fireEvent.click(screen.getByText('保存'))
    await waitFor(() => {
      expect(alertMock).toHaveBeenCalledWith('失败: create failed')
    })
  })

  it('resets form after cancel', () => {
    renderPage()
    fireEvent.click(screen.getByText('新增'))
    fireEvent.change(screen.getByPlaceholderText('标题'), { target: { value: 'something' } })
    fireEvent.click(screen.getByText('取消'))
    fireEvent.click(screen.getByText('新增'))
    expect(screen.getByPlaceholderText('标题').value).toBe('')
  })
})

describe('PromptsPage - Detail modal', () => {
  it('opens detail modal on card click', () => {
    useCardDataMock.mockReturnValue({ ...defaultCardDataReturn, cards: samplePrompts, total: 2 })
    renderPage()
    fireEvent.click(screen.getByTestId('click-1'))
    expect(screen.getByTestId('detail-modal')).toBeInTheDocument()
    expect(screen.getByTestId('modal-card-title')).toHaveTextContent('Prompt One')
  })

  it('closes detail modal on close', () => {
    useCardDataMock.mockReturnValue({ ...defaultCardDataReturn, cards: samplePrompts, total: 2 })
    renderPage()
    fireEvent.click(screen.getByTestId('click-1'))
    expect(screen.getByTestId('detail-modal')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('modal-close'))
    expect(screen.queryByTestId('detail-modal')).not.toBeInTheDocument()
  })

  it('calls handleFavorite from detail modal', () => {
    const handleFavorite = vi.fn()
    useCardDataMock.mockReturnValue({ ...defaultCardDataReturn, cards: samplePrompts, total: 2, handleFavorite })
    renderPage()
    fireEvent.click(screen.getByTestId('click-1'))
    fireEvent.click(screen.getByTestId('modal-fav'))
    expect(handleFavorite).toHaveBeenCalledWith('1')
  })

  it('calls onPromptSave from detail modal', async () => {
    promptUpdateMock.mockResolvedValue({})
    useCardDataMock.mockReturnValue({ ...defaultCardDataReturn, cards: samplePrompts, total: 2 })
    renderPage()
    fireEvent.click(screen.getByTestId('click-1'))
    fireEvent.click(screen.getByTestId('modal-save'))
    await waitFor(() => {
      expect(promptUpdateMock).toHaveBeenCalledWith('1', { name: 'updated' })
    })
  })
})

describe('PromptsPage - Use prompt action', () => {
  it('navigates to home with pending_prompt on use', () => {
    useCardDataMock.mockReturnValue({ ...defaultCardDataReturn, cards: samplePrompts, total: 2 })
    renderPage()
    fireEvent.click(screen.getByTestId('use-1'))
    expect(localStorage.getItem('pending_prompt')).toBe('a cat sitting')
    expect(navigateMock).toHaveBeenCalledWith('/')
  })
})

describe('PromptsPage - Selection', () => {
  it('toggles card selection', () => {
    useCardDataMock.mockReturnValue({ ...defaultCardDataReturn, cards: samplePrompts, total: 2 })
    renderPage()
    const toggleBtn = screen.getByTestId('toggle-1')
    expect(toggleBtn).toHaveTextContent('unselected')
    fireEvent.click(toggleBtn)
    expect(toggleBtn).toHaveTextContent('selected')
    fireEvent.click(toggleBtn)
    expect(toggleBtn).toHaveTextContent('unselected')
  })

  it('selects all cards', () => {
    useCardDataMock.mockReturnValue({ ...defaultCardDataReturn, cards: samplePrompts, total: 2 })
    renderPage()
    fireEvent.click(screen.getByText('全选'))
    expect(screen.getByTestId('toggle-1')).toHaveTextContent('selected')
    expect(screen.getByTestId('toggle-2')).toHaveTextContent('selected')
    expect(screen.getByText('取消全选')).toBeInTheDocument()
  })

  it('deselects all cards', () => {
    useCardDataMock.mockReturnValue({ ...defaultCardDataReturn, cards: samplePrompts, total: 2 })
    renderPage()
    fireEvent.click(screen.getByText('全选'))
    fireEvent.click(screen.getByText('取消全选'))
    expect(screen.getByTestId('toggle-1')).toHaveTextContent('unselected')
    expect(screen.getByTestId('toggle-2')).toHaveTextContent('unselected')
  })

  it('shows batch delete button when items selected', () => {
    useCardDataMock.mockReturnValue({ ...defaultCardDataReturn, cards: samplePrompts, total: 2 })
    renderPage()
    fireEvent.click(screen.getByTestId('toggle-1'))
    expect(screen.getByText(/删除 \(1\)/)).toBeInTheDocument()
  })

  it('shows export button with count when items selected', () => {
    useCardDataMock.mockReturnValue({ ...defaultCardDataReturn, cards: samplePrompts, total: 2 })
    renderPage()
    fireEvent.click(screen.getByTestId('toggle-1'))
    expect(screen.getByText(/导出 \(1\)/)).toBeInTheDocument()
  })

  it('export button is disabled when nothing selected', () => {
    useCardDataMock.mockReturnValue({ ...defaultCardDataReturn, cards: samplePrompts, total: 2 })
    renderPage()
    const exportBtn = screen.getByText('导出').closest('button')
    expect(exportBtn).toBeDisabled()
  })
})

describe('PromptsPage - Delete', () => {
  it('calls promptAPI.delete on detail modal delete', async () => {
    promptDeleteMock.mockResolvedValue({})
    useCardDataMock.mockReturnValue({ ...defaultCardDataReturn, cards: samplePrompts, total: 2 })
    renderPage()
    fireEvent.click(screen.getByTestId('click-1'))
    fireEvent.click(screen.getByTestId('modal-delete'))
    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalledWith('确定删除？')
      expect(promptDeleteMock).toHaveBeenCalledWith('1')
    })
  })

  it('does not delete when confirm is rejected', async () => {
    confirmMock.mockResolvedValue(false)
    useCardDataMock.mockReturnValue({ ...defaultCardDataReturn, cards: samplePrompts, total: 2 })
    renderPage()
    fireEvent.click(screen.getByTestId('click-1'))
    fireEvent.click(screen.getByTestId('modal-delete'))
    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalled()
      expect(promptDeleteMock).not.toHaveBeenCalled()
    })
  })

  it('shows alert on delete failure', async () => {
    promptDeleteMock.mockRejectedValue(new Error('delete error'))
    useCardDataMock.mockReturnValue({ ...defaultCardDataReturn, cards: samplePrompts, total: 2 })
    renderPage()
    fireEvent.click(screen.getByTestId('click-1'))
    fireEvent.click(screen.getByTestId('modal-delete'))
    await waitFor(() => {
      expect(alertMock).toHaveBeenCalledWith('delete error')
    })
  })

  it('batch deletes selected prompts', async () => {
    promptBatchDeleteMock.mockResolvedValue({})
    useCardDataMock.mockReturnValue({ ...defaultCardDataReturn, cards: samplePrompts, total: 2 })
    renderPage()
    fireEvent.click(screen.getByTestId('toggle-1'))
    fireEvent.click(screen.getByTestId('toggle-2'))
    fireEvent.click(screen.getByText(/删除 \(2\)/))
    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalledWith('删除 2 条？')
      expect(promptBatchDeleteMock).toHaveBeenCalledWith(['1', '2'])
    })
  })
})

describe('PromptsPage - Import', () => {
  it('triggers file input click on import button', () => {
    renderPage()
    const fileInput = document.querySelector('input[type="file"]')
    const clickSpy = vi.spyOn(fileInput, 'click')
    fireEvent.click(screen.getByText(/导入/))
    expect(clickSpy).toHaveBeenCalled()
  })

  it('calls promptAPI.import on file selection', async () => {
    promptImportMock.mockResolvedValue({ data: { success: 5, failed: 0 } })
    renderPage()
    const fileInput = document.querySelector('input[type="file"]')
    const file = new File(['[]'], 'prompts.json', { type: 'application/json' })
    fireEvent.change(fileInput, { target: { files: [file] } })
    await waitFor(() => {
      expect(promptImportMock).toHaveBeenCalledWith(file)
      expect(alertMock).toHaveBeenCalledWith('成功: 5, 失败: 0')
    })
  })

  it('shows alert on import failure', async () => {
    promptImportMock.mockRejectedValue(new Error('import error'))
    renderPage()
    const fileInput = document.querySelector('input[type="file"]')
    const file = new File(['[]'], 'bad.json', { type: 'application/json' })
    fireEvent.change(fileInput, { target: { files: [file] } })
    await waitFor(() => {
      expect(alertMock).toHaveBeenCalledWith('import error')
    })
  })

  it('does nothing when no file selected', async () => {
    renderPage()
    const fileInput = document.querySelector('input[type="file"]')
    fireEvent.change(fileInput, { target: { files: [] } })
    expect(promptImportMock).not.toHaveBeenCalled()
  })
})

describe('PromptsPage - Export', () => {
  it('calls promptAPI.export on export click', async () => {
    const blobData = new Blob(['[]'])
    promptExportMock.mockResolvedValue({ data: blobData })
    useCardDataMock.mockReturnValue({ ...defaultCardDataReturn, cards: samplePrompts, total: 2 })
    renderPage()
    fireEvent.click(screen.getByTestId('toggle-1'))
    fireEvent.click(screen.getByText(/导出/))
    await waitFor(() => {
      expect(promptExportMock).toHaveBeenCalledWith(['1'], 'json')
    })
  })
})

describe('PromptsPage - useCardData integration', () => {
  it('calls useCardData with prompt type', () => {
    renderPage()
    expect(useCardDataMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'prompt' })
    )
  })

  it('passes deps containing query', () => {
    renderPage()
    expect(useCardDataMock).toHaveBeenCalledWith(
      expect.objectContaining({ deps: expect.any(Array) })
    )
  })
})
