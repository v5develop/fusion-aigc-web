<script setup lang="ts">
/**
 * 姿态复刻 · 服装参考图（选填，最多 6 张，单人姿态专用）。
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
defineExpose({ uploading })
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

const countText = computed(() => {
  if (blocked.value) return `${garments.value.length} 张`
  return `${garments.value.length}/${max}${max > 0 ? ` · 还可加 ${room.value} 张` : ''}`
})
</script>

<template>
  <section ref="zone" class="flex flex-col gap-6px" aria-labelledby="pose-garment-title">
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
    <div class="flex items-baseline gap-8px">
      <h2 id="pose-garment-title" class="m-0 text-12px font-600 text-ink">服装参考图（选填，最多 {{ hardMax }} 张）</h2>
      <span class="ml-auto text-11px leading-15px tabular-nums text-placeholder">{{ countText }}</span>
    </div>
    <p class="m-0 text-11px leading-16px text-muted">用于补充背面、侧面、五金等细节，作为图3 起</p>
    <p v-if="blockedReason" class="m-0 text-12px leading-18px text-warning" role="note">{{ blockedReason }}</p>
    <p v-else-if="over" class="m-0 text-12px leading-18px text-warning" role="note">
      当前模型最多再放 {{ max }} 张服装参考图，请删到 {{ max }} 张以内再提交
    </p>

    <div class="flex flex-wrap items-start gap-x-14px gap-y-12px pt-6px" :class="blocked ? 'opacity-60' : ''">
      <span
        v-for="(url, index) in garments"
        :key="url"
        class="group relative block w-48px h-64px box-border rounded-5px border border-solid border-line bg-surface3"
      >
        <img :src="url" alt="" class="block w-full h-full object-cover rounded-4px" />
        <span
          class="absolute left-2px bottom-2px px-3px rounded-3px text-10px leading-14px text-white bg-[rgb(0_0_0/0.55)]"
          aria-hidden="true"
          >图{{ index + 3 }}</span
        >
        <StudioMedBtn
          v-if="!disabled"
          :label="`移除服装参考图 ${index + 1}`"
          class="-top-6px -right-6px z-2"
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

      <span v-if="!full || !garments.length" class="relative block">
        <button
          type="button"
          class="flex flex-col items-center justify-center gap-2px w-48px h-64px box-border p-0 rounded-5px border border-dashed border-control bg-surface2 text-muted cursor-pointer disabled:cursor-not-allowed hover:border-violet focus-visible:(outline-2 outline-solid outline-violet outline-offset-2)"
          :class="dragging ? 'sx-drop-ring' : ''"
          :disabled="locked || uploading || max <= 0"
          :aria-label="blocked ? `服装参考图不可用：${blockedReason}` : '添加服装参考图'"
          :title="blocked ? blockedReason : '点击添加，也可拖入或粘贴'"
          @click="pick"
        >
          <n-spin v-if="uploading" :size="16" />
          <template v-else>
            <svg
              class="w-16px h-16px"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span class="text-11px leading-14px">添加</span>
          </template>
        </button>
        <StudioMedBtn
          label="从资产库选服装参考图"
          class="-right-10px -bottom-10px"
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
      </span>
    </div>

    <AssetPickerModal v-model:show="assetOpen" :limit="Math.max(1, room)" media="image" @select="onAssets" />
  </section>
</template>
