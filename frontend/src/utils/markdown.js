// 安全的迷你 Markdown 渲染器（流式友好）。
// 设计：块级语法用【原始文本】匹配，内容在输出前才做 HTML 转义（防 XSS），
//       行内格式（代码/链接/图片/加粗/斜体）在转义后的文本上解析。
// 支持：```代码块（含语言标注）、`行内代码`、#~###### 标题、**加粗**、*斜体*、
//       - 无序列表（含缩进嵌套、- [x] 任务项）、1. 有序列表、> 引用、
//       [链接](url)（仅 http/https）、![图片](url)（仅 http/https）、
//       | 表格 |、--- 水平线、<url> 自动链接。
// 公式：$$...$$ / \[...\] 块级公式、$...$ / \(...\) 行内公式（KaTeX 渲染，解析失败回退原文）。

import katex from 'katex'
import 'katex/dist/katex.min.css'
// 语法高亮：按需注册常用语言（hljs 核心不带语言，registerLanguage 会同时注册各语言声明的别名，
// 如 js/ts/py/sh/html/md/c++ 等，用户写 ```js 也能命中 javascript）
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import bash from 'highlight.js/lib/languages/bash'
import json from 'highlight.js/lib/languages/json'
import css from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'
import markdown from 'highlight.js/lib/languages/markdown'
import sql from 'highlight.js/lib/languages/sql'
import java from 'highlight.js/lib/languages/java'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import cpp from 'highlight.js/lib/languages/cpp'
import c from 'highlight.js/lib/languages/c'

// 依赖 subLanguage（如 typescript/markdown 内嵌 xml、css）的语言放在依赖之后注册更稳妥
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('json', json)
hljs.registerLanguage('css', css)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('java', java)
hljs.registerLanguage('go', go)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('c', c)

// 代码块头部显示的语言名（友好短名；未收录则保持用户输入原样）
const LANG_LABELS = {
  javascript: 'js',
  typescript: 'ts',
  python: 'py',
  bash: 'sh',
  xml: 'html',
  markdown: 'md',
  cpp: 'cpp',
  c: 'c',
}

// 公式占位符（私用区字符 \uE000 几乎不可能出现在用户文本中，且不被转义/其他正则干扰）
const KATEX_RE = /\uE000K(\d+)\uE000/g

// 提取公式并替换为占位符，返回 { text, formulas }
function extractFormulas(text) {
  const formulas = []
  let out = text
  // 块级 $$...$$ 与 \[...\]（优先处理，避免内部 $ 被行内规则误配）
  out = out.replace(/\$\$([\s\S]+?)\$\$/g, (_, latex) => {
    const idx = formulas.length
    formulas.push({ latex: latex.trim(), display: true })
    return `\uE000K${idx}\uE000`
  })
  out = out.replace(/(^|[^\\])\\\[([\s\S]+?)\\\]/g, (m, pre, latex) => {
    const idx = formulas.length
    formulas.push({ latex: latex.trim(), display: true })
    return `${pre}\uE000K${idx}\uE000`
  })
  // 行内 $...$ 与 \(...\)（不含 $、换行；前导字符不能是字母数字/$，避免货币 "$5" 误判）
  out = out.replace(/(^|[^\w$])\$([^$\n]+?)\$(?!\w)/g, (m, pre, latex) => {
    const idx = formulas.length
    formulas.push({ latex: latex.trim(), display: false })
    return `${pre}\uE000K${idx}\uE000`
  })
  out = out.replace(/(^|[^\\])\\\(([\s\S]+?)\\\)/g, (m, pre, latex) => {
    const idx = formulas.length
    formulas.push({ latex: latex.trim(), display: false })
    return `${pre}\uE000K${idx}\uE000`
  })
  return { text: out, formulas }
}

// 把占位符还原为 KaTeX 渲染结果；解析失败回退 LaTeX 原文。
// 外层包 span.katex-clickable + data-latex 属性，供页面事件委托实现「点击复制公式」。
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// 代码块语法高亮：优先按指定语言（getLanguage 命中注册名/别名），未指定或未注册时自动检测；
// hljs.highlight 内部会转义输入，直接对围栏内【原始文本】调用；任何失败退回 escapeHtml 纯文本。
function highlightCode(code, lang) {
  try {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
    }
    return hljs.highlightAuto(code).value
  } catch {
    return escapeHtml(code)
  }
}

// KaTeX 渲染结果缓存：key = 公式原始字符串 + displayMode，命中直接复用，避免重复 renderToString
const KATEX_CACHE = new Map()
const KATEX_CACHE_MAX = 500
function renderKaTeX(latex, displayMode) {
  const key = (displayMode ? 'd:' : 'i:') + latex
  const cached = KATEX_CACHE.get(key)
  if (cached !== undefined) return cached
  const html = katex.renderToString(latex, { throwOnError: false, displayMode })
  // 简单容量限制：缓存超限时整体清空重建，防止无界增长
  if (KATEX_CACHE.size >= KATEX_CACHE_MAX) KATEX_CACHE.clear()
  KATEX_CACHE.set(key, html)
  return html
}

function restoreFormulas(html, formulas) {
  if (!formulas.length) return html
  return html.replace(KATEX_RE, (_, n) => {
    const f = formulas[Number(n)]
    if (!f) return ''
    try {
      const inner = renderKaTeX(f.latex, f.display)
      const cls = f.display ? 'katex-clickable katex-display' : 'katex-clickable'
      return `<span class="${cls}" data-latex="${escapeHtml(f.latex)}" title="点击复制公式">${inner}</span>`
    } catch {
      return f.latex
    }
  })
}

const SAFE_URL_RE = /^https?:\/\//i

// 行内 token：图片 | 双反引号代码 | 单反引号代码 | 链接 | 加粗 | 斜体（顺序即优先级）
const INLINE_RE = /(!\[[^\]\n]+\]\([^)\n]+\))|(``[^`\n]+``)|(`[^`\n]+`)|(\[[^\]\n]+\]\([^)\n]+\))|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)/g

function renderInline(text) {
  // 自动链接 <https://...> 先转成标准链接语法，再统一处理
  const normalized = String(text).replace(/<(https?:\/\/[^>\s]+)>/g, '[$1]($1)')
  const escaped = escapeHtml(normalized)
  let out = ''
  let last = 0
  let m
  INLINE_RE.lastIndex = 0
  while ((m = INLINE_RE.exec(escaped))) {
    out += escaped.slice(last, m.index)
    if (m[1] != null) {
      // 图片 ![alt](url)：允许 http/https 绝对地址与同源 / 相对路径（如图片接口 /api/images/file/xxx）
      const img = m[1].match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/)
      if (img && (SAFE_URL_RE.test(img[2]) || (img[2].startsWith('/') && !img[2].startsWith('//')))) {
        out += `<img src="${img[2]}" alt="${img[1]}" loading="lazy" />`
      } else {
        out += m[1]
      }
    } else if (m[2] != null) {
      // 双反引号行内代码
      out += `<code>${m[2].slice(2, -2)}</code>`
    } else if (m[3] != null) {
      // 行内代码
      out += `<code>${m[3].slice(1, -1)}</code>`
    } else if (m[4] != null) {
      // 链接：href 仅允许 http/https
      const link = m[4].match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)
      if (link) {
        const label = link[1]
        const href = SAFE_URL_RE.test(link[2]) ? link[2] : ''
        out += href
          ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`
          : label
      } else {
        out += m[4]
      }
    } else if (m[5] != null) {
      out += `<strong>${m[5].slice(2, -2)}</strong>`
    } else if (m[6] != null) {
      out += `<em>${m[6].slice(1, -1)}</em>`
    }
    last = m.index + m[0].length
  }
  out += escaped.slice(last)
  return out
}

// 表格分隔行：形如 | --- | :---: | ---: |
function isTableSeparator(line) {
  const s = line.trim()
  if (!s.startsWith('|')) return false
  const inner = s.replace(/^\|/, '').replace(/\|$/, '').trim()
  if (!inner.includes('-')) return false
  return inner.split('|').every(seg => /^:?-+:?$/.test(seg.trim()))
}

function splitTableCells(row) {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
}

// ---------- 列表（支持缩进嵌套 + 任务项） ----------

const UL_RE = /^(\s*)[-*]\s+(.*)$/
const OL_RE = /^(\s*)\d+\.\s+(.*)$/

function parseTask(content) {
  const m = String(content).match(/^\[([ xX])\]\s+(.*)$/)
  if (!m) return { content, task: null }
  // task: null=非任务项, false=未勾选, true=已勾选
  return { content: m[2], task: m[1].toLowerCase() === 'x' }
}

function buildListTree(items) {
  const root = { indent: -1, children: [] }
  const stack = [root]
  for (const item of items) {
    const node = { ...item, children: [] }
    while (stack.length > 1 && stack[stack.length - 1].indent >= item.indent) stack.pop()
    stack[stack.length - 1].children.push(node)
    stack.push(node)
  }
  return root.children
}

function renderListNodes(nodes) {
  if (!nodes.length) return ''
  let html = ''
  let i = 0
  while (i < nodes.length) {
    const ordered = nodes[i].ordered
    const tag = ordered ? 'ol' : 'ul'
    const items = []
    while (i < nodes.length && nodes[i].ordered === ordered) {
      const node = nodes[i]
      const { content, task } = parseTask(node.content)
      const inner = task !== null
        ? `<input type="checkbox" disabled ${task ? 'checked' : ''} /> ${renderInline(content)}`
        : renderInline(content)
      const childHtml = renderListNodes(node.children)
      items.push(`<li>${inner}${childHtml}</li>`)
      i++
    }
    html += `<${tag}>${items.join('')}</${tag}>`
  }
  return html
}

// 收集从 i 开始的连续列表行（允许缩进），返回 { nodes, nextIndex }
function collectList(lines, i) {
  const nodes = []
  while (i < lines.length) {
    const ul = lines[i].match(UL_RE)
    const ol = lines[i].match(OL_RE)
    if (!ul && !ol) break
    nodes.push({
      indent: (ul || ol)[1].length,
      content: (ul || ol)[2],
      ordered: !!ol,
    })
    i++
  }
  return { nodes, nextIndex: i }
}

// ---------- 主渲染 ----------

export function mdToHtml(text) {
  if (typeof text !== 'string' || !text.trim()) return ''
  const { text: safeText, formulas } = extractFormulas(text)
  const lines = safeText.split('\n')
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // 代码块（含语言标注）
    const fence = line.match(/^```([\w+-]*)\s*$/)
    if (fence) {
      const rawLang = fence[1]
      const buf = []
      let closed = false
      i++
      while (i < lines.length) {
        if (/^```\s*$/.test(lines[i])) { closed = true; i++; break }
        buf.push(lines[i])
        i++
      }
      if (closed) {
        // 围栏内提取原始文本 → hljs 高亮（内部自转义）→ 输出；失败则退回 escapeHtml 纯文本
        const code = buf.join('\n')
        const label = rawLang ? (LANG_LABELS[rawLang.toLowerCase()] || rawLang) : ''
        const langAttr = rawLang ? ` language-${rawLang}` : ''
        out.push(
          `<pre class="md-code-block"><div class="md-code-header"><span class="md-code-lang">${escapeHtml(label)}</span><span class="md-code-actions"><button type="button" class="md-copy-btn">复制</button><button type="button" class="md-download-btn">下载</button></span></div><code class="hljs${langAttr}">${highlightCode(code, rawLang)}</code></pre>`
        )
        continue
      }
      // 未闭合（流式输出中间态）：按普通文本渲染，避免吞掉后续内容
      const rest = buf.length ? '<br/>' + buf.map(l => renderInline(l)).join('<br/>') : ''
      out.push(`<p>${renderInline(line)}${rest}</p>`)
      continue
    }

    // 表格：当前行为表头且下一行是分隔行
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const rows = []
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(lines[i]); i++ }
      if (rows.length >= 2) {
        let html = '<table><thead><tr>'
        for (const c of splitTableCells(rows[0])) html += `<th>${renderInline(c)}</th>`
        html += '</tr></thead><tbody>'
        for (let r = 2; r < rows.length; r++) {
          html += '<tr>'
          for (const c of splitTableCells(rows[r])) html += `<td>${renderInline(c)}</td>`
          html += '</tr>'
        }
        html += '</tbody></table>'
        out.push(
          `<div class="md-table-wrap"><div class="md-table-actions"><button type="button" class="md-table-copy-btn">复制</button><button type="button" class="md-table-download-btn">下载</button></div>${html}</div>`
        )
        continue
      }
    }

    // 标题 # ~ ######
    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      const level = heading[1].length
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`)
      i++
      continue
    }

    // 引用（连续多行合并）
    if (line.trim().startsWith('>')) {
      const buf = []
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        buf.push(lines[i].trim().replace(/^>\s?/, ''))
        i++
      }
      out.push(`<blockquote>${buf.map(l => renderInline(l)).join('<br/>')}</blockquote>`)
      continue
    }

    // 无序列表 / 有序列表（含缩进嵌套、任务项）
    if (UL_RE.test(line) || OL_RE.test(line)) {
      const { nodes, nextIndex } = collectList(lines, i)
      i = nextIndex
      out.push(renderListNodes(buildListTree(nodes)))
      continue
    }

    // 水平线 --- / *** / ___
    if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      out.push('<hr />')
      i++
      continue
    }

    // 空行
    if (!line.trim()) { i++; continue }

    // 普通段落：合并连续非空、非块级起始的行
    const buf = []
    while (i < lines.length) {
      const l = lines[i]
      if (!l.trim() || /^```/.test(l) || /^#{1,6}\s+/.test(l) || l.trim().startsWith('>')
        || UL_RE.test(l) || OL_RE.test(l) || /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(l)
        || (l.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1]))) break
      buf.push(l)
      i++
    }
    out.push(`<p>${buf.map(l => renderInline(l)).join('<br/>')}</p>`)
  }
  return restoreFormulas(out.join('\n'), formulas)
}

export default mdToHtml
