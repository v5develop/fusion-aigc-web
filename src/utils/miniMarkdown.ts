/**
 * 轻量安全 Markdown：零依赖。先整体转义 HTML，再只生成白名单标签
 * （p/br/strong/em/code/pre/ul/ol/li/a）。支持流式半截文本：没闭合的 ** / ` / 链接保持原样，
 * 未闭合的 ``` 代码块按「直到文末」渲染。
 */
import './miniMarkdown.css'

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c] ?? c)

function inline(raw: string): string {
  // 原文里的 \u0000 会伪造占位符（把别处的 stash 内容复制过来），先剔掉
  let s = esc(raw.replace(/\u0000/g, ''))
  const stash: string[] = []
  const hold = (html: string) => `\u0000${stash.push(html) - 1}\u0000`
  s = s.replace(/`([^`\n]+)`/g, (_, c) => hold(`<code>${c}</code>`))
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t, u) =>
    hold(`<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`),
  )
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?![*\w])/g, '$1<em>$2</em>')
  // 占位符可嵌套（链接文字里的行内代码），循环还原到没有占位符为止；
  // 还原后的内容已是转义后的 HTML，不会凭空产生新的 \u0000，循环必然收敛（再加次数上限兜底）
  for (let n = 0; n < 8 && s.includes('\u0000'); n++) {
    s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[Number(i)] ?? '')
  }
  return s
}

export function renderMiniMarkdown(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let para: string[] = []
  let list: { tag: 'ul' | 'ol'; items: string[] } | null = null
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`)
    para = []
  }
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`)
    list = null
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (/^\s*```/.test(line)) {
      flushPara()
      flushList()
      const code: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i] ?? '')) code.push(lines[i++] ?? '')
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`)
      continue
    }
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line)
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (ul || ol) {
      flushPara()
      const tag = ul ? 'ul' : 'ol'
      if (list && list.tag !== tag) flushList()
      if (!list) list = { tag, items: [] }
      list.items.push((ul ?? ol)?.[1] ?? '')
      continue
    }
    if (!line.trim()) {
      flushPara()
      flushList()
      continue
    }
    flushList()
    para.push(line)
  }
  flushPara()
  flushList()
  return out.join('')
}
