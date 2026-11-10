<script setup lang="ts">
/**
 * 参考图条 · 5185 原型样子（MlReferenceHead + MlReferenceSlots inline 单角色；与 ReferenceStripClassic.vue 同 props / 事件，
 * 契约见 ./referenceStrip.ts）。数值逐项取原型源码，圆角按 material-align.css（片 r12、图内 r11 同心）。
 *
 * - 计数行（head）：高 22、下距 8；左计数 11/16·400 muted 等宽、不带空格（0/30）；右书本钮视觉 24、r4、右缩 -4、
 *   悬停 surface3 + ink，图标 ionicons BookOutline 15，命中 ≥32（sx-hit）。
 * - 叠片：78×130 白边浮片（1px #fff、0 1px 3px .16、r12），后一张只露 8px，新的在最右压最上；最后一张右上角 16 高深色张数徽标，
 *   悬停 / 摊开时退场，同位出删除钮（20 圆 medbtn，只删最上面一张）。
 * - 空片：白底同款浮片，图标 18 muted + 「待上传」12/16 placeholder（间距 4）；悬停只把影压深一档。
 * - 云钮：20 圆 medbtn 挂在叠片右下角外沿 -12/-12（left = 68 + (n-1)×8），命中 ≥32；满额时隐去。
 * - 悬停 200ms 原地摊开、离开 100ms 收回；收回时卡片 220ms 滑回、宽度保持 240ms 再收窄（不被视口裁掉）；键盘聚焦立即摊开。
 *   摊开步长 81，放不下按容器宽压缩（最密 8），视口横向滚、无滚动条；行尾虚线「+ 点击添加」格 220ms 后淡入（160ms），
 *   格内右下 4/4 是云钮；摊开时每张悬停出 .36 暗层 + 22 白圆「上传 / 替换」钮，点图看大图。
 * - 单张上限（max = 1）不摊开。
 * - 条下距 8（原型 .ml-slots-inline margin-bottom），与提示词正文上内边距 8 合成 16。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import MediaLightbox, { type LightboxItem } from '@/components/MediaLightbox/index.vue'
import AssetCornerButton from './AssetCornerButton.vue'
import BookOutlineIcon from '@/components/icons/BookOutlineIcon.vue'
import StudioMedBtn from '@/views/studio/components/StudioImageUpload/StudioMedBtn.vue'
import { useFileDropPaste } from '@/composables/useFileDropPaste'
import type { ReferenceStripEmits, ReferenceStripProps } from './referenceStrip'

const props = defineProps<ReferenceStripProps>()
const emit = defineEmits<ReferenceStripEmits>()

const CARD_W = 78
const STACK = 8
const ADD_W = CARD_W + 3
const OPEN_DELAY = 200
const CLOSE_DELAY = 100
const CLOSE_ANIM_MS = 240

const count = computed(() => props.urls.length)
const n = computed(() => Math.max(1, count.value))
const name = computed(() => props.label || '参考图')
const countText = computed(() => props.headText ?? `${count.value}/${props.max}`)
const full = computed(() => count.value >= props.max)
const canAdd = computed(() => !props.disabled && !full.value)

// ---------------- 摊开 / 收回 ----------------

const rootEl = ref<HTMLElement | null>(null)
const rootWidth = ref(0)
let ro: ResizeObserver | null = null
onMounted(() => {
  const el = rootEl.value
  if (!el) return
  rootWidth.value = el.clientWidth
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(([entry]) => {
      if (entry) rootWidth.value = entry.contentRect.width
    })
    ro.observe(el)
  }
})

const active = ref(false)
const closing = ref(false)
/** 单张上限不摊开；没图也不摊开 */
const isOpen = computed(() => active.value && count.value > 0 && props.max > 1)
const wide = computed(() => isOpen.value || closing.value)
const addVisible = computed(() => isOpen.value && canAdd.value)

const step = computed(() => {
  if (n.value < 2) return ADD_W
  const avail = Math.max(120, rootWidth.value || 408)
  const addW = canAdd.value ? ADD_W : 0
  return Math.max(8, Math.min(ADD_W, Math.floor((avail - CARD_W - addW) / (n.value - 1))))
})
const openWidth = computed(() => CARD_W + (n.value - 1) * step.value + (canAdd.value ? ADD_W : 0))
const roleWidth = computed(() =>
  wide.value ? `min(100%, ${openWidth.value}px)` : `${CARD_W + (n.value - 1) * STACK}px`,
)
const cardGap = computed(() => (isOpen.value ? `${step.value - CARD_W}px` : `${STACK - CARD_W}px`))

let openTimer: ReturnType<typeof setTimeout> | undefined
let closeTimer: ReturnType<typeof setTimeout> | undefined
let closingTimer: ReturnType<typeof setTimeout> | undefined
function clearTimers() {
  clearTimeout(openTimer)
  clearTimeout(closeTimer)
  openTimer = closeTimer = undefined
}
function clearClosing() {
  clearTimeout(closingTimer)
  closingTimer = undefined
  closing.value = false
}
function openNow() {
  if (props.max <= 1) return
  clearTimers()
  clearClosing()
  active.value = true
}
function scheduleOpen() {
  if (props.max <= 1) return
  clearTimers()
  clearClosing()
  openTimer = setTimeout(() => {
    openTimer = undefined
    active.value = true
  }, OPEN_DELAY)
}
function collapse() {
  const was = isOpen.value
  active.value = false
  if (!was) return
  closing.value = true
  clearTimeout(closingTimer)
  closingTimer = setTimeout(() => {
    closingTimer = undefined
    closing.value = false
  }, CLOSE_ANIM_MS)
}
function scheduleClose() {
  clearTimers()
  closeTimer = setTimeout(() => {
    closeTimer = undefined
    collapse()
  }, CLOSE_DELAY)
}
function onFocusOut(event: FocusEvent) {
  const next = event.relatedTarget as Node | null
  if (next && rootEl.value?.contains(next)) return
  clearTimers()
  collapse()
}
watch(count, (c) => {
  if (!c) {
    active.value = false
    clearClosing()
  }
})
onBeforeUnmount(() => {
  clearTimers()
  clearClosing()
  ro?.disconnect()
})

// ---------------- 操作 ----------------

function pick() {
  if (props.disabled || props.uploading) return
  emit('pick')
}
function onCard(index: number) {
  if (isOpen.value) openPreview(index)
  else if (!props.disabled && !props.uploading) emit('replace', index)
}
function replace(index: number) {
  if (props.disabled || props.uploading) return
  emit('replace', index)
}
function removeLast() {
  if (props.disabled || !count.value) return
  emit('remove', count.value - 1)
}
// 不能叫 asset：<script setup> 的同名顶层绑定在模板里会盖掉 asset prop，v-if="asset" 就恒为真
function onAsset() {
  if (props.disabled || props.uploading) return
  emit('asset')
}
const bookEl = ref<HTMLButtonElement | null>(null)
function openLibrary() {
  if (bookEl.value) emit('open-library', bookEl.value)
}

const preview = ref({ show: false, index: 0 })
const previewItems = computed<LightboxItem[]>(() =>
  props.urls.map((url, i) => ({ url, type: 'image', name: `${name.value} · ${i + 1}` })),
)
function openPreview(index: number) {
  if (!props.urls[index]) return
  preview.value = { show: true, index }
}

// 拖入 / 粘贴进叠片：交给调用方（与选文件同一套校验）；没接时打开选文件
const stackEl = ref<HTMLElement | null>(null)
useFileDropPaste(stackEl, {
  accept: 'image',
  multiple: () => props.max > 1,
  disabled: () => !!props.disabled || !!props.uploading,
  rejectMessage: () => '已跳过非图片文件',
  onFiles: (files) => {
    if (!files.length) return
    if (props.onDropFiles) props.onDropFiles(files)
    else emit('pick')
  },
})

/** 片的共用底：78×130、1px #fff、r12 squircle、0 1px 3px .16；margin-left 220ms（摊开 / 收回只动它） */
const cardCls =
  'relative grid place-items-center flex-[0_0_78px] w-78px h-130px box-border p-0 border border-solid border-white rounded-12px sx-squircle ' +
  'shadow-[0_1px_3px_rgba(31,35,41,0.16)] cursor-pointer ' +
  '[transition:margin-left_220ms_cubic-bezier(0.25,0.8,0.25,1),border-color_110ms,background_110ms,box-shadow_110ms] motion-reduce:transition-none ' +
  'outline-none focus-visible:(outline-2 outline-solid outline-violet outline-offset-2)'
</script>

<template>
  <div ref="rootEl" class="relative w-full min-w-0">
    <!-- 计数行（原型 MlReferenceHead）：高 22、下距 8 -->
    <div v-if="head" class="flex items-center justify-between w-full min-w-0 h-22px flex-[0_0_22px] mb-8px">
      <span class="text-11px font-400 leading-16px tabular-nums text-muted" :title="headTitle || undefined">{{
        countText
      }}</span>
      <button
        v-if="library"
        ref="bookEl"
        type="button"
        class="sx-hit sx-squircle grid place-items-center w-24px h-24px -mr-4px p-0 border-none rounded-4px bg-transparent text-muted cursor-pointer hover:(bg-surface3 text-ink) disabled:(opacity-45 cursor-default) sx-focus"
        title="我的提示词"
        aria-label="我的提示词"
        aria-haspopup="dialog"
        :aria-expanded="!!libraryOpen"
        :disabled="disabled"
        @click="openLibrary"
      >
        <BookOutlineIcon />
      </button>
    </div>

    <!-- 图槽（原型 MlReferenceSlots inline，单角色）：条下距 8 -->
    <div class="mb-8px">
      <div
        class="relative flex flex-col flex-[0_0_auto] min-w-0 [transition:width_220ms_cubic-bezier(0.25,0.8,0.25,1)] motion-reduce:transition-none"
        :style="{ width: roleWidth }"
        @mouseenter="scheduleOpen"
        @mouseleave="scheduleClose"
        @focusin="openNow"
        @focusout="onFocusOut"
        @keydown.esc="collapse"
      >
        <div ref="stackEl" class="relative min-w-0 max-w-full" :class="wide ? 'w-full' : 'w-max'">
          <div
            class="flex items-end max-w-full h-130px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            :class="wide ? 'w-full overflow-x-auto overflow-y-hidden' : 'overflow-visible'"
          >
            <div class="flex items-end">
              <!-- 叠片：老的在前，新的在最右、压最上 -->
              <div
                v-for="(url, index) in urls"
                :key="`${index}:${url}`"
                :class="[cardCls, 'group/card bg-surface3']"
                :style="{ zIndex: 20 + index, marginLeft: index ? cardGap : '0px' }"
                role="button"
                tabindex="0"
                :aria-label="isOpen ? `查看${name}第 ${index + 1} 张` : `替换${name}第 ${index + 1} 张`"
                @click="onCard(index)"
                @keydown.enter.self.prevent="onCard(index)"
                @keydown.space.self.prevent="onCard(index)"
              >
                <img
                  class="absolute inset-0 z-2 block w-full h-full rounded-11px sx-squircle object-cover"
                  :src="url"
                  :alt="`${name}第 ${index + 1} 张`"
                  draggable="false"
                />
                <span
                  v-if="uploading && index === count - 1"
                  class="absolute inset-0 z-5 grid place-items-center rounded-11px bg-[rgba(31,35,41,0.35)] text-14px font-600 text-white"
                  role="status"
                  aria-label="上传中"
                  >…</span
                >
                <!-- 张数徽标：最后一张右上 4/4；摊开 / 悬停 / 聚焦时退场，让位给删除钮 -->
                <span
                  v-if="index === count - 1"
                  class="absolute top-4px right-4px z-2 grid place-items-center min-w-16px h-16px box-border px-4px border border-solid border-white rounded-full bg-ink text-white text-10px font-600 leading-none tabular-nums shadow-[0_1px_2px_rgba(31,35,41,0.2)] [transition:opacity_160ms_ease,transform_160ms_ease] motion-reduce:transition-none group-hover/card:(opacity-0 scale-80) group-focus-within/card:(opacity-0 scale-80)"
                  :class="isOpen ? 'opacity-0 scale-70' : ''"
                  aria-hidden="true"
                  >{{ count }}</span
                >
                <!-- 摊开时：.36 暗层 + 22 白圆「上传 / 替换」钮（命中 ≥32） -->
                <div
                  v-if="isOpen"
                  class="absolute inset-0 z-4 flex items-center justify-center gap-4px rounded-11px bg-[rgba(31,35,41,0.36)] opacity-0 [transition:opacity_120ms_ease] motion-reduce:transition-none group-hover/card:opacity-100 group-focus-within/card:opacity-100 [@media(hover:none)]:opacity-100"
                >
                  <button
                    type="button"
                    class="relative grid place-items-center w-22px h-22px min-w-22px p-0 border-none rounded-full bg-white text-ink-2 shadow-[0_1px_2px_rgba(31,35,41,0.18)] cursor-pointer hover:text-violet-ink disabled:cursor-not-allowed after:(content-empty absolute -inset-5px rounded-full) sx-focus"
                    title="上传 / 替换"
                    :aria-label="`上传替换${name}第 ${index + 1} 张`"
                    :disabled="disabled"
                    @mousedown.prevent
                    @click.stop="replace(index)"
                  >
                    <svg class="w-10px h-10px" viewBox="0 0 512 512" fill="none" stroke="currentColor" stroke-width="32" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M320 367.79h76c55 0 100-29.21 100-83.6s-53-81.47-96-83.6c-8.89-85.06-71-136.8-144-136.8-69 0-113.44 45.79-128 91.2-60 5.7-112 43.88-112 106.4s54 106.4 120 106.4h56" />
                      <path d="M320 255.79l-64-64-64 64M256 448.21V207.79" />
                    </svg>
                  </button>
                </div>
                <!-- 删除：最后一张右上 4/4（与徽标同位），悬停 / 聚焦出现；触屏常显 -->
                <StudioMedBtn
                  v-if="index === count - 1 && !disabled"
                  :label="`移除${name}第 ${index + 1} 张`"
                  class="top-4px right-4px !z-6 opacity-0 [transition:opacity_120ms_ease] motion-reduce:transition-none group-hover/card:opacity-100 group-focus-within/card:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                  @mousedown.prevent
                  @click.stop="removeLast"
                >
                  <svg viewBox="0 0 512 512" fill="none" stroke="currentColor" stroke-width="32" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M112 112l20 320c.95 18.49 14.4 32 32 32h184c17.67 0 30.87-13.51 32-32l20-320" />
                    <path d="M80 112h352" />
                    <path d="M192 112V72h0a23.93 23.93 0 0 1 24-24h80a23.93 23.93 0 0 1 24 24h0v40M256 176v224M184 176l8 224M328 176l-8 224" />
                  </svg>
                </StudioMedBtn>
              </div>

              <!-- 空片：图标 18 + 「待上传」12/16，单角色不写片下说明 -->
              <button
                v-if="!count"
                type="button"
                :class="[
                  cardCls,
                  'bg-white text-placeholder hover:shadow-[0_2px_6px_rgba(31,35,41,0.2)] disabled:cursor-not-allowed',
                ]"
                :aria-label="uploading ? `${name}上传中` : `上传${name}，待上传`"
                :disabled="disabled"
                @click="pick"
              >
                <span class="flex flex-col items-center gap-4px">
                  <svg class="w-18px h-18px text-muted" viewBox="0 0 512 512" fill="none" stroke="currentColor" stroke-width="32" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <rect x="48" y="80" width="416" height="352" rx="48" ry="48" />
                    <circle cx="336" cy="176" r="32" />
                    <path d="M304 335.79l-90.66-90.49a32 32 0 0 0-43.87-1.3L48 352M224 432l123.34-123.34a32 32 0 0 1 43.11-2L464 368" />
                  </svg>
                  <span class="text-12px leading-16px text-placeholder">{{ uploading ? '上传中…' : '待上传' }}</span>
                </span>
              </button>

              <!-- 行尾「+ 点击添加」：只在摊开时出现，220ms 后淡入；格内右下 4/4 是云钮 -->
              <div v-if="addVisible" class="relative flex flex-[0_0_auto] ml-3px">
                <button
                  type="button"
                  :class="[
                    cardCls,
                    '!flex flex-col items-center justify-center gap-2px pb-20px !border-dashed !border-control bg-white text-muted text-11px leading-15px animate-[rs-card-in_160ms_ease_220ms_both] motion-reduce:animate-none',
                  ]"
                  :aria-label="`添加${name}`"
                  :disabled="disabled"
                  @click.stop="pick"
                >
                  <svg class="w-14px h-14px" viewBox="0 0 512 512" fill="none" stroke="currentColor" stroke-width="32" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M256 112v288M400 256H112" />
                  </svg>
                  <span class="px-2px whitespace-nowrap">点击添加</span>
                </button>
                <AssetCornerButton
                  v-if="asset"
                  :corner="false"
                  class="!z-30 right-4px bottom-4px animate-[rs-card-in_160ms_ease_220ms_both] motion-reduce:animate-none"
                  :disabled="disabled"
                  @click="onAsset"
                />
              </div>
            </div>
          </div>

          <!-- 云钮：叠片右下角外沿 -12/-12（钉在叠片右沿，不跟收回中的宽度走）；满额隐去 -->
          <AssetCornerButton
            v-if="asset && !isOpen"
            :corner="false"
            class="!z-30 bottom-[-12px]"
            :class="full ? 'invisible' : ''"
            :style="{ left: `${CARD_W - 10 + (n - 1) * STACK}px` }"
            :disabled="disabled"
            @click="onAsset"
          />
        </div>
      </div>
    </div>

    <MediaLightbox v-model:show="preview.show" v-model:index="preview.index" :items="previewItems" pannable />
  </div>
</template>

<style>
/* 「+ 点击添加」格（原型 ml-card-in）：牌发完再出现，从左 8px 滑入并淡入 */
@keyframes rs-card-in {
  from {
    opacity: 0;
    transform: translateX(-8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
</style>
