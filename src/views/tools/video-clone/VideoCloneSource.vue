<script setup lang="ts">
/**
 * 原片信息条：小窗预览 + 时长 / 尺寸 / 分镜数 / 音轨；「联系表」放大核对抽帧，「换一条」回到上传。
 * 解析完成前时长与尺寸取浏览器读到的元数据，完成后以解析结果为准。
 */
import { computed, ref } from 'vue'
import { VC_AUDIO_KIND, fmtSeconds } from '../video-clone/constants'
import type { VideoCloneState } from '../video-clone/useVideoClone'

const props = defineProps<{
  state: VideoCloneState
  videoUrl: string
  disabled?: boolean
}>()
const emit = defineEmits<{ replace: []; 'open-sheet': [] }>()

/** 浏览器读到的元数据（解析结果出来前先填） */
const local = ref<{ duration: number; width: number; height: number } | null>(null)
function onMeta(e: Event) {
  const el = e.target as HTMLVideoElement
  local.value = {
    duration: Number.isFinite(el.duration) ? el.duration : 0,
    width: el.videoWidth,
    height: el.videoHeight,
  }
}

const meta = computed(() => props.state.meta)
const duration = computed(() => meta.value?.duration ?? local.value?.duration ?? null)
const size = computed(() => {
  const w = meta.value?.width ?? local.value?.width
  const h = meta.value?.height ?? local.value?.height
  return w && h ? `${w}×${h}` : '—'
})
const sections = computed(() => (props.state.result ? `${props.state.result.sections?.length ?? 0} 段` : '—'))
const audioText = computed(() => {
  const r = props.state.result
  if (!r) return '—'
  if (!r.audio?.hasTrack && !r.meta.hasAudio) return '无音轨'
  return (r.audio?.kind && VC_AUDIO_KIND[r.audio.kind]) || '有'
})
const hasSheet = computed(
  () => !!props.state.result?.contactSheet?.url || !!props.state.result?.frames?.some((f) => f.url),
)
</script>

<template>
  <section
    class="flex gap-12px p-10px box-border rounded-12px border border-solid border-line bg-surface2"
    aria-label="原片"
  >
    <div class="flex-none w-96px h-170px overflow-hidden rounded-8px bg-#0f1114">
      <video
        :src="videoUrl"
        class="block w-full h-full object-cover"
        muted
        playsinline
        controls
        preload="metadata"
        aria-label="原片预览"
        @loadedmetadata="onMeta"
      />
    </div>
    <div class="flex min-w-0 flex-1 flex-col gap-8px">
      <dl class="m-0 grid grid-cols-2 gap-x-10px gap-y-8px">
        <div>
          <dt class="text-11px leading-16px text-placeholder">时长</dt>
          <dd class="m-0 text-13px leading-18px text-ink tabular-nums">{{ fmtSeconds(duration) }}</dd>
        </div>
        <div>
          <dt class="text-11px leading-16px text-placeholder">尺寸</dt>
          <dd class="m-0 text-13px leading-18px text-ink tabular-nums">{{ size }}</dd>
        </div>
        <div>
          <dt class="text-11px leading-16px text-placeholder">分镜</dt>
          <dd class="m-0 text-13px leading-18px text-ink tabular-nums">{{ sections }}</dd>
        </div>
        <div>
          <dt class="text-11px leading-16px text-placeholder">音轨</dt>
          <dd class="m-0 text-13px leading-18px text-ink" :title="state.result?.audio?.note || undefined">
            {{ audioText }}
          </dd>
        </div>
      </dl>
      <p v-if="state.result?.audio?.note" class="m-0 text-11px leading-16px text-muted line-clamp-2">
        {{ state.result.audio.note }}
      </p>
      <div class="mt-auto flex flex-wrap gap-8px">
        <button v-if="hasSheet" type="button" class="sx-btn !h-32px !px-10px !text-12px" @click="emit('open-sheet')">
          看联系表
        </button>
        <button type="button" class="sx-btn !h-32px !px-10px !text-12px" :disabled="disabled" @click="emit('replace')">
          <svg
            class="w-13px h-13px"
            viewBox="0 0 512 512"
            fill="none"
            stroke="currentColor"
            stroke-width="40"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M320 146s24.36-12-64-12a160 160 0 10160 160" />
            <path d="M256 58l80 80-80 80" />
          </svg>
          换一条
        </button>
      </div>
    </div>
  </section>
</template>
