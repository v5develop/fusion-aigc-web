<script setup lang="ts">
/**
 * 视频复刻的参考图库：缩略图带 @n 编号（= 提交时 imageUrls 的顺序，后端按 @图片n 读图），
 * 维度卡里点编号挂图。上传走 api/ossUpload（与工具页上传槽同一条通道），也可以从资产库选。
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { useMessage } from 'naive-ui'
import { upload } from '@/api/oss-upload.ts'
import { toApiError } from '@/api/index.ts'
import IconButton from '@/components/IconButton/index.vue'
import AssetPickerModal from '@/views/studio/components/AssetPickerModal/index.vue'
import MediaLightbox, { type LightboxItem } from '@/components/MediaLightbox/index.vue'

const props = defineProps<{
  max: number
  maxBytes: number
  accept: string
  disabled?: boolean
}>()
const urls = defineModel<string[]>({ required: true })
const emit = defineEmits<{ 'update:uploading': [busy: boolean] }>()

const message = useMessage()
const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const assetShow = ref(false)
const room = computed(() => Math.max(props.max - urls.value.length, 0))
let alive = true
onBeforeUnmount(() => {
  alive = false
  if (uploading.value) emit('update:uploading', false)
})
const exts = computed(() => props.accept.split(',').map((s) => s.trim().toLowerCase()))

const lightbox = ref({ show: false, index: 0 })
const lightboxItems = computed<LightboxItem[]>(() => urls.value.map((url, i) => ({ url, name: `参考图 @${i + 1}` })))

function pick() {
  if (props.disabled || uploading.value) return
  if (!room.value) {
    message.warning(`参考图最多 ${props.max} 张`)
    return
  }
  fileInput.value?.click()
}

function acceptable(file: File) {
  const name = file.name.toLowerCase()
  if (!exts.value.some((e) => name.endsWith(e))) {
    message.warning(`${file.name} 格式不支持，请上传 ${exts.value.join(' / ').replace(/\./g, '').toUpperCase()}`)
    return false
  }
  if (file.size > props.maxBytes) {
    message.warning(`${file.name} 超过 ${Math.round(props.maxBytes / 1024 / 1024)}MB，已跳过`)
    return false
  }
  return true
}

async function onFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  if (!files.length) return
  if (files.length > room.value) message.warning(`参考图最多 ${props.max} 张，已保留前 ${room.value} 张`)
  const ok = files.slice(0, room.value).filter(acceptable)
  if (!ok.length) return
  uploading.value = true
  emit('update:uploading', true)
  try {
    const done = await upload(ok)
    // 传的过程中被卸载（换片 / 改用直接出片）：结果作废
    if (!alive) return
    urls.value = [...urls.value, ...done.filter((u): u is string => typeof u === 'string' && !!u)].slice(0, props.max)
  } catch (err) {
    const api = toApiError(err)
    // 业务失败请求层已提示，这里只补传输层失败
    if (!api || api.code === -1) message.error('参考图上传失败，请重试')
  } finally {
    uploading.value = false
    if (alive) emit('update:uploading', false)
  }
}

function addAssets(picked: string[]) {
  const fresh = picked.filter((u) => !urls.value.includes(u))
  if (fresh.length > room.value) message.warning(`参考图最多 ${props.max} 张，已保留前 ${room.value} 张`)
  urls.value = [...urls.value, ...fresh].slice(0, props.max)
}

function remove(i: number) {
  urls.value = urls.value.filter((_, j) => j !== i)
}

function open(i: number) {
  lightbox.value = { show: true, index: i }
}
</script>

<template>
  <div class="flex flex-col gap-6px">
    <div class="flex items-center justify-between gap-8px min-h-24px">
      <span id="vc-refs-label" class="text-12px font-500 leading-18px text-ink-2">
        参考图<span class="ml-4px text-11px font-400 text-placeholder tabular-nums">{{ urls.length }}/{{ max }}</span>
      </span>
      <button
        type="button"
        class="sx-btn !h-32px !px-10px !text-12px"
        :disabled="disabled || uploading || !room"
        :title="!room ? `参考图最多 ${max} 张` : undefined"
        @click="assetShow = true"
      >
        从资产库选
      </button>
    </div>
    <ul class="m-0 p-0 list-none flex flex-wrap items-center gap-12px" aria-labelledby="vc-refs-label">
      <li v-for="(url, i) in urls" :key="url" class="group relative w-48px h-48px">
        <button
          type="button"
          class="block w-full h-full p-0 overflow-hidden box-border rounded-8px border border-solid border-line bg-white cursor-zoom-in sx-focus"
          :aria-label="`查看参考图 @${i + 1}`"
          @click="open(i)"
        >
          <img :src="url" alt="" class="block w-full h-full object-cover" draggable="false" />
        </button>
        <span
          class="pointer-events-none absolute left-2px bottom-2px px-3px rounded-3px bg-[rgba(15,17,20,0.62)] text-10px leading-14px text-white tabular-nums"
          aria-hidden="true"
          >@{{ i + 1 }}</span
        >
        <IconButton
          class="!absolute -top-8px -right-8px z-1"
          size="sm"
          variant="overlay"
          reveal
          :label="`移除参考图 @${i + 1}`"
          :disabled="disabled"
          @click="remove(i)"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M7 7l10 10M17 7L7 17" />
          </svg>
        </IconButton>
      </li>
      <li v-if="room">
        <button
          type="button"
          class="grid place-items-center w-48px h-48px box-border rounded-8px border border-dashed border-line-strong bg-surface2 text-muted cursor-pointer hover:(border-violet-line text-violet-ink) disabled:(cursor-not-allowed opacity-60) sx-focus"
          :disabled="disabled || uploading"
          :aria-label="uploading ? '参考图上传中' : '上传参考图'"
          :aria-busy="uploading || undefined"
          @click="pick"
        >
          <span
            v-if="uploading"
            class="block w-16px h-16px box-border rounded-full border-2 border-solid border-violet-soft border-t-violet animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          <svg
            v-else
            class="w-18px h-18px"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </li>
    </ul>
    <p class="m-0 text-11px leading-16px text-muted">
      最多 {{ max }} 张；在下面的维度里点编号挂图，@n 就是后端读图的顺序
    </p>
    <input ref="fileInput" type="file" :accept="accept" multiple hidden @change="onFiles" />
    <AssetPickerModal v-model:show="assetShow" :limit="Math.max(room, 1)" media="image" @select="addAssets" />
    <MediaLightbox v-model:show="lightbox.show" v-model:index="lightbox.index" :items="lightboxItems" />
  </div>
</template>
