<script setup lang="ts">
/**
 * 档案表单图片位：多张（max>1）或单张（max=1）。
 * 上传走 goUploadImage（Java 直传 public 桶，≤10M，与商拍/本地生活其余入口同一条路径）。
 * 上传中通过 uploading 事件告诉表单（表单据此禁用保存、关闭前确认）；组件卸载（弹窗关了 / 行删了）后
 * 才回来的上传结果直接丢弃，不再写回表单。
 */
import { onBeforeUnmount, ref } from 'vue'
import { useMessage } from 'naive-ui'
import { goUploadImage } from '@/api/goUpload.ts'
import { ACCEPT_IMAGE } from '@/utils/utils.ts'
import IconButton from '@/components/IconButton/index.vue'

const props = withDefaults(defineProps<{ max?: number; label: string; disabled?: boolean }>(), { max: 9 })
const urls = defineModel<string[]>({ default: () => [] })
const emit = defineEmits<{ uploading: [busy: boolean] }>()
const message = useMessage()
const input = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
let disposed = false

function setUploading(v: boolean) {
  if (uploading.value === v) return
  uploading.value = v
  emit('uploading', v)
}
onBeforeUnmount(() => {
  disposed = true
  // 卸载时还在传：告诉表单这一位不再占着「上传中」
  if (uploading.value) setUploading(false)
})

async function onPick(e: Event) {
  const el = e.target as HTMLInputElement
  let files = Array.from(el.files ?? [])
  el.value = ''
  if (!files.length) return
  const room = props.max - urls.value.length
  if (room <= 0) return message.warning(`最多上传 ${props.max} 张`)
  const picked = files.filter((f) => f.type.startsWith('image/'))
  if (picked.length < files.length) message.warning('已跳过非图片文件')
  files = picked.slice(0, room)
  if (picked.length > room) message.warning(`最多还能添加 ${room} 张，其余未添加`)
  setUploading(true)
  try {
    for (const f of files) {
      if (disposed) return
      try {
        const url = await goUploadImage(f)
        if (disposed) return
        urls.value = [...urls.value, url]
      } catch (err) {
        if (disposed) return
        message.error(err instanceof Error ? err.message : '图片上传失败')
      }
    }
  } finally {
    if (!disposed) setUploading(false)
  }
}
function removeAt(i: number) {
  urls.value = urls.value.filter((_, idx) => idx !== i)
}
</script>

<template>
  <div class="flex flex-wrap gap-8px">
    <div
      v-for="(u, i) in urls"
      :key="u + i"
      class="relative h-64px w-64px overflow-hidden rounded-md border border-solid border-line-soft bg-sunken"
    >
      <img :src="u" alt="" class="h-full w-full object-cover" loading="lazy" />
      <IconButton
        class="!absolute right-2px top-2px"
        :label="`删除${label}第 ${i + 1} 张`"
        variant="overlay"
        size="sm"
        :disabled="disabled"
        @click="removeAt(i)"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </IconButton>
    </div>
    <button
      v-if="urls.length < max"
      type="button"
      :disabled="disabled || uploading"
      :aria-label="`上传${label}`"
      class="h-64px w-64px flex cursor-pointer flex-col items-center justify-center gap-2px rounded-md border border-dashed border-line bg-white text-11px text-muted [font-family:inherit] hover:(border-violet-line text-violet-ink) disabled:cursor-not-allowed disabled:opacity-60 focus-visible:(outline outline-2 outline-offset-2 outline-violet)"
      @click="input?.click()"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14" /></svg>
      {{ uploading ? '上传中' : '上传' }}
    </button>
    <input
      ref="input"
      type="file"
      class="hidden"
      :accept="ACCEPT_IMAGE"
      :multiple="max > 1"
      @change="onPick"
    />
  </div>
</template>
