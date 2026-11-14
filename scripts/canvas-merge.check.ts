/**
 * 画布三方合并的纯函数检查（仓库没有测试框架：直接 `node scripts/canvas-merge.check.ts` 跑，退出码非 0 = 有失败）。
 *
 * 覆盖：单方改动自动采纳、不同字段各取所改、同字段同值、同字段不同值冲突（默认我的 / 选对方）、
 * 删除 vs 修改（双向）、双方都删、双方新增、运行态键不冲突且取对方、连线合并与悬空 / 重复连线丢弃、标题、base 缺失退化。
 */
import assert from 'node:assert/strict'
import {
  changedNodeIdsBetween,
  mergeCanvas,
  previewValue,
  rebaseOntoRemote,
  singleSlotOf,
  type IMergeDoc,
} from '../src/views/canvas/editor/merge.ts'
import type { CanvasEditorEdge, CanvasEditorNode } from '../src/views/canvas/editor/types.ts'

const RUNTIME = new Set(['status', 'progress', 'candidates', 'runId', 'requestId'])
const isRuntimeKey = (node: CanvasEditorNode, key: string) =>
  RUNTIME.has(key) || (node.type === 'model' && key === 'image')

function node(
  id: string,
  data: Record<string, unknown>,
  x = 0,
  y = 0,
  type: CanvasEditorNode['type'] = 'text',
): CanvasEditorNode {
  return { id, type, position: { x, y }, data: { title: id, ...data } } as CanvasEditorNode
}
function edge(id: string, source: string, target: string, targetHandle = 'prompt'): CanvasEditorEdge {
  return { id, source, target, sourceHandle: 'text', targetHandle, type: 'canvas-bezier', data: { color: '#000' } }
}
function doc(nodes: CanvasEditorNode[], edges: CanvasEditorEdge[] = [], title = '画布'): IMergeDoc {
  return { title, nodes, edges }
}
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const byId = (d: IMergeDoc, id: string) => d.nodes.find((n) => n.id === id)

let passed = 0
function check(name: string, fn: () => void) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (err) {
    console.error(`  FAIL ${name}`)
    throw err
  }
}

const base = doc(
  [
    node('a', { text: 'A' }, 0, 0),
    node('b', { text: 'B' }, 100, 0),
    node('m', { prompt: 'p0', ratio: '1:1' }, 200, 0, 'model'),
  ],
  [edge('e1', 'a', 'm')],
)

check('只有对方改：自动采纳，无冲突，高亮对方改的节点', () => {
  const ours = clone(base)
  const theirs = clone(base)
  byId(theirs, 'b')!.data.text = 'B2'
  const r = mergeCanvas(base, ours, theirs, { isRuntimeKey })
  assert.equal(r.conflicts.length, 0)
  assert.equal(byId(r.doc, 'b')!.data.text, 'B2')
  assert.deepEqual(r.theirsNodeIds, ['b'])
  assert.equal(r.autoApplied, 1)
})

check('同一节点不同字段：各取所改', () => {
  const ours = clone(base)
  const theirs = clone(base)
  byId(ours, 'm')!.data.prompt = 'mine'
  byId(theirs, 'm')!.data.ratio = '16:9'
  byId(theirs, 'm')!.position = { x: 500, y: 50 }
  const r = mergeCanvas(base, ours, theirs, { isRuntimeKey })
  assert.equal(r.conflicts.length, 0)
  const m = byId(r.doc, 'm')!
  assert.equal(m.data.prompt, 'mine')
  assert.equal(m.data.ratio, '16:9')
  assert.deepEqual(m.position, { x: 500, y: 50 })
})

check('同字段改成同一个值：不算冲突', () => {
  const ours = clone(base)
  const theirs = clone(base)
  byId(ours, 'a')!.data.text = 'same'
  byId(theirs, 'a')!.data.text = 'same'
  const r = mergeCanvas(base, ours, theirs, { isRuntimeKey })
  assert.equal(r.conflicts.length, 0)
  assert.equal(byId(r.doc, 'a')!.data.text, 'same')
})

check('同字段不同值：冲突，默认保留我的；选对方后取对方', () => {
  const ours = clone(base)
  const theirs = clone(base)
  byId(ours, 'm')!.data.prompt = 'mine'
  byId(theirs, 'm')!.data.prompt = 'agent'
  const r = mergeCanvas(base, ours, theirs, { isRuntimeKey })
  assert.equal(r.conflicts.length, 1)
  assert.equal(r.conflicts[0]!.key, 'node:m:data.prompt')
  assert.equal(r.conflicts[0]!.kind, 'modify')
  assert.equal(byId(r.doc, 'm')!.data.prompt, 'mine')
  const r2 = mergeCanvas(base, ours, theirs, { isRuntimeKey, choices: { 'node:m:data.prompt': 'theirs' } })
  assert.equal(r2.conflicts.length, 0)
  assert.equal(byId(r2.doc, 'm')!.data.prompt, 'agent')
  assert.ok(r2.theirsNodeIds.includes('m'))
})

check('位置双方都动：冲突（position 作为一个字段）', () => {
  const ours = clone(base)
  const theirs = clone(base)
  byId(ours, 'a')!.position = { x: 10, y: 10 }
  byId(theirs, 'a')!.position = { x: 20, y: 20 }
  const r = mergeCanvas(base, ours, theirs, { isRuntimeKey })
  assert.deepEqual(
    r.conflicts.map((c) => c.field),
    ['position'],
  )
  assert.equal(previewValue(r.conflicts[0]!.theirs, 'position'), '(20, 20)')
})

check('我删了、对方改了：冲突 delete-ours；默认保持删除，选对方恢复', () => {
  const ours = clone(base)
  ours.nodes = ours.nodes.filter((n) => n.id !== 'b')
  const theirs = clone(base)
  byId(theirs, 'b')!.data.text = 'agent edit'
  const r = mergeCanvas(base, ours, theirs, { isRuntimeKey })
  assert.equal(r.conflicts.length, 1)
  assert.equal(r.conflicts[0]!.kind, 'delete-ours')
  assert.equal(byId(r.doc, 'b'), undefined)
  const r2 = mergeCanvas(base, ours, theirs, { isRuntimeKey, choices: { 'node:b:@exist': 'theirs' } })
  assert.equal(byId(r2.doc, 'b')!.data.text, 'agent edit')
})

check('对方删了、我改了：冲突 delete-theirs；默认保留我的，选对方删除', () => {
  const ours = clone(base)
  byId(ours, 'a')!.data.text = 'mine'
  const theirs = clone(base)
  theirs.nodes = theirs.nodes.filter((n) => n.id !== 'a')
  theirs.edges = []
  const r = mergeCanvas(base, ours, theirs, { isRuntimeKey })
  assert.deepEqual(
    r.conflicts.map((c) => c.kind),
    ['delete-theirs'],
  )
  assert.equal(byId(r.doc, 'a')!.data.text, 'mine')
  // 连线 e1 对方删了、我没改：跟着删
  assert.equal(r.doc.edges.length, 0)
  const r2 = mergeCanvas(base, ours, theirs, { isRuntimeKey, choices: { 'node:a:@exist': 'theirs' } })
  assert.equal(byId(r2.doc, 'a'), undefined)
})

check('对方删了、我没改：跟着删，连带悬空连线丢弃', () => {
  const ours = clone(base)
  const theirs = clone(base)
  theirs.nodes = theirs.nodes.filter((n) => n.id !== 'a')
  const r = mergeCanvas(base, ours, theirs, { isRuntimeKey })
  assert.equal(r.conflicts.length, 0)
  assert.equal(byId(r.doc, 'a'), undefined)
  assert.equal(r.doc.edges.length, 0)
  assert.deepEqual(r.droppedEdgeIds, ['e1'])
})

check('双方都删：删除，无冲突', () => {
  const ours = clone(base)
  const theirs = clone(base)
  ours.nodes = ours.nodes.filter((n) => n.id !== 'b')
  theirs.nodes = theirs.nodes.filter((n) => n.id !== 'b')
  const r = mergeCanvas(base, ours, theirs, { isRuntimeKey })
  assert.equal(r.conflicts.length, 0)
  assert.equal(byId(r.doc, 'b'), undefined)
})

check('双方各自新增节点与连线：都保留，对方新增排在后面并高亮', () => {
  const ours = clone(base)
  ours.nodes.push(node('x', { text: 'mine new' }))
  const theirs = clone(base)
  theirs.nodes.push(node('y', { text: 'agent new' }), node('z', { prompt: '' }, 0, 0, 'model'))
  theirs.edges.push(edge('e2', 'y', 'z'))
  const r = mergeCanvas(base, ours, theirs, { isRuntimeKey })
  assert.equal(r.conflicts.length, 0)
  assert.deepEqual(
    r.doc.nodes.map((n) => n.id),
    ['a', 'b', 'm', 'x', 'y', 'z'],
  )
  assert.deepEqual(
    r.doc.edges.map((e) => e.id),
    ['e1', 'e2'],
  )
  assert.deepEqual(r.theirsNodeIds.sort(), ['y', 'z'])
})

check('运行态键不冲突、取对方；模型节点的 image 视为成品', () => {
  const ours = clone(base)
  const theirs = clone(base)
  Object.assign(byId(ours, 'm')!.data, { status: 'running', progress: 10, image: 'old.png' })
  Object.assign(byId(theirs, 'm')!.data, { status: 'done', progress: 100, image: 'new.png' })
  const r = mergeCanvas(base, ours, theirs, { isRuntimeKey })
  assert.equal(r.conflicts.length, 0)
  const m = byId(r.doc, 'm')!
  assert.equal(m.data.status, 'done')
  assert.equal(m.data.image, 'new.png')
  // 运行态变化不算对方改动
  assert.deepEqual(r.theirsNodeIds, [])
})

check('连线删除 vs 修改：冲突；重复连线去重', () => {
  const ours = clone(base)
  ours.edges = []
  const theirs = clone(base)
  theirs.edges[0]!.targetHandle = 'image'
  const r = mergeCanvas(base, ours, theirs, { isRuntimeKey })
  assert.deepEqual(
    r.conflicts.map((c) => c.key),
    ['edge:e1:@exist'],
  )
  assert.equal(r.doc.edges.length, 0)
  // 双方各加了一条一模一样的线（id 不同）：只留一条
  const o2 = clone(base)
  o2.edges.push(edge('eo', 'b', 'm'))
  const t2 = clone(base)
  t2.edges.push(edge('et', 'b', 'm'))
  const r2 = mergeCanvas(base, o2, t2, { isRuntimeKey })
  assert.deepEqual(
    r2.doc.edges.map((e) => e.id),
    ['e1', 'eo'],
  )
  assert.deepEqual(r2.droppedEdgeIds, ['et'])
})

check('标题：单方改采纳，双方不同冲突', () => {
  const ours = clone(base)
  const theirs = clone(base)
  theirs.title = '新标题'
  assert.equal(mergeCanvas(base, ours, theirs).doc.title, '新标题')
  ours.title = '我的标题'
  const r = mergeCanvas(base, ours, theirs)
  assert.deepEqual(
    r.conflicts.map((c) => c.key),
    ['title'],
  )
  assert.equal(r.doc.title, '我的标题')
})

check('data 键被一方删除：按改动处理', () => {
  const ours = clone(base)
  const theirs = clone(base)
  delete (byId(theirs, 'm')!.data as unknown as Record<string, unknown>).ratio
  const r = mergeCanvas(base, ours, theirs, { isRuntimeKey })
  assert.equal(r.conflicts.length, 0)
  assert.equal(byId(r.doc, 'm')!.data.ratio, undefined)
})

check('base 缺失：双方不同即冲突、单方存在即保留', () => {
  const ours = clone(base)
  const theirs = clone(base)
  byId(theirs, 'a')!.data.text = 'agent'
  theirs.nodes.push(node('n', {}))
  const r = mergeCanvas(null, ours, theirs, { isRuntimeKey })
  assert.deepEqual(
    r.conflicts.map((c) => c.key),
    ['node:a:data.text'],
  )
  assert.ok(byId(r.doc, 'n'))
})

check('键序不同不算改动；changedNodeIdsBetween 只报真实变化', () => {
  const ours = clone(base)
  const theirs = clone(base)
  const m = byId(theirs, 'm')!
  m.data = { ratio: '1:1', prompt: 'p0', title: 'm' } as CanvasEditorNode['data']
  const r = mergeCanvas(base, ours, theirs, { isRuntimeKey })
  assert.equal(r.conflicts.length, 0)
  assert.equal(r.autoApplied, 0)
  byId(theirs, 'a')!.data.text = 'x'
  Object.assign(byId(theirs, 'b')!.data, { status: 'running' })
  assert.deepEqual(changedNodeIdsBetween(base, theirs, isRuntimeKey), ['a'])
})

check('输入不被改写（纯函数）', () => {
  const ours = clone(base)
  const theirs = clone(base)
  byId(theirs, 'a')!.data.text = 'z'
  const snapshot = JSON.stringify([base, ours, theirs])
  const r = mergeCanvas(base, ours, theirs, { isRuntimeKey })
  byId(r.doc, 'a')!.data.text = 'mutated'
  assert.equal(JSON.stringify([base, ours, theirs]), snapshot)
})

// ---------------- 单槽输入口 ----------------

const slotBase = doc(
  [
    node('t1', { text: 'T1' }),
    node('t2', { text: 'T2' }),
    node('i1', {}, 0, 100, 'image'),
    node('i2', {}, 0, 200, 'image'),
    node('v', { kind: 'video', maxImageRefs: 5 }, 300, 0, 'model'),
  ],
  [],
)

check('singleSlotOf：提示词 / 首尾帧是单槽，参考图（模型节点）不是', () => {
  const v = byId(slotBase, 'v')
  assert.equal(singleSlotOf(v, 'prompt'), 'prompt')
  assert.equal(singleSlotOf(v, 'image1'), 'image1')
  assert.equal(singleSlotOf(v, 'image2'), 'image2')
  assert.equal(singleSlotOf(v, 'image'), null)
  assert.equal(singleSlotOf(byId(slotBase, 't1'), 'prompt'), null)
})

check('单槽口：双方各接一条提示词线 → 保留我的，对方的记为冲突', () => {
  const ours = clone(slotBase)
  const theirs = clone(slotBase)
  ours.edges.push(edge('eo', 't1', 'v', 'prompt'))
  theirs.edges.push(edge('et', 't2', 'v', 'prompt'))
  const r = mergeCanvas(slotBase, ours, theirs, { isRuntimeKey })
  assert.deepEqual(r.doc.edges.map((e) => e.id), ['eo'])
  assert.equal(r.conflicts.length, 1)
  assert.equal(r.conflicts[0]!.key, 'edge:et:@slot')
  assert.equal(r.conflicts[0]!.kind, 'slot-full')
  assert.ok(r.droppedEdgeIds.includes('et'))
  // 选对方：对方的留下、我在这个口的线移除，冲突消失
  const r2 = mergeCanvas(slotBase, ours, theirs, { isRuntimeKey, choices: { 'edge:et:@slot': 'theirs' } })
  assert.deepEqual(r2.doc.edges.map((e) => e.id), ['et'])
  assert.equal(r2.conflicts.length, 0)
  // 选我的：与默认一致
  const r3 = mergeCanvas(slotBase, ours, theirs, { isRuntimeKey, choices: { 'edge:et:@slot': 'ours' } })
  assert.deepEqual(r3.doc.edges.map((e) => e.id), ['eo'])
  assert.equal(r3.conflicts.length, 0)
})

check('单槽口：首帧 / 尾帧各算一个口；不同口、不同节点不冲突', () => {
  const ours = clone(slotBase)
  const theirs = clone(slotBase)
  ours.edges.push(edge('eo', 'i1', 'v', 'image1'))
  theirs.edges.push(edge('et', 'i2', 'v', 'image2'))
  const r = mergeCanvas(slotBase, ours, theirs, { isRuntimeKey })
  assert.equal(r.conflicts.length, 0)
  assert.equal(r.doc.edges.length, 2)
  const ours2 = clone(slotBase)
  const theirs2 = clone(slotBase)
  ours2.edges.push(edge('eo', 'i1', 'v', 'image1'))
  theirs2.edges.push(edge('et', 'i2', 'v', 'image1'))
  const r2 = mergeCanvas(slotBase, ours2, theirs2, { isRuntimeKey })
  assert.equal(r2.conflicts[0]?.key, 'edge:et:@slot')
})

check('单槽口：参考图口（多容量）合并后多条入线不报冲突；对方单独接线无冲突', () => {
  const ours = clone(slotBase)
  const theirs = clone(slotBase)
  ours.edges.push(edge('eo', 'i1', 'v', 'image'))
  theirs.edges.push(edge('et', 'i2', 'v', 'image'))
  const r = mergeCanvas(slotBase, ours, theirs, { isRuntimeKey })
  assert.equal(r.conflicts.length, 0)
  assert.equal(r.doc.edges.length, 2)
  const only = clone(slotBase)
  only.edges.push(edge('et', 't2', 'v', 'prompt'))
  const r2 = mergeCanvas(slotBase, clone(slotBase), only, { isRuntimeKey })
  assert.equal(r2.conflicts.length, 0)
  assert.equal(r2.doc.edges.length, 1)
})

check('单槽口：对方把已有连线改接到我已占的口 → 同样冲突，我的保留', () => {
  const b = doc(slotBase.nodes, [edge('eo', 't1', 'v', 'prompt'), edge('ex', 't2', 'v', 'image')])
  const ours = clone(b)
  const theirs = clone(b)
  theirs.edges.find((e) => e.id === 'ex')!.targetHandle = 'prompt'
  const r = mergeCanvas(b, ours, theirs, { isRuntimeKey })
  assert.deepEqual(r.conflicts.map((c) => c.key), ['edge:ex:@slot'])
  assert.deepEqual(r.doc.edges.map((e) => e.id), ['eo'])
})

// ---------------- 撤销栈改基 ----------------

check('rebaseOntoRemote：旧快照叠上远端改动，撤销不会把远端改动撤掉', () => {
  const pre = clone(base)
  const post = clone(base)
  byId(post, 'b')!.data.text = 'agent'
  post.nodes.push(node('n', { text: 'new' }, 5, 5))
  // 旧快照 = 本地某步之前的状态（没有远端改动，且我当时把 a 改成别的）
  const entry = clone(base)
  byId(entry, 'a')!.data.text = 'old-a'
  const out = rebaseOntoRemote(pre, post, entry, isRuntimeKey)
  assert.equal(byId(out, 'b')!.data.text, 'agent')
  assert.ok(byId(out, 'n'))
  assert.equal(byId(out, 'a')!.data.text, 'old-a') // 本地操作仍可撤回
})

check('rebaseOntoRemote：同字段冲突远端为准；远端删除的节点在旧快照里也删除', () => {
  const pre = clone(base)
  const post = clone(base)
  byId(post, 'a')!.data.text = 'agent'
  post.nodes = post.nodes.filter((n) => n.id !== 'b')
  const entry = clone(base)
  byId(entry, 'a')!.data.text = 'older'
  byId(entry, 'b')!.data.text = 'edited-then-undone'
  const out = rebaseOntoRemote(pre, post, entry, isRuntimeKey)
  assert.equal(byId(out, 'a')!.data.text, 'agent')
  assert.equal(byId(out, 'b'), undefined)
})

check('rebaseOntoRemote：输入不被改写', () => {
  const pre = clone(base)
  const post = clone(base)
  byId(post, 'a')!.data.text = 'x'
  const entry = clone(base)
  const snap = JSON.stringify([pre, post, entry])
  rebaseOntoRemote(pre, post, entry, isRuntimeKey)
  assert.equal(JSON.stringify([pre, post, entry]), snap)
})

console.log(`\ncanvas-merge: ${passed} checks passed`)
