<script setup lang="ts">
/**
 * 模板预览（agent-template-industry DESIGN §7.5 / EXPERIENCE §3.7）：点卡片先看，再「做同款」。
 * 桌面是居中对话框，手机（≤640px）是底部抽屉；图片 contain，视频 muted loop controls，
 * 非 reduced-motion 才自动播放，关闭时 pause 并摘掉 src 释放连接；点「做同款」只是放进输入框，不扣点数。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { NDrawer, NDrawerContent, NModal } from 'naive-ui'
import type { IPlazaTemplate } from '@/api/plaza.ts'
import FavButton from './FavButton.vue'
import { useSamples } from './industry/useSamples.ts'
import SamplePanel from './SamplePanel.vue'
import { coverOf, descOf, industryLine, isVideoTemplate, usageText, videoSrcOf } from './templateMedia.ts'

const props = defineProps<{
  /** null = 关闭 */
  item: IPlazaTemplate | null
  /** 当前列表的位置，用于上一个 / 下一个 */
  index?: number
  total?: number
  disabled?: boolean
  /** 当前行业范围（示例效果按它取；缺则不取、不显示示例） */
  scope?: { industry: string; subIndustry?: string } | null
}>()
const emit = defineEmits<{ close: []; pick: [item: IPlazaTemplate]; nav: [delta: number] }>()

const show = computed(() => !!props.item)
const sampleScope = computed(() =>
  props.item && props.scope ? { industry: props.scope.industry, subIndustry: props.scope.subIndustry, templateId: props.item.plazaTemplateId } : null,
)
const { samples } = useSamples(sampleScope)
const mq = typeof window !== 'undefined' ? window.matchMedia('(max-width: 640px)') : null
const phone = ref(mq?.matches ?? false)
const onMq = () => (phone.value = mq?.matches ?? false)
mq?.addEventListener('change', onMq)
onBeforeUnmount(() => mq?.removeEventListener('change', onMq))

/** NDrawer 底部抽屉不认 height:auto（高度会是 0），给确定像素：屏高的 86%，封顶 680 */
const drawerHeight = computed(() => Math.min(Math.round((typeof window !== 'undefined' ? window.innerHeight : 800) * 0.86), 680))

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

const video = ref<HTMLVideoElement | null>(null)
const videoFailed = ref(false)
const imgFailed = ref(false)
const imgKey = ref(0)

const isVideo = computed(() => !!props.item && isVideoTemplate(props.item))
const src = computed(() => (props.item ? videoSrcOf(props.item) : ''))
const cover = computed(() => (props.item ? coverOf(props.item) : ''))
const desc = computed(() => (props.item ? descOf(props.item) : ''))
const usage = computed(() => (props.item ? usageText(props.item) : ''))
const channels = computed(() => (props.item?.targetChannels ?? []).map((c) => c.name).join(' · '))
const eta = computed(() => (isVideo.value ? '约 3 分钟出片' : '约 30 秒出图'))

let opener: HTMLElement | null = null
watch(
  () => props.item?.plazaTemplateId,
  async (id, old) => {
    videoFailed.value = false
    imgFailed.value = false
    if (id != null && old == null) opener = document.activeElement as HTMLElement | null
    if (id != null) {
      await nextTick()
      const v = video.value
      if (v && !reduced()) void v.play().catch(() => undefined)
    }
  },
)

function stopVideo() {
  const v = video.value
  if (!v) return
  v.pause()
  v.removeAttribute('src')
  v.load()
}

function close() {
  stopVideo()
  emit('close')
  void nextTick(() => opener?.focus?.())
}

function pick() {
  if (!props.item || props.disabled) return
  stopVideo()
  emit('pick', props.item)
  void nextTick(() => opener?.focus?.())
}

function onKey(e: KeyboardEvent) {
  if (!props.item) return
  if (e.key === 'ArrowLeft') emit('nav', -1)
  else if (e.key === 'ArrowRight') emit('nav', 1)
}

const hasNav = computed(() => (props.total ?? 0) > 1 && props.index != null)
const FOCUS = 'focus-visible:(outline outline-2 outline-violet outline-offset-2)'
</script>

<template>
  <component
    :is="phone ? NDrawer : NModal"
    v-bind="
      phone
        ? { show, placement: 'bottom', height: drawerHeight, autoFocus: true, trapFocus: true }
        : { show, autoFocus: true, trapFocus: true, transformOrigin: 'center' }
    "
    @update:show="(v: boolean) => !v && close()"
    @after-leave="stopVideo"
  >
    <component
      :is="phone ? NDrawerContent : 'div'"
      v-bind="phone ? { nativeScrollbar: true, bodyContentStyle: { padding: 0 } } : {}"
    >
      <div
        v-if="item"
        role="dialog"
        aria-labelledby="tpl-preview-title"
        :aria-modal="true"
        :class="[
          'relative flex flex-col overflow-hidden bg-surface text-left text-ink',
          phone
            ? 'h-full rounded-t-20px'
            : 'sx-squircle w-[min(560px,92vw)] max-h-[90vh] rounded-20px border border-solid border-soft-line shadow-pop',
        ]"
        @keydown="onKey"
      >
        <span v-if="phone" class="mx-auto mt-8px h-4px w-36px flex-none rounded-2px bg-line-strong" aria-hidden="true" />
        <button
          type="button"
          class="absolute right-10px top-10px z-3 grid h-40px w-40px place-items-center rounded-full border-0 bg-surface/80 text-ink-2 cursor-pointer backdrop-blur-6px hover:text-ink"
          :class="FOCUS"
          aria-label="关闭"
          @click="close"
        >
          <svg class="h-16px w-16px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        <div class="relative flex-none bg-surface3">
          <template v-if="isVideo">
            <video
              v-if="src && !videoFailed"
              ref="video"
              :src="src"
              :poster="cover || undefined"
              muted
              loop
              playsinline
              controls
              preload="metadata"
              class="block max-h-52vh w-full bg-black object-contain"
              @error="videoFailed = true"
            />
            <div v-else class="relative grid min-h-200px w-full place-items-center">
              <img v-if="cover" :src="cover" alt="" class="absolute inset-0 h-full w-full object-cover opacity-60" aria-hidden="true" />
              <span class="relative rounded-8px bg-surface/90 px-12px py-6px text-12px text-ink-2">{{
                src ? '视频暂时无法播放' : '暂无预览'
              }}</span>
            </div>
          </template>
          <template v-else>
            <img
              v-if="cover && !imgFailed"
              :key="imgKey"
              :src="cover"
              :alt="item.title"
              class="block max-h-52vh w-full object-contain"
              @error="imgFailed = true"
            />
            <div v-else class="grid min-h-200px place-items-center gap-8px text-12px text-muted">
              <span>{{ cover ? '图片没加载出来' : '暂无预览' }}</span>
              <button
                v-if="cover"
                type="button"
                class="sx-soft-btn"
                @click="
                  () => {
                    imgFailed = false
                    imgKey++
                  }
                "
              >
                重新加载
              </button>
            </div>
          </template>
        </div>

        <div class="flex min-h-0 flex-col gap-8px overflow-y-auto px-18px pb-16px pt-14px">
          <div class="flex items-center gap-8px">
            <h3 id="tpl-preview-title" class="m-0 min-w-0 flex-1 truncate text-16px font-600 leading-24px">
              {{ item.title }}
            </h3>
            <FavButton v-if="scope" :item="item" variant="inline" class="flex-none" />
            <span
              v-if="hasNav"
              class="flex flex-none items-center gap-2px text-11px text-placeholder"
              :aria-label="`第 ${(index ?? 0) + 1} 个，共 ${total} 个`"
            >
              <button
                type="button"
                class="grid h-32px w-32px place-items-center rounded-full border-0 bg-transparent text-ink-2 cursor-pointer hover:bg-surface3 disabled:opacity-40"
                :class="FOCUS"
                aria-label="上一个模板"
                :disabled="(index ?? 0) <= 0"
                @click="emit('nav', -1)"
              >
                <svg class="h-14px w-14px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
              </button>
              {{ (index ?? 0) + 1 }}/{{ total }}
              <button
                type="button"
                class="grid h-32px w-32px place-items-center rounded-full border-0 bg-transparent text-ink-2 cursor-pointer hover:bg-surface3 disabled:opacity-40"
                :class="FOCUS"
                aria-label="下一个模板"
                :disabled="(index ?? 0) >= (total ?? 0) - 1"
                @click="emit('nav', 1)"
              >
                <svg class="h-14px w-14px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
              </button>
            </span>
          </div>
          <p v-if="desc" class="m-0 text-13px leading-20px text-ink-2">{{ desc }}</p>
          <div class="flex flex-wrap items-center gap-x-10px gap-y-4px text-12px text-muted">
            <span v-if="industryLine(item)" class="inline-flex h-20px items-center rounded-4px bg-violet-soft px-8px text-violet-ink">{{ industryLine(item) }}</span>
            <span v-if="usage">{{ usage }}</span>
            <span>{{ eta }}</span>
          </div>
          <p v-if="channels" class="m-0 text-12px text-muted">适合：{{ channels }}</p>
          <!-- 没有示例就不显示该区块（不编造）；示例只展示、不生成、不扣点数 -->
          <SamplePanel v-if="samples.length" :samples="samples" compact class="mt-4px" />
          <p class="m-0 mt-6px text-14px font-600 leading-20px text-ink-2">只是放进输入框，发送前不会扣点数</p>
          <button type="button" class="sx-btn-primary !h-40px !text-14px" :disabled="disabled" @click="pick">做同款</button>
        </div>
      </div>
    </component>
  </component>
</template>
