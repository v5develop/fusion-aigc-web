<script setup lang="ts">
/**
 * 「AI 图片」「AI 视频」导航首页（新原型 #/picture、#/video 落地页），两页共用，内容见 ./landing.ts；
 * 本地生活导航首页（#/local-life，无原型）也用这个组件，内容见 views/local-life/landingData.ts。
 *
 * <p>阴影、渐变、过渡时长、入场动画逐值取自原型的计算样式；尺寸按原型截图量取（1x）。
 * 原型 banner 右侧是实拍图，本仓库没有这些图，用同色调的柔和渐变块占位，不外链原型图片。
 */
import { RouterLink } from 'vue-router'
import type { LandingBanner, LandingPageData } from './landing'

defineProps<{ data: LandingPageData }>()

/** 原型入场动画 motion-enter-up：各分组时长依次 0.34 / 0.28 / 0.26 / 0.24s（原型计算样式原值） */
const sectionAnim = [
  'animate-[motion-enter-up_0.34s_cubic-bezier(0.4,0,0.2,1)]',
  'animate-[motion-enter-up_0.28s_cubic-bezier(0.4,0,0.2,1)]',
  'animate-[motion-enter-up_0.26s_cubic-bezier(0.4,0,0.2,1)]',
  'animate-[motion-enter-up_0.24s_cubic-bezier(0.4,0,0.2,1)]',
]

/** banner 右侧实拍图的占位色：取原图主色调的柔和渐变（近似，非原图） */
const photoTint: Record<string, string> = {
  'ai-digital-model': 'bg-[linear-gradient(135deg,#d6eef0_0%,#7fc3c9_55%,#2f8f99_100%)]',
  'ai-posture-fission': 'bg-[linear-gradient(160deg,#cfeaf3_0%,#f4e7b0_55%,#e9c85a_100%)]',
  'image-generate': 'bg-[linear-gradient(135deg,#b495c6_0%,#8f6aa5_100%)]',
  'model-sell': 'bg-[linear-gradient(160deg,#cfeaf3_0%,#f4e7b0_55%,#e9c85a_100%)]',
  'video-product-replace': 'bg-[linear-gradient(135deg,#f7ece4_0%,#efc9bf_55%,#d99a96_100%)]',
  'ai-video-generator': 'bg-[linear-gradient(135deg,#b495c6_0%,#8f6aa5_100%)]',
  // 本地生活导航首页（views/local-life/landingData.ts）：无原型，沿用上面同一组占位渐变
  'local-life-full-set': 'bg-[linear-gradient(135deg,#b495c6_0%,#8f6aa5_100%)]',
  'local-life-shop-profile': 'bg-[linear-gradient(135deg,#d6eef0_0%,#7fc3c9_55%,#2f8f99_100%)]',
  'local-life-copywriting': 'bg-[linear-gradient(160deg,#cfeaf3_0%,#f4e7b0_55%,#e9c85a_100%)]',
}

const focusRing =
  'outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-violet focus-visible:outline-offset-2'

function bannerClass(b: LandingBanner) {
  return [
    'group relative overflow-hidden flex flex-col items-start h-124px box-border pt-14px px-15px rounded-10px border border-solid no-underline text-left',
    'transition-[border-color,box-shadow,transform] duration-[0.18s] ease-[ease]',
    focusRing,
    b.accent
      ? 'border-violet-border bg-[linear-gradient(#8a639f,#7a548c)] shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_1px_rgba(90,60,110,0.18),0_2px_4px_rgba(90,60,110,0.18)]'
      : 'border-line bg-white shadow-[0_10px_16px_rgba(0,0,0,0.04)]',
    b.route
      ? b.accent
        ? 'cursor-pointer hover:-translate-y-2px hover:border-violet-press hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_4px_16px_rgba(90,60,110,0.24)]'
        : 'cursor-pointer hover:-translate-y-2px hover:border-violet-line hover:shadow-[0_4px_16px_rgba(31,35,41,0.08)]'
      : 'cursor-not-allowed',
  ]
}
</script>

<template>
  <div class="h-full overflow-y-auto bg-page">
    <div class="max-w-1180px box-border pt-14px pb-24px pl-16px pr-24px">
      <h1
        class="m-0 text-22px font-600 leading-30px text-ink animate-[motion-enter-up_0.2s_cubic-bezier(0.4,0,0.2,1)] motion-reduce:animate-none"
      >
        {{ data.title }}
      </h1>

      <!-- 三张入口 banner：前两张白卡、第三张藤紫卡（原型宽度 366 / 366 / 427） -->
      <ul
        class="m-0 mt-12px p-0 list-none grid gap-10px grid-cols-[minmax(0,366fr)_minmax(0,366fr)_minmax(0,427fr)] animate-[motion-enter-up_0.3s_cubic-bezier(0.4,0,0.2,1)] motion-reduce:animate-none"
      >
        <li v-for="b in data.banners" :key="b.id">
          <component
            :is="b.route ? RouterLink : 'div'"
            v-bind="b.route ? { to: b.route } : { role: 'link', 'aria-disabled': 'true', tabindex: 0 }"
            :aria-label="b.route ? `${b.title}：${b.desc}` : `${b.title}（即将开放）`"
            :class="bannerClass(b)"
          >
            <!-- 实拍图占位：卡片右侧 46%，悬停微放大（原型 img transform 0.16s ease-out） -->
            <span
              aria-hidden="true"
              class="absolute top-0 right-0 h-full w-[46%] transition-transform duration-[0.16s] ease-[ease-out]"
              :class="[photoTint[b.id], b.accent ? 'opacity-55' : '', b.route ? 'group-hover:scale-[1.04]' : '']"
            />
            <!-- 原型的整卡遮罩：白卡左实右透，紫卡藤紫 0.92 → 0.18 -->
            <span
              aria-hidden="true"
              class="absolute inset-0"
              :class="
                b.accent
                  ? 'bg-[linear-gradient(90deg,rgba(95,63,111,0.92)_0%,rgba(95,63,111,0.72)_48%,rgba(95,63,111,0.18)_100%)]'
                  : 'bg-[linear-gradient(90deg,#fff_0%,#fff_46%,rgba(255,255,255,0.72)_66%,rgba(255,255,255,0)_100%)]'
              "
            />
            <span
              class="relative inline-flex items-center h-18px box-border px-6px rounded-full border border-solid text-10px font-500 leading-none"
              :class="
                b.accent ? 'border-white/45 bg-white/12 text-white' : 'border-violet-line bg-white text-violet-ink'
              "
              >新手推荐</span
            >
            <span
              class="relative mt-10px text-20px font-600 leading-26px"
              :class="b.accent ? 'text-white' : 'text-ink'"
              >{{ b.title }}</span
            >
            <span class="relative mt-4px text-12px leading-18px" :class="b.accent ? 'text-white/80' : 'text-muted'">{{
              b.desc
            }}</span>
            <span
              v-if="b.route"
              class="relative mt-6px inline-flex items-center gap-2px text-12px font-600 leading-18px"
              :class="b.accent ? 'text-white' : 'text-violet-ink'"
            >
              {{ b.cta }}
              <svg
                viewBox="0 0 24 24"
                width="12"
                height="12"
                fill="none"
                stroke="currentColor"
                stroke-width="2.4"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="m9 6 6 6-6 6" />
              </svg>
            </span>
            <span v-else class="relative mt-6px ll-chip text-muted bg-surface3 border border-line">即将开放</span>
          </component>
        </li>
      </ul>

      <section
        v-for="(sec, si) in data.sections"
        :key="sec.label"
        :aria-labelledby="`landing-sec-${si}`"
        class="mt-12px motion-reduce:animate-none"
        :class="sectionAnim[si] ?? sectionAnim[sectionAnim.length - 1]"
      >
        <h2 :id="`landing-sec-${si}`" class="m-0 flex items-baseline gap-8px text-16px font-600 leading-22px text-ink">
          {{ sec.label }}
          <span class="text-12px font-400 text-muted" :aria-label="`共 ${sec.tools.length} 个`">{{
            sec.tools.length
          }}</span>
        </h2>
        <ul class="m-0 mt-10px p-0 list-none grid gap-10px grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
          <li v-for="tool in sec.tools" :key="tool.id">
            <component
              :is="tool.route ? RouterLink : 'div'"
              v-bind="tool.route ? { to: tool.route } : { role: 'link', 'aria-disabled': 'true', tabindex: 0 }"
              :aria-label="tool.route ? `${tool.name}：${tool.tagline}` : `${tool.name}（即将开放）`"
              class="group relative flex items-center gap-12px box-border py-11px px-13px rounded-8px bg-white border border-solid border-line no-underline shadow-[0_10px_16px_rgba(0,0,0,0.04)] transition-[border-color,background,box-shadow,color,transform] duration-[0.11s] ease-[ease]"
              :class="[
                focusRing,
                tool.route
                  ? 'cursor-pointer hover:-translate-y-2px hover:border-violet-line hover:shadow-[0_4px_16px_rgba(31,35,41,0.08)]'
                  : 'cursor-not-allowed',
              ]"
            >
              <span
                class="shrink-0 flex items-center justify-center w-40px h-40px box-border rounded-8px border border-solid border-line bg-[linear-gradient(135deg,#f6effa,#efe6f5)] shadow-[inset_0_1px_0_#fff] text-violet-ink"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                  class="transition-opacity duration-[0.11s] ease-[ease]"
                  :class="tool.route ? '' : 'opacity-60'"
                  :innerHTML="tool.icon"
                />
              </span>
              <span class="min-w-0 flex-1 flex flex-col gap-2px" :class="tool.hot ? 'pr-44px' : ''">
                <span class="flex items-center gap-6px">
                  <span
                    class="truncate text-14px font-600 leading-20px transition-colors duration-[0.11s] ease-[ease]"
                    :class="tool.route ? 'text-ink group-hover:text-violet-ink' : 'text-muted'"
                    >{{ tool.name }}</span
                  >
                  <span v-if="!tool.route" class="ll-chip shrink-0 text-muted bg-surface3 border border-line"
                    >即将开放</span
                  >
                </span>
                <span class="truncate text-12px leading-18px text-muted">{{ tool.tagline }}</span>
              </span>
              <span
                v-if="tool.hot"
                class="absolute top-8px right-8px inline-flex items-center h-18px box-border px-6px rounded-full border border-solid border-violet-line bg-[linear-gradient(#fff,#f8f3fc)] shadow-[0_1px_2px_rgba(31,35,41,0.05)] text-10px font-500 leading-none text-violet-ink"
                >最常用</span
              >
            </component>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style>
/*
 * 只留 @keyframes：UnoCSS 的 animate-[…] 只引用名字，关键帧写不成原子类。
 * 不加 scoped——scoped 会给关键帧名加哈希，模板里的原子类就对不上了（同 StudioImageUpload 的做法）。
 * motion-enter-up 原值抄自原型计算样式：标题 0.2s、banner 0.3s、各分组 0.34/0.28/0.26/0.24s。
 */
@keyframes motion-enter-up {
  0% {
    opacity: 0;
    transform: translateX(-24px);
  }
  100% {
    opacity: 1;
    transform: none;
  }
}
</style>
