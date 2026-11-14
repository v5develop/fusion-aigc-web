<script setup lang="ts">
/**
 * 智能体首页 · 爆款模板横卡（原型 5185 TemplateCard variant="row"）：148 高、左 40% 封面、右侧标题 / 说明 / 标签。
 * 选中 = 紫描边 + 1px 外圈 + 右上角紫勾；悬停封面出 CTA（默认「做同款」，创意广场传「一键复刻」）。
 * 创意广场共用本组件：没有关联技能的模板传 cta=false，卡片降为不可点的静态展示（div，无 CTA）。
 */
import { computed } from 'vue'
import type { IPlazaTemplate } from '@/api/plaza.ts'
import FavButton from './FavButton.vue'
import { coverOf, isVideoTemplate, usageText, videoSrcOf } from './templateMedia.ts'

const props = withDefaults(
  defineProps<{
    item: IPlazaTemplate
    picked?: boolean
    disabled?: boolean
    /** 悬停 CTA 文案；false = 不可点的静态卡（不出 CTA、不发 pick） */
    cta?: string | false
    /** 点卡片是先开预览（行业版浏览）：只影响读屏标签 */
    preview?: boolean
    /** 给了行业就在封面右上显示收藏 ♡（兄弟 button，不嵌在主按钮里）；不给（创意广场等）不显示 */
    favorable?: boolean
  }>(),
  { picked: false, disabled: false, cta: '做同款', preview: false, favorable: false },
)
const emit = defineEmits<{ pick: [item: IPlazaTemplate] }>()

// 行业版卡片：封面 = posterUrl ?? 效果图首张；视频没有封面图时退回 <video> 首帧；右上角是类型角标 + 热 / 新上架
const cover = computed(() => coverOf(props.item))
const isVideo = computed(() => isVideoTemplate(props.item))
const videoSrc = computed(() => videoSrcOf(props.item))
const usage = computed(() => usageText(props.item))
const status = computed(() => (props.item.isNew ? '新上架' : ''))
const interactive = computed(() => props.cta !== false)
/** 底部标签照原型「行业 · 子类」：取前两个标签合成一枚 */
const tagLine = computed(() =>
  props.item.industries?.length
    ? props.item.industries.map((x) => x.name).slice(0, 2).join(' · ')
    : (props.item.tags ?? []).slice(0, 2).join(' · '),
)
const desc = computed(() => {
  const d = props.item.payload?.description
  return typeof d === 'string' ? d.trim() : ''
})

function onClick() {
  if (props.disabled || !interactive.value) return
  emit('pick', props.item)
}
</script>

<template>
  <div class="fav-host relative block w-full">
  <component
    :is="interactive ? 'button' : 'div'"
    :type="interactive ? 'button' : undefined"
    :aria-pressed="interactive ? picked : undefined"
    :aria-label="interactive && preview ? `${item.title}，${isVideo ? '视频' : '图片'}模板，点击查看` : undefined"
    :aria-disabled="(interactive && disabled) || undefined"
    :class="[
      'group sx-squircle relative flex h-148px w-full overflow-hidden rounded-18px border border-solid p-0 text-left',
      'bg-[linear-gradient(var(--xq-surface),var(--xq-soft-bottom))] [content-visibility:auto] [contain-intrinsic-size:auto_148px]',
      '[transition:border-color_0.12s_ease,box-shadow_0.12s_ease] motion-reduce:transition-none',
      'focus-visible:(outline outline-2 outline-violet outline-offset-2)',
      picked
        ? 'border-#b48bc6 shadow-[0_0_0_1px_#b48bc6,0_6px_16px_rgba(31,35,41,0.08)]'
        : 'border-soft-line shadow-[0_6px_16px_rgba(31,35,41,0.08),inset_0_1px_0_#fff,inset_0_-3px_6px_rgba(31,35,41,0.04)] hover:(border-violet-line shadow-[0_6px_18px_rgba(31,35,41,0.08),0_1px_2px_rgba(31,35,41,0.05)])',
      !interactive ? 'cursor-default' : disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
    ]"
    @click="onClick"
  >
    <span class="relative block h-full w-2/5 flex-none overflow-hidden bg-surface3">
      <video
        v-if="!cover && isVideo && videoSrc"
        :src="videoSrc"
        muted
        playsinline
        preload="metadata"
        class="block h-full w-full object-cover"
        aria-hidden="true"
      />
      <img
        v-else-if="cover"
        :src="cover"
        :alt="item.title"
        loading="lazy"
        class="block h-full w-full object-cover [transition:transform_0.4s_ease] group-hover:scale-103 motion-reduce:transition-none"
      />
      <span v-else class="grid h-full w-full place-items-center text-11px text-placeholder">暂无预览</span>
      <span
        class="absolute left-8px top-8px inline-flex h-20px items-center gap-3px rounded-10px bg-white/88 px-7px text-10px font-500 text-violet-ink backdrop-blur-6px"
        aria-hidden="true"
      >
        {{ isVideo ? '视频' : '图片' }}
      </span>
      <span
        v-if="isVideo"
        class="absolute bottom-8px left-8px grid h-24px w-24px place-items-center rounded-full bg-black/55 text-white"
        aria-hidden="true"
      >
        <svg class="ml-1px h-10px w-10px" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
      </span>
      <span
        v-if="interactive"
        class="absolute bottom-8px right-8px inline-flex h-26px items-center gap-3px rounded-4px bg-[linear-gradient(var(--xq-violet-top),var(--xq-violet-bottom))] px-9px text-11px font-600 text-white opacity-0 translate-y-4px [transition:opacity_0.14s_ease,transform_0.14s_ease] group-hover:(opacity-100 translate-y-0) group-focus-visible:(opacity-100 translate-y-0) [@media(hover:none)]:hidden"
        aria-hidden="true"
      >
        {{ cta }}
        <svg class="h-10px w-10px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </span>
    </span>

    <span class="flex min-w-0 flex-1 flex-col justify-center gap-3px px-14px py-12px">
      <span class="flex min-w-0 items-center gap-6px">
        <b class="truncate text-14px font-600 leading-20px text-ink">{{ item.title }}</b>
        <i
          v-if="status"
          class="inline-flex h-16px flex-none items-center rounded-4px bg-violet-soft px-5px text-10px font-600 not-italic text-violet-ink"
          >{{ status }}</i
        >
      </span>
      <span v-if="desc" class="line-clamp-2 text-12px leading-18px text-muted">{{ desc }}</span>
      <span v-if="usage" class="text-11px leading-16px text-placeholder">{{ usage }}</span>
      <span v-if="tagLine" class="mt-5px flex min-w-0 items-center overflow-hidden">
        <i
          class="inline-flex h-18px max-w-full items-center truncate whitespace-nowrap rounded-3px bg-violet-soft px-6px text-10px not-italic text-violet-ink"
          >{{ tagLine }}</i
        >
      </span>
    </span>

    <span
      v-if="picked"
      class="absolute right-8px top-8px z-3 grid h-18px w-18px place-items-center rounded-full bg-violet-top text-white shadow-[0_2px_6px_rgba(31,35,41,0.22),inset_0_1px_0_rgba(255,255,255,0.25)]"
      aria-hidden="true"
    >
      <svg class="h-11px w-11px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    </span>
  </component>
  <!-- 收藏钮：与主按钮同级（不嵌套）；放在封面右上，避开左上的类型角标与右上的选中勾 -->
  <FavButton v-if="favorable && interactive" :item="item" class="absolute left-[calc(40%-36px)] top-8px z-4" />
  </div>
</template>
