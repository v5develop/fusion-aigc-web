<script setup lang="ts">
/**
 * 模特选择器：公共模板 / 我的模特两个页签，多选后按选中顺序交回模特图地址。
 *
 * <p>数据与增删改走 useModelLibrary（与 FixedModelPicker 同一套 /api/v1/models 接口与校验）；
 * 新建模特的图片走 StudioImageUpload / useStudioUploader（同 FixedModelPicker 的直传通道）。
 * 只负责「选」：选中结果经 confirm 交给页面，由页面按自己的规则入列（去重、格式、余量）。
 *
 * <p>键盘：方向键在卡片间移动（按当前列数换行）、Home / End 到首尾，Enter / Space 选中或取消，
 * Esc 关闭；关闭后焦点回到 returnFocus（不传则回到打开前的焦点）。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import StudioImageUpload from '@/views/studio/components/StudioImageUpload/index.vue'
import { useStudioUploader } from '@/views/studio/components/StudioImageUpload/useStudioUploader.ts'
import { useFileDropPaste } from '@/composables/useFileDropPaste'
import { MODEL_FIELD_MAX, useModelLibrary, type ModelPickerItem } from './useModelLibrary'

const {
  limit,
  max = 9,
  exclude = [],
  returnFocus = null,
} = defineProps<{
  /** 这次最多能选几位（页面传「上限 − 已有」） */
  limit: number
  /** 模特图总上限（只用于文案） */
  max?: number
  /** 已在列表里的图片地址：卡片标「已添加」，不可再选 */
  exclude?: string[]
  /** 关闭后把焦点还给谁（一般是打开它的按钮） */
  returnFocus?: HTMLElement | null
}>()

const emit = defineEmits<{
  /** 按选中顺序交回图片地址与对应模特 */
  confirm: [urls: string[], items: ModelPickerItem[]]
}>()

const show = defineModel<boolean>('show', { required: true })

const message = useMessage()
const lib = useModelLibrary()
const { uploading, uploadFiles } = useStudioUploader()

type TabKey = 'preset' | 'custom'
const tab = ref<TabKey>('preset')
const tabs = computed(() => [
  { key: 'preset' as const, label: '公共模板', count: lib.presetModels.value.length },
  { key: 'custom' as const, label: '我的模特', count: lib.customModels.value.length },
])
const items = computed(() => (tab.value === 'preset' ? lib.presetModels.value : lib.customModels.value))

// ---------------- 选择 ----------------

/** 按点选顺序保存（跨页签保留） */
const picked = ref<ModelPickerItem[]>([])
const pickedIndex = (item: ModelPickerItem) => picked.value.findIndex((p) => p.id === item.id)
const room = computed(() => Math.max(0, limit))
const atLimit = computed(() => picked.value.length >= room.value)
const excluded = (item: ModelPickerItem) => exclude.includes(item.image)

function toggle(item: ModelPickerItem) {
  const index = pickedIndex(item)
  if (index >= 0) {
    picked.value = picked.value.filter((_, i) => i !== index)
    return
  }
  if (excluded(item)) {
    message.info('这位已在模特图里')
    return
  }
  if (atLimit.value) {
    message.warning(`最多还能加 ${room.value} 位（上限 ${max} 位）`)
    return
  }
  picked.value = [...picked.value, item]
}

function confirm() {
  if (!picked.value.length) return
  emit(
    'confirm',
    picked.value.map((p) => p.image),
    picked.value,
  )
  show.value = false
}

// ---------------- 打开 / 关闭 ----------------

let lastFocus: HTMLElement | null = null

watch(show, (open) => {
  if (!open) return
  lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  picked.value = []
  focusIndex.value = 0
  if (!lib.loaded.value && !lib.loading.value) void lib.load()
})

function afterLeave() {
  const target = returnFocus ?? lastFocus
  if (target?.isConnected) target.focus()
}

// ---------------- 键盘：卡片之间的漫游焦点 ----------------

const gridEl = ref<HTMLElement | null>(null)
const focusIndex = ref(0)
/** 可导航格子数：我的模特页签的第一格是上传格 */
const navCount = computed(() => items.value.length + (tab.value === 'custom' ? 1 : 0))
const navOffset = computed(() => (tab.value === 'custom' ? 1 : 0))

watch(tab, () => (focusIndex.value = 0))
watch(navCount, (n) => {
  if (focusIndex.value >= n) focusIndex.value = Math.max(0, n - 1)
})

function columns() {
  const el = gridEl.value
  if (!el) return 1
  return Math.max(1, getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length)
}

function moveFocus(next: number) {
  const n = navCount.value
  if (!n) return
  focusIndex.value = Math.min(n - 1, Math.max(0, next))
  void nextTick(() => gridEl.value?.querySelector<HTMLElement>(`[data-nav="${focusIndex.value}"]`)?.focus())
}

function onGridKeydown(event: KeyboardEvent) {
  const cols = columns()
  const map: Record<string, number> = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -cols,
    ArrowDown: cols,
  }
  if (event.key in map) {
    event.preventDefault()
    moveFocus(focusIndex.value + (map[event.key] ?? 0))
  } else if (event.key === 'Home') {
    event.preventDefault()
    moveFocus(0)
  } else if (event.key === 'End') {
    event.preventDefault()
    moveFocus(navCount.value - 1)
  }
}

function onCardKeydown(event: KeyboardEvent, item: ModelPickerItem) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  toggle(item)
}

// ---------------- 新建 / 修改我的模特 ----------------

const formShow = ref(false)
const formSaving = ref(false)
const formEditId = ref<number | null>(null)
const form = ref({ title: '', description: '', images: [] as string[] })
const formTitle = computed(() => (formEditId.value == null ? '添加我的模特' : '修改自建模特'))

function openCreate(preset: { title?: string; images?: string[] } = {}) {
  formEditId.value = null
  form.value = { title: preset.title ?? '', description: '', images: preset.images ?? [] }
  formShow.value = true
}

function openEdit(item: ModelPickerItem) {
  const origin = lib.findUserModel(item.userModelId)
  if (!origin) return
  formEditId.value = origin.userModelId
  form.value = { title: origin.title, description: origin.description, images: [origin.imageUrl] }
  formShow.value = true
}

async function saveForm() {
  if (formSaving.value) return
  const title = form.value.title.trim()
  const description = form.value.description.trim()
  const imageUrl = form.value.images[0] ?? ''
  if (!title) return message.warning('请填写模特名称')
  if (!description) return message.warning('请填写模特描述')
  if (!imageUrl) return message.warning('请上传模特图')
  formSaving.value = true
  try {
    const editId = formEditId.value
    if (editId == null) {
      const created = await lib.create(title, imageUrl, description)
      // 新建的直接选上（还有余量时），方便一步加入
      if (created && !atLimit.value && !excluded(created)) picked.value = [...picked.value, created]
      tab.value = 'custom'
    } else {
      await lib.update(editId, { title, description, imageUrl })
      // 已选中的同步成最新的名称 / 图
      const fresh = lib.customModels.value.find((m) => m.userModelId === editId)
      if (fresh) picked.value = picked.value.map((p) => (p.userModelId === editId ? fresh : p))
    }
    formShow.value = false
  } catch {
    // 业务失败拦截器已提示
  } finally {
    formSaving.value = false
  }
}

const deleting = ref<number | null>(null)

async function removeItem(item: ModelPickerItem) {
  const id = item.userModelId
  if (id == null || deleting.value != null) return
  deleting.value = id
  try {
    await lib.remove(id)
    picked.value = picked.value.filter((p) => p.userModelId !== id)
  } catch (err) {
    message.error(err instanceof Error ? err.message : '删除失败，请重试')
  } finally {
    deleting.value = null
  }
}

// 拖入 / 粘贴到上传格：先直传，再带着图和文件名打开新建表单
const uploadTileEl = ref<HTMLElement | null>(null)
const titleOf = (fileName: string) => (fileName.replace(/\.[^.]+$/, '') || '我的模特').slice(0, MODEL_FIELD_MAX)
const { dragging } = useFileDropPaste(uploadTileEl, {
  accept: 'image',
  disabled: uploading,
  onFiles: ([file]) => {
    if (!file) return
    void uploadFiles([file], 1, 1, (url) => openCreate({ title: titleOf(file.name), images: [url] }))
  },
})

// ---------------- 样式 ----------------

const cardBase =
  'group relative flex flex-col overflow-hidden rounded-lg border border-solid bg-white text-left cursor-pointer select-none ' +
  'transition-[transform,box-shadow,border-color] duration-mid ease-sx motion-reduce:transition-none sx-focus'
const cardIdle =
  'border-line hover:(-translate-y-2px border-violet-line shadow-raised-hover) motion-reduce:hover:translate-y-0'
const cardOn = 'border-violet shadow-focus'
const checkPath = 'M5 12.5l4.2 4.2L19 7'
</script>

<template>
  <n-modal
    v-model:show="show"
    preset="card"
    title="模特选择"
    :style="{ width: '820px', maxWidth: 'calc(100vw - 48px)' }"
    :content-style="{ padding: '0 20px' }"
    :footer-style="{ padding: '12px 20px' }"
    @after-leave="afterLeave"
  >
    <!-- 页签：分段控件 -->
    <div class="flex items-center gap-12px pb-12px">
      <div class="sx-seg" role="tablist" aria-label="模特来源">
        <button
          v-for="t in tabs"
          :key="t.key"
          type="button"
          role="tab"
          class="sx-seg-item gap-6px px-14px text-12px sx-focus"
          :class="tab === t.key && 'sx-seg-on'"
          :aria-selected="tab === t.key"
          @click="tab = t.key"
        >
          {{ t.label }}
          <span v-if="lib.loaded.value" class="text-10px font-400 text-placeholder tabular-nums">{{ t.count }}</span>
        </button>
      </div>
      <span class="sx-hint">{{
        tab === 'preset' ? '点选卡片可多选，按选中顺序加入' : '单人、正脸、清晰的图片效果最好'
      }}</span>
    </div>

    <div class="max-h-[min(58vh,560px)] min-h-240px overflow-y-auto -mx-6px px-6px pt-4px pb-12px">
      <!-- 加载中：骨架卡 -->
      <div v-if="lib.loading.value" class="grid grid-cols-3 md:grid-cols-4 gap-12px" aria-busy="true">
        <div
          v-for="n in 8"
          :key="n"
          class="flex flex-col overflow-hidden rounded-lg border border-solid border-line bg-white"
        >
          <div class="aspect-[3/4] bg-surface3 animate-pulse motion-reduce:animate-none" />
          <div class="flex flex-col gap-6px p-10px">
            <div class="h-12px w-3/5 rounded-xs bg-surface3 animate-pulse motion-reduce:animate-none" />
            <div class="h-10px w-4/5 rounded-xs bg-surface3 animate-pulse motion-reduce:animate-none" />
          </div>
        </div>
      </div>

      <template v-else>
        <div
          ref="gridEl"
          class="grid grid-cols-3 md:grid-cols-4 gap-12px"
          role="listbox"
          :aria-label="tab === 'preset' ? '公共模板' : '我的模特'"
          aria-multiselectable="true"
          @keydown="onGridKeydown"
        >
          <!-- 上传格（我的模特第一格） -->
          <button
            v-if="tab === 'custom'"
            ref="uploadTileEl"
            type="button"
            data-nav="0"
            :tabindex="focusIndex === 0 ? 0 : -1"
            class="flex flex-col items-center justify-center gap-6px min-h-200px p-12px box-border rounded-lg border border-dashed border-control sx-grad-upload text-violet text-center cursor-pointer transition-colors duration-mid hover:(border-violet-line to-#fbf7fd) disabled:(cursor-wait opacity-60) sx-focus"
            :class="dragging && 'sx-drop'"
            :disabled="uploading"
            @click="openCreate()"
            @focus="focusIndex = 0"
          >
            <span class="grid place-items-center w-40px h-40px rounded-full sx-grad-icon" aria-hidden="true">
              <svg class="w-20px h-20px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 5v14M5 12h14" stroke-linecap="round" />
              </svg>
            </span>
            <span class="text-12px font-600 text-ink">{{ uploading ? '上传中…' : '上传我的模特' }}</span>
            <span class="text-10px leading-15px text-ink-2">单人、正脸、清晰的图片效果最好</span>
          </button>

          <div
            v-for="(item, i) in items"
            :key="item.id"
            :data-nav="i + navOffset"
            :tabindex="focusIndex === i + navOffset ? 0 : -1"
            role="option"
            :aria-selected="pickedIndex(item) >= 0"
            :aria-disabled="excluded(item) || (atLimit && pickedIndex(item) < 0) || undefined"
            :aria-label="`${item.name}，${item.description || item.tag}`"
            :class="[
              cardBase,
              pickedIndex(item) >= 0 ? cardOn : cardIdle,
              (excluded(item) || (atLimit && pickedIndex(item) < 0)) && 'opacity-55',
            ]"
            @click="toggle(item)"
            @keydown="onCardKeydown($event, item)"
            @focus="focusIndex = i + navOffset"
          >
            <div class="relative aspect-[3/4] overflow-hidden bg-surface3">
              <img
                class="block w-full h-full object-cover"
                :src="item.image"
                :alt="item.name"
                loading="lazy"
                draggable="false"
              />
              <!-- 选中：左上角序号勾（序号 = 加入顺序） -->
              <span
                class="absolute top-8px left-8px grid place-items-center w-22px h-22px rounded-full border border-solid text-11px font-600 tabular-nums transition-colors duration-fast"
                :class="
                  pickedIndex(item) >= 0
                    ? 'sx-grad-primary border-violet-border text-white shadow-btn'
                    : 'border-white/90 bg-black/18 text-transparent opacity-0 group-hover:opacity-100'
                "
                aria-hidden="true"
              >
                <template v-if="pickedIndex(item) >= 0">{{ pickedIndex(item) + 1 }}</template>
                <svg
                  v-else
                  class="w-12px h-12px text-white"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.4"
                >
                  <path :d="checkPath" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </span>
              <span
                v-if="excluded(item)"
                class="absolute bottom-8px left-8px sx-chip bg-white/92 text-ink-2 shadow-toast"
                >已添加</span
              >
              <!-- 我的模特：编辑 / 删除 -->
              <div
                v-if="item.source === 'custom'"
                class="absolute top-6px right-6px flex gap-4px sx-reveal"
                @click.stop
                @keydown.stop
              >
                <n-button size="small" secondary class="!bg-white/92" @click="openEdit(item)">编辑</n-button>
                <n-popconfirm @positive-click="removeItem(item)">
                  <template #trigger>
                    <n-button
                      size="small"
                      secondary
                      type="error"
                      class="!bg-white/92"
                      :loading="deleting === item.userModelId"
                    >
                      删除
                    </n-button>
                  </template>
                  删除自建模特「{{ item.name }}」？
                </n-popconfirm>
              </div>
            </div>
            <div class="flex flex-col gap-2px px-10px pt-8px pb-10px min-w-0">
              <span class="overflow-hidden text-13px font-600 leading-18px text-ink whitespace-nowrap text-ellipsis">{{
                item.name
              }}</span>
              <span class="overflow-hidden text-11px leading-16px text-muted whitespace-nowrap text-ellipsis">{{
                item.description || item.tag
              }}</span>
            </div>
          </div>

          <!-- 我的模特为空：上传格之后的说明 -->
          <div
            v-if="tab === 'custom' && !items.length"
            class="col-span-2 md:col-span-3 flex flex-col items-start justify-center gap-4px px-8px"
          >
            <span class="sx-empty-title">还没有自建模特</span>
            <span class="sx-empty-desc">上传一张模特图，填好名称和描述，之后可反复使用</span>
          </div>
        </div>

        <div v-if="tab === 'preset' && !items.length" class="sx-empty">
          <span class="sx-empty-title">暂无公共模板</span>
          <span class="sx-empty-desc">可切到「我的模特」上传自己的模特图</span>
        </div>
      </template>
    </div>

    <!-- 底部选择条 -->
    <template #footer>
      <div class="flex items-center gap-10px">
        <div class="flex items-center gap-8px min-w-0">
          <span class="text-13px text-ink-2 tabular-nums">
            已选 <b class="font-600 text-violet-ink">{{ picked.length }}</b> / {{ room }}
          </span>
          <span v-if="room < max" class="sx-hint">模特图已有 {{ max - room }} 位</span>
          <span v-if="picked.length" class="flex items-center -space-x-6px" aria-hidden="true">
            <img
              v-for="p in picked"
              :key="p.id"
              :src="p.image"
              alt=""
              class="block w-26px h-26px rounded-full border-2 border-solid border-white object-cover shadow-[0_1px_2px_rgba(31,35,41,0.18)]"
            />
          </span>
        </div>
        <span class="flex-1" />
        <n-button quaternary @click="show = false">取消</n-button>
        <n-button type="primary" :disabled="!picked.length" @click="confirm">
          加入{{ picked.length ? ` ${picked.length} 位` : '' }}
        </n-button>
      </div>
    </template>
  </n-modal>

  <n-modal
    v-model:show="formShow"
    preset="card"
    :title="formTitle"
    :style="{ width: '420px', maxWidth: 'calc(100vw - 48px)' }"
  >
    <div class="flex flex-col gap-12px">
      <StudioImageUpload v-model="form.images" :max="1" :multiple="false" label="模特图" cloud />
      <n-input v-model:value="form.title" :maxlength="MODEL_FIELD_MAX" placeholder="模特名称" />
      <n-input v-model:value="form.description" :maxlength="MODEL_FIELD_MAX" placeholder="模特描述" />
    </div>
    <template #footer>
      <div class="flex items-center justify-end gap-2">
        <n-button quaternary @click="formShow = false">取消</n-button>
        <n-button type="primary" :loading="formSaving" @click="saveForm">保存</n-button>
      </div>
    </template>
  </n-modal>
</template>
