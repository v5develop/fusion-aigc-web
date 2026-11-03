<script setup lang="ts">
/**
 * 「AI 图片」「AI 视频」导航首页（新原型 #/picture、#/video 落地页），两页共用，内容见 ./landing.ts；
 * 本地生活导航首页（#/local-life，无原型）也用这个组件，内容见 views/local-life/landingData.ts。
 *
 * <p>尺寸、阴影、渐变、过渡、入场节奏逐值取自原型 views/explore/AiExploreView.vue（设计规范 §6「探索落地页」、§7.13）。
 * 原型按视口高度分四档（默认 / ≥960 / ≤880 / ≤760）收放卡高与间距，这里用 UnoCSS 的高度媒体查询变体逐档写。
 * 原型 banner 右侧是实拍图，本仓库没有这些图，用同色调的柔和渐变块占位，不外链原型图片；
 * 原型 banner 的鼠标 3D 倾斜（useTilt）不搬，只保留上抬 2px。
 */
import { RouterLink } from 'vue-router'
import type { LandingBanner, LandingPageData } from './landing'

defineProps<{ data: LandingPageData }>()

// 高度档位的媒体查询变体（区间互斥，不用比先后）：≥960 = [@media(min-height:960px)]，761–880 = [@media(min-height:761px)_and_(max-height:880px)]，≤760 = [@media(max-height:760px)]。
// 类名必须整串写成字面量，UnoCSS 只扫源码文本，拼接出来的类不会生成。

/** 页面内边距 18/20/20 → ≥960 20/20/24 → ≤880 14/16/16 → ≤760 10/14/12 */
const pageClass = [
  'pt-18px px-20px pb-20px',
  '[@media(min-height:960px)]:pt-20px [@media(min-height:960px)]:pb-24px',
  '[@media(min-height:761px)_and_(max-height:880px)]:pt-14px [@media(min-height:761px)_and_(max-height:880px)]:px-16px [@media(min-height:761px)_and_(max-height:880px)]:pb-16px',
  '[@media(max-height:760px)]:pt-10px [@media(max-height:760px)]:px-14px [@media(max-height:760px)]:pb-12px',
]
/** 分层间距 --ex-deck-gap：16 → 18 / 10 / 8 */
const deckGap =
  'gap-16px [@media(min-height:960px)]:gap-18px [@media(min-height:761px)_and_(max-height:880px)]:gap-10px [@media(max-height:760px)]:gap-8px'
/** 卡片网格间距 --ex-grid-gap：12 → 12 / 8 / 6（hero 行与工具网格共用） */
const gridGap = 'gap-12px [@media(min-height:761px)_and_(max-height:880px)]:gap-8px [@media(max-height:760px)]:gap-6px'
/** 分组标题与网格间距 --ex-group-gap：12 → 10 / 8 / 6 */
const groupGap =
  'gap-12px [@media(min-height:960px)]:gap-10px [@media(min-height:761px)_and_(max-height:880px)]:gap-8px [@media(max-height:760px)]:gap-6px'
/** hero 高 --ex-hero-h：142 → 156 / 124 / 112 */
const heroH =
  'h-142px [@media(min-height:960px)]:h-156px [@media(min-height:761px)_and_(max-height:880px)]:h-124px [@media(max-height:760px)]:h-112px'
/** 工具卡高 --ex-card-h：74 → 78 / 64 / 58 */
const cardH =
  'h-74px [@media(min-height:960px)]:h-78px [@media(min-height:761px)_and_(max-height:880px)]:h-64px [@media(max-height:760px)]:h-58px'

/** 原型 useStaggerEnter：标题 0/200ms → 推荐层 40/300ms → 各组延迟 160/360/500/620、时长 340/280/260/240ms，缓动 (.4,0,.2,1)、fill both */
const headAnim = 'animate-[motion-enter-up_200ms_cubic-bezier(0.4,0,0.2,1)_0ms_both]'
const heroAnim = 'animate-[motion-enter-up_300ms_cubic-bezier(0.4,0,0.2,1)_40ms_both]'
const sectionAnim = [
  'animate-[motion-enter-up_340ms_cubic-bezier(0.4,0,0.2,1)_160ms_both]',
  'animate-[motion-enter-up_280ms_cubic-bezier(0.4,0,0.2,1)_360ms_both]',
  'animate-[motion-enter-up_260ms_cubic-bezier(0.4,0,0.2,1)_500ms_both]',
  'animate-[motion-enter-up_240ms_cubic-bezier(0.4,0,0.2,1)_620ms_both]',
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

/** 原型 .explore-hero：r12、1px 描边、180ms ease 过渡；白卡 hover 换 violet-line 描边 + 双层阴影，紫卡 hover 只上抬 */
function bannerClass(b: LandingBanner) {
  return [
    'group relative block overflow-hidden box-border p-0 rounded-12px border border-solid no-underline text-left',
    heroH,
    'transition-[border-color,box-shadow,transform] duration-180 ease-[ease] motion-reduce:transition-none',
    focusRing,
    b.accent
      ? 'border-violet-border bg-[linear-gradient(#8a639f,#7a548c)] shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_1px_rgba(90,60,110,0.18),0_2px_4px_rgba(90,60,110,0.18)]'
      : 'border-line bg-white shadow-[0_10px_16px_rgba(0,0,0,0.04)]',
    b.route
      ? [
          'cursor-pointer hover:-translate-y-2px motion-reduce:hover:transform-none',
          b.accent
            ? ''
            : 'hover:border-violet-line hover:shadow-[0_2px_4px_rgba(31,35,41,0.06),0_10px_24px_rgba(31,35,41,0.08)] active:shadow-[inset_0_1px_2px_rgba(31,35,41,0.08)]',
        ]
      : 'cursor-not-allowed',
  ]
}
</script>

<template>
  <div class="h-full overflow-y-auto box-border bg-page" :class="pageClass">
    <div class="max-w-1180px flex flex-col" :class="deckGap">
      <h1 class="m-0 text-24px font-600 leading-32px text-ink motion-reduce:animate-none" :class="headAnim">
        {{ data.title }}
      </h1>

      <!-- 三张入口 banner：前两张白卡、第三张藤紫卡（原型列宽 1fr 1fr 1.16fr） -->
      <ul
        aria-label="推荐功能"
        class="m-0 p-0 list-none grid grid-cols-[1fr_1fr_1.16fr] motion-reduce:animate-none"
        :class="[gridGap, heroAnim]"
      >
        <li v-for="b in data.banners" :key="b.id" class="min-w-0">
          <component
            :is="b.route ? RouterLink : 'div'"
            v-bind="b.route ? { to: b.route } : { role: 'link', 'aria-disabled': 'true', tabindex: 0 }"
            :aria-label="b.route ? `${b.title}：${b.desc}` : `${b.title}（即将开放）`"
            :class="bannerClass(b)"
          >
            <!-- 实拍图占位：右侧 46%，常态 scale 1.02、悬停 1.04（原型 transform 160ms ease-out）；紫卡上 0.24 + luminosity -->
            <span
              aria-hidden="true"
              class="absolute top-0 right-0 h-full w-[46%] scale-[1.02] transition-transform duration-160 ease-[ease-out] motion-reduce:transition-none motion-reduce:transform-none"
              :class="[
                photoTint[b.id],
                b.accent ? 'opacity-24 mix-blend-luminosity' : 'opacity-92',
                b.route ? 'group-hover:scale-[1.04]' : '',
              ]"
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
            <span class="relative z-2 h-full box-border flex flex-col items-start py-14px px-16px">
              <span
                class="inline-flex items-center h-18px box-border px-6px rounded-full border border-solid text-10px font-600 leading-16px whitespace-nowrap"
                :class="
                  b.accent ? 'border-white/50 bg-white/18 text-white' : 'border-violet-line bg-white text-violet-ink'
                "
                >新手推荐</span
              >
              <span class="mt-8px text-19px font-600 leading-26px" :class="b.accent ? 'text-white' : 'text-ink'">{{
                b.title
              }}</span>
              <span
                class="max-w-190px mt-2px text-12px leading-18px"
                :class="b.accent ? 'text-white/80' : 'text-muted'"
                >{{ b.desc }}</span
              >
              <span
                v-if="b.route"
                class="mt-auto inline-flex items-center gap-3px h-22px text-12px font-600"
                :class="b.accent ? 'text-white' : 'text-violet-ink'"
              >
                {{ b.cta }}
                <svg
                  viewBox="0 0 24 24"
                  width="13"
                  height="13"
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
              <span v-else class="mt-auto ll-chip text-muted bg-surface3 border border-line">即将开放</span>
            </span>
          </component>
        </li>
      </ul>

      <section
        v-for="(sec, si) in data.sections"
        :key="sec.label"
        :aria-labelledby="`landing-sec-${si}`"
        class="flex flex-col motion-reduce:animate-none"
        :class="[groupGap, sectionAnim[si] ?? sectionAnim[sectionAnim.length - 1]]"
      >
        <header class="flex items-baseline gap-8px px-2px">
          <h2 :id="`landing-sec-${si}`" class="m-0 text-15px font-600 leading-22px text-ink">{{ sec.label }}</h2>
          <span class="text-12px text-muted tabular-nums" :aria-label="`共 ${sec.tools.length} 个`">{{
            sec.tools.length
          }}</span>
        </header>
        <ul class="m-0 p-0 list-none grid grid-cols-4" :class="gridGap">
          <li v-for="tool in sec.tools" :key="tool.id" class="min-w-0">
            <component
              :is="tool.route ? RouterLink : 'div'"
              v-bind="tool.route ? { to: tool.route } : { role: 'link', 'aria-disabled': 'true', tabindex: 0 }"
              :aria-label="tool.route ? `${tool.name}：${tool.tagline}` : `${tool.name}（即将开放）`"
              class="group relative flex items-center gap-12px box-border px-14px rounded-10px bg-white border border-solid border-line no-underline shadow-[0_10px_16px_rgba(0,0,0,0.04)] transition-[border-color,background,box-shadow,color] duration-110 motion-reduce:transition-none"
              :class="[
                cardH,
                focusRing,
                tool.route
                  ? 'cursor-pointer hover:border-violet-line hover:bg-[linear-gradient(180deg,#fff_0%,#f8f3fc_100%)] hover:shadow-[0_1px_2px_rgba(31,35,41,0.05)] active:shadow-[inset_0_1px_2px_rgba(31,35,41,0.1)]'
                  : 'cursor-not-allowed',
              ]"
            >
              <span
                v-if="tool.hot"
                class="absolute top-8px right-8px inline-flex items-center h-18px box-border px-6px rounded-full border border-solid border-violet-line bg-[linear-gradient(#fff,#f8f3fc)] shadow-[0_1px_2px_rgba(31,35,41,0.05)] text-10px font-600 leading-16px whitespace-nowrap text-violet-ink"
                >最常用</span
              >
              <span
                class="shrink-0 grid place-items-center w-40px h-40px box-border rounded-8px border border-solid border-line bg-[linear-gradient(135deg,#f6effa,#efe6f5)] shadow-[inset_0_1px_0_#fff] text-violet-ink"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="19"
                  height="19"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                  :class="tool.route ? '' : 'opacity-60'"
                  :innerHTML="tool.icon"
                />
              </span>
              <span class="min-w-0 flex-1 flex flex-col gap-2px" :class="tool.hot ? 'pr-44px' : ''">
                <span class="flex items-center gap-6px min-w-0">
                  <span
                    class="truncate text-14px font-600 leading-20px transition-colors duration-110 motion-reduce:transition-none"
                    :class="tool.route ? 'text-ink group-hover:text-violet-ink' : 'text-muted'"
                    >{{ tool.name }}</span
                  >
                  <span v-if="!tool.route" class="ll-chip shrink-0 text-muted bg-surface3 border border-line"
                    >即将开放</span
                  >
                </span>
                <span class="truncate text-11px leading-17px text-muted">{{ tool.tagline }}</span>
              </span>
              <!-- 原型 .explore-card__chev：13px 箭头，常态隐藏，悬停 / 键盘聚焦时显出（110ms） -->
              <svg
                v-if="tool.route"
                viewBox="0 0 24 24"
                width="13"
                height="13"
                fill="none"
                stroke="currentColor"
                stroke-width="2.4"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
                class="shrink-0 text-placeholder opacity-0 transition-opacity duration-110 group-hover:opacity-100 group-hover:text-violet-ink group-focus-visible:opacity-100 group-focus-visible:text-violet-ink motion-reduce:transition-none"
              >
                <path d="m9 6 6 6-6 6" />
              </svg>
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
 * motion-enter-up 原值抄自原型 components/motion/motion-enter.css。
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
