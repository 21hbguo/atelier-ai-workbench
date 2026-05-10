import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../api', () => ({
  imageAPI: { getBlobByUrl: vi.fn() },
}))

const { saveBlob, getDownloadFilename, downloadImageByUrl } = await import('../utils/download.js')
const { imageAPI } = await import('../api')

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('saveBlob', () => {
  let clickSpy, removeSpy, appendSpy

  beforeEach(() => {
    clickSpy = vi.fn()
    removeSpy = vi.fn()
    appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation(() => {})
    vi.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      download: '',
      style: {},
      click: clickSpy,
      remove: removeSpy,
    })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('creates object URL, triggers download, and cleans up', async () => {
    const blob = new Blob(['data'])
    const result = await saveBlob(blob, 'test.png')

    expect(URL.createObjectURL).toHaveBeenCalledWith(blob)
    expect(document.createElement).toHaveBeenCalledWith('a')
    expect(appendSpy).toHaveBeenCalled()
    expect(clickSpy).toHaveBeenCalled()
    expect(result).toBe(true)

    vi.runAllTimers()
    expect(removeSpy).toHaveBeenCalled()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })

  it('uses default filename when none provided', async () => {
    await saveBlob(new Blob())
    const anchor = document.createElement.mock.results[0].value
    expect(anchor.download).toBe('download')
  })

  it('revokes object URL even if download throws', async () => {
    clickSpy.mockImplementation(() => { throw new Error('click failed') })
    await expect(saveBlob(new Blob(), 'fail.png')).rejects.toThrow('click failed')

    vi.runAllTimers()
    expect(removeSpy).toHaveBeenCalled()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })

  it('can trigger sequential downloads repeatedly', async () => {
    await saveBlob(new Blob(['1']), 'first.png')
    await saveBlob(new Blob(['2']), 'second.png')
    expect(document.createElement).toHaveBeenCalledTimes(2)
    expect(clickSpy).toHaveBeenCalledTimes(2)
    vi.runAllTimers()
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
  })
})

describe('getDownloadFilename', () => {
  it('parses UTF-8 encoded filename', () => {
    const headers = { 'content-disposition': "attachment; filename=UTF-8''%E6%B5%8B%E8%AF%95.png" }
    expect(getDownloadFilename(headers, 'fallback.png')).toBe('测试.png')
  })

  it('parses quoted filename parameter', () => {
    const headers = { 'content-disposition': 'attachment; filename="photo.jpg"' }
    expect(getDownloadFilename(headers, 'fallback.png')).toBe('photo.jpg')
  })

  it('parses unquoted filename parameter', () => {
    const headers = { 'content-disposition': 'attachment; filename=photo.jpg' }
    expect(getDownloadFilename(headers, 'fallback.png')).toBe('photo.jpg')
  })

  it('prefers UTF-8 encoded filename over plain filename', () => {
    const headers = { 'content-disposition': "attachment; filename=\"plain.png\"; filename=UTF-8''utf8%E5%9B%BE.png" }
    expect(getDownloadFilename(headers, 'fallback.png')).toBe('utf8图.png')
  })

  it('returns fallback when header is missing', () => {
    expect(getDownloadFilename({}, 'fallback.png')).toBe('fallback.png')
  })

  it('returns fallback when headers is null', () => {
    expect(getDownloadFilename(null, 'fallback.png')).toBe('fallback.png')
  })

  it('returns fallback when headers is undefined', () => {
    expect(getDownloadFilename(undefined, 'fallback.png')).toBe('fallback.png')
  })

  it('returns fallback when content-disposition has no filename', () => {
    const headers = { 'content-disposition': 'attachment' }
    expect(getDownloadFilename(headers, 'fallback.png')).toBe('fallback.png')
  })

  it('works with Headers.get() interface', () => {
    const headers = new Headers({ 'content-disposition': 'attachment; filename="via-get.png"' })
    expect(getDownloadFilename(headers, 'fallback.png')).toBe('via-get.png')
  })

  it('returns fallback when both header forms are absent', () => {
    const headers = { 'other-header': 'value' }
    expect(getDownloadFilename(headers, 'img.png')).toBe('img.png')
  })
})

describe('downloadImageByUrl', () => {
  beforeEach(() => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      download: '',
      style: {},
      click: vi.fn(),
      remove: vi.fn(),
    })
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => {})
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('downloads image with filename from headers', async () => {
    imageAPI.getBlobByUrl.mockResolvedValue({
      data: new Blob(['img'], { type: 'image/png' }),
      headers: { 'content-disposition': 'attachment; filename="real.png"' },
    })

    await downloadImageByUrl('https://example.com/img')

    expect(imageAPI.getBlobByUrl).toHaveBeenCalledWith('https://example.com/img')
    const anchor = document.createElement.mock.results[0].value
    expect(anchor.download).toBe('real.png')
  })

  it('uses fallback name when headers have no content-disposition', async () => {
    imageAPI.getBlobByUrl.mockResolvedValue({
      data: new Blob(['img']),
      headers: {},
    })

    await downloadImageByUrl('https://example.com/img', 'custom.jpg')
    const anchor = document.createElement.mock.results[0].value
    expect(anchor.download).toBe('custom.jpg')
  })

  it('uses default fallback name image.png', async () => {
    imageAPI.getBlobByUrl.mockResolvedValue({
      data: new Blob(['img']),
      headers: {},
    })

    await downloadImageByUrl('https://example.com/img')
    const anchor = document.createElement.mock.results[0].value
    expect(anchor.download).toBe('image.png')
  })

  it('propagates fetch errors', async () => {
    imageAPI.getBlobByUrl.mockRejectedValue(new Error('network error'))
    await expect(downloadImageByUrl('https://bad.url')).rejects.toThrow('network error')
  })
})
