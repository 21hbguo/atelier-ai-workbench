import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const {
  downloadBatchMock,
  saveMetadataMock,
  categoriesMock,
  uploadLocalMock,
  alertMock,
  confirmMock,
  saveBlobMock,
  getDownloadFilenameMock,
  getExpiryInfoMock,
} = vi.hoisted(() => ({
  downloadBatchMock: vi.fn(),
  saveMetadataMock: vi.fn(),
  categoriesMock: vi.fn(),
  uploadLocalMock: vi.fn(),
  alertMock: vi.fn(),
  confirmMock: vi.fn(async () => true),
  saveBlobMock: vi.fn(async () => true),
  getDownloadFilenameMock: vi.fn(() => 'test.png'),
  getExpiryInfoMock: vi.fn(),
}))

vi.mock('../components/AppDialogProvider', () => ({
  useAppDialog: () => ({ alert: alertMock, confirm: confirmMock, choose: vi.fn(async () => null) }),
}))

vi.mock('../api', () => ({
  imageAPI: { downloadBatch: downloadBatchMock, saveMetadata: saveMetadataMock },
  promptAPI: { categories: categoriesMock },
  uploadAPI: { uploadLocal: uploadLocalMock },
}))

vi.mock('../utils/expiry', () => ({
  getExpiryInfo: getExpiryInfoMock,
}))

vi.mock('../utils/download', () => ({
  saveBlob: saveBlobMock,
  getDownloadFilename: getDownloadFilenameMock,
}))

import UnifiedDetailModal from '../components/UnifiedDetailModal'

const baseExpiry = { expired: false, text: '3天到期', detail: '3天后过期', msLeft: 259200000 }

const imageCard = {
  id: 'img-1',
  _type: 'image',
  fullUrl: '/api/images/file/test.png',
  url: '/api/images/file/test.png',
  filename: 'test.png',
  prompt: 'a cat sitting on a mat',
  metadata: { size: '1024x1024', type: 'text', created_at: '2025-01-01 10:00:00' },
  daysLeft: 3,
  _raw: { filename: 'test.png', metadata: { size: '1024x1024', type: 'text', created_at: '2025-01-01 10:00:00' } },
}

const promptCard = {
  id: 'prompt-1',
  _type: 'prompt',
  name: 'My Prompt',
  prompt: 'a beautiful sunset over the ocean',
  author: 'testuser',
  categoryLabel: 'Landscape',
  createdAt: '2025-01-01',
  category: 'landscape',
  imagePath: 'thumb.png',
}

const noUrlImageCard = {
  id: 'img-2',
  _type: 'image',
  fullUrl: '',
  filename: 'noimg.png',
  _raw: { filename: 'noimg.png', metadata: {} },
}

const cards = [
  { ...imageCard, id: 'img-1', prompt: 'first image' },
  { ...imageCard, id: 'img-2', prompt: 'second image', fullUrl: '/api/images/file/other.png', _raw: { filename: 'other.png', metadata: {} } },
  { ...imageCard, id: 'img-3', prompt: 'third image', fullUrl: '/api/images/file/third.png', _raw: { filename: 'third.png', metadata: {} } },
]

function renderModal(props = {}) {
  const defaults = { card: imageCard, cards: [imageCard], currentIndex: 0, onClose: vi.fn() }
  return render(<UnifiedDetailModal {...defaults} {...props} />)
}

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  getExpiryInfoMock.mockReturnValue(baseExpiry)
  categoriesMock.mockResolvedValue({ data: { categories: [{ slug: 'landscape', label: 'Landscape' }] } })
  downloadBatchMock.mockResolvedValue({ data: new Blob(['img']), headers: {} })
})

describe('UnifiedDetailModal', () => {
  describe('rendering', () => {
    it('returns null when card is null', () => {
      const { container } = renderModal({ card: null, cards: [] })
      expect(container.innerHTML).toBe('')
    })

    it('renders image card with prompt text', () => {
      renderModal()
      expect(screen.getByText('a cat sitting on a mat')).toBeInTheDocument()
    })

    it('renders image metadata info items', () => {
      renderModal()
      expect(screen.getAllByText('1024x1024').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('纯文本')).toBeInTheDocument()
    })

    it('renders prompt card with name and author', () => {
      renderModal({ card: promptCard, cards: [promptCard] })
      expect(screen.getByText('My Prompt')).toBeInTheDocument()
      expect(screen.getByText('a beautiful sunset over the ocean')).toBeInTheDocument()
      expect(screen.getByText('testuser')).toBeInTheDocument()
      expect(screen.getByText('Landscape')).toBeInTheDocument()
    })

    it('renders image with correct src', () => {
      const { container } = renderModal()
      const img = container.querySelector('img[src="/api/images/file/test.png"]')
      expect(img).toBeInTheDocument()
    })

    it('renders title prop', () => {
      renderModal({ title: 'Image Detail' })
      expect(screen.getByText('Image Detail')).toBeInTheDocument()
    })

    it('renders default title', () => {
      renderModal()
      expect(screen.getByText('详情')).toBeInTheDocument()
    })

    it('shows placeholder when no displayUrl', () => {
      renderModal({ card: noUrlImageCard, cards: [noUrlImageCard] })
      expect(screen.queryByRole('img', { name: '' })).not.toBeInTheDocument()
    })

    it('renders expiry info', () => {
      getExpiryInfoMock.mockReturnValue({ expired: false, text: '2天到期', detail: '2天后过期', msLeft: 172800000 })
      renderModal()
      expect(screen.getByText('2天后过期')).toBeInTheDocument()
    })
  })

  describe('close', () => {
    it('triggers history.back when close button is clicked', () => {
      const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {})
      renderModal()
      const buttons = screen.getAllByRole('button')
      const closeBtn = buttons.find(b => !b.textContent.trim() && b.querySelector('svg'))
      fireEvent.click(closeBtn)
      expect(backSpy).toHaveBeenCalled()
      backSpy.mockRestore()
    })

    it('triggers history.back when backdrop is clicked', () => {
      const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {})
      const { container } = renderModal()
      const backdrop = container.querySelector('[class*="fixed"][class*="inset-0"][class*="bg-black"]')
      fireEvent.click(backdrop)
      expect(backSpy).toHaveBeenCalled()
      backSpy.mockRestore()
    })

    it('calls onClose via popstate when modal state was not pushed', () => {
      const onClose = vi.fn()
      const origPushState = window.history.pushState
      window.history.pushState = vi.fn()
      renderModal({ onClose })
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
      expect(onClose).toHaveBeenCalled()
      window.history.pushState = origPushState
    })

    it('does not close when modal content is clicked', () => {
      const onClose = vi.fn()
      const { container } = renderModal({ onClose })
      const modalContent = container.querySelector('.rounded-2xl.overflow-hidden.max-w-5xl')
      fireEvent.click(modalContent)
      expect(onClose).not.toHaveBeenCalled()
    })
  })

  describe('navigation', () => {
    it('shows navigation indicator with multiple cards', () => {
      renderModal({ cards, currentIndex: 0, card: cards[0] })
      expect(screen.getByText('1 / 3')).toBeInTheDocument()
    })

    it('does not show navigation indicator with single card', () => {
      renderModal()
      expect(screen.queryByText(/\/ 1/)).not.toBeInTheDocument()
    })

    it('navigates with ArrowRight key', () => {
      const onNavigate = vi.fn()
      renderModal({ cards, currentIndex: 0, card: cards[0], onNavigate })
      fireEvent.keyDown(window, { key: 'ArrowRight' })
      expect(onNavigate).toHaveBeenCalledWith(1)
    })

    it('navigates with ArrowLeft key', () => {
      const onNavigate = vi.fn()
      renderModal({ cards, currentIndex: 1, card: cards[1], onNavigate })
      fireEvent.keyDown(window, { key: 'ArrowLeft' })
      expect(onNavigate).toHaveBeenCalledWith(0)
    })

    it('does not navigate left when at first card', () => {
      const onNavigate = vi.fn()
      renderModal({ cards, currentIndex: 0, card: cards[0], onNavigate })
      fireEvent.keyDown(window, { key: 'ArrowLeft' })
      expect(onNavigate).not.toHaveBeenCalled()
    })

    it('does not navigate right when at last card', () => {
      const onNavigate = vi.fn()
      renderModal({ cards, currentIndex: 2, card: cards[2], onNavigate })
      fireEvent.keyDown(window, { key: 'ArrowRight' })
      expect(onNavigate).not.toHaveBeenCalled()
    })

    it('ignores other keys', () => {
      const onNavigate = vi.fn()
      renderModal({ cards, currentIndex: 0, card: cards[0], onNavigate })
      fireEvent.keyDown(window, { key: 'ArrowUp' })
      expect(onNavigate).not.toHaveBeenCalled()
    })
  })

  describe('action buttons', () => {
    it('renders download button for image card', () => {
      renderModal()
      expect(screen.getByText('下载')).toBeInTheDocument()
    })

    it('hides download button when hideDownload=true', () => {
      renderModal({ hideDownload: true })
      expect(screen.queryByText('下载')).not.toBeInTheDocument()
    })

    it('calls onUsePrompt when clicked', () => {
      const onUsePrompt = vi.fn()
      renderModal({ onUsePrompt })
      fireEvent.click(screen.getByText('用提示词'))
      expect(onUsePrompt).toHaveBeenCalledWith(imageCard)
    })

    it('renders reference image button when onUseImage provided', () => {
      renderModal({ onUseImage: vi.fn() })
      expect(screen.getByText('参考图')).toBeInTheDocument()
    })

    it('renders delete button when onDelete provided', () => {
      renderModal({ onDelete: vi.fn() })
      expect(screen.getByText('删除')).toBeInTheDocument()
    })

    it('calls onDelete with filename for image card', () => {
      const onDelete = vi.fn()
      renderModal({ onDelete })
      fireEvent.click(screen.getByText('删除'))
      expect(onDelete).toHaveBeenCalledWith('test.png')
    })

    it('renders like button and calls onLike', () => {
      const onLike = vi.fn()
      renderModal({ onLike })
      const likeBtn = screen.getByTitle('点赞')
      fireEvent.click(likeBtn)
      expect(onLike).toHaveBeenCalledWith('img-1')
    })

    it('renders favorite button and calls onFavorite', () => {
      const onFavorite = vi.fn()
      renderModal({ onFavorite })
      expect(screen.getByText('收藏')).toBeInTheDocument()
      fireEvent.click(screen.getByText('收藏'))
      expect(onFavorite).toHaveBeenCalledWith('img-1')
    })

    it('shows "已收藏" when card is favorited', () => {
      const favorited = { ...imageCard, isFavorited: true }
      renderModal({ card: favorited, cards: [favorited], onFavorite: vi.fn() })
      expect(screen.getByText('已收藏')).toBeInTheDocument()
    })

    it('renders share button for image with filename', () => {
      renderModal({ onShare: vi.fn() })
      expect(screen.getByText('分享')).toBeInTheDocument()
    })

    it('calls onShare with card', () => {
      const onShare = vi.fn()
      renderModal({ onShare })
      fireEvent.click(screen.getByText('分享'))
      expect(onShare).toHaveBeenCalledWith(imageCard)
    })

    it('renders unshare button when onUnshare provided', () => {
      renderModal({ onUnshare: vi.fn() })
      expect(screen.getByText('撤回')).toBeInTheDocument()
    })

    it('renders extend button for non-permanent image', () => {
      renderModal({ onExtend: vi.fn() })
      expect(screen.getByText('延3天')).toBeInTheDocument()
    })

    it('hides extend button for permanent image', () => {
      const permanent = { ...imageCard, is_permanent: true }
      renderModal({ card: permanent, cards: [permanent], onExtend: vi.fn() })
      expect(screen.queryByText('延3天')).not.toBeInTheDocument()
    })

    it('renders add-to-library button when onAddToPromptLibrary provided', () => {
      renderModal({ onAddToPromptLibrary: vi.fn() })
      expect(screen.getByText('加库')).toBeInTheDocument()
    })

    it('does not render delete for prompt card without id', () => {
      const noId = { ...promptCard, id: undefined }
      renderModal({ card: noId, cards: [noId], onDelete: vi.fn() })
      expect(screen.queryByText('删除')).not.toBeInTheDocument()
    })

    it('calls onDelete with card.id for prompt card', () => {
      const onDelete = vi.fn()
      renderModal({ card: promptCard, cards: [promptCard], onDelete })
      fireEvent.click(screen.getByText('删除'))
      expect(onDelete).toHaveBeenCalledWith('prompt-1')
    })
  })

  describe('copy', () => {
    it('copies prompt text on copy button click', async () => {
      const writeText = vi.fn(async () => {})
      Object.assign(navigator, { clipboard: { writeText } })
      renderModal()
      const promptEl = screen.getByText('a cat sitting on a mat')
      const copyBtn = promptEl.closest('div').querySelector('button')
      fireEvent.click(copyBtn)
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('a cat sitting on a mat'))
    })

    it('shows "已复制" feedback after copy', async () => {
      Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } })
      renderModal()
      const promptEl = screen.getByText('a cat sitting on a mat')
      const copyBtn = promptEl.closest('div').querySelector('button')
      fireEvent.click(copyBtn)
      await waitFor(() => expect(screen.getByText('已复制')).toBeInTheDocument())
    })
  })

  describe('download', () => {
    it('calls imageAPI.downloadBatch on download click', async () => {
      renderModal()
      fireEvent.click(screen.getByText('下载'))
      await waitFor(() => expect(downloadBatchMock).toHaveBeenCalledWith(['test.png']))
    })

    it('calls saveBlob after download', async () => {
      renderModal()
      fireEvent.click(screen.getByText('下载'))
      await waitFor(() => expect(saveBlobMock).toHaveBeenCalled())
    })

    it('shows alert on download error', async () => {
      downloadBatchMock.mockRejectedValueOnce(new Error('network error'))
      renderModal()
      fireEvent.click(screen.getByText('下载'))
      await waitFor(() => expect(alertMock).toHaveBeenCalledWith('network error'))
    })
  })

  describe('lightbox', () => {
    it('opens lightbox on media click', () => {
      const { container } = renderModal()
      const mediaArea = container.querySelector('[class*="md:w-3/5"]')
      fireEvent.click(mediaArea)
      const overlays = container.querySelectorAll('[class*="fixed"][class*="inset-0"]')
      expect(overlays.length).toBeGreaterThanOrEqual(2)
    })

    it('triggers history.back on lightbox backdrop click', () => {
      const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {})
      const { container } = renderModal()
      const mediaArea = container.querySelector('[class*="md:w-3/5"]')
      fireEvent.click(mediaArea)
      const overlays = container.querySelectorAll('[class*="fixed"][class*="inset-0"]')
      const lightbox = overlays[overlays.length - 1]
      fireEvent.click(lightbox)
      expect(backSpy).toHaveBeenCalled()
      backSpy.mockRestore()
    })

    it('displays full image in lightbox', () => {
      const { container } = renderModal()
      const mediaArea = container.querySelector('[class*="md:w-3/5"]')
      fireEvent.click(mediaArea)
      const lightboxImgs = container.querySelectorAll('img[src="/api/images/file/test.png"]')
      expect(lightboxImgs.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('prompt detail', () => {
    it('shows author and category info', () => {
      renderModal({ card: promptCard, cards: [promptCard] })
      expect(screen.getByText('testuser')).toBeInTheDocument()
      expect(screen.getByText('Landscape')).toBeInTheDocument()
    })

    it('shows created time', () => {
      renderModal({ card: promptCard, cards: [promptCard] })
      expect(screen.getByText('2025-01-01')).toBeInTheDocument()
    })

    it('does not show download button for prompt card', () => {
      renderModal({ card: promptCard, cards: [promptCard] })
      expect(screen.queryByText('下载')).not.toBeInTheDocument()
    })

    it('calls onDelete with card.id for prompt', () => {
      const onDelete = vi.fn()
      renderModal({ card: promptCard, cards: [promptCard], onDelete })
      fireEvent.click(screen.getByText('删除'))
      expect(onDelete).toHaveBeenCalledWith('prompt-1')
    })
  })

  describe('image detail with input_urls', () => {
    it('renders input images when present', () => {
      const cardWithInputs = {
        ...imageCard,
        _raw: {
          ...imageCard._raw,
          metadata: {
            ...imageCard._raw.metadata,
            input_urls: ['/api/prompts/image/input1.png', 'https://cdn.example.com/remote.png'],
          },
        },
      }
      renderModal({ card: cardWithInputs, cards: [cardWithInputs] })
      const allImgs = screen.getAllByRole('img')
      const srcs = allImgs.map(i => i.src)
      expect(srcs.some(s => s.includes('input1.png'))).toBe(true)
      expect(srcs.some(s => s.includes('remote.png'))).toBe(true)
    })
  })

  describe('touch navigation', () => {
    it('swipes right to go to previous card', () => {
      const onNavigate = vi.fn()
      renderModal({ cards, currentIndex: 1, card: cards[1], onNavigate })
      const { container } = render(<div />)
      const modalContent = document.querySelector('.rounded-2xl.overflow-hidden.max-w-5xl')
      fireEvent.touchStart(modalContent, { touches: [{ clientX: 100, clientY: 200 }] })
      fireEvent.touchMove(modalContent, { touches: [{ clientX: 200, clientY: 200 }] })
      fireEvent.touchEnd(modalContent, { changedTouches: [{ clientX: 200, clientY: 200 }] })
      expect(onNavigate).toHaveBeenCalledWith(0)
    })

    it('swipes left to go to next card', () => {
      const onNavigate = vi.fn()
      renderModal({ cards, currentIndex: 0, card: cards[0], onNavigate })
      const modalContent = document.querySelector('.rounded-2xl.overflow-hidden.max-w-5xl')
      fireEvent.touchStart(modalContent, { touches: [{ clientX: 200, clientY: 200 }] })
      fireEvent.touchMove(modalContent, { touches: [{ clientX: 100, clientY: 200 }] })
      fireEvent.touchEnd(modalContent, { changedTouches: [{ clientX: 100, clientY: 200 }] })
      expect(onNavigate).toHaveBeenCalledWith(1)
    })

    it('ignores short swipe', () => {
      const onNavigate = vi.fn()
      renderModal({ cards, currentIndex: 0, card: cards[0], onNavigate })
      const modalContent = document.querySelector('.rounded-2xl.overflow-hidden.max-w-5xl')
      fireEvent.touchStart(modalContent, { touches: [{ clientX: 200, clientY: 200 }] })
      fireEvent.touchMove(modalContent, { touches: [{ clientX: 210, clientY: 200 }] })
      fireEvent.touchEnd(modalContent, { changedTouches: [{ clientX: 210, clientY: 200 }] })
      expect(onNavigate).not.toHaveBeenCalled()
    })

    it('ignores vertical swipe', () => {
      const onNavigate = vi.fn()
      renderModal({ cards, currentIndex: 0, card: cards[0], onNavigate })
      const modalContent = document.querySelector('.rounded-2xl.overflow-hidden.max-w-5xl')
      fireEvent.touchStart(modalContent, { touches: [{ clientX: 200, clientY: 100 }] })
      fireEvent.touchMove(modalContent, { touches: [{ clientX: 200, clientY: 200 }] })
      fireEvent.touchEnd(modalContent, { changedTouches: [{ clientX: 200, clientY: 200 }] })
      expect(onNavigate).not.toHaveBeenCalled()
    })
  })
})
