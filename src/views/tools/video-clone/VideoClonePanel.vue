<script setup lang="ts">
/**
 * 视频复刻操作栏（原型 VideoClone.vue 的「解析、标注」）：
 * 原片 → 四步解析 → 片子目的 / 原片文字 / 参考图 / 十一维标注 / 补充说明 / 清晰度与音频。
 * 状态全在 useVideoClone；原片上传槽由工具页从 #upload 插进来（与其它工具同一个 ToolUploadSlot），
 * 模型选择与提交按钮仍是工具页底部那一套。
 */
import { computed, ref } from 'vue'
import MediaLightbox, { type LightboxItem } from '@/components/MediaLightbox/index.vue'
import type { VideoCloneAudio, VideoCloneResolution } from '@/api/video-clone'
import VideoCloneSource from '../video-clone/VideoCloneSource.vue'
import VideoCloneProgress from '../video-clone/VideoCloneProgress.vue'
import VideoCloneRefLibrary from '../video-clone/VideoCloneRefLibrary.vue'
import VideoCloneDimCard from '../video-clone/VideoCloneDimCard.vue'
import { VC_PURPOSES, VC_TEXT_OPTIONS, fmtSeconds } from '../video-clone/constants'
import type { VideoCloneState } from '../video-clone/useVideoClone'

const props = defineProps<{
  state: VideoCloneState
  videoUrl: string
  disabled?: boolean
  /** 参考图上限（当前模型 refs.maxImages 与 9 取小） */
  refMax: number
  refMaxBytes: number
  refAccept: string
  /** 当前模型支持的清晰度（小写）；null = 没建模，都允许 */
  modelResolutions: string[] | null
  /** 当前模型名，只用于提示文案 */
  modelLabel?: string
  /** 当前模型单段上限（秒） */
  modelMaxSeconds: number | null
  /** 补充说明上限（视频路由 content 上限） */
  contentMax: number
}>()
const refs = defineModel<string[]>('refs', { required: true })
const emit = defineEmits<{ replace: []; skip: []; 'update:uploading': [busy: boolean] }>()

const s = computed(() => props.state)
const meta = computed(() => s.value.meta)

/* ---------------- 联系表 ---------------- */
const sheet = ref({ show: false, index: 0 })
const sheetItems = computed<LightboxItem[]>(() => {
  const r = s.value.result
  if (!r) return []
  const items: LightboxItem[] = []
  if (r.contactSheet?.url) items.push({ url: r.contactSheet.url, name: '联系表 · 每格带秒数' })
  for (const f of r.frames ?? [])
    if (f.url) items.push({ url: f.url, name: `第 ${f.index + 1} 帧 · ${fmtSeconds(f.t)}` })
  return items
})
function openSheet() {
  if (sheetItems.value.length) sheet.value = { show: true, index: 0 }
}

/* ---------------- 输出设置 ---------------- */
const RESOLUTIONS: { key: VideoCloneResolution; label: string }[] = [
  { key: 'follow', label: '跟随原片' },
  { key: '720p', label: '720P' },
  { key: '1080p', label: '1080P' },
]
const resolutionBlocked = (key: VideoCloneResolution) =>
  key !== 'follow' && !!props.modelResolutions && !props.modelResolutions.includes(key)
const AUDIOS: { key: VideoCloneAudio; label: string }[] = [
  { key: 'keep', label: '保留原声' },
  { key: 'regenerate', label: '重新配乐' },
]
const audioBlocked = (key: VideoCloneAudio) => key === 'keep' && !meta.value?.hasAudio
const textHint = computed(() => VC_TEXT_OPTIONS.find((o) => o.key === s.value.textStrategy)?.hint ?? '')
const ratioText = computed(() => {
  const m = meta.value
  if (!m) return ''
  if (m.aspectRatio) return m.aspectRatio
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
  const g = gcd(m.width, m.height) || 1
  return `${m.width / g}:${m.height / g}`
})
const overModel = computed(() => {
  const d = meta.value?.duration
  return !!(props.modelMaxSeconds && d && d > props.modelMaxSeconds + 0.5)
})

const segBtn =
  'h-32px box-border px-12px rounded-6px border border-solid text-12px whitespace-nowrap cursor-pointer sx-focus ' +
  '[transition:border-color_.15s,background_.15s,color_.15s] motion-reduce:transition-none disabled:(opacity-45 cursor-not-allowed)'
const segOn =
  'border-violet-line bg-[linear-gradient(180deg,#fff_0%,#f8f3fc_100%)] text-violet-ink font-600 shadow-[0_1px_2px_rgba(31,35,41,0.05)]'
const segOff = 'border-transparent bg-transparent text-muted hover:enabled:text-ink'
const segTrack =
  'inline-flex flex-wrap gap-2px p-2px box-border rounded-8px border border-solid border-line bg-surface3 shadow-[inset_0_1px_2px_rgba(31,35,41,0.055)]'
const labelCls = 'text-12px font-500 leading-18px text-ink-2'
</script>

<template>
  <div class="flex min-w-0 flex-col gap-12px">
    <!-- ① 原片：没有时是上传槽，有了换成信息条 -->
    <template v-if="!videoUrl">
      <slot name="upload" />
      <p class="m-0 text-12px leading-18px text-muted">
        上传后先自动解析画面（免费，约半分钟），再标哪几项保持、哪几项替换。
        <button
          type="button"
          class="inline-flex items-center h-28px px-2px border-none bg-transparent text-12px text-violet-ink underline-offset-2 cursor-pointer hover:underline sx-focus"
          :disabled="disabled"
          @click="emit('skip')"
        >
          不解析，直接写描述出片
        </button>
      </p>
    </template>
    <template v-else>
      <VideoCloneSource
        :state="state"
        :video-url="videoUrl"
        :disabled="disabled"
        @replace="emit('replace')"
        @open-sheet="openSheet"
      />
      <!-- ② 四步进度 / 失败 -->
      <VideoCloneProgress :state="state" :disabled="disabled" @skip="emit('skip')" />
    </template>

    <!-- ③ 可标注 -->
    <template v-if="videoUrl && state.ready && meta">
      <section class="flex flex-col gap-6px" aria-labelledby="vc-purpose-label">
        <label id="vc-purpose-label" for="vc-purpose" :class="labelCls">这条片子</label>
        <div class="relative self-start">
          <select
            id="vc-purpose"
            class="h-36px box-border pl-10px pr-30px rounded-12px border border-solid border-violet-line bg-violet-tint text-15px font-600 text-ink appearance-none cursor-pointer sx-focus disabled:cursor-not-allowed"
            :value="state.purpose"
            :disabled="disabled"
            @change="state.setPurpose(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="p in VC_PURPOSES" :key="p.key" :value="p.key">{{ p.label }}</option>
          </select>
          <svg
            class="pointer-events-none absolute right-10px top-1/2 -translate-y-1/2 w-12px h-12px text-placeholder"
            viewBox="0 0 512 512"
            fill="none"
            stroke="currentColor"
            stroke-width="48"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M112 184l144 144 144-144" />
          </svg>
        </div>
        <p v-if="state.purposeWhy" class="m-0 text-12px leading-18px text-muted">{{ state.purposeWhy }}</p>
        <p class="m-0 text-11px leading-16px text-placeholder">改目的会重排下面的维度，并带出原片文字的默认处理</p>
      </section>

      <section class="flex flex-col gap-6px">
        <span id="vc-text-label" :class="labelCls">原片文字</span>
        <div :class="[segTrack, 'self-start']" role="group" aria-labelledby="vc-text-label">
          <button
            v-for="o in VC_TEXT_OPTIONS"
            :key="o.key"
            type="button"
            :class="[segBtn, state.textStrategy === o.key ? segOn : segOff]"
            :aria-pressed="state.textStrategy === o.key"
            :disabled="disabled"
            @click="state.setTextStrategy(o.key)"
          >
            {{ o.label }}
          </button>
        </div>
        <p class="m-0 text-12px leading-18px text-muted">{{ textHint }}</p>
      </section>

      <VideoCloneRefLibrary
        v-model="refs"
        :max="refMax"
        :max-bytes="refMaxBytes"
        :accept="refAccept"
        :disabled="disabled"
        @update:uploading="emit('update:uploading', $event)"
      />

      <section class="flex flex-col" aria-labelledby="vc-dims-title">
        <div class="flex items-baseline justify-between gap-8px pt-8px pb-2px border-t border-t-solid border-line-soft">
          <h2 id="vc-dims-title" class="m-0 text-13px font-600 leading-18px text-ink">十一维 · 默认全部保持</h2>
          <span
            class="text-12px leading-18px tabular-nums"
            :class="state.changedKeys.length ? 'text-violet-ink' : 'text-placeholder'"
            aria-live="polite"
          >
            {{ state.changedKeys.length }} 项改动
          </span>
        </div>
        <VideoCloneDimCard
          v-for="k in state.orderedDims"
          :key="k"
          :state="state"
          :dim-key="k"
          :refs="refs"
          :disabled="disabled"
        />
      </section>

      <section class="flex flex-col gap-6px">
        <label for="vc-content" :class="labelCls"> 整体补充（选填） </label>
        <div class="relative">
          <textarea
            id="vc-content"
            :value="state.content"
            rows="3"
            :maxlength="contentMax"
            :disabled="disabled"
            @input="state.setContent(($event.target as HTMLTextAreaElement).value)"
            placeholder="还有哪些要求一句话写清，比如「节奏再快一点」；不标维度时写这里也能生成"
            class="block w-full box-border resize-y min-h-76px rounded-12px border border-solid border-#c9cfd6 bg-white px-10px pt-8px pb-22px text-13px leading-20px text-ink shadow-[inset_0_1px_2px_rgba(31,35,41,0.055)] outline-none placeholder:text-placeholder hover:border-#aeb6bf focus:(border-violet shadow-[0_0_0_3px_rgba(135,95,154,0.14)]) disabled:(bg-surface3 text-placeholder cursor-not-allowed)"
          />
          <span class="pointer-events-none absolute right-10px bottom-6px text-11px text-placeholder tabular-nums">
            {{ state.content.length }}/{{ contentMax }}
          </span>
        </div>
      </section>

      <section class="flex flex-col gap-10px pt-8px border-t border-t-solid border-line-soft" aria-label="输出设置">
        <div class="flex flex-wrap items-center justify-between gap-8px">
          <span id="vc-res-label" :class="labelCls">清晰度</span>
          <div :class="segTrack" role="group" aria-labelledby="vc-res-label">
            <button
              v-for="o in RESOLUTIONS"
              :key="o.key"
              type="button"
              :class="[segBtn, state.resolution === o.key ? segOn : segOff]"
              :aria-pressed="state.resolution === o.key"
              :disabled="disabled || resolutionBlocked(o.key)"
              :title="resolutionBlocked(o.key) ? `${modelLabel || '当前模型'}不支持 ${o.label}` : undefined"
              @click="state.setResolution(o.key)"
            >
              {{ o.label }}
            </button>
          </div>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-8px">
          <span id="vc-audio-label" :class="labelCls">音频</span>
          <div :class="segTrack" role="group" aria-labelledby="vc-audio-label">
            <button
              v-for="o in AUDIOS"
              :key="o.key"
              type="button"
              :class="[segBtn, state.audio === o.key ? segOn : segOff]"
              :aria-pressed="state.audio === o.key"
              :disabled="disabled || audioBlocked(o.key)"
              :title="audioBlocked(o.key) ? '原片没有音轨，只能重新配乐' : undefined"
              @click="state.setAudio(o.key)"
            >
              {{ o.label }}
            </button>
          </div>
        </div>
        <p class="m-0 text-11px leading-16px text-placeholder">
          画幅 {{ ratioText }}、时长
          {{ fmtSeconds(meta.duration) }} 跟随原片；「跟随原片」按原片清晰度落到模型最接近的一档，出片画质不超过原片
        </p>
        <p
          v-if="overModel"
          class="m-0 p-8px box-border rounded-10px border border-solid border-warning-line bg-warning-soft text-12px leading-18px text-alert-warning"
          role="alert"
        >
          原片 {{ fmtSeconds(meta.duration) }}，超过{{ modelLabel || '当前模型' }}单段上限
          {{ modelMaxSeconds }} 秒：请在下方换一个模型，或先裁剪原片
        </p>
      </section>
    </template>

    <MediaLightbox v-model:show="sheet.show" v-model:index="sheet.index" :items="sheetItems" pannable />
  </div>
</template>
