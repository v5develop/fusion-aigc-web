<script setup lang="ts">
/**
 * 姿态复刻 · 服装参考图（选填，最多 6 张，单人姿态专用）：「1 人物与服装」节里与人物图并排的服装叠片 + 可逐张删除的小图。
 *
 * <p>补充背面、侧面、五金等细节，生图时排在人物图（图1）、姿势图（图2）之后，从图3 起。
 * 上传 / 拖入 / 粘贴 / 资产库与其它入口同一套（useStudioUploader + useFileDropPaste + AssetPickerModal）。
 * 不可用（多人配对、模型参考图名额放不下）由页面通过 blockedReason 传入：入口禁用并显示原因，不静默吞图。
 * 有效上限 max = min(6, 模型参考图上限 − 2)，页面算好传进来；这里只负责展示剩余数量与拦截。
 */
import { computed, ref } from 'vue'
import { useMessage } from 'naive-ui'
import { useFileDropPaste } from '@/composables/useFileDropPaste'
import AssetPickerModal from '../components/AssetPickerModal/index.vue'
import StudioMedBtn from '../components/StudioImageUpload/StudioMedBtn.vue'
import { useStudioUploader } from '../components/StudioImageUpload/useStudioUploader.ts'
import { MIN_SHORT_SIDE } from '../image-size.ts'
import { ACCEPT_IMAGE } from '@/utils/utils.ts'

const {
  max = 6,
  hardMax = 6,
  blockedReason = '',
  disabled = false,
} = defineProps<{
  /** 当前有效上限（≤ hardMax；模型名额不够时更小，0 = 放不下） */
  max?: number
  /** 契约上限，只用于标题文案 */
  hardMax?: number
  /** 非空 = 入口不可用，文案即原因 */
  blockedReason?: string
  /** 提交中等整体锁定 */
  disabled?: boolean
}>()

const garments = defineModel<string[]>({ required: true })

const message = useMessage()
const up = useStudioUploader({
  minShortSide: MIN_SHORT_SIDE,
  onOverflow: ({ room, max: cap }) => message.info(`只放了前 ${room} 张，最多 ${cap} 张`),
})
const uploading = up.uploading
up.invalidateOnReplace(() => garments.value)

const blocked = computed(() => !!blockedReason)
const locked = computed(() => disabled || blocked.value)
const room = computed(() => Math.max(0, max - garments.value.length))
const full = computed(() => room.value <= 0)
const over = computed(() => garments.value.length > max)

const input = ref<HTMLInputElement | null>(null)
const zone = ref<HTMLElement | null>(null)

const fullTip = () =>
  max < hardMax ? `当前模型最多再放 ${max} 张服装参考图，要换先删一张` : `最多 ${hardMax} 张服装参考图，要换先删一张`

function pick() {
  if (locked.value || uploading.value) return
  if (full.value) return void message.warning(fullTip())
  input.value?.click()
}

async function addFiles(files: File[]) {
  if (full.value) return void message.warning(fullTip())
  await up.uploadFiles(files, room.value, max, (url) => {
    if (!garments.value.includes(url)) garments.value = [...garments.value, url]
  })
}

function onFiles(event: Event) {
  const el = event.target as HTMLInputElement
  const files = [...(el.files ?? [])]
  el.value = ''
  if (files.length) void addFiles(files)
}

const { dragging } = useFileDropPaste(zone, {
  accept: 'image',
  multiple: true,
  full: full,
  fullMessage: fullTip,
  disabled: () => locked.value || uploading.value,
  disabledMessage: () => blockedReason || undefined,
  rejectMessage: () => '已跳过非图片文件',
  onFiles: (files) => void addFiles(files),
})

function remove(url: string) {
  if (disabled) return
  garments.value = garments.value.filter((u) => u !== url)
}

const assetOpen = ref(false)
function openAssets() {
  if (locked.value || uploading.value) return
  if (full.value) return void message.warning(fullTip())
  assetOpen.value = true
}
function onAssets(picked: string[]) {
  const ok = picked.filter((u) => /^https?:\/\//i.test(u))
  const fresh = [...new Set(ok.filter((u) => !garments.value.includes(u)))]
  if (fresh.length < picked.length) message.warning('已跳过重复或不可用的图片')
  if (fresh.length > room.value) message.info(`只放了前 ${room.value} 张，最多 ${max} 张`)
  if (fresh.length) garments.value = [...garments.value, ...fresh.slice(0, room.value)]
}

/** 叠片：最多画 6 张，每张露 6px（同姿势图叠片的尺寸，60×100 白边浮片） */
const stackWidth = computed(() => `${60 + (Math.max(1, Math.min(garments.value.length, 6)) - 1) * 6}px`)
const PLATE_CLS =
  'absolute top-0 block w-60px h-100px box-border overflow-hidden border border-solid border-white rounded-5px bg-surface3 shadow-[0_1px_3px_rgba(31,35,41,0.16)]'

defineExpose({
  uploading,
  /** 节内操作钮（「+ 服装」、资产库）直接调 */
  pick: () => pick(),
  openAssets: () => openAssets(),
  blocked,
})
</script>

<template>
  <section ref="zone" class="flex min-w-0 flex-col gap-8px" aria-label="服装参考图">
    <input
      ref="input"
      type="file"
      class="hidden"
      :accept="ACCEPT_IMAGE"
      multiple
      tabindex="-1"
      aria-hidden="true"
      @change="onFiles"
    />
    <!-- 叠片入口：与人物图同尺寸的白边浮片，点击添加，右下角云钮选资产；满了只拦点击 -->
    <div class="relative h-100px" :style="{ width: stackWidth }" :class="blocked ? 'opacity-60' : ''">
      <button
        type="button"
        class="relative block h-100px w-full cursor-pointer overflow-visible rounded-5px border-0 bg-transparent p-0 disabled:cursor-not-allowed focus-visible:(outline-2 outline-solid outline-violet outline-offset-2)"
        :class="[
          dragging ? 'sx-drop-ring' : '',
          garments.length
            ? ''
            : 'border border-solid border-white !bg-white shadow-[0_1px_3px_rgba(31,35,41,0.16)] hover:shadow-[0_2px_6px_rgba(31,35,41,0.2)]',
        ]"
        :disabled="locked || uploading || max <= 0"
        :aria-label="
          blocked
            ? `服装参考图不可用：${blockedReason}`
            : garments.length
              ? `服装参考图 ${garments.length} 张，点击继续添加`
              : '添加服装参考图'
        "
        :title="blocked ? blockedReason : '点击添加，也可拖入或粘贴；须与人物图同款'"
        @click="pick"
      >
        <span
          v-for="(url, index) in garments.slice(0, 6)"
          :key="url"
          :class="PLATE_CLS"
          :style="{ left: `${index * 6}px`, zIndex: index }"
          aria-hidden="true"
        >
          <img class="block h-full w-full object-cover" :src="url" alt="" />
        </span>
        <span
          v-if="!garments.length"
          class="absolute inset-0 flex flex-col items-center justify-center gap-4px text-placeholder"
        >
          <n-spin v-if="uploading" :size="16" />
          <template v-else>
            <svg
              class="h-18px w-18px text-muted"
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
            <span class="text-9px leading-13px">待上传</span>
          </template>
        </span>
        <span
          v-else-if="uploading"
          class="absolute inset-0 z-20 grid place-items-center rounded-5px bg-surface/60"
        >
          <n-spin :size="16" />
        </span>
      </button>
      <StudioMedBtn
        label="从资产库选服装参考图"
        class="-bottom-12px -right-12px z-12"
        :disabled="locked || uploading || max <= 0"
        @click.stop="openAssets"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <path
            d="M7 18.5h10.5a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.4 9.1 4.75 4.75 0 0 0 7 18.5z"
            stroke-linejoin="round"
            transform="translate(0 -0.5)"
          />
        </svg>
      </StudioMedBtn>
    </div>

    <p v-if="blockedReason" class="m-0 text-12px leading-18px text-warning" role="note">{{ blockedReason }}</p>
    <p v-else-if="over" class="m-0 text-12px leading-18px text-warning" role="note">
      当前模型最多再放 {{ max }} 张服装参考图，请删到 {{ max }} 张以内再提交
    </p>

    <!-- 逐张小图：可单独删（图3 起） -->
    <div v-if="garments.length" class="flex flex-wrap items-start gap-x-10px gap-y-10px pt-6px">
      <span
        v-for="(url, index) in garments"
        :key="url"
        class="group relative block h-48px w-36px box-border rounded-4px border border-solid border-line bg-surface3"
      >
        <img :src="url" alt="" class="block h-full w-full rounded-3px object-cover" />
        <span
          class="absolute bottom-1px left-1px rounded-3px bg-[rgb(0_0_0/0.55)] px-3px text-9px leading-13px text-white"
          aria-hidden="true"
          >图{{ index + 3 }}</span
        >
        <StudioMedBtn
          v-if="!disabled"
          :label="`移除服装参考图 ${index + 1}`"
          class="-right-6px -top-6px z-2"
          @click.stop="remove(url)"
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
            <path d="M4.5 7h15M9.5 7V5h5v2M6.5 7l1 12.5h9l1-12.5M10.5 11v5M13.5 11v5" />
          </svg>
        </StudioMedBtn>
      </span>
    </div>

    <AssetPickerModal v-model:show="assetOpen" :limit="Math.max(1, room)" media="image" @select="onAssets" />
  </section>
</template>
