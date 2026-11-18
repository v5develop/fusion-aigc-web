<script setup lang="ts">
/**
 * 素材区（CONTRACT §AA）：最多 9 张图，可多选 / 拖入 / 从资产库多选 / 一键带入「我的模特」「我的商品」。
 * 每张图带类别标签（后端自动判断后填入，判断中显示「识别中」，降级成「其他」时请用户选），可改；
 * 人物 / 服装图识别出对应视频里的人时，显示那个人的称呼（如「左侧白衣女生」），也可改。
 * 上传步与方案步共用同一份素材（useReplicate.assets）。
 */
import { computed, onMounted, ref } from 'vue'
import { isMock } from '@/api/mock-switch.ts'
import { listUserModels } from '@/api/models.ts'
import { agentBrandAssets, type AgentBrandAsset as BrandAsset } from '@/api/agent.ts'
import AssetPickerModal from '@/views/studio/components/AssetPickerModal/index.vue'
import { KIND_LABEL, KIND_ORDER, MAX_ASSETS, type AssetKind } from '../constants.ts'
import type { useReplicate } from '../useReplicate.ts'

const props = defineProps<{ rep: ReturnType<typeof useReplicate> }>()
const rep = props.rep
const FOCUS = 'focus-visible:(outline outline-2 outline-violet outline-offset-2)'

const fileEl = ref<HTMLInputElement | null>(null)
const dragging = ref(false)
const pickerOpen = ref(false)

const full = computed(() => rep.assets.value.length >= MAX_ASSETS)

function onFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (files.length) void rep.addFiles(files)
}
function onDrop(e: DragEvent) {
  dragging.value = false
  const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'))
  if (files.length) void rep.addFiles(files)
}
function onPicked(urls: string[]) {
  rep.addUrls(urls.map((u, i) => ({ url: u, name: `资产库图片 ${i + 1}` })))
}

// ---- 一键带入：复刻里存的（模特 / 商品 / 店铺）+ 模特库；取不到或为空就整条不显示，不影响手动放图 ----
interface BrandItem {
  /** 显示地址（有 rid 时是会过期的现签地址，只用来显示） */
  url: string
  name: string
  /** 私有媒体 id：发给 Go 一律用它，不用 url */
  rid?: string
}
interface BrandGroup {
  key: string
  label: string
  kind: AssetKind
  items: BrandItem[]
}
const groups = ref<BrandGroup[]>([])
const isHttp = (u: string) => /^(https?:|data:image\/)/i.test(u)
/** 同一页面里上传步 / 方案步各挂一次，别重复请求 */
let brandCache: BrandGroup[] | null = null
async function loadBrand() {
  if (brandCache) {
    groups.value = brandCache
    return
  }
  const saved: BrandAsset[] = await agentBrandAssets()
    .then((r) => r.data ?? [])
    .catch(() => [])
  const pick = (k: BrandAsset['kind']) =>
    saved
      .filter((a) => a.kind === k && isHttp(a.url))
      .map((a) => ({ url: a.url, name: a.name, ...(a.rid ? { rid: a.rid } : {}) }))
  let lib: BrandItem[] = []
  if (!isMock('replicate')) {
    lib = await listUserModels()
      .then((r) => (r.data ?? []).filter((u) => isHttp(u.imageUrl)).map((u) => ({ url: u.imageUrl, name: u.title })))
      .catch(() => [])
  }
  brandCache = [
    { key: 'm1', label: '我的模特 · 复刻里存的', kind: 'person' as AssetKind, items: pick('model') },
    { key: 'm2', label: '我的模特 · 模特库', kind: 'person' as AssetKind, items: lib },
    { key: 'p', label: '我的商品', kind: 'product' as AssetKind, items: pick('product') },
    { key: 's', label: '我的店铺', kind: 'scene' as AssetKind, items: pick('shop') },
  ]
    .map((g) => ({ ...g, items: g.items.slice(0, 12) }))
    .filter((g) => g.items.length)
  groups.value = brandCache
}
onMounted(() => void loadBrand())

function addBrand(it: BrandItem, kind: AssetKind) {
  rep.addUrls([{ ...it, kind }])
}
const added = (it: BrandItem) => rep.assets.value.some((a) => (it.rid ? a.rid === it.rid : a.url === it.url))

/** 类别下拉改了：交给 useReplicate（之后不再被自动判断覆盖） */
function onKind(id: number, e: Event) {
  rep.setAssetKind(id, (e.target as HTMLSelectElement).value as AssetKind)
}
function onSubject(id: number, e: Event) {
  rep.setAssetSubject(id, (e.target as HTMLSelectElement).value)
}
/** 下拉被窄卡片截断时，悬停可看全名 */
function subjectTitle(id?: string) {
  return rep.subjectList.value.find((s) => s.id === id)?.name ?? '对应哪位：不确定'
}
const SEL =
  'h-24px w-full min-w-0 rounded-6px border border-solid bg-surface px-4px text-12px text-ink focus-visible:(outline outline-2 outline-violet)'
</script>

<template>
  <div class="flex flex-col gap-10px">
    <!-- 一键带入 -->
    <div v-for="g in groups" :key="g.key" class="flex items-center gap-8px">
      <span class="w-88px flex-none text-12px leading-16px text-muted">{{ g.label }}</span>
      <ul class="m-0 flex min-w-0 flex-1 list-none gap-6px overflow-x-auto p-0 pb-2px">
        <li v-for="it in g.items" :key="it.url" class="flex-none">
          <button
            type="button"
            :disabled="added(it) || full"
            :class="['relative block h-40px w-40px overflow-hidden rounded-8px border border-solid border-soft-line bg-surface3 p-0 cursor-pointer disabled:(opacity-45 cursor-not-allowed)', FOCUS]"
            :aria-label="added(it) ? `${it.name}，已添加` : `添加：${it.name}`"
            :title="it.name"
            @click="addBrand(it, g.kind)"
          >
            <img :src="it.url" alt="" loading="lazy" class="h-full w-full object-cover" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </div>

    <!-- 素材格：整块都能拖入 -->
    <div
      :class="['rounded-14px border border-dashed p-10px', dragging ? 'sx-drop border-violet-line' : 'border-control']"
      @dragover.prevent="dragging = true"
      @dragleave="dragging = false"
      @drop.prevent="onDrop"
    >
      <ul class="m-0 grid list-none grid-cols-5 gap-10px p-0 max-md:grid-cols-3 max-[520px]:grid-cols-2">
        <li v-for="a in rep.assets.value" :key="a.id" class="flex min-w-0 flex-col gap-4px">
          <span class="sx-squircle relative block aspect-[3/4] w-full overflow-hidden rounded-12px bg-surface3">
            <img v-if="a.url || a.preview" :src="a.url || a.preview" :alt="`图 ${rep.assetNo(a.id)}`" class="h-full w-full object-cover" />
            <span v-if="a.busy" class="absolute inset-0 grid place-items-center bg-black/30"><n-spin size="small" /></span>
            <span class="absolute left-4px top-4px rounded-4px bg-black/55 px-4px text-10px tabular-nums text-white">图{{ rep.assetNo(a.id) }}</span>
            <button
              type="button"
              :class="['absolute right-4px top-4px grid h-20px w-20px place-items-center rounded-full border-0 bg-black/55 p-0 text-white cursor-pointer', FOCUS]"
              :aria-label="`去掉图${rep.assetNo(a.id)}`"
              @click="rep.removeAsset(a.id)"
            >
              <svg class="h-10px w-10px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </span>

          <!-- 类别：识别中 / 可改 -->
          <span v-if="a.kindState === 'pending' && !a.busy" class="vr-pulse inline-flex h-24px items-center text-12px text-muted" role="status">识别中…</span>
          <span v-else-if="a.busy" class="inline-flex h-24px items-center text-12px text-muted" role="status">上传中…</span>
          <select
            v-else
            :value="a.kind"
            :class="[SEL, a.kindState === 'degraded' ? 'border-warning' : 'border-line']"
            :aria-label="`图${rep.assetNo(a.id)}的类别`"
            @change="onKind(a.id, $event)"
          >
            <option v-for="k in KIND_ORDER" :key="k" :value="k">{{ KIND_LABEL[k] }}</option>
          </select>
          <small v-if="a.error" class="text-11px leading-14px text-danger" role="alert">{{ a.error }}<button type="button" :class="['ml-4px border-0 bg-transparent p-0 text-11px text-danger underline cursor-pointer', FOCUS]" @click="rep.removeAsset(a.id)">去掉这张</button></small>
          <small v-if="a.kindState === 'degraded'" class="text-11px leading-14px text-warning">没认出来，请选一下</small>

          <!-- 对应视频里的人（分析好、视频里有人物时） -->
          <select
            v-if="(a.kind === 'person' || a.kind === 'garment') && rep.subjectList.value.length && !a.busy"
            :value="a.subjectId ?? ''"
            :class="[SEL, 'border-line']"
            :aria-label="`图${rep.assetNo(a.id)}对应视频里的哪个人`"
            :title="subjectTitle(a.subjectId)"
            @change="onSubject(a.id, $event)"
          >
            <option value="">对应哪位：不确定</option>
            <option v-for="s in rep.subjectList.value" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
          <small v-else-if="a.label && a.kindState === 'done'" class="truncate text-11px leading-14px text-placeholder">{{ a.label }}</small>
        </li>

        <!-- 添加格 -->
        <li v-if="!full" class="flex min-w-0 flex-col gap-4px">
          <button
            type="button"
            :class="['sx-squircle grid aspect-[3/4] w-full place-items-center rounded-12px border border-dashed border-control bg-surface2 p-4px text-center text-placeholder cursor-pointer hover:border-violet-line', FOCUS]"
            aria-label="添加图片"
            @click="fileEl?.click()"
          >
            <span class="flex flex-col items-center gap-4px">
              <svg class="h-22px w-22px text-violet" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              <span class="text-12px text-muted">{{ rep.assets.value.length ? '再加一张' : '点击或拖入' }}</span>
              <span class="text-11px text-placeholder">可多选</span>
            </span>
          </button>
        </li>
      </ul>
      <p v-if="!rep.assets.value.length" class="m-0 mt-8px text-12px leading-18px text-muted">
        人物、商品、服装、门店照片都可以，最多 {{ MAX_ASSETS }} 张。放进来后我会判断每张是什么，判断不对可以自己改
      </p>
    </div>
    <input ref="fileEl" type="file" multiple accept="image/jpeg,image/png,image/webp" class="hidden" @change="onFiles" />

    <div class="flex flex-wrap items-center gap-8px">
      <button type="button" class="sx-soft-btn" :disabled="full" @click="pickerOpen = true">从资产库添加</button>
      <span class="text-12px tabular-nums text-muted">{{ rep.assets.value.length }} / {{ MAX_ASSETS }}</span>
      <small v-if="rep.assetError.value" class="text-12px text-danger" role="alert">{{ rep.assetError.value }}</small>
    </div>
    <AssetPickerModal v-model:show="pickerOpen" :limit="Math.max(MAX_ASSETS - rep.assets.value.length, 1)" media="image" @select="onPicked" />
  </div>
</template>
