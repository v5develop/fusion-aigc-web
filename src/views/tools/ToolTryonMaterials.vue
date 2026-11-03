<script setup lang="ts">
/**
 * 商拍换装的素材板（线上原型 AiDigitalModel `.dm-mat`）：一块内凹白板里并排两叠 60×100 白边浮片——服装图 / 模特图。
 *
 * <p>服装图：点叠片开「服装图」弹窗（ToolGarmentDialog，选单品 + 角度格）；右下云钮从资产库往第一件没满的单品里加；
 * 悬停出按单品分组的预览卡。写回服装图槽位的是原型 clothUrl() 那一张（契约只收一张 cloth_image_url）。
 *
 * <p>模特图：点叠片直接选文件（最多 9 位，逐位各提交一次，与原槽位同一个 modelImageUrl）；云钮开模特选择器
 * （components/model-picker，公共模板 / 我的模特多选，选中的图与资产库同一条入列路径）；
 * 悬停出「模特 n 位」面板，3 列逐位删除。满 9 位入口不再弹文件框，给原型同一句提示。
 *
 * <p>校验（格式 / 体积）与上传通道同 ToolUploadSlot（api/ossUpload.ts）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import StudioMedBtn from '@/views/studio/components/StudioImageUpload/StudioMedBtn.vue'
import AssetPickerModal from '@/views/studio/components/AssetPickerModal/index.vue'
import { ModelPicker } from '@/components/model-picker'
import ToolGarmentDialog from './ToolGarmentDialog.vue'
import { MAX_GARMENT, outfitLabel, useToolImageUpload, useTryonGarment } from './useTryonGarment'
import type { TryonGarment } from './useTryonGarment'
import type { UploadSpec } from './schemas'

const props = defineProps<{
  clothSpec: UploadSpec
  modelSpec: UploadSpec
  disabled?: boolean
  /**
   * 外部持有的服装图状态（商拍工作室要读逐件的图 / 角度拼 garment_images）；不传 = 组件自建（工具页默认）。
   * 只在创建时读一次，挂载后换实例不生效。
   */
  garment?: TryonGarment
  /** 上传通道（服装图自建状态与模特图共用）；不传走 api/ossUpload.ts（工具页默认） */
  uploadFn?: (files: File[]) => Promise<string[]>
}>()

defineSlots<{
  /** 素材板内、叠片行下方的内容（商拍工作室放补充说明与各单品参数）；不传 = 板内只有叠片行 */
  default?: () => unknown
}>()

/** 服装图槽位（clothImageUrl，max 1） */
const cloth = defineModel<string[]>('cloth', { required: true })
/** 模特图槽位（modelImageUrl，逐张提交） */
const models = defineModel<string[]>('models', { required: true })

const message = useMessage()
const uploadOptions = props.uploadFn ? { upload: props.uploadFn } : {}
const g = props.garment ?? useTryonGarment(() => props.clothSpec, uploadOptions)
const modelUploader = useToolImageUpload(() => props.modelSpec, uploadOptions)
const MAX_MODELS = computed(() => props.modelSpec.max)

// ---------------- 服装图 ⇄ 槽位 ----------------

/** 槽位里有、但不是弹窗产出的那张（重新编辑 / 回填带回来的）：照样显示、照样提交，弹窗里一传图就换掉 */
const external = ref('')
const clothOut = computed(() => g.allPhotos[0] ?? external.value)
watch(clothOut, (url) => {
  const next = url ? [url] : []
  if (next[0] !== cloth.value[0] || next.length !== cloth.value.length) cloth.value = next
})
watch(
  () => cloth.value[0] ?? '',
  (url) => {
    if (url === clothOut.value) return
    // 外部改了槽位（重置 / 回填 / 做同款清空）：弹窗里的整理一并作废
    g.reset()
    external.value = url
  },
  { immediate: true },
)
const garmentShown = computed(() => (g.allPhotos.length ? g.allPhotos : external.value ? [external.value] : []))

// ---------------- 叠片摊开 ----------------

const SLOT_GAP = 16
const PLATES = 9
const rowEl = ref<HTMLElement | null>(null)
const rowWidth = ref(0)
let observer: ResizeObserver | null = null
onMounted(() => {
  const el = rowEl.value
  if (!el || typeof ResizeObserver === 'undefined') return
  observer = new ResizeObserver(([entry]) => (rowWidth.value = entry?.contentRect.width ?? 0))
  observer.observe(el)
  rowWidth.value = el.getBoundingClientRect().width
})
onBeforeUnmount(() => observer?.disconnect())

const garmentPlates = computed(() => Math.max(1, Math.min(garmentShown.value.length, PLATES)))
const modelPlates = computed(() => Math.max(1, Math.min(models.value.length, PLATES)))
/** 收起宽度：60 + (n-1) × 6 */
const stackWidth = (n: number) => 60 + (n - 1) * 6
/** 展开步长：3px 间距放得下用 63；放不下按另一块的宽度压缩，最密 8 */
function expandStep(n: number, other: number) {
  const gaps = n - 1
  if (!gaps) return 63
  const room = (rowWidth.value || 410) - stackWidth(other) - SLOT_GAP
  return Math.min(63, Math.max(8, (room - 60) / gaps))
}

const garmentHover = ref(false)
const garmentExpanded = computed(() => garmentHover.value && garmentShown.value.length > 0)
const garmentStep = computed(() => (garmentExpanded.value ? expandStep(garmentPlates.value, modelPlates.value) : 6))
const modelsPeek = ref(false)
const modelsExpanded = computed(() => modelsPeek.value && models.value.length > 0)
const modelsStep = computed(() => (modelsExpanded.value ? expandStep(modelPlates.value, garmentPlates.value) : 6))

/** 模特块 / 面板之间悬停接力：离开任意一边先等 180ms */
let peekTimer: ReturnType<typeof setTimeout> | undefined
function enterModels() {
  clearTimeout(peekTimer)
  modelsPeek.value = true
}
function leaveModels() {
  clearTimeout(peekTimer)
  peekTimer = setTimeout(() => (modelsPeek.value = false), 180)
}
onBeforeUnmount(() => clearTimeout(peekTimer))
/** 模特面板左缘 = 切口位置：左侧叠片收起宽度 + 16 间距 */
const modelsPanelLeft = computed(() => SLOT_GAP + stackWidth(garmentPlates.value))

// ---------------- 服装图入口 ----------------

const dialogOpen = ref(false)
function openDialog() {
  if (props.disabled) return
  dialogOpen.value = true
}

const assetShow = ref(false)
const assetFor = ref<'garment' | 'models'>('models')
const assetKey = ref('')
const assetLimit = ref(1)

function openGarmentAssets() {
  if (props.disabled || g.uploading) return
  const target = g.assetTarget()
  if (!target) return
  assetFor.value = 'garment'
  assetKey.value = target.key
  assetLimit.value = target.room
  assetShow.value = true
}

function clearGarment() {
  if (props.disabled) return
  const count = garmentShown.value.length
  g.clear()
  external.value = ''
  message.info(count ? `已清空 ${count} 张服装图` : '已清空服装图')
}

function dropOnGarment(event: DragEvent) {
  if (props.disabled) return
  const files = [...(event.dataTransfer?.files ?? [])]
  if (files.length) g.dropOnEntry(files)
}

const peekGroups = computed(() =>
  g.isTogether
    ? [{ key: 'look', label: '整套合影', photos: g.look ? [g.look] : [] }]
    : g.selected.map((key) => ({ key, label: outfitLabel(key), photos: g.photosOf(key).map((p) => p.url) })),
)

// ---------------- 模特图入口 ----------------

const modelInput = ref<HTMLInputElement | null>(null)
const modelsFull = computed(() => models.value.length >= MAX_MODELS.value)
const fullTip = () => `满了，最多 ${MAX_MODELS.value} 位；要换先在上面删一位`

function openModelPicker() {
  if (props.disabled || modelUploader.uploading.value) return
  if (modelsFull.value) {
    message.warning(fullTip())
    return
  }
  modelInput.value?.click()
}

async function addModels(files: File[]) {
  const room = MAX_MODELS.value - models.value.length
  if (room <= 0) {
    message.warning(`位置满了，最多 ${MAX_MODELS.value} 位`)
    return
  }
  if (files.length > room) message.info(`只放了前 ${room} 位，最多 ${MAX_MODELS.value} 位`)
  const urls = await modelUploader.uploadFiles(files.slice(0, room))
  if (urls.length) models.value = [...models.value, ...urls].slice(0, MAX_MODELS.value)
}

function onModelFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  if (files.length) void addModels(files)
}

function dropOnModels(event: DragEvent) {
  if (props.disabled || modelUploader.uploading.value) return
  const files = [...(event.dataTransfer?.files ?? [])]
  if (files.length) void addModels(files)
}

/** 模特图云钮：开模特选择器（不再开资产库）；关闭后焦点回到云钮 */
const modelPickerShow = ref(false)
const modelCloudBtn = ref<{ $el: HTMLElement } | null>(null)
const modelCloudEl = computed(() => modelCloudBtn.value?.$el ?? null)

function openModelAssets() {
  if (props.disabled || modelUploader.uploading.value) return
  if (modelsFull.value) {
    message.warning(fullTip())
    return
  }
  modelPickerShow.value = true
}

function clearModels() {
  if (props.disabled) return
  const count = models.value.length
  models.value = []
  message.info(count ? `已清空 ${count} 位模特` : '已清空模特图')
}

function removeModel(index: number) {
  if (props.disabled) return
  models.value = models.value.filter((_, i) => i !== index)
}

function onAssets(picked: string[]) {
  if (assetFor.value === 'garment') {
    if (assetKey.value) g.addUrls(assetKey.value, picked)
    return
  }
  addModelUrls(picked)
}

/** 按地址加模特图（资产库 / 模特选择器共用）：去重、只收 http(s)、按余量截断、格式同上传校验 */
function addModelUrls(picked: string[]) {
  const fresh = picked.filter((u) => /^https?:\/\//i.test(u) && !models.value.includes(u))
  if (fresh.length < picked.length) message.warning('已跳过重复或不可用的图片')
  const room = MAX_MODELS.value - models.value.length
  const valid = fresh.slice(0, Math.max(0, room)).filter(modelUploader.acceptUrl)
  if (valid.length) models.value = [...models.value, ...valid]
}

// ---------------- 样式 ----------------

const focusRing = 'outline-none focus-visible:(outline-2 outline-solid outline-violet outline-offset-2)'
const ease = 'duration-220 ease-[cubic-bezier(0.25,0.8,0.25,1)] motion-reduce:transition-none'
/** 白边浮片：60×100 · r5 · 1px #fff · 0 1px 3px .16 */
const plateCls =
  'relative block flex-[0_0_60px] w-60px h-100px box-border overflow-hidden rounded-5px border border-solid border-white ' +
  'shadow-[0_1px_3px_rgba(31,35,41,0.16)] transition-[margin-left] ' +
  ease
const emptyCls =
  'border border-solid border-white bg-white text-placeholder shadow-[0_1px_3px_rgba(31,35,41,0.16)] hover:shadow-[0_2px_6px_rgba(31,35,41,0.2)]'
/** 浮层卡：1px line · r8 · 白 · 0 12 32 .18 + 0 2 8 .08；顶上 12 高透明桥，入场 120ms + 4px 上浮 */
const popCls =
  'absolute top-108px box-border p-10px rounded-8px border border-solid border-line bg-white text-left ' +
  'shadow-[0_12px_32px_rgba(31,35,41,0.18),0_2px_8px_rgba(31,35,41,0.08)] animate-[tus-preview-in_120ms_ease_both] motion-reduce:animate-none ' +
  "before:(content-[''] absolute -top-12px inset-x-0 h-12px)"
/** 切口：两块隔 16，缝里居中一条细线（9 宽柔边带 + 1px 中线，上下渐隐） */
const seamCls = [
  "[.ttm-slot+&]:before:content-[''] [.ttm-slot+&]:before:absolute [.ttm-slot+&]:before:top-0",
  '[.ttm-slot+&]:before:left-[-12px] [.ttm-slot+&]:before:w-9px [.ttm-slot+&]:before:h-100px [.ttm-slot+&]:before:pointer-events-none',
  '[.ttm-slot+&]:before:bg-[linear-gradient(90deg,rgba(31,35,41,0)_0%,rgba(31,35,41,0.026)_35%,rgba(31,35,41,0.026)_65%,rgba(31,35,41,0)_100%)]',
  '[.ttm-slot+&]:before:[mask:linear-gradient(180deg,transparent_0%,#000_12%,#000_88%,transparent_100%)]',
  '[.ttm-slot+&]:before:[-webkit-mask:linear-gradient(180deg,transparent_0%,#000_12%,#000_88%,transparent_100%)]',
  "[.ttm-slot+&]:after:content-[''] [.ttm-slot+&]:after:absolute [.ttm-slot+&]:after:top-0",
  '[.ttm-slot+&]:after:left-[-8px] [.ttm-slot+&]:after:w-1px [.ttm-slot+&]:after:h-100px [.ttm-slot+&]:after:pointer-events-none',
  '[.ttm-slot+&]:after:bg-[linear-gradient(180deg,rgba(31,35,41,0)_0%,rgba(31,35,41,0.09)_14%,rgba(31,35,41,0.09)_86%,rgba(31,35,41,0)_100%)]',
]
const trashPath = 'M4.5 7h15M9.5 7V5h5v2M6.5 7l1 12.5h9l1-12.5M10.5 11v5M13.5 11v5'
const cloudPath = 'M7 18.5h10.5a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.4 9.1 4.75 4.75 0 0 0 7 18.5z'
</script>

<template>
  <!-- 素材板（原型 .dm-mat）：撑满余高，1px line · r6 · 白 · 内凹 16 柔影 + 顶 1px 内线，内边距 12 -->
  <div
    class="flex-[1_1_auto] min-h-0 flex flex-col gap-10px p-12px box-border rounded-6px border border-solid border-line bg-white shadow-[inset_0_0_16px_rgba(31,35,41,0.12),inset_0_1px_0_rgba(31,35,41,0.05)]"
  >
    <input
      ref="modelInput"
      type="file"
      class="hidden"
      :accept="modelSpec.accept"
      multiple
      tabindex="-1"
      aria-hidden="true"
      @change="onModelFiles"
    />

    <div ref="rowEl" class="relative flex items-start gap-16px">
      <!-- 服装图 -->
      <div
        class="ttm-slot relative flex flex-[0_0_auto] min-w-0 flex-col items-center"
        :class="seamCls"
        @mouseenter="garmentHover = true"
        @mouseleave="garmentHover = false"
      >
        <div class="relative">
          <button
            type="button"
            class="relative flex flex-col items-center justify-center gap-4px h-100px box-border p-0 overflow-visible rounded-5px cursor-pointer transition-[width] disabled:cursor-not-allowed"
            :class="[
              ease,
              focusRing,
              garmentShown.length ? 'border-0 bg-transparent' : emptyCls,
              garmentExpanded ? 'z-5' : '',
            ]"
            :style="{ width: `${60 + (garmentPlates - 1) * garmentStep}px` }"
            :disabled="disabled"
            :aria-label="`服装图，${garmentShown.length} 张，点击编辑`"
            @click="openDialog"
            @dragover.prevent
            @drop.prevent="dropOnGarment"
          >
            <span v-if="garmentShown.length" class="absolute left-0 top-0 flex" aria-hidden="true">
              <span
                v-for="(url, index) in garmentShown.slice(-PLATES)"
                :key="url"
                :class="plateCls"
                :style="{ zIndex: index, marginLeft: index ? `${garmentStep - 60}px` : '0px' }"
              >
                <img :src="url" alt="" class="block w-full h-full object-cover" />
              </span>
            </span>
            <template v-else>
              <svg
                class="w-18px h-18px text-muted"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
                <circle cx="9" cy="10" r="1.6" />
                <path d="M20.5 16l-5-5L6 19.5" />
              </svg>
              <span class="text-9px leading-13px">{{ g.uploading ? '上传中…' : '待上传' }}</span>
            </template>
          </button>
          <StudioMedBtn
            label="从资产库选服装图"
            class="-right-12px -bottom-12px !z-21 transition-opacity duration-120 motion-reduce:transition-none"
            :class="garmentExpanded ? 'opacity-0 pointer-events-none' : ''"
            :disabled="disabled"
            @click.stop="openGarmentAssets"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <path :d="cloudPath" stroke-linejoin="round" transform="translate(0 -0.5)" />
            </svg>
          </StudioMedBtn>
          <StudioMedBtn
            v-if="garmentShown.length && !disabled"
            label="清空服装图"
            class="-top-8px z-14 transition-[left]"
            :class="ease"
            :style="{ left: `${60 + (garmentPlates - 1) * garmentStep - 8}px` }"
            @click.stop="clearGarment"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path :d="trashPath" />
            </svg>
          </StudioMedBtn>
        </div>
        <p
          class="flex flex-col items-center gap-2px w-60px mt-8px mb-0 text-10px leading-15px text-center text-placeholder"
        >
          <b class="text-11px font-500 text-ink-2">服装图</b>
          <span>{{
            g.allPhotos.length ? `${g.selected.length}件·${g.allPhotos.length}张` : `最多${MAX_GARMENT}张`
          }}</span>
        </p>

        <!-- 悬停预览卡（原型 .dm-peek）：300 宽，按单品分组，44 方缩略；顶上的透明桥会压住云钮，云钮提到 z-21 -->
        <div
          v-if="garmentHover && peekGroups.length"
          :class="[popCls, 'z-20 left-0 w-300px']"
          role="group"
          aria-label="服装图预览"
        >
          <div class="flex items-baseline gap-6px mb-2px text-10px text-muted">
            <b class="text-11px font-600 text-ink-2">服装图</b>
            <span>{{ g.selected.length }} 件 · {{ g.allPhotos.length }} 张</span>
            <em class="ml-auto not-italic text-9px text-placeholder">点开编辑</em>
          </div>
          <div v-for="group in peekGroups" :key="group.key" class="mt-9px">
            <div class="flex gap-5px mb-4px text-[9.5px] text-placeholder">
              <b class="text-10px font-600 text-ink-2">{{ group.label }}</b>
              <span>{{ group.photos.length ? `${group.photos.length} 张` : '还没有图' }}</span>
            </div>
            <div class="flex gap-4px">
              <img
                v-for="url in group.photos"
                :key="url"
                :src="url"
                alt=""
                class="block w-44px h-44px box-border rounded-4px border border-solid border-line object-cover"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- 模特图 -->
      <div
        class="ttm-slot relative flex flex-[0_0_auto] min-w-0 flex-col items-center"
        :class="seamCls"
        @mouseenter="enterModels"
        @mouseleave="leaveModels"
      >
        <div class="relative">
          <button
            type="button"
            class="relative flex flex-col items-center justify-center gap-4px h-100px box-border p-0 overflow-visible rounded-5px transition-[width] disabled:cursor-not-allowed"
            :class="[
              ease,
              focusRing,
              models.length ? 'border-0 bg-transparent' : emptyCls,
              modelsFull ? 'cursor-default' : 'cursor-pointer',
              modelsExpanded ? 'z-5' : '',
            ]"
            :style="{ width: `${60 + (modelPlates - 1) * modelsStep}px` }"
            :disabled="disabled"
            :aria-label="modelsFull ? `模特图已满 ${MAX_MODELS} 位` : `模特图，${models.length} 位，点击上传`"
            :aria-disabled="modelsFull || undefined"
            @click="openModelPicker"
            @dragover.prevent
            @drop.prevent="dropOnModels"
          >
            <span v-if="models.length" class="absolute left-0 top-0 flex" aria-hidden="true">
              <span
                v-for="(url, index) in models.slice(-PLATES)"
                :key="url"
                :class="plateCls"
                :style="{ zIndex: index, marginLeft: index ? `${modelsStep - 60}px` : '0px' }"
              >
                <img :src="url" alt="" class="block w-full h-full object-cover" />
              </span>
            </span>
            <template v-else>
              <svg
                class="w-18px h-18px text-muted"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
                <circle cx="9" cy="10" r="1.6" />
                <path d="M20.5 16l-5-5L6 19.5" />
              </svg>
              <span class="text-9px leading-13px">{{ modelUploader.uploading.value ? '上传中…' : '待上传' }}</span>
            </template>
          </button>
          <StudioMedBtn
            ref="modelCloudBtn"
            label="从模特库选模特图"
            class="-right-12px -bottom-12px transition-opacity duration-120 motion-reduce:transition-none"
            :class="modelsExpanded ? 'opacity-0 pointer-events-none' : ''"
            :disabled="disabled"
            @click.stop="openModelAssets"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <path :d="cloudPath" stroke-linejoin="round" transform="translate(0 -0.5)" />
            </svg>
          </StudioMedBtn>
          <StudioMedBtn
            v-if="models.length && !disabled"
            label="清空模特图"
            class="-top-8px z-14 transition-[left]"
            :class="ease"
            :style="{ left: `${60 + (modelPlates - 1) * modelsStep - 8}px` }"
            @click.stop="clearModels"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path :d="trashPath" />
            </svg>
          </StudioMedBtn>
        </div>
        <p
          class="flex flex-col items-center gap-2px w-60px mt-8px mb-0 text-10px leading-15px text-center text-placeholder"
        >
          <b class="text-11px font-500 text-ink-2">模特图</b>
          <span>{{ models.length ? `${models.length}/${MAX_MODELS}` : `最多${MAX_MODELS}张` }}</span>
        </p>
      </div>

      <!-- 模特面板（原型 .dm-mpop）：左缘压切口、右缘到板右缘，3 列 3:4 逐位删除 -->
      <div
        v-if="modelsPeek && models.length"
        :class="[popCls, 'z-21 right-0']"
        :style="{ left: `${modelsPanelLeft}px` }"
        role="group"
        :aria-label="`模特，共 ${models.length} 位`"
        @mouseenter="enterModels"
        @mouseleave="leaveModels"
      >
        <div class="flex items-baseline gap-6px mb-6px text-10px text-muted">
          <b class="text-11px font-600 text-ink-2">模特</b>
          <span>{{ models.length }} 位</span>
        </div>
        <div class="grid grid-cols-3 gap-8px">
          <span
            v-for="(url, index) in models"
            :key="url"
            class="relative aspect-[3/4] overflow-hidden rounded-5px border border-solid border-line"
          >
            <img :src="url" alt="" class="block w-full h-full object-cover" />
            <StudioMedBtn
              v-if="!disabled"
              label="移除模特"
              class="top-3px right-3px z-2"
              @click.stop="removeModel(index)"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path :d="trashPath" />
              </svg>
            </StudioMedBtn>
          </span>
        </div>
      </div>
    </div>

    <slot />

    <ToolGarmentDialog v-model:show="dialogOpen" :g="g" :accept="clothSpec.accept" />
    <AssetPickerModal v-model:show="assetShow" :limit="Math.max(1, assetLimit)" media="image" @select="onAssets" />
    <ModelPicker
      v-model:show="modelPickerShow"
      :limit="MAX_MODELS - models.length"
      :max="MAX_MODELS"
      :exclude="models"
      :return-focus="modelCloudEl"
      @confirm="addModelUrls"
    />
  </div>
</template>
