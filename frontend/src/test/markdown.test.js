import { describe, it, expect } from 'vitest'
import { mdToHtml } from '../utils/markdown'

describe('mdToHtml 公式渲染', () => {
  it('行内公式 $...$ 渲染为 KaTeX', () => {
    const html = mdToHtml('质能方程 $E=mc^2$ 很著名')
    expect(html).toContain('class="katex"')
  })

  it('块级公式 $$...$$ 渲染为 KaTeX display', () => {
    const html = mdToHtml('$$\n\\frac{a}{b}\n$$')
    expect(html).toContain('katex-display')
  })

  it('行内公式 \\(...\\) 渲染为 KaTeX', () => {
    const html = mdToHtml('质能方程 \\(E=mc^2\\) 很著名')
    expect(html).toContain('class="katex"')
  })

  it('块级公式 \\[...\\] 渲染为 KaTeX display', () => {
    const html = mdToHtml('\\[\n\\frac{a}{b}\n\\]')
    expect(html).toContain('katex-display')
  })

  it('\\(...\\) 内含 \\left( \\right) 不被误截断', () => {
    const html = mdToHtml('\\( \\left( \\frac{a}{b} \\right) \\)')
    expect(html).toContain('class="katex"')
  })

  it('未闭合的 \\( 保持原样', () => {
    const html = mdToHtml('半截公式 \\(E=mc^2')
    expect(html).not.toContain('class="katex"')
    expect(html).toContain('\\(E=mc^2')
  })

  it('公式包 katex-clickable 且带 data-latex 原文（点击复制）', () => {
    const html = mdToHtml('质能方程 $E=mc^2$')
    expect(html).toContain('class="katex-clickable"')
    expect(html).toContain('data-latex="E=mc^2"')
    expect(html).toContain('title="点击复制公式"')
  })

  it('块级公式 data-latex 保留多行内容', () => {
    const html = mdToHtml('$$\n\\frac{a}{b}\n$$')
    expect(html).toContain('katex-clickable katex-display')
    expect(html).toContain('data-latex="\\frac{a}{b}"')
  })

  it('data-latex 属性值做 HTML 转义（防注入）', () => {
    const html = mdToHtml('$a"b&c<d>$')
    expect(html).toContain('data-latex="a&quot;b&amp;c&lt;d&gt;"')
  })

  it('公式内特殊字符不被 markdown 规则破坏', () => {
    const html = mdToHtml('$x_i^*$')
    expect(html).toContain('class="katex"')
    expect(html).not.toContain('<em>')
    expect(html).not.toContain('<strong>')
  })

  it('货币 $5 不误判为公式', () => {
    const html = mdToHtml('花费 $5 and $6')
    expect(html).not.toContain('class="katex"')
    expect(html).toContain('$5 and $6')
  })

  it('非法公式回退显示原文（不抛异常）', () => {
    const html = mdToHtml('$\\frac{}$')
    expect(html).toContain('\\frac{}')
  })

  it('未闭合的 $ 保持原样', () => {
    const html = mdToHtml('半截公式 $E=mc^2')
    expect(html).not.toContain('class="katex"')
    expect(html).toContain('$E=mc^2')
  })

  it('公式与 markdown 混排（加粗 + 行内公式）', () => {
    const html = mdToHtml('**重点**：$a^2 + b^2 = c^2$')
    expect(html).toContain('<strong>重点</strong>')
    expect(html).toContain('class="katex"')
  })
})
