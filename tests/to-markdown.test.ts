import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fromHtml } from 'hast-util-from-html'
import rehypeStringify from 'rehype-stringify'
import { unified } from 'unified'
import { render } from '../src/lib/markdown/render.ts'
import { toMarkdown } from '../src/lib/markdown/to-markdown.ts'

const printer = unified().use(rehypeStringify)

/** The outerHTML of each top-level element, as the preview gives it. */
function topLevelHtml(html: string): string[] {
  return fromHtml(html, { fragment: true })
    .children.filter((node) => node.type === 'element')
    .map((element) => printer.stringify({ type: 'root', children: [element] }))
}

const fixture = [
  '# Heading',
  'A paragraph with **bold**, *italic*, ~~strike~~, `code`, a [link](https://example.com "Title"), a note[^1] and $x^2$.\nIt has a soft line break.',
  '- bullet one\n- bullet two\n  - nested',
  '1. first\n2. second',
  '- [ ] open task\n- [x] done task',
  '> A quote\n> on two lines.',
  '| Name | Value |\n| ---- | ----: |\n| a    |     1 |',
  '---',
  '```js\nconst a = 1\n```',
  '$$\nE = mc^2\n$$',
  '[^1]: The note.',
].join('\n\n')

test('every block of the fixture converts back to its own source', () => {
  const { html, blocks } = render(fixture)
  const elements = topLevelHtml(html)
  assert.equal(blocks.length, 10)
  blocks.forEach(({ start, end }, index) => {
    const original = fixture.slice(start, end)
    assert.equal(toMarkdown(elements[index], original), original)
  })
})

test('the elements that execCommand makes become markdown', () => {
  const html = '<div><b>bold</b> <i>italic</i> <strike>gone</strike> <s>too</s> <font color="red">red</font><span style="color: red">dish</span>&nbsp;end<br></div>'
  assert.equal(toMarkdown(html, ''), '**bold** *italic* ~~gone~~ ~~too~~ reddish end')
})

test('a break at the end of a block is dropped', () => {
  assert.equal(toMarkdown('<p><b>bold<br></b></p>', ''), '**bold**')
  assert.equal(toMarkdown('<p>one<br>two</p>', ''), 'one\\\ntwo')
})

test('the checked attribute is the state of a task', () => {
  const html = '<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" checked disabled> task</li></ul>'
  assert.equal(toMarkdown(html, '- [ ] task'), '- [x] task')
})

test('the markers of the original block stay', () => {
  const cases = [
    ['_x_ and __y__', '<p><em>x</em> and <strong>y</strong></p>'],
    ['* item', '<ul><li>item</li></ul>'],
    ['+ item', '<ul><li>item</li></ul>'],
    ['1) item', '<ol><li>item</li></ol>'],
    ['~~~\ncode\n~~~', '<pre><code>code\n</code></pre>'],
    ['***', '<hr>'],
    ['Title\n=====', '<h1>Title</h1>'],
  ]
  for (const [original, html] of cases) assert.equal(toMarkdown(html, original), original)
})

test('without an original block the defaults apply', () => {
  const html = '<ul><li><em>x</em> <strong>y</strong></li></ul><hr><pre><code>z\n</code></pre>'
  assert.equal(toMarkdown(html, ''), '- *x* **y**\n\n---\n\n```\nz\n```')
})
