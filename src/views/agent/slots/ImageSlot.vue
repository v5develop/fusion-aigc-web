<script setup lang="ts">
/**
 * image / video 槽位：复用现有放图入口——放一张（本地选）/ 拍一张（手机相机）/ 素材库 / 示例素材（有 exampleUrl 时）。
 * 数量按 minCount / maxCount 控制；显示 guidance 与 exampleUrl 示例图；上传走商拍直传（图）/ OSS（视频）。
 */
import { computed, ref } from 'vue'
import { useMessage } from 'naive-ui'
import { upload } from '@/api/oss-upload.ts'
import { requireLogin } from '../industry/useLoginGate.ts'
import AssetPickerModal from '@/views/studio/components/AssetPickerModal/index.vue'
import { useStudioUploader } from '@/views/studio/components/StudioImageUpload/useStudioUploader.ts'
import { kindForSlotLabel } from '@/views/asset-library/usage.ts'
import type { ISlot } from './slotTypes.ts'

const props = defineProps<{ field: ISlot; disabled?: boolean }>()
const model = defineModel<string[]>({ required: true })
const emit = defineEmits<{ touch: [] }>()

const message = useMessage()
const isVideo = computed(() => props.field.type === 'video')
const max = computed(() => props.field.maxCount ?? 1)
const room = computed(() => Math.max(0, max.value - model.value.length))
const unit = computed(() => (isVideo.value ? '条' : '张'))
const { uploading, uploadFiles } = useStudioUploader()
const videoBusy = ref(false)
const busy = computed(() => uploading.value || videoBusy.value)

const fileEl = ref<HTMLInputElement | null>(null)
const camEl = ref<HTMLInputElement | null>(null)
const pickerShow = ref(false)
const FOCUS = 'focus-visible:(outline outline-2 outline-violet outline-offset-2)'

const accept = computed(() => (isVideo.value ? 'video/mp4,video/quicktime,video/webm' : '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp'))

function add(urls: string[]) {
  const fresh = urls.filter((u) => /^https?:\/\//i.test(u) && !model.value.includes(u))
  if (!fresh.length) return
  if (room.value <= 0) return void message.warning(`最多放 ${max.value} ${unit.value}`)
  model.value = [...model.value, ...fresh.slice(0, room.value)]
  emit('touch')
}

function videoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    const u = URL.createObjectURL(file)
    v.preload = 'metadata'
    v.onloadedmetadata = () => (URL.revokeObjectURL(u), resolve(v.duration || 0))
    v.onerror = () => (URL.revokeObjectURL(u), resolve(0))
    v.src = u
  })
}

async function onFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  // 匿名不上传（getSts 要登录，会被踢到登录页）：弹登录半屏，不调接口
  if (files.length && !requireLogin('pick')) return
  if (!files.length || room.value <= 0) {
    if (files.length) message.warning(`最多放 ${max.value} ${unit.value}`)
    return
  }
  if (isVideo.value) {
    const f = files[0]!
    const limit = props.field.maxDurationSec
    if (limit && (await videoDuration(f)) > limit) return void message.warning(`视频最长 ${limit} 秒，剪短一点再放`)
    videoBusy.value = true
    try {
      const urls = await upload([f], undefined, { compress: false })
      add(urls.map(String))
    } catch {
      message.error('视频没传上去，请重新上传')
    } finally {
      videoBusy.value = false
    }
    return
  }
  const picked = files.filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type))
  if (picked.length < files.length) message.warning('支持 JPG、PNG、WebP 格式的图片')
  if (!picked.length) return
  await uploadFiles(picked, room.value, max.value, (url) => add([url]))
}

function remove(i: number) {
  model.value = model.value.filter((_, idx) => idx !== i)
  emit('touch')
}

const BTN = 'sx-soft-btn'
</script>

<template>
  <div class="flex flex-col gap-8px">
    <ul v-if="model.length" class="m-0 flex list-none flex-wrap gap-8px p-0" :aria-label="`已放的${field.label}`">
      <li v-for="(u, i) in model" :key="u" class="relative h-64px w-48px flex-none">
        <video v-if="isVideo" :src="u" preload="metadata" muted class="h-full w-full rounded-6px border border-solid border-line object-cover" />
        <img v-else :src="u" :alt="`${field.label} ${i + 1}`" class="h-full w-full rounded-6px border border-solid border-line object-cover" />
        <button
          type="button"
          :aria-label="`移除${field.label} ${i + 1}`"
          :disabled="disabled"
          class="absolute right-1px top-1px grid h-20px w-20px place-items-center rounded-4px border-0 bg-[rgba(31,35,41,0.72)] p-0 text-12px leading-none text-white cursor-pointer after:(content-empty absolute -inset-6px rounded-[inherit])"
          :class="FOCUS"
          @click="remove(i)"
        >
          ×
        </button>
      </li>
    </ul>
    <div v-if="room > 0" class="flex flex-wrap items-center gap-6px">
      <button type="button" :class="BTN" :disabled="disabled || busy" @click="fileEl?.click()">
        <n-spin v-if="busy" :size="12" />
        放一{{ unit }}
      </button>
      <button v-if="!isVideo" type="button" :class="[BTN, 'sm:hidden']" :disabled="disabled || busy" @click="camEl?.click()">拍一张</button>
      <button type="button" :class="BTN" :disabled="disabled || busy" @click="pickerShow = true">素材库</button>
      <button v-if="field.exampleUrl && !isVideo" type="button" :class="BTN" :disabled="disabled || busy" @click="add([field.exampleUrl!])">示例素材</button>
      <span class="text-11px text-placeholder">{{ model.length }}/{{ max }}{{ field.acceptRatio ? ` · 建议比例 ${field.acceptRatio}` : '' }}{{ field.maxDurationSec ? ` · 最长 ${field.maxDurationSec} 秒` : '' }}</span>
    </div>
    <div v-if="field.guidance || field.exampleUrl" class="flex items-center gap-8px">
      <img v-if="field.exampleUrl && !isVideo" :src="field.exampleUrl" alt="示例" class="h-40px w-30px flex-none rounded-4px object-cover" />
      <span v-if="field.guidance" class="text-11px leading-16px text-muted">{{ field.guidance }}</span>
    </div>
    <input ref="fileEl" type="file" :accept="accept" :multiple="!isVideo && max > 1" class="hidden" @change="onFiles" />
    <input v-if="!isVideo" ref="camEl" type="file" accept="image/*" capture="environment" class="hidden" @change="onFiles" />
    <AssetPickerModal
      v-model:show="pickerShow"
      :limit="Math.max(room, 1)"
      :media="isVideo ? 'video' : 'image'"
      :default-kind="isVideo ? '' : kindForSlotLabel(field.label)"
      @select="add"
    />
  </div>
</template>
