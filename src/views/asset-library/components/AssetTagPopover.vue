<script setup lang="ts">
/**
 * 单卡快捷打标签浮层（原型 relay-tag-menu）：搜索标签 + 标签列表（含资产数）+ 新建标签。
 * 点标签即在这一个资产上加 / 去该标签（加走 batch-tag，去走 PATCH tags 整组替换）；
 * 点「未分类」清空该资产全部标签。乐观更新卡片标签与计数，失败回滚。
 * 页面只放一个实例，卡片通过 open(asset, anchor) 唤起。
 */
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { NButton, NInput, NModal, useMessage } from 'naive-ui'
import { ApiError } from '@/api/index.ts'
import { assetLibBatchTag, assetLibTagCreate, assetLibTags, assetLibUpdate } from '@/api/asset-library.ts'
import type { IAssetLibAsset, IAssetLibTag } from '@/api/asset-library.ts'

const message = useMessage()
const emit = defineEmits<{ changed: [] }>()

const MENU_WIDTH = 260
const MENU_HEIGHT = 360

const tags = ref<IAssetLibTag[]>([])
const asset = ref<IAssetLibAsset | null>(null)
const pos = ref({ left: 0, top: 0 })
const query = ref('')
const busy = ref(false)
const menuEl = ref<HTMLElement | null>(null)
const searchEl = ref<HTMLInputElement | null>(null)
let anchorEl: HTMLElement | null = null
/** 「未分类」的服务端计数；取不到时不显示 */
const untaggedCount = ref<number | null>(null)

async function loadTags() {
  try {
    const res = await assetLibTags()
    tags.value = res.data?.items ?? []
    untaggedCount.value = res.data?.untaggedCount ?? null
  } catch {
    // 拉失败沿用上次的字典；失败 toast 已由请求层弹出
  }
}

/** 浮层位置（原型）：贴在触发器下方、与卡片内容左缘对齐，放不下翻到上方；水平方向不出视口 */
function place(el: HTMLElement) {
  const rect = el.getBoundingClientRect()
  const card = el.closest('[data-asset-card]')?.getBoundingClientRect()
  let top = rect.bottom + 6
  if (top + MENU_HEIGHT > window.innerHeight) top = Math.max(8, rect.top - MENU_HEIGHT - 6)
  const left = Math.min(Math.max(8, (card?.left ?? rect.left) + 8), window.innerWidth - MENU_WIDTH - 8)
  pos.value = { left, top }
}

function open(target: IAssetLibAsset, anchor: HTMLElement) {
  if (asset.value?.id === target.id) {
    close()
    return
  }
  asset.value = target
  anchorEl = anchor
  query.value = ''
  place(anchor)
  void loadTags()
  bind()
  void nextTick(() => searchEl.value?.focus())
}

function close(restoreFocus = false) {
  if (!asset.value) return
  asset.value = null
  unbind()
  if (restoreFocus && anchorEl?.isConnected) anchorEl.focus()
}

defineExpose({ open, close })

// ---------------- 关闭时机：点外面 / 页面滚动 / 视口变化 ----------------

function onDocPointer(e: PointerEvent) {
  const t = e.target as Node | null
  if (!t || menuEl.value?.contains(t) || anchorEl?.contains(t)) return
  close()
}
function onScroll(e: Event) {
  if (menuEl.value && e.target instanceof Node && menuEl.value.contains(e.target)) return
  close()
}
function onResize() {
  close()
}
function bind() {
  document.addEventListener('pointerdown', onDocPointer, true)
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', onResize)
}
function unbind() {
  document.removeEventListener('pointerdown', onDocPointer, true)
  window.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', onResize)
}
onBeforeUnmount(unbind)

/** 焦点移出浮层（Tab 走出去）即关闭 */
function onFocusOut(e: FocusEvent) {
  const next = e.relatedTarget as Node | null
  if (!next || menuEl.value?.contains(next) || anchorEl?.contains(next)) return
  close()
}

// ---------------- 列表 ----------------

interface IOption {
  key: string
  label: string
  /** null = 不显示计数 */
  count: number | null
  tag: IAssetLibTag | null
}

const options = computed<IOption[]>(() => {
  const needle = query.value.trim().toLowerCase()
  return [
    { key: '__uncat__', label: '未分类', count: untaggedCount.value, tag: null },
    ...tags.value
      .filter((t) => !needle || t.name.toLowerCase().includes(needle))
      .map((t) => ({ key: String(t.id), label: t.name, count: t.assetCount, tag: t })),
  ]
})

function isOn(o: IOption) {
  const tagsOnAsset = asset.value?.tags ?? []
  return o.tag ? tagsOnAsset.includes(o.tag.name) : !tagsOnAsset.length
}

/** 乐观改：资产标签 + 字典计数，返回回滚函数 */
function applyLocal(target: IAssetLibAsset, nextTags: string[]) {
  const prevTags = target.tags
  const prevCounts = new Map(tags.value.map((t) => [t.id, t.assetCount]))
  for (const t of tags.value) {
    const had = prevTags.includes(t.name)
    const has = nextTags.includes(t.name)
    if (had !== has) t.assetCount = Math.max(0, t.assetCount + (has ? 1 : -1))
  }
  target.tags = nextTags
  return () => {
    target.tags = prevTags
    for (const t of tags.value) {
      const c = prevCounts.get(t.id)
      if (c !== undefined) t.assetCount = c
    }
  }
}

function reportError(err: unknown) {
  // 业务失败请求层已弹 toast；网络 / HTTP 失败这里补一条
  if (!(err instanceof ApiError)) message.error('标签更新失败')
}

async function pick(o: IOption) {
  const target = asset.value
  if (!target || busy.value) return
  const on = isOn(o)
  if (!o.tag && on) return // 已是未分类
  const nextTags = !o.tag ? [] : on ? target.tags.filter((n) => n !== o.tag!.name) : [...target.tags, o.tag.name]
  const rollback = applyLocal(target, nextTags)
  busy.value = true
  try {
    if (o.tag && !on) await assetLibBatchTag({ assetIds: [target.id], tagIds: [o.tag.id] })
    else await assetLibUpdate(target.id, { tags: nextTags })
    message.success(o.tag && !on ? `已放入「${o.tag.name}」` : '已移出标签')
    emit('changed')
  } catch (err) {
    rollback()
    reportError(err)
  } finally {
    busy.value = false
  }
}

/** 列表内上下键移动焦点；搜索框按下键进入列表 */
function moveFocus(e: KeyboardEvent, delta: number) {
  const items = Array.from(menuEl.value?.querySelectorAll<HTMLElement>('[data-tag-option]') ?? [])
  if (!items.length) return
  e.preventDefault()
  const i = items.indexOf(document.activeElement as HTMLElement)
  if (i < 0) {
    items[delta > 0 ? 0 : items.length - 1]?.focus()
    return
  }
  const next = i + delta
  if (next < 0) searchEl.value?.focus()
  else items[Math.min(next, items.length - 1)]?.focus()
}

// ---------------- 新建标签（原型：关浮层开弹窗；建完放进这个资产） ----------------

const showCreate = ref(false)
const draft = ref('')
const creating = ref(false)
let createFor: IAssetLibAsset | null = null

function openCreate() {
  createFor = asset.value
  draft.value = ''
  close()
  showCreate.value = true
}

function onCreateClosed() {
  if (anchorEl?.isConnected) anchorEl.focus()
}

async function createTag() {
  const name = draft.value.trim()
  if (!name || creating.value) return
  if (name.length > 20) {
    message.warning('标签名最多 20 字')
    return
  }
  creating.value = true
  let created: IAssetLibTag | undefined
  try {
    const res = await assetLibTagCreate(name)
    created = res.data
  } catch (err) {
    reportError(err)
    return
  } finally {
    creating.value = false
  }
  showCreate.value = false
  if (!created?.id) return
  tags.value.push({ ...created, assetCount: 0 })
  emit('changed')
  const target = createFor
  createFor = null
  if (!target || target.tags.includes(created.name)) return
  const tag = tags.value[tags.value.length - 1]!
  const rollback = applyLocal(target, [...target.tags, tag.name])
  try {
    await assetLibBatchTag({ assetIds: [target.id], tagIds: [tag.id] })
    message.success(`已放入「${tag.name}」`)
    emit('changed')
  } catch (err) {
    rollback()
    reportError(err)
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="asset"
      ref="menuEl"
      role="dialog"
      aria-label="打标签"
      class="fixed z-[6000] w-260px p-6px border border-solid border-[#e2e5e9] rounded-8px bg-white shadow-[0_14px_36px_rgba(31,35,41,0.18)]"
      :style="{ left: `${pos.left}px`, top: `${pos.top}px` }"
      @keydown.esc.stop.prevent="close(true)"
      @focusout="onFocusOut"
    >
      <label
        class="flex items-center gap-6px h-28px mx-3px mt-1px mb-5px px-7px border border-solid border-line rounded-5px text-[#a3a9b1] focus-within:border-violet-line"
      >
        <svg class="w-12px h-12px shrink-0" viewBox="0 0 512 512" aria-hidden="true">
          <path
            d="M221.09 64a157.09 157.09 0 1 0 157.09 157.09A157.1 157.1 0 0 0 221.09 64z"
            fill="none"
            stroke="currentColor"
            stroke-miterlimit="10"
            stroke-width="32"
          />
          <path
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-miterlimit="10"
            stroke-width="32"
            d="M338.29 338.29L448 448"
          />
        </svg>
        <input
          ref="searchEl"
          v-model="query"
          aria-label="搜索标签"
          placeholder="搜索标签"
          class="min-w-0 flex-1 border-none outline-none bg-transparent text-11px text-ink placeholder:text-[#a3a9b1]"
          @keydown.down="moveFocus($event, 1)"
        />
      </label>
      <div class="max-h-250px overflow-y-auto" :aria-busy="busy">
        <button
          v-for="o in options"
          :key="o.key"
          type="button"
          data-tag-option
          :aria-pressed="isOn(o)"
          class="flex items-center gap-8px w-full h-30px px-8px border-none rounded-5px text-11px text-left cursor-pointer focus-visible:(outline outline-2 outline-violet outline-offset-[-2px])"
          :class="isOn(o) ? 'bg-[#f7f1fb] text-[#5c3f6c] font-600' : 'bg-transparent text-[#4b5563] hover:bg-[#f5f2f8]'"
          @click="pick(o)"
          @keydown.down="moveFocus($event, 1)"
          @keydown.up="moveFocus($event, -1)"
        >
          <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{{ o.label }}</span>
          <em v-if="o.count !== null" class="not-italic text-9px text-[#a3a9b1]">{{ o.count }}</em>
          <i class="w-10px not-italic text-9px text-[#6b487c]" aria-hidden="true">{{ isOn(o) ? '✓' : '' }}</i>
        </button>
      </div>
      <button
        type="button"
        class="w-full h-30px mt-4px px-8px border-t border-line-soft rounded-b-5px bg-transparent text-11px text-left text-[#6b487c] cursor-pointer hover:bg-[#f5f2f8] focus-visible:(outline outline-2 outline-violet outline-offset-[-2px])"
        @click="openCreate"
        @keydown.up="moveFocus($event, -1)"
      >
        ＋ 新建标签
      </button>
    </div>
  </Teleport>

  <n-modal
    v-model:show="showCreate"
    preset="card"
    title="新建标签"
    style="width: 320px"
    :auto-focus="true"
    @after-leave="onCreateClosed"
  >
    <n-input v-model:value="draft" maxlength="20" placeholder="标签名称" @keyup.enter="createTag" />
    <template #footer>
      <div class="flex justify-end gap-8px">
        <n-button size="small" @click="showCreate = false">取消</n-button>
        <n-button size="small" type="primary" :loading="creating" @click="createTag">创建</n-button>
      </div>
    </template>
  </n-modal>
</template>
