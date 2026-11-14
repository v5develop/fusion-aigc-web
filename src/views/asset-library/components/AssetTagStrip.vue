<script setup lang="ts">
/**
 * 资产库标签带（对齐原型 AssetsView 的 relay-tag-strip + relay-tag-panel），取代「标签管理」弹窗：
 *   - 带上：「全部标签」钮 + 「未分类」+ 各标签胶囊（点即筛选）+ 「＋」行内新建；
 *   - 「全部标签」展开行内浮层：搜索（放大镜点开）、新增 / 改名 / 删除三个模式、双击胶囊改名、「完成」收起。
 * 标签的新建 / 重命名 / 删除直接走 asset-library API，结果通过 changed 抛给页面刷新字典与列表。
 *
 *   <AssetTagStrip v-model:active="filters.tag" :tags="tags" :untagged-count="untaggedCount" @changed="onTagsChanged" />
 *
 * - active：当前筛选的标签名（空 = 不筛；UNTAGGED_TAG = 未分类）。改名 / 删除命中它时由本组件改写 / 清空；
 * - changed(deletedName?)：与旧 TagManagerModal 同一签名，页面现有 onTagsChanged 可直接接。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useDialog, useMessage } from 'naive-ui'
import { assetLibTagCreate, assetLibTagDelete, assetLibTagRename } from '@/api/asset-library.ts'
import type { IAssetLibTag } from '@/api/asset-library.ts'
import IconButton from '@/components/IconButton/index.vue'
import { PILL_CLS, PILL_COUNT_CLS, PILL_OFF, PILL_ON } from '../ui.ts'
import { UNTAGGED_TAG } from '../useAssetDelete.ts'

const props = defineProps<{
  tags: IAssetLibTag[]
  untaggedCount?: number | null
}>()
const active = defineModel<string>('active', { required: true })
const emit = defineEmits<{ changed: [deletedName?: string] }>()

const message = useMessage()
const dialog = useDialog()

const NAME_MAX = 32
const root = ref<HTMLElement | null>(null)
const open = ref(false)
const mode = ref<'' | 'rename' | 'delete'>('')
const query = ref('')
const searching = ref(false)
const searchEl = ref<HTMLInputElement | null>(null)

const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  return q ? props.tags.filter((t) => t.name.toLowerCase().includes(q)) : props.tags
})

/** Esc 关掉输入框后把焦点还给触发它的按钮（输入框销毁后焦点会掉到 body） */
function focusTrigger(selector: string) {
  void nextTick(() => root.value?.querySelector<HTMLElement>(selector)?.focus())
}

// ---------------- 新建（带上「＋」与浮层「新增」共用） ----------------
const composing = ref<'' | 'strip' | 'panel'>('')
const draft = ref('')
const creating = ref(false)
const draftEl = ref<HTMLInputElement | null>(null)

function startCompose(where: 'strip' | 'panel') {
  composing.value = where
  draft.value = ''
  mode.value = ''
  void nextTick(() => draftEl.value?.focus())
}
function cancelCompose() {
  composing.value = ''
  draft.value = ''
}
async function commitCompose() {
  const name = draft.value.trim()
  if (!name) return cancelCompose()
  if (creating.value) return
  if (name.length > NAME_MAX) return void message.warning(`标签名最多 ${NAME_MAX} 字`)
  if (props.tags.some((t) => t.name === name)) return void message.warning('已有同名标签')
  creating.value = true
  try {
    await assetLibTagCreate(name)
    message.success('标签已新建')
    cancelCompose()
    emit('changed')
  } catch {
    // 失败（重名 / 超限）toast 已由请求层弹出，保留输入便于改名
  } finally {
    creating.value = false
  }
}

// ---------------- 改名 ----------------
const renamingId = ref<number | null>(null)
const renameDraft = ref('')
let renameBusy = false

function startRename(t: IAssetLibTag) {
  renamingId.value = t.id
  renameDraft.value = t.name
  void nextTick(() => root.value?.querySelector<HTMLInputElement>('[data-rename-input]')?.focus())
}
function cancelRename() {
  renamingId.value = null
}
async function commitRename() {
  const id = renamingId.value
  if (id == null || renameBusy) return
  const old = props.tags.find((t) => t.id === id)
  const name = renameDraft.value.trim()
  if (!old || !name || name === old.name) return cancelRename()
  if (name.length > NAME_MAX) return void message.warning(`标签名最多 ${NAME_MAX} 字`)
  if (props.tags.some((t) => t.id !== id && t.name === name)) return void message.warning('已有同名标签')
  renameBusy = true
  try {
    await assetLibTagRename(id, name)
    if (active.value === old.name) active.value = name
    // 等待期间用户可能已改去重命名别的标签：只收起仍属于这次提交的那个输入框
    if (renamingId.value === id) cancelRename()
    emit('changed')
  } catch {
    // 重名等失败 toast 已弹，输入框留着供修改重试
  } finally {
    renameBusy = false
  }
}

// ---------------- 删除 ----------------
function removeTag(t: IAssetLibTag) {
  dialog.warning({
    title: `删除标签「${t.name}」`,
    content: `将从 ${t.assetCount} 个资产上解除这个标签，资产本身不受影响。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      await assetLibTagDelete(t.id)
      message.success(`已删除标签「${t.name}」`)
      if (active.value === t.name) active.value = ''
      emit('changed', t.name)
    },
  })
}

// ---------------- 浮层开合 ----------------
function toggleMode(m: 'rename' | 'delete') {
  mode.value = mode.value === m ? '' : m
  cancelCompose()
  cancelRename()
}
function openSearch() {
  searching.value = true
  void nextTick(() => searchEl.value?.focus())
}
function closeSearch() {
  searching.value = false
  query.value = ''
}
function closePanel() {
  open.value = false
}
watch(open, (on) => {
  if (!on) {
    mode.value = ''
    cancelCompose()
    cancelRename()
    closeSearch()
  }
})

function onChip(t: IAssetLibTag) {
  if (mode.value === 'rename') return startRename(t)
  active.value = active.value === t.name ? '' : t.name
}

function onDocDown(e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) closePanel()
}
// 文档级 Esc：面板打开期间生效，逐层关闭（新建 / 改名输入 → 搜索 → 模式 → 面板），不依赖焦点在哪
function onEsc(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !open.value || e.isComposing) return
  e.stopPropagation()
  if (composing.value) {
    const where = composing.value
    cancelCompose()
    focusTrigger(`[data-tag-trigger="add-${where}"]`)
  } else if (renamingId.value != null) {
    const id = renamingId.value
    cancelRename()
    focusTrigger(`[data-tag-chip="${id}"]`)
  } else if (searching.value) {
    closeSearch()
    focusTrigger('[data-tag-trigger="search"]')
  } else if (mode.value) {
    const m = mode.value
    mode.value = ''
    focusTrigger(`[data-tag-trigger="mode-${m}"]`)
  } else {
    closePanel()
    focusTrigger('[data-tag-trigger="panel"]')
  }
}
watch(open, (on) => {
  if (on) {
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onEsc, true)
  } else {
    document.removeEventListener('mousedown', onDocDown)
    document.removeEventListener('keydown', onEsc, true)
  }
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocDown)
  document.removeEventListener('keydown', onEsc, true)
})

const ACT =
  'h-26px cursor-pointer rounded-13px border border-solid px-10px text-12px leading-24px transition-colors sx-focus'
const CELL_INPUT =
  'h-28px w-96px box-border rounded-14px border border-solid border-violet-line bg-white px-10px text-12px text-ink outline-none placeholder:text-placeholder'
</script>

<template>
  <div ref="root" class="relative flex min-w-0 flex-1 items-center gap-6px">
    <IconButton
      label="全部标签"
      size="md"
      variant="plate"
      :aria-expanded="open"
      aria-haspopup="dialog"
      data-tag-trigger="panel"
      @click="open = !open"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7a1 1 0 0 1 .7.3l7.3 7.3a1 1 0 0 1 0 1.4l-7.7 7.7a1 1 0 0 1-1.4 0l-7.3-7.3a1 1 0 0 1-.3-.7Z" />
        <circle cx="8.2" cy="8.2" r="1.2" />
      </svg>
    </IconButton>

    <!-- 标签带 -->
    <div
      class="flex min-w-0 flex-1 items-center gap-6px overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="group"
      aria-label="按标签筛选"
    >
      <button
        type="button"
        :aria-pressed="active === UNTAGGED_TAG"
        :class="[PILL_CLS, active === UNTAGGED_TAG ? PILL_ON : PILL_OFF]"
        @click="active = active === UNTAGGED_TAG ? '' : UNTAGGED_TAG"
      >
        未分类<em v-if="untaggedCount != null" :class="PILL_COUNT_CLS" class="not-italic">{{ untaggedCount }}</em>
      </button>
      <button
        v-for="t in tags"
        :key="t.id"
        type="button"
        :aria-pressed="active === t.name"
        :class="[PILL_CLS, active === t.name ? PILL_ON : PILL_OFF]"
        @click="active = active === t.name ? '' : t.name"
      >
        {{ t.name }}<em :class="PILL_COUNT_CLS" class="not-italic">{{ t.assetCount }}</em>
      </button>
      <input
        v-if="composing === 'strip'"
        ref="draftEl"
        v-model="draft"
        :maxlength="NAME_MAX"
        placeholder="标签名"
        aria-label="新标签名"
        :disabled="creating"
        :class="CELL_INPUT"
        class="shrink-0"
        @keydown.enter.prevent="commitCompose"
        @keydown.esc.stop="cancelCompose"
        @blur="commitCompose"
      />
      <button v-else type="button" aria-label="新建标签" title="新建标签" data-tag-trigger="add-strip" :class="[PILL_CLS, PILL_OFF]" @click="startCompose('strip')">＋</button>
    </div>

    <!-- 全部标签浮层 -->
    <Transition name="xq-tag-panel">
      <div
        v-if="open"
        role="dialog"
        aria-label="全部标签"
        class="sx-squircle absolute left-0 top-[calc(100%+8px)] z-20 flex w-[min(460px,calc(100vw-40px))] flex-col gap-10px rounded-14px border border-solid border-line bg-white p-12px shadow-pop"
      >
        <header class="flex items-center gap-8px">
          <b class="text-13px leading-20px text-ink">全部标签</b>
          <span v-if="tags.length" class="text-12px leading-16px text-placeholder tabular-nums">{{ tags.length }}</span>
          <span class="flex-1" />
          <button v-if="!searching" type="button" aria-label="搜索标签" data-tag-trigger="search" class="grid h-28px w-28px cursor-pointer place-items-center rounded-full border-none bg-transparent p-0 text-muted hover:(bg-surface3 text-ink) sx-focus" @click="openSearch">
            <svg class="h-14px w-14px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
          </button>
          <input
            v-else
            ref="searchEl"
            v-model="query"
            type="search"
            aria-label="搜索标签"
            placeholder="搜索标签"
            class="h-28px w-130px box-border rounded-14px border border-solid border-line bg-surface px-10px text-12px text-ink outline-none placeholder:text-placeholder focus:border-violet"
            @blur="!query.trim() && closeSearch()"
          />
          <button type="button" :class="[ACT, 'border-line bg-surface text-ink-2 hover:border-control']" data-tag-trigger="add-panel" @click="startCompose('panel')">新增</button>
          <button type="button" :aria-pressed="mode === 'rename'" data-tag-trigger="mode-rename" :class="[ACT, mode === 'rename' ? 'border-violet bg-violet-tint text-violet-ink' : 'border-line bg-surface text-ink-2 hover:border-control']" @click="toggleMode('rename')">改名</button>
          <button type="button" :aria-pressed="mode === 'delete'" data-tag-trigger="mode-delete" :class="[ACT, mode === 'delete' ? 'border-danger-line bg-danger-soft text-alert-danger' : 'border-line bg-surface text-ink-2 hover:border-control']" @click="toggleMode('delete')">删除</button>
        </header>

        <p v-if="mode" class="m-0 text-12px leading-16px text-muted">
          {{ mode === 'rename' ? '点标签（或双击）改名，回车保存' : '点标签右侧的 × 删除，会从所有资产上摘掉' }}
        </p>

        <div v-if="shown.length || composing === 'panel'" class="flex max-h-260px flex-wrap gap-6px overflow-y-auto">
          <template v-for="t in shown" :key="t.id">
            <input
              v-if="renamingId === t.id"
              v-model="renameDraft"
              data-rename-input
              :maxlength="NAME_MAX"
              :aria-label="`重命名标签 ${t.name}`"
              :class="CELL_INPUT"
              @keydown.enter.prevent="commitRename"
              @blur="commitRename"
            />
            <span
              v-else-if="mode === 'delete'"
              class="inline-flex h-28px items-center gap-4px rounded-14px border border-solid border-danger-line bg-danger-soft pl-10px pr-4px text-12px text-alert-danger"
            >
              {{ t.name }}
              <button type="button" :aria-label="`删除标签 ${t.name}`" title="删除标签" class="grid h-20px w-20px cursor-pointer place-items-center rounded-full border-none bg-transparent p-0 text-alert-danger hover:bg-danger-line sx-focus" @click="removeTag(t)">×</button>
            </span>
            <button
              v-else
              type="button"
              :data-tag-chip="t.id"
              :aria-pressed="active === t.name"
              :title="mode ? undefined : '双击改名'"
              :class="[PILL_CLS, 'h-28px', active === t.name ? PILL_ON : PILL_OFF]"
              @click="onChip(t)"
              @dblclick="startRename(t)"
            >
              {{ t.name }}<em :class="PILL_COUNT_CLS" class="not-italic">{{ t.assetCount }}</em>
            </button>
          </template>
          <input
            v-if="composing === 'panel'"
            ref="draftEl"
            v-model="draft"
            :maxlength="NAME_MAX"
            placeholder="新标签"
            aria-label="新标签名"
            :disabled="creating"
            :class="CELL_INPUT"
            @keydown.enter.prevent="commitCompose"
                @blur="commitCompose"
          />
        </div>
        <p v-else class="m-0 py-16px text-center text-12px leading-18px text-placeholder">
          {{ query.trim() ? '没有匹配的标签' : '还没有标签，点「新增」建一个' }}
        </p>

        <footer class="flex justify-end">
          <button type="button" class="sx-soft-btn sx-soft-btn-primary" @click="closePanel">完成</button>
        </footer>
      </div>
    </Transition>
  </div>
</template>

<style scoped lang="less">
.xq-tag-panel-enter-active,
.xq-tag-panel-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}
.xq-tag-panel-enter-from,
.xq-tag-panel-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
@media (prefers-reduced-motion: reduce) {
  .xq-tag-panel-enter-active,
  .xq-tag-panel-leave-active {
    transition: none;
  }
}
</style>
