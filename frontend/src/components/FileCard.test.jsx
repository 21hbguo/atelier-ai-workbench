import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import FileCard, { formatFileSize } from './FileCard'
import { imageAPI } from '../api'
import * as downloadUtils from '../utils/download'

vi.mock('../api', () => ({ imageAPI: { getBlobByUrl: vi.fn() } }))
vi.mock('../utils/download', () => ({ saveBlob: vi.fn(), getDownloadFilename: vi.fn(() => 'download') }))

beforeEach(() => cleanup())

describe('formatFileSize', () => {
  it('formats bytes under 1024 as B', () => {
    expect(formatFileSize(512)).toBe('512 B')
  })

  it('formats under 1MB as KB with 1 decimal', () => {
    expect(formatFileSize(2048)).toBe('2.0 KB')
  })

  it('formats 1MB+ as MB with 1 decimal', () => {
    expect(formatFileSize(3 * 1024 * 1024)).toBe('3.0 MB')
    expect(formatFileSize(1536 * 1024)).toBe('1.5 MB')
  })
})

describe('FileCard', () => {
  const files = [
    { filename: '报告.pdf', url: '/api/files/report.pdf', size: 1536 * 1024, description: '季度报告' },
    { filename: 'data.csv', url: '/api/files/data.csv', size: 2048, description: '' },
  ]

  it('renders filename, size and description', () => {
    render(<FileCard files={files} />)
    expect(screen.getByText('报告.pdf')).toBeInTheDocument()
    expect(screen.getByText('1.5 MB')).toBeInTheDocument()
    expect(screen.getByText('季度报告')).toBeInTheDocument()
    expect(screen.getByText('data.csv')).toBeInTheDocument()
    expect(screen.getByText('2.0 KB')).toBeInTheDocument()
  })

  it('download button fetches blob via authed API and saves', async () => {
    imageAPI.getBlobByUrl.mockResolvedValue({ data: new Blob(['pdf']), headers: {} })
    downloadUtils.saveBlob.mockResolvedValue(true)
    render(<FileCard files={files} />)
    const buttons = screen.getAllByText('下载')
    expect(buttons.length).toBe(2)
    fireEvent.click(buttons[0])
    await waitFor(() => expect(imageAPI.getBlobByUrl).toHaveBeenCalledWith('/api/files/report.pdf'))
    await waitFor(() => expect(downloadUtils.saveBlob).toHaveBeenCalled())
    expect(screen.getByText('已保存')).toBeInTheDocument()
  })

  it('returns null when files is empty or undefined', () => {
    const { container } = render(<FileCard files={[]} />)
    expect(container.firstChild).toBeNull()
    const { container: c2 } = render(<FileCard files={undefined} />)
    expect(c2.firstChild).toBeNull()
    const { container: c3 } = render(<FileCard />)
    expect(c3.firstChild).toBeNull()
  })
})
