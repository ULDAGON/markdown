import type { Element } from 'hast'
import { fromHtml } from 'hast-util-from-html'
import { defaultHandlers, toMdast, type Handle } from 'hast-util-to-mdast'
import type { Parent, Root } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkParse from 'remark-parse'
import remarkStringify, { type Options } from 'remark-stringify'
import { unified } from 'unified'
import { EXIT, visit } from 'unist-util-visit'

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath)

const handlers: Record<string, Handle> = {
  a: (state, node) => (hasClass(node, 'anchor') ? undefined : defaultHandlers.a(state, node)),
  sup(state, node) {
    const label = footnoteLabel(node)
    return label ? { type: 'footnoteReference', identifier: label, label } : state.all(node)
  },
  span(state, node) {
    if (hasClass(node, 'katex-display')) return { type: 'math', value: texOf(node) }
    if (hasClass(node, 'katex')) return { type: 'inlineMath', value: texOf(node) }
    return state.all(node)
  },
}

export function toMarkdown(html: string, original: string): string {
  // The editor types `&nbsp;` for spaces that HTML would otherwise collapse.
  const hast = fromHtml(html.replace(/&nbsp;|\u00a0/g, ' '), { fragment: true })
  const mdast = toMdast(hast, { handlers, newlines: true }) as Root
  visit(mdast, ['paragraph', 'heading', 'tableCell'] as const, dropTrailingBreak)
  return unified()
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkStringify, styleOf(original))
    .stringify(mdast)
    .trimEnd()
}

function hasClass(node: Element, name: string): boolean {
  const { className } = node.properties
  return Array.isArray(className) && className.includes(name)
}

/** `<sup><a href="#user-content-fn-label" data-footnote-ref>` gives `label`. */
function footnoteLabel(sup: Element): string | undefined {
  const link = sup.children.find((child) => child.type === 'element' && child.properties.dataFootnoteRef !== undefined)
  const href = link?.type === 'element' ? link.properties.href : undefined
  if (typeof href !== 'string' || !href.startsWith('#user-content-fn-')) return undefined
  return decodeURIComponent(href.slice('#user-content-fn-'.length))
}

function texOf(katex: Element): string {
  let tex = ''
  visit(katex, 'element', (node) => {
    if (node.tagName !== 'annotation' || node.properties.encoding !== 'application/x-tex') return
    tex = node.children.map((child) => (child.type === 'text' ? child.value : '')).join('')
    return EXIT
  })
  return tex
}

/** A `<br>` that the editor leaves at the end of a block would print as a stray `\`. */
function dropTrailingBreak(block: Parent) {
  let parent = block
  while (true) {
    const last = parent.children.at(-1)
    if (last?.type === 'break') parent.children.pop()
    else if (last && 'children' in last) parent = last
    else return
  }
}

/** Takes the markers that `original` uses, so an edit keeps the style of the source. */
function styleOf(original: string): Options {
  const style: Options = { bullet: '-', emphasis: '*', strong: '*', fence: '`', rule: '-', listItemIndent: 'one' }
  visit(parser.parse(original), (node) => {
    const start = node.position!.start.offset!
    const mark = original[start]
    if (node.type === 'emphasis') style.emphasis = mark as '*' | '_'
    if (node.type === 'strong') style.strong = mark as '*' | '_'
    if (node.type === 'thematicBreak') style.rule = mark as '*' | '-' | '_'
    if (node.type === 'heading' && mark !== '#') style.setext = true
    if (node.type === 'code' && (mark === '`' || mark === '~')) style.fence = mark
    if (node.type === 'list' && !node.ordered) style.bullet = mark as '*' | '+' | '-'
    if (node.type === 'list' && node.ordered) {
      style.bulletOrdered = original.slice(start).match(/^\d+([.)])/)?.[1] as '.' | ')'
    }
  })
  return style
}
