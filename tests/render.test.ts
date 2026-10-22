import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Element } from 'hast'
import { fromHtml } from 'hast-util-from-html'
import { render } from '../src/lib/markdown/render.ts'

function topLevel(html: string): Element[] {
  return fromHtml(html, { fragment: true }).children.filter((node) => node.type === 'element')
}

function find(node: Element, test: (element: Element) => boolean): Element | undefined {
  if (test(node)) return node
  for (const child of node.children) {
    const found = child.type === 'element' ? find(child, test) : undefined
    if (found) return found
  }
}

function hasClass(node: Element, name: string): boolean {
  return Array.isArray(node.properties.className) && node.properties.className.includes(name)
}

const source = [
  '# Title',
  'Text with a note[^n] and $x^2$.',
  '- one\n- two',
  '```js\nconst a = 1\n```',
  '```mermaid\ngraph A --> B<c>\n```',
  '$$\nE = mc^2\n$$',
  '<div onclick="steal()">raw<script>alert(1)</script><img src="x.png" onerror="alert(1)"></div>',
  '[^n]: The note.',
].join('\n\n')

const { html, blocks } = render(source)
const elements = topLevel(html)
const [heading, paragraph, list, code, diagram, math, raw, footnotes] = elements

test('offsets slice back to the source of each block', () => {
  assert.deepEqual(
    blocks.map(({ start, end }) => source.slice(start, end)),
    source.split('\n\n').slice(0, -1),
  )
  const marked = elements.filter((element) => element.properties.dataStart !== undefined)
  assert.deepEqual(
    marked.map((element) => ({ start: Number(element.properties.dataStart), end: Number(element.properties.dataEnd) })),
    blocks,
  )
})

test('code, math, Mermaid and raw HTML are rich blocks', () => {
  for (const block of [code, diagram, math, raw]) {
    assert.ok(block.properties.dataRich !== undefined, block.tagName)
    assert.equal(block.properties.contentEditable, 'false')
  }
  for (const block of [heading, paragraph, list]) assert.equal(block.properties.dataRich, undefined)
  assert.equal(code.tagName, 'pre')
  assert.ok(find(code, (node) => hasClass(node, 'hljs-keyword')))
  assert.ok(find(math, (node) => hasClass(node, 'katex-display')))
})

test('a Mermaid block is a diagram with its escaped source and no highlighting', () => {
  assert.equal(diagram.tagName, 'div')
  assert.ok(hasClass(diagram, 'diagram'))
  assert.match(html, /<div [^>]*class="diagram"[^>]*><pre>graph A --> B&#x3C;c>\n<\/pre><\/div>/)
})

test('footnote references link to the footnotes section, which is not editable', () => {
  const ref = find(paragraph, (node) => node.properties.dataFootnoteRef !== undefined)!
  const item = find(footnotes, (node) => node.tagName === 'li')!
  const backref = find(footnotes, (node) => node.properties.dataFootnoteBackref !== undefined)!
  assert.equal(ref.properties.href, '#user-content-fn-n')
  assert.equal(item.properties.id, 'user-content-fn-n')
  assert.equal(backref.properties.href, '#' + ref.properties.id)
  assert.equal(footnotes.tagName, 'section')
  assert.equal(footnotes.properties.contentEditable, 'false')
  assert.equal(footnotes.properties.dataStart, undefined)
})

test('headings get a non-editable anchor to their slug', () => {
  const anchor = heading.children.at(-1) as Element
  assert.equal(heading.properties.id, 'title')
  assert.equal(anchor.tagName, 'a')
  assert.ok(hasClass(anchor, 'anchor'))
  assert.equal(anchor.properties.href, '#title')
  assert.equal(anchor.properties.contentEditable, 'false')
  assert.equal(anchor.properties.ariaHidden, 'true')
})

test('raw HTML loses scripts and event handlers', () => {
  assert.doesNotMatch(html, /<script|alert|onerror|onclick|steal/)
  assert.ok(find(raw, (node) => node.tagName === 'img'))
})

test('inline math is not editable', () => {
  const katex = find(paragraph, (node) => hasClass(node, 'katex'))!
  assert.equal(katex.properties.contentEditable, 'false')
})
