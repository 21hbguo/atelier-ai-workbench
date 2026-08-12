import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import WidgetViewer, { sanitizeSvg } from './WidgetViewer'

beforeEach(() => cleanup())

describe('sanitizeSvg', () => {
  it('strips <script> tags', () => {
    const out = sanitizeSvg('<svg><script>alert(1)</script><rect/></svg>')
    expect(out).not.toMatch(/script/i)
    expect(out).toContain('<rect')
  })

  it('strips on* event attributes', () => {
    const out = sanitizeSvg('<svg><rect onclick="alert(1)" onload="evil()" fill="red"/></svg>')
    expect(out).not.toMatch(/onclick/i)
    expect(out).not.toMatch(/onload/i)
    expect(out).toContain('fill="red"')
  })

  it('strips javascript: protocol', () => {
    const out = sanitizeSvg('<svg><a href="javascript:alert(1)">x</a></svg>')
    expect(out).not.toMatch(/javascript/i)
  })

  it('strips case-mixed dangerous tags', () => {
    const out = sanitizeSvg('<svg><Script>bad()</Script><foreignObject><div/></foreignObject></svg>')
    expect(out).not.toMatch(/script/i)
    expect(out).not.toMatch(/foreignobject/i)
  })
})

describe('WidgetViewer', () => {
  it('renders svg element for a valid svg widget', () => {
    const { container } = render(
      <WidgetViewer widgets={[{ kind: 'svg', title: '流程图', code: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/></svg>' }]} />
    )
    expect(container.querySelector('.widget-svg svg')).toBeTruthy()
    expect(screen.getByText('流程图')).toBeInTheDocument()
    expect(screen.getByText('下载 SVG')).toBeInTheDocument()
  })

  it('returns null when widgets is empty', () => {
    const { container } = render(<WidgetViewer widgets={[]} />)
    expect(container.firstChild).toBeNull()
    const { container: c2 } = render(<WidgetViewer widgets={null} />)
    expect(c2.firstChild).toBeNull()
  })

  it('renders sandboxed iframe for html widget (allow-scripts, no allow-same-origin)', () => {
    const { container } = render(
      <WidgetViewer widgets={[{ kind: 'html', title: '页面原型', code: '<p>hello</p>' }]} />
    )
    const iframe = container.querySelector('iframe')
    expect(iframe).toBeTruthy()
    const sandbox = iframe.getAttribute('sandbox') || ''
    expect(sandbox).toContain('allow-scripts')
    expect(sandbox).not.toContain('allow-same-origin')
    expect(iframe.getAttribute('srcdoc')).toBe('<p>hello</p>')
    expect(screen.getByText('下载 HTML')).toBeInTheDocument()
  })

  it('renders multiple widgets with mb-3 separators', () => {
    const { container } = render(
      <WidgetViewer widgets={[
        { kind: 'svg', title: 'A', code: '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>' },
        { kind: 'html', title: 'B', code: '<p>b</p>' },
      ]} />
    )
    expect(container.querySelectorAll('iframe').length).toBe(1)
    expect(container.querySelectorAll('.widget-svg svg').length).toBe(1)
  })
})
