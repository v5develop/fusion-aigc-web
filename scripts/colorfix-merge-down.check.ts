/**
 * 校色「向下合并」的纯函数检查（仓库没有测试框架：直接 `node scripts/colorfix-merge-down.check.ts` 跑，退出码非 0 = 有失败）。
 *
 * 覆盖：
 * 1. 覆盖范围并集 / 像素层合成 / 软并集对照；
 * 2. 合并前后整图逐字节一致（随机图 + 随机参数 + 随机软蒙版，走与导出同一套精算函数 compositeSteps，
 *    含：调整层并入底层 / 并入选区层 / 像素层再合并 / 合并后下面的层改动仍按覆盖范围透传）；
 * 3. 老数据（v2，没有 kind）原样读出，像素层的存取 / 折回旧形状 / 带不走 / 合并可用性；
 * 4. 4K 合并耗时（只算两层精算合成 + 覆盖度，不含浏览器取帧 / PNG 编码）。
 */
import assert from 'node:assert/strict'
import {
  adjustZero,
  compositePixelLayer,
  compositeSteps,
  coverUnion,
  unionAlpha,
  type ColorFixAdjust,
  type CompositeStep,
} from '../src/utils/colorfix-math.ts'
import {
  BASE_LAYER_ID,
  cloneLayers,
  layerTransferable,
  layersEqual,
  layersHavePixel,
  layersNeedLocalMask,
  layersSanitize,
  legacyOf,
  makeBaseLayer,
  makePixelLayer,
  mergeDownBlocked,
  nextPixelName,
  pixelScope,
  type ColorFixLayer,
} from '../src/components/ColorFix/layers.ts'

let failures = 0
let passed = 0
function check(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  ok   ${name}`)
  } catch (err) {
    failures++
    console.log(`  FAIL ${name}\n       ${(err as Error).message.split('\n').slice(0, 6).join('\n       ')}`)
  }
}

// ---- 可复现的随机数 ----
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
type Rand = () => number
const ri = (r: Rand, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))

function randomFrame(r: Rand, w: number, h: number): Uint8ClampedArray {
  const f = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < f.length; i += 4) {
    f[i] = ri(r, 0, 255)
    f[i + 1] = ri(r, 0, 255)
    f[i + 2] = ri(r, 0, 255)
    f[i + 3] = r() < 0.2 ? ri(r, 0, 255) : 255 // 一部分半透明（抠图）
  }
  return f
}

/** 随机软蒙版：若干圆形软边斑块 + 随机噪点；含 0 / 255 / 中间值 */
function randomAlpha(r: Rand, w: number, h: number): Uint8Array {
  const a = new Uint8Array(w * h)
  const blobs = ri(r, 1, 3)
  for (let b = 0; b < blobs; b++) {
    const cx = r() * w
    const cy = r() * h
    const rad = 4 + r() * Math.min(w, h) * 0.4
    const soft = 1 + r() * 6
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const d = Math.hypot(x - cx, y - cy)
        const v = Math.max(0, Math.min(1, (rad - d) / soft + 0.5))
        a[y * w + x] = Math.max(a[y * w + x]!, Math.round(v * 255))
      }
  }
  for (let i = 0; i < a.length; i++) if (r() < 0.03) a[i] = ri(r, 0, 255)
  return a
}

function randomAdjust(r: Rand): ColorFixAdjust | null {
  if (r() < 0.4) return null
  const a = adjustZero()
  a.temp = ri(r, -60, 60)
  a.tint = ri(r, -40, 40)
  a.hsl = a.hsl.map(() => ({ h: ri(r, -30, 30), s: ri(r, -40, 40), l: ri(r, -20, 20) }))
  a.skin = r() < 0.3
  if (r() < 0.5) a.levels = { inBlack: ri(r, 0, 40), inWhite: ri(r, 200, 255), gamma: 0.6 + r() * 1.6, outBlack: 0, outWhite: 255 }
  return a
}

const HEX = ['#875f9a', '#c0392b', '#2e86c1', '#27ae60', '#f1c40f']
function randomStep(r: Rand, w: number, h: number, whole: boolean): CompositeStep {
  const recolor = r() < 0.35 ? { source: HEX[ri(r, 0, 4)]!, target: HEX[ri(r, 0, 4)]!, strength: ri(r, 20, 100) } : null
  return {
    kind: 'adjust',
    spec: {
      params: { hue: ri(r, -40, 40), sat: ri(r, -50, 50), light: ri(r, -30, 30), bright: ri(r, -30, 30), contrast: ri(r, -30, 30) },
      recolor,
      adjust: randomAdjust(r),
    },
    alpha: whole ? null : randomAlpha(r, w, h),
    // 自动源色在 DOM 路径里先按原图算好；这里给个固定的 OKLab 源色，两条路径同值即可
    source: recolor ? [0.55, 0.05, -0.04] : null,
  }
}

const same = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
  assert.equal(a.length, b.length)
  let diff = 0
  let first = -1
  for (let i = 0; i < a.length; i++)
    if (a[i] !== b[i]) {
      diff++
      if (first < 0) first = i
    }
  assert.equal(diff, 0, `有 ${diff} 个字节不同，首个在 ${first}（像素 ${Math.floor(first / 4)} 通道 ${first % 4}）`)
}

/** 与 DOM 路径同一份逻辑：合并 steps[at-1] 与 steps[at]，返回新的 steps（像素层占下面那层的位置） */
function mergeDown(frame: Uint8ClampedArray, steps: readonly CompositeStep[], at: number): CompositeStep[] {
  const p = compositeSteps(new Uint8ClampedArray(frame), steps.slice(0, at + 1), true, [at - 1, at])
  return [...steps.slice(0, at - 1), { kind: 'pixel', pixels: p }, ...steps.slice(at + 1)]
}

console.log('覆盖范围与像素层合成')

check('coverUnion：调整层按 alpha>0 取并集，整幅层铺满，像素层按 A>0', () => {
  const cover = new Uint8Array(6)
  coverUnion(cover, { kind: 'adjust', spec: { params: { hue: 0, sat: 0, light: 0, bright: 0, contrast: 0 } }, alpha: Uint8Array.of(0, 5, 0, 255, 0, 0), source: null })
  assert.deepEqual([...cover], [0, 255, 0, 255, 0, 0])
  const px = new Uint8ClampedArray(24)
  px[4 * 4 + 3] = 1
  coverUnion(cover, { kind: 'pixel', pixels: px })
  assert.deepEqual([...cover], [0, 255, 0, 255, 255, 0])
  coverUnion(cover, { kind: 'adjust', spec: { params: { hue: 0, sat: 0, light: 0, bright: 0, contrast: 0 } }, alpha: null, source: null })
  assert.deepEqual([...cover], [255, 255, 255, 255, 255, 255])
})

check('unionAlpha = 1 − (1 − a)(1 − b)（软并集，单调、含 0 / 255 端点）', () => {
  assert.equal(unionAlpha(0, 0), 0)
  assert.equal(unionAlpha(255, 0), 255)
  assert.equal(unionAlpha(0, 128), 128)
  assert.equal(unionAlpha(255, 255), 255)
  assert.equal(unionAlpha(128, 128), 192)
  for (let a = 0; a <= 255; a += 5) for (let b = 0; b <= 255; b += 5) assert.ok(unionAlpha(a, b) >= Math.max(a, b))
})

check('compositePixelLayer：A=255 逐位拷贝，A=0 不动，中间值线性混合，alpha 通道不动', () => {
  const running = Uint8ClampedArray.of(10, 20, 30, 77, 10, 20, 30, 77, 100, 100, 100, 9)
  const pixels = Uint8ClampedArray.of(200, 210, 220, 255, 1, 2, 3, 0, 200, 0, 50, 128)
  compositePixelLayer(running, pixels)
  assert.deepEqual([...running.slice(0, 4)], [200, 210, 220, 77])
  assert.deepEqual([...running.slice(4, 8)], [10, 20, 30, 77])
  const k = 128 / 255
  assert.deepEqual(
    [...running.slice(8, 12)],
    [100 + (200 - 100) * k, 100 + (0 - 100) * k, 100 + (50 - 100) * k, 9].map((v) => Math.min(255, Math.max(0, Math.round(v)))).map((v, i) => (i === 3 ? 9 : v)),
  )
})

console.log('合并前后图像逐字节一致')

const W = 53
const H = 41

check('随机 120 组：调整层并入下层（底层 / 选区层），合并前后整图逐字节一致', () => {
  for (let seed = 1; seed <= 120; seed++) {
    const r = rng(seed)
    const frame = randomFrame(r, W, H)
    const n = ri(r, 2, 6)
    const steps: CompositeStep[] = [randomStep(r, W, H, true)]
    for (let i = 1; i < n; i++) steps.push(randomStep(r, W, H, false))
    const at = ri(r, 1, n - 1)
    const before = compositeSteps(new Uint8ClampedArray(frame), steps, true)
    const after = compositeSteps(new Uint8ClampedArray(frame), mergeDown(frame, steps, at), true)
    try {
      same(before, after)
    } catch (e) {
      throw new Error(`seed ${seed}（${n} 层，合并第 ${at} 层）：${(e as Error).message}`)
    }
  }
})

check('随机 60 组：连续向下合并到只剩一个像素层（含像素层再合并、并入整图底层），每一步都一致', () => {
  for (let seed = 1000; seed < 1060; seed++) {
    const r = rng(seed)
    const frame = randomFrame(r, W, H)
    const n = ri(r, 3, 6)
    let steps: CompositeStep[] = [randomStep(r, W, H, true)]
    for (let i = 1; i < n; i++) steps.push(randomStep(r, W, H, false))
    const before = compositeSteps(new Uint8ClampedArray(frame), steps, true)
    while (steps.length > 1) {
      steps = mergeDown(frame, steps, ri(r, 1, steps.length - 1))
      same(before, compositeSteps(new Uint8ClampedArray(frame), steps, true))
    }
    assert.equal(steps[0]!.kind, 'pixel')
  }
})

check('合并后覆盖范围外的像素仍跟着下面的层走（不是整张图被冻住）', () => {
  const r = rng(77)
  const frame = randomFrame(r, W, H)
  const base = randomStep(r, W, H, true)
  const d = randomStep(r, W, H, false)
  const l = randomStep(r, W, H, false)
  const merged = mergeDown(frame, [base, d, l], 2) // [base, P]
  const P = (merged[1] as { pixels: Uint8ClampedArray }).pixels
  const base2 = randomStep(rng(78), W, H, true) // 改了底层
  const after = compositeSteps(new Uint8ClampedArray(frame), [base2, merged[1]!], true)
  const lowerOnly = compositeSteps(new Uint8ClampedArray(frame), [base2], true)
  let outside = 0
  for (let px = 0; px < W * H; px++) {
    const cov = P[px * 4 + 3]!
    assert.ok(cov === 0 || cov === 255, '覆盖度只有 0 / 255 两档')
    if (cov === 0) {
      outside++
      for (let c = 0; c < 4; c++) assert.equal(after[px * 4 + c], lowerOnly[px * 4 + c])
    } else for (let c = 0; c < 3; c++) assert.equal(after[px * 4 + c], P[px * 4 + c])
  }
  assert.ok(outside > 0, '测试数据应有覆盖范围外的像素')
})

check('对照：按软并集 alpha 盖回去（不是二值覆盖）会让软边像素与合并前不同——这就是取二值覆盖的原因', () => {
  const r = rng(5)
  const frame = randomFrame(r, W, H)
  const base: CompositeStep = randomStep(r, W, H, true)
  const d = randomStep(r, W, H, false)
  const l = randomStep(r, W, H, false)
  const steps = [base, d, l]
  const before = compositeSteps(new Uint8ClampedArray(frame), steps, true)
  const p = compositeSteps(new Uint8ClampedArray(frame), steps, true)
  // 软并集 alpha（d / l 都是 adjust）
  const soft = new Uint8ClampedArray(p)
  const da = (d as { alpha: Uint8Array }).alpha
  const la = (l as { alpha: Uint8Array }).alpha
  for (let px = 0; px < W * H; px++) soft[px * 4 + 3] = unionAlpha(da[px]!, la[px]!)
  // 只合并 d、l（下面是 base）：盖在 base 的结果上
  const underlying = compositeSteps(new Uint8ClampedArray(frame), [base], true)
  compositePixelLayer(underlying, soft)
  let diff = 0
  for (let i = 0; i < before.length; i++) if (before[i] !== underlying[i]) diff++
  assert.ok(diff > 0, '软并集应当与合并前不同（否则这条对照没有意义）')
})

check('大蒙版整幅（alpha=null）并入：像素层覆盖整幅', () => {
  const r = rng(9)
  const frame = randomFrame(r, W, H)
  const steps = [randomStep(r, W, H, true), randomStep(r, W, H, true)]
  const merged = mergeDown(frame, steps, 1)
  const px = (merged[0] as { pixels: Uint8ClampedArray }).pixels
  for (let i = 0; i < W * H; i++) assert.equal(px[i * 4 + 3], 255)
  same(compositeSteps(new Uint8ClampedArray(frame), steps, true), compositeSteps(new Uint8ClampedArray(frame), merged, true))
})

console.log('图层模型与兼容')

const v2Json = {
  v: 2,
  selected: 'l1',
  layers: [
    { id: 'base', name: '整图', autoName: true, visible: true, params: { hue: 3, sat: -16, light: -6, bright: -17, contrast: 10 }, region: { mode: 'whole', target: 'garment', invert: false, feather: 4 }, recolor: null },
    { id: 'l1', name: '上衣', autoName: true, visible: true, params: { hue: 10, sat: 0, light: 0, bright: 0, contrast: 0 }, region: { mode: 'auto', target: 'garment', parts: ['tops'], invert: false, feather: 6 }, recolor: { source: null, target: '#875f9a', strength: 80 } },
    { id: 'l2', name: '选区 2', autoName: true, visible: false, params: { hue: 0, sat: 20, light: 0, bright: 0, contrast: 0 }, region: { mode: 'paint', target: 'garment', invert: true, feather: 0 }, recolor: null },
  ],
}

check('老数据（v2，无 kind）原样读出：没有像素字段、不带 hasPixelLayers、可折回旧形状的照旧', () => {
  const stack = layersSanitize(JSON.stringify(v2Json))!
  assert.equal(stack.v, 2)
  assert.equal(stack.layers.length, 3)
  for (const l of stack.layers) {
    assert.equal(l.kind, undefined)
    assert.equal(l.pixel, undefined)
  }
  assert.equal(stack.hasPixelLayers, undefined)
  assert.equal(stack.selected, 'l1')
  assert.equal(stack.layers[1]!.region.parts?.[0], 'tops')
  assert.equal(stack.layers[1]!.recolor?.strength, 80)
  assert.equal(layersHavePixel(stack.layers), false)
  // 读 → 写 → 读 稳定
  const again = layersSanitize(JSON.parse(JSON.stringify(stack)))!
  assert.ok(layersEqual(stack.layers, again.layers))
  // 只有底层的老数据仍然 exact
  const only = layersSanitize({ layers: [v2Json.layers[0]] })!
  assert.equal(legacyOf(only.layers).exact, true)
})

check('像素层：存取往返、hasPixelLayers、折不回旧形状、带不走、需要本机数据', () => {
  const px = makePixelLayer('lp1', '像素层 1', { w: 4096, h: 2304, pid: 'pxabc123' })
  const base = makeBaseLayer({ hue: 0, sat: 0, light: 0, bright: 0, contrast: 0 })
  const json = JSON.parse(JSON.stringify({ v: 2, layers: [base, px], selected: 'lp1' }))
  const stack = layersSanitize(json)!
  assert.equal(stack.hasPixelLayers, true)
  const got = stack.layers[1]!
  assert.equal(got.kind, 'pixel')
  assert.deepEqual(got.pixel, { w: 4096, h: 2304, pid: 'pxabc123' })
  assert.equal(legacyOf(stack.layers).exact, false)
  assert.equal(layerTransferable(got), false)
  assert.equal(layersNeedLocalMask(stack.layers), true)
  assert.ok(layersEqual(stack.layers, cloneLayers(stack.layers)))
  // 坏的像素层数据（缺 pid / 尺寸）按调整层处理，不崩
  const bad = layersSanitize({ layers: [base, { ...json.layers[1], pixel: { w: 0, h: 1, pid: '' } }] })!
  assert.equal(bad.layers[1]!.kind, undefined)
  assert.equal(bad.hasPixelLayers, undefined)
})

check('底层是像素层（合并进整图）：仍是底层、可存取、整图名字固定', () => {
  const pb = makePixelLayer(BASE_LAYER_ID, '整图', { w: 10, h: 10, pid: 'pxb' })
  const stack = layersSanitize({ layers: [JSON.parse(JSON.stringify(pb))] })!
  assert.equal(stack.layers[0]!.id, BASE_LAYER_ID)
  assert.equal(stack.layers[0]!.kind, 'pixel')
  assert.equal(stack.layers[0]!.name, '整图')
  assert.equal(stack.layers[0]!.region.mode, 'whole')
})

check('mergeDownBlocked：最下层不能、两层都没效果不必、其余可以；像素层与调整层同样处理', () => {
  const base = makeBaseLayer({ hue: 0, sat: 0, light: 0, bright: 0, contrast: 0 })
  const l1: ColorFixLayer = { ...makeBaseLayer({ hue: 5, sat: 0, light: 0, bright: 0, contrast: 0 }), id: 'a', name: '选区 1', region: { mode: 'point', target: 'garment', invert: false, feather: 4 } }
  const px = makePixelLayer('p', '像素层 1', { w: 1, h: 1, pid: 'pxz' })
  assert.notEqual(mergeDownBlocked([base, l1], 0), '')
  assert.notEqual(mergeDownBlocked([base, { ...l1, params: { hue: 0, sat: 0, light: 0, bright: 0, contrast: 0 } }], 1), '')
  assert.equal(mergeDownBlocked([base, l1], 1), '')
  assert.equal(mergeDownBlocked([base, px, l1], 2), '')
  assert.equal(mergeDownBlocked([base, l1, px], 2), '')
  assert.equal(mergeDownBlocked([base, px, { ...px, id: 'p2' }], 2), '')
  assert.notEqual(mergeDownBlocked([base, { ...px, visible: false }, { ...l1, visible: false }], 2), '')
})

check('像素层命名与存储作用域', () => {
  const a = makePixelLayer('p1', '像素层 1', { w: 1, h: 1, pid: 'pxa' })
  const b = makePixelLayer('p2', '像素层 3', { w: 1, h: 1, pid: 'pxb' })
  assert.equal(nextPixelName([makeBaseLayer({ hue: 0, sat: 0, light: 0, bright: 0, contrast: 0 }), a, b]), '像素层 4')
  const s = pixelScope('asset:1:abc', 'https://x/y.png', 'pxa', 'full')
  assert.ok(s.startsWith('asset:1:abc::'), '以 <key>:: 开头，「移除校色」按前缀清')
  assert.notEqual(s, pixelScope('asset:1:abc', 'https://x/y.png', 'pxa', 'preview'))
  assert.equal(pixelScope('', 'x', 'pxa', 'full'), '')
})

console.log('性能（Node 单线程，仅两层精算合成 + 覆盖度；浏览器里在 Worker 并行，另加取帧与 PNG 编码）')

check('4096×2304，两层（HSL + 白平衡 + 色阶 + 替换颜色）精算合并耗时', () => {
  const w = 4096
  const h = 2304
  const r = rng(42)
  const frame = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < frame.length; i += 4) {
    frame[i] = (i >> 4) & 255
    frame[i + 1] = (i >> 6) & 255
    frame[i + 2] = ri(r, 0, 255)
    frame[i + 3] = 255
  }
  const alpha = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) alpha[y * w + x] = x > w * 0.25 && x < w * 0.8 && y > h * 0.2 && y < h * 0.9 ? 255 : 0
  const adj = adjustZero()
  adj.temp = 20
  adj.tint = -10
  adj.hsl[0] = { h: 10, s: 20, l: -5 }
  adj.levels = { inBlack: 10, inWhite: 240, gamma: 1.2, outBlack: 0, outWhite: 255 }
  const mk = (a: Uint8Array | null, recolor: boolean): CompositeStep => ({
    kind: 'adjust',
    spec: {
      params: { hue: 8, sat: 10, light: 0, bright: 5, contrast: 5 },
      recolor: recolor ? { source: '#c0392b', target: '#2e86c1', strength: 80 } : null,
      adjust: adj,
    },
    alpha: a,
    source: recolor ? [0.55, 0.15, 0.08] : null,
  })
  const t0 = performance.now()
  compositeSteps(frame, [mk(null, false), mk(alpha, true)], true, [0, 1])
  const ms = performance.now() - t0
  console.log(`       ${(w * h / 1e6).toFixed(1)}M 像素，两层精算 + 覆盖度：${ms.toFixed(0)} ms`)
  assert.ok(ms < 8000, `Node 里 ${ms.toFixed(0)}ms 过慢`)
})

console.log(`\n${passed} 通过，${failures} 失败`)
process.exit(failures ? 1 : 0)
