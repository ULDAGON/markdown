import type { Element, Root, RootContent } from 'hast'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema, type Options as Schema } from 'rehype-sanitize'
import rehypeSlug from 'rehype-slug'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { SKIP, visit } from 'unist-util-visit'

export type Range = { start: number; end: number }

const schema: Schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    div: [...(defaultSchema.attributes?.div ?? []), ['className', 'diagram']],
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'dataStart', 'dataEnd', 'dataRich'],
  },
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkRehype, { allowDangerousHtml: true, clobberPrefix: '' })
  .use(markBlocks)
  .use(rehypeRaw)
  .use(rehypeSanitize, schema)
  .use(linkFootnotes)
  .use(rehypeSlug)
  .use(rehypeAutolinkHeadings, {
    behavior: 'append',
    properties: { className: ['anchor'], contentEditable: 'false', ariaHidden: 'true' },
    content: { type: 'text', value: '#' },
  })
  .use(rehypeKatex)
  .use(lockRichContent)
  .use(rehypeHighlight)
  .use(rehypeStringify)

export function render(markdown: string): { html: string; blocks: Range[] } {
  const tree = processor.runSync(processor.parse(markdown), markdown)
  const blocks = tree.children.filter(isBlock).map((node) => ({
    start: Number(node.properties.dataStart),
    end: Number(node.properties.dataEnd),
  }))
  return { html: processor.stringify(tree), blocks }
}

function isBlock(node: RootContent): node is Element {
  return node.type === 'element' && node.properties.dataStart !== undefined
}

/** Gives each top-level element the source range of its block and marks the rich blocks. */
function markBlocks() {
  return (tree: Root) => {
    tree.children = tree.children.map((node) => {
      if ((node.type !== 'element' && node.type !== 'raw') || !node.position) return node
      const range = { dataStart: node.position.start.offset, dataEnd: node.position.end.offset }
      // Raw HTML has no markdown form to edit, and it can expand to several elements.
      if (node.type === 'raw') return richBlock(range, [node])
      if (node.tagName !== 'pre') return { ...node, properties: { ...node.properties, ...range } }

      const code = node.children.find((child) => child.type === 'element')
      const language = code?.properties.className
      if (Array.isArray(language) && language.includes('language-mermaid')) {
        return richBlock({ ...range, className: ['diagram'] }, [{ ...node, children: code!.children }])
      }
      // KaTeX replaces the whole `pre` of display math, so the range goes on a wrapper.
      if (Array.isArray(language) && language.includes('language-math')) return richBlock(range, [node])
      return { ...node, properties: { ...node.properties, ...range, dataRich: true } }
    })
  }
}

function richBlock(properties: Element['properties'], children: Element['children']): Element {
  return { type: 'element', tagName: 'div', properties: { ...properties, dataRich: true }, children }
}

/**
 * remark-rehype runs without a clobber prefix, so sanitize adds `user-content-` to the
 * footnote ids exactly once. Sanitize leaves hrefs alone, so the links get the prefix here.
 */
function linkFootnotes() {
  return (tree: Root) => {
    visit(tree, 'element', (node) => {
      const { href, dataFootnoteRef, dataFootnoteBackref } = node.properties
      if (typeof href === 'string' && (dataFootnoteRef !== undefined || dataFootnoteBackref !== undefined)) {
        node.properties.href = '#user-content-' + href.slice(1)
      }
    })
  }
}

/** Rich blocks, math and the footnotes section are not editable as rich text. */
function lockRichContent() {
  return (tree: Root) => {
    visit(tree, 'element', (node) => {
      const { dataRich, dataFootnotes, className } = node.properties
      const isMath = Array.isArray(className) && className.includes('katex')
      if (dataRich === undefined && dataFootnotes === undefined && !isMath) return
      node.properties.contentEditable = 'false'
      return SKIP
    })
  }
}
