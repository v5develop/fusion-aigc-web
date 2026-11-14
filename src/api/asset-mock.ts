/**
 * 资产库「用途类型 + 标签」的本地 mock（`?mock=asset` 打开，见 mock-switch.ts）：后端接口未就绪时用。
 * 覆盖资产页与素材库选择器用到的全部资产 / 标签接口，筛选语义同契约：
 * kind / kindGroup、tags / sysTags 逗号分隔且须全部包含、untagged、favoriteOnly、q、source、media、kind。
 * 图片地址形如 `${origin}/__mock_asset/{id}.svg`（http，选择器才收）；dev 下没有这个文件，
 * 截图 / 联调时由浏览器侧拦截返回渐变 SVG，不进仓库静态资源。
 */
import type {
  IAssetLibAsset,
  IAssetLibBatchTagResp,
  IAssetLibCategoriesResp,
  IAssetLibListParams,
  IAssetLibListResp,
  IAssetLibTag,
  IAssetLibSysTag,
  IAssetLibTagListResp,
  IAssetLibUpdateReq,
  IAssetCategoryNode,
} from './asset-library.ts'
import { ASSET_KINDS } from './asset-library.ts'
import type { ApiResponse } from './types.ts'

const ok = <T,>(data: T) => ({ code: 0, msg: 'ok', data }) as unknown as ApiResponse<T>
const wait = (ms = 160) => new Promise((r) => setTimeout(r, ms))

const BASE = Date.UTC(2026, 10, 1)
const DAY = 86_400_000

type Seed = [title: string, usage: string, tags: string[], sys: string[], media: 'image' | 'video', source: string]
const SEEDS: Seed[] = [
  ['老刘足浴 门头正面', 'storefront', ['门头', '2026春'], ['含文字'], 'image', 'upload'],
  ['足浴店夜景外立面', 'storefront', ['门头'], ['夜景'], 'image', 'generated'],
  ['招牌特写', 'storefront', ['门头', '招牌'], ['含文字'], 'image', 'upload'],
  ['精油套餐主图', 'product', ['套餐', '爆款'], ['白底'], 'image', 'upload'],
  ['足浴桶白底图', 'product', ['白底'], ['白底'], 'image', 'upload'],
  ['养生茶礼盒', 'product', ['礼盒', '爆款'], [], 'image', 'generated'],
  ['艾灸盒商品图', 'product', [], ['白底'], 'image', 'upload'],
  ['大堂环境', 'scene', ['环境', '2026春'], ['室内'], 'image', 'upload'],
  ['包间环境氛围图', 'scene', ['环境'], ['室内', '暖光'], 'image', 'generated'],
  ['休息区', 'scene', ['环境'], ['室内'], 'image', 'upload'],
  ['技师形象照', 'person', ['技师'], ['人像'], 'image', 'upload'],
  ['店长半身像', 'person', ['技师', '店长'], ['人像'], 'image', 'upload'],
  ['代言模特 A', 'person', ['模特'], ['人像'], 'image', 'generated'],
  ['招牌红烧肉', 'dish', ['招牌菜', '爆款'], [], 'image', 'upload'],
  ['小炒黄牛肉', 'dish', ['招牌菜'], [], 'image', 'upload'],
  ['凉菜拼盘', 'dish', [], [], 'image', 'generated'],
  ['品牌 Logo 横版', 'logo', ['品牌'], ['透明底'], 'image', 'upload'],
  ['品牌 Logo 竖版', 'logo', ['品牌'], ['透明底'], 'image', 'upload'],
  ['国庆活动海报', 'poster', ['活动', '2026国庆'], ['含文字'], 'image', 'generated'],
  ['新人 9.9 海报', 'poster', ['活动', '爆款'], ['含文字'], 'image', 'generated'],
  ['探店视频成片', 'video_final', ['探店'], ['竖屏'], 'video', 'generated'],
  ['开业宣传片', 'video_final', ['活动'], ['横屏'], 'video', 'generated'],
  ['技师手法片段', 'video_segment', ['技师'], ['竖屏'], 'video', 'upload'],
  ['门头延时片段', 'video_segment', ['门头'], ['横屏'], 'video', 'upload'],
  ['竞品参考 1', 'reference', ['参考'], [], 'image', 'upload'],
  ['竞品参考 2', 'reference', ['参考'], [], 'image', 'upload'],
  ['随手拍', 'other', [], [], 'image', 'upload'],
  ['未命名素材', '', [], [], 'image', 'generated'],
]

const store: IAssetLibAsset[] = SEEDS.map(([title, usage, tags, sys, media, source], i) => ({
  id: 9000 + i,
  title,
  prompt: '',
  image: `${location.origin}/__mock_asset/${9000 + i}.svg`,
  media,
  videoUrl: media === 'video' ? `${location.origin}/__mock_asset/${9000 + i}.mp4` : '',
  source,
  tags: [...tags],
  createdAt: BASE - i * DAY,
  favorite: i % 7 === 0,
  license: '',
  metadata: {},
  provenance: { runId: '', workflowId: '', nodeId: '', operator: '', model: '', params: '', createdAt: 0 },
  versions: [],
  currentVersionId: 0,
  relatedIds: [],
  entryCode: '',
  width: 1024,
  height: 768,
  kind: usage === 'other' || !usage ? (usage ? 'other' : '') : usage === 'person' ? 'model' : usage,
  kindSource: i % 3 === 0 ? 'user' : 'auto',
  sysTags: [...sys],
}))

const autoKind = new Map(store.map((a) => [a.id, a.kind]))

// 标签字典：名字 → 稳定 id；新建 / 改名 / 删除只动这里和 store
const tagIds = new Map<string, number>()
let nextTagId = 500
const idOf = (name: string) => {
  let id = tagIds.get(name)
  if (id == null) tagIds.set(name, (id = nextTagId++))
  return id
}
const extraTags = new Set<string>() // 新建但还没挂到任何资产的标签

const csv = (v?: string) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [])

function filtered(p: IAssetLibListParams): IAssetLibAsset[] {
  const want = [...csv(p.tags), ...(p.tag ? [p.tag] : [])]
  const sys = csv(p.sysTags)
  const q = p.q?.trim().toLowerCase()
  return store.filter(
    (a) =>
      (!p.media || a.media === p.media) &&
      (!p.source || (p.source === 'input' ? a.source !== 'generated' : a.source === p.source)) &&
      (!p.favoriteOnly || a.favorite) &&
      (!p.kind || p.kind === 'uncategorized' ? (p.kind ? !a.kind : true) : a.kind === p.kind) &&
      (!p.kindGroup || ASSET_KINDS.find((k) => k.value === a.kind)?.group === p.kindGroup) &&
      (!p.untagged || !a.tags.length) &&
      want.every((t) => a.tags.includes(t)) &&
      sys.every((t) => a.sysTags?.includes(t)) &&
      (!q || a.title.toLowerCase().includes(q)),
  )
}

export async function mockList(p: IAssetLibListParams) {
  await wait()
  const rows = filtered(p)
  const size = p.pageSize ?? 30
  const page = p.page ?? 1
  const res: IAssetLibListResp = { items: rows.slice((page - 1) * size, page * size).map((a) => ({ ...a })), total: rows.length }
  return ok(res)
}

export async function mockCategories(p: { source?: string; media?: string }) {
  await wait(60)
  const rows = filtered({ source: p.source, media: p.media })
  const kinds = ASSET_KINDS.map((k) => ({
    key: k.value,
    label: k.label,
    group: k.group as string,
    count: rows.filter((a) => a.kind === k.value).length,
  }))
  const res: IAssetLibCategoriesResp = {
    items: [
      { key: 'all', label: '全部', count: rows.length, group: '' },
      ...kinds,
      { key: 'uncategorized', label: '未分类', count: rows.filter((a) => !a.kind).length, group: '' },
    ],
  }
  return ok(res)
}

export async function mockTree() {
  await wait(40)
  return ok<IAssetCategoryNode[]>([])
}

export async function mockUpdate(id: number, d: IAssetLibUpdateReq) {
  await wait(80)
  const a = store.find((x) => x.id === id)
  if (!a) throw new Error('mock: asset not found')
  if (d.favorite != null) a.favorite = d.favorite
  if (d.title != null) a.title = d.title
  if (d.kind != null) {
    // 空串 = 恢复系统推算：mock 里推算 = 种子里的默认分类
    a.kind = d.kind === '' ? (autoKind.get(a.id) ?? '') : d.kind
    a.kindSource = d.kind === '' ? 'auto' : 'user'
  }
  if (d.tags) a.tags = [...new Set(d.tags)]
  return ok({ ...a })
}

function dict(): IAssetLibTag[] {
  const count = new Map<string, number>()
  for (const a of store) for (const t of a.tags) count.set(t, (count.get(t) ?? 0) + 1)
  for (const t of extraTags) if (!count.has(t)) count.set(t, 0)
  return [...count].map(([name, assetCount]) => ({ id: idOf(name), name, assetCount, createdAt: BASE }))
}

export async function mockTags(sort: 'count' | 'name' = 'count') {
  await wait(60)
  const items = dict().sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : b.assetCount - a.assetCount || a.name.localeCompare(b.name, 'zh-CN')))
  const res: IAssetLibTagListResp = { items, untaggedCount: store.filter((a) => !a.tags.length).length }
  return ok(res)
}

export async function mockSysTags() {
  await wait(60)
  const count = new Map<string, number>()
  for (const a of store) for (const t of a.sysTags ?? []) count.set(t, (count.get(t) ?? 0) + 1)
  const items: IAssetLibSysTag[] = [...count]
    .map(([name, assetCount]) => ({ name, assetCount }))
    .sort((a, b) => b.assetCount - a.assetCount || a.name.localeCompare(b.name, 'zh-CN'))
  return ok({ items })
}

export async function mockTagCreate(name: string) {
  await wait(60)
  extraTags.add(name)
  return ok<IAssetLibTag>({ id: idOf(name), name, assetCount: 0, createdAt: Date.now() })
}

const nameOf = (id: number) => [...tagIds].find(([, v]) => v === id)?.[0]

export async function mockTagRename(id: number, name: string) {
  await wait(60)
  const old = nameOf(id)
  if (old) {
    for (const a of store) a.tags = [...new Set(a.tags.map((t) => (t === old ? name : t)))]
    extraTags.delete(old)
    extraTags.add(name)
    tagIds.delete(old)
    tagIds.set(name, id)
  }
  return ok<IAssetLibTag>({ id, name, assetCount: 0, createdAt: BASE })
}

export async function mockTagDelete(id: number) {
  await wait(60)
  const old = nameOf(id)
  if (old) {
    for (const a of store) a.tags = a.tags.filter((t) => t !== old)
    extraTags.delete(old)
    tagIds.delete(old)
  }
  return ok(null)
}

export async function mockBatchTag(d: { assetIds: number[]; tagIds?: number[]; removeTagIds?: number[] }) {
  await wait(80)
  const add = (d.tagIds ?? []).map(nameOf).filter((n): n is string => !!n)
  const drop = (d.removeTagIds ?? []).map(nameOf).filter((n): n is string => !!n)
  let added = 0
  let removed = 0
  for (const a of store.filter((x) => d.assetIds.includes(x.id))) {
    for (const n of drop) {
      if (!a.tags.includes(n)) continue
      a.tags = a.tags.filter((t) => t !== n)
      removed++
    }
    for (const n of add) {
      if (a.tags.includes(n)) continue
      a.tags.push(n)
      added++
    }
  }
  return ok<IAssetLibBatchTagResp>({ added, removed })
}

