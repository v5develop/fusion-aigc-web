<script setup lang="ts">
/**
 * 工具页的上传槽位：图片或视频，按 schema 的 max / maxBytes / accept / 时长在上传前拦截。
 *
 * <p>上传走现有的 api/ossUpload.ts（STS 直传 + confirm，ImageUpload / VideoUpload 同一条通道），不另开通道。
 */
import { computed, ref } from 'vue'
import { useMessage } from 'naive-ui'
import { upload } from '@/api/ossUpload.ts'
import { toApiError } from '@/api/index.ts'
import type { ToolUpload } from './schemas'

const props = defineProps<{ spec: ToolUpload; id: string; disabled?: boolean }>()
const urls = defineModel<string[]>({ required: true })

const message = useMessage()
const inputRef = ref<HTMLInputElement | null>(null)
const uploading = ref(false)

const isVideo = computed(() => props.spec.kind === 'video')
const room = computed(() => props.spec.max - urls.value.length)
const exts = computed(() => props.spec.accept.split(',').map((s) => s.trim().toLowerCase()))
const extText = computed(() => exts.value.map((e) => e.replace('.', '').toUpperCase()).join(' / '))
const sizeText = computed(() => {
  const mb = props.spec.maxBytes / 1024 / 1024
  return mb >= 1024 ? `${mb / 1024}G` : `${mb}M`
})
const hint = computed(() => {
  const parts = [`支持 ${extText.value}`, `单个不超过 ${sizeText.value}`]
  if (props.spec.max > 1) parts.push(`最多 ${props.spec.max} ${isVideo.value ? '段' : '张'}`)
  if (props.spec.minDuration || props.spec.maxDuration)
    parts.push(`时长 ${props.spec.minDuration ?? 0}–${props.spec.maxDuration ?? '∞'} 秒`)
  return parts.join('，')
})

function pick() {
  if (props.disabled || uploading.value) return
  inputRef.value?.click()
}

/** 读取视频时长（秒）；读不出来返回 null，不拦截 */
function videoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const el = document.createElement('video')
    const url = URL.createObjectURL(file)
    const done = (v: number | null) => {
      URL.revokeObjectURL(url)
      resolve(v)
    }
    el.preload = 'metadata'
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : null)
    el.onerror = () => done(null)
    el.src = url
  })
}

async function validate(file: File): Promise<string | null> {
  const name = file.name.toLowerCase()
  if (!exts.value.some((ext) => name.endsWith(ext))) {
    return `「${file.name}」格式不支持，仅支持 ${extText.value}`
  }
  if (file.size > props.spec.maxBytes) {
    return `「${file.name}」超过 ${sizeText.value}，请压缩后再上传`
  }
  if (isVideo.value && (props.spec.minDuration || props.spec.maxDuration)) {
    const d = await videoDuration(file)
    if (d !== null) {
      if (props.spec.minDuration && d < props.spec.minDuration) {
        return `「${file.name}」时长不足 ${props.spec.minDuration} 秒`
      }
      if (props.spec.maxDuration && d > props.spec.maxDuration) {
        return `「${file.name}」时长超过 ${props.spec.maxDuration} 秒`
      }
    }
  }
  return null
}

async function onChange(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length) return
  // 单槽位（max=1）选新文件 = 换一张
  const replacing = props.spec.max === 1
  const capacity = replacing ? 1 : room.value
  if (capacity <= 0) {
    message.warning(`最多上传 ${props.spec.max} ${isVideo.value ? '段' : '张'}`)
    return
  }
  let picked = files
  if (picked.length > capacity) {
    message.warning(`最多还能添加 ${capacity} 个，多选的 ${picked.length - capacity} 个未添加`)
    picked = picked.slice(0, capacity)
  }
  const valid: File[] = []
  for (const f of picked) {
    const err = await validate(f)
    if (err) message.error(err)
    else valid.push(f)
  }
  if (!valid.length) return

  uploading.value = true
  try {
    const uploaded = await upload(valid)
    urls.value = replacing ? uploaded.slice(0, 1) : [...urls.value, ...uploaded]
  } catch (err) {
    // 业务失败（取凭证被拒等）请求层已 toast，这里只补传输层 / 对象存储的失败提示
    const apiErr = toApiError(err)
    if (!apiErr || apiErr.code === -1) message.error('上传失败，请检查网络后重试')
  } finally {
    uploading.value = false
  }
}

function remove(i: number) {
  urls.value = urls.value.filter((_, idx) => idx !== i)
}

const focusRing = 'outline-none focus-visible:(outline-2 outline-solid outline-violet outline-offset-2)'
</script>

<template>
  <div>
    <div class="ll-label">
      <span :id="`${id}-label`">
        {{ spec.label }}
        <span v-if="spec.required" class="text-danger" aria-hidden="true">*</span>
      </span>
      <span v-if="spec.max > 1" class="text-12px text-placeholder">{{ urls.length }} / {{ spec.max }}</span>
    </div>
    <input
      :id="id"
      ref="inputRef"
      type="file"
      class="hidden"
      :accept="spec.accept"
      :multiple="spec.max > 1"
      :aria-labelledby="`${id}-label`"
      @change="onChange"
    />

    <ul
      v-if="urls.length"
      class="m-0 mb-8px p-0 list-none grid gap-8px"
      :class="isVideo ? 'grid-cols-1' : 'grid-cols-4'"
    >
      <li
        v-for="(url, i) in urls"
        :key="url + i"
        class="relative overflow-hidden rounded-8px border border-solid border-line bg-surface3"
        :class="isVideo ? 'aspect-video' : 'aspect-square'"
      >
        <video v-if="isVideo" :src="url" class="w-full h-full object-contain bg-black" controls preload="metadata" />
        <img v-else :src="url" :alt="`${spec.label} 第 ${i + 1} 张`" class="w-full h-full object-cover" />
        <button
          type="button"
          class="absolute top-4px right-4px w-22px h-22px flex items-center justify-center rounded-full border-none bg-black/55 text-white text-14px leading-none cursor-pointer hover:bg-black/75"
          :class="focusRing"
          :aria-label="`删除${spec.label}第 ${i + 1} 个`"
          :disabled="disabled"
          @click="remove(i)"
        >
          ×
        </button>
      </li>
    </ul>

    <button
      v-if="spec.max === 1 && urls.length"
      type="button"
      class="ll-pill"
      :class="focusRing"
      :disabled="disabled || uploading"
      @click="pick"
    >
      {{ uploading ? '上传中…' : '换一张' }}
    </button>
    <button
      v-else-if="room > 0"
      type="button"
      class="w-full flex flex-col items-center justify-center gap-4px py-18px rounded-8px border border-dashed border-line-strong bg-surface2 text-ink-2 cursor-pointer transition-colors hover:(border-violet-line bg-violet-soft text-violet-ink) disabled:cursor-not-allowed"
      :class="focusRing"
      :disabled="disabled || uploading"
      :aria-describedby="`${id}-hint`"
      @click="pick"
    >
      <span class="text-14px font-500">{{ uploading ? '上传中…' : `上传${spec.label}` }}</span>
      <span :id="`${id}-hint`" class="text-11px text-placeholder">{{ hint }}</span>
    </button>
  </div>
</template>
