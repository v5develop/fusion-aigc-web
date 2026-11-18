<script setup lang="ts">
/**
 * 「AI 图片」「AI 视频」导航首页（新原型 AI 图片 / AI 视频落地页，路由 /image、/video），两页共用，内容见 ./landing.ts；
 * 本地生活导航首页（#/local-life，无原型）也用这个组件，内容见 views/local-life/landingData.ts。
 *
 * <p>尺寸、阴影、渐变、过渡、入场节奏逐值取自原型 views/ai/AiExploreView.vue（设计规范 §6「探索落地页」、§7.13，
 * 2026-11-06 对齐轮：卡片 r18 squircle、封面实拍图、紫底主卡 3D 倾斜）。
 * 2026-11-12 对齐 5186 总览终版（rail-row）：推荐区两列 × 行高 128，首卡跨两行、第 2/3 张叠在右列；
 * 每组是一条面板带（内边距 18/20、r14、1px 描边），组名在卡片上方（18 号、不带数量）；
 * 工具卡固定高 74，网格 auto-fill minmax(220px,1fr)、间距 10/12（各组卡宽一致）；<640 宽推荐区退成单列、首卡用小卡样式。
 * 原型按视口高度分四档收放卡高与间距，5186 终版已取消，现在只剩页面内边距还按高度分档。
 * 原型 banner 右侧是实拍图（public/images/tool-covers，名称对齐原型 toolCovers.ts），没有的（本地生活导航首页）沿用同色调渐变占位；
 * 分组里的工具卡一律用图标方块（2026-11-18：实拍封面与图标方块混排显得杂，封面只留在 banner）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { isIndustryGone as isIndustryGate, plazaTemplates, type IPlazaTemplate } from '@/api/plaza.ts'
import IndustryGate from '@/views/agent/industry/IndustryGate.vue'
import { useIndustry } from '@/views/agent/industry/useIndustry.ts'
import IndustryGateModal from '@/views/plaza/components/IndustryGateModal.vue'
import { replicateTemplate } from '@/views/plaza/replicate.ts'
import { useToolAvailability, withoutDisabledSections } from '@/utils/toolAvailability.ts'
import { useTilt } from '@/utils/composables/useTilt.ts'
import { toolCover } from './tool-covers.ts'
import type { LandingBanner, LandingPageData } from './landing'

const props = defineProps<{ data: LandingPageData }>()

// 受控工具（后端绑定被关停）已知不可用时不列卡片；未知 / 加载中照常显示
useToolAvailability()
const sections = computed(() => withoutDisabledSections(props.data.sections))

// 页面内边距的高度档位媒体查询变体（区间互斥，不用比先后）：≥960 = [@media(min-height:960px)]，761–880 = [@media(min-height:761px)_and_(max-height:880px)]，≤760 = [@media(max-height:760px)]。
// 类名必须整串写成字面量，UnoCSS 只扫源码文本，拼接出来的类不会生成。

/** 页面内边距 18/20/20 → ≥960 20/20/24 → ≤880 14/16/16 → ≤760 10/14/12 */
const pageClass = [
  'pt-18px px-20px pb-20px',
  '[@media(min-height:960px)]:pt-20px [@media(min-height:960px)]:pb-24px',
  '[@media(min-height:761px)_and_(max-height:880px)]:pt-14px [@media(min-height:761px)_and_(max-height:880px)]:px-16px [@media(min-height:761px)_and_(max-height:880px)]:pb-16px',
  '[@media(max-height:760px)]:pt-10px [@media(max-height:760px)]:px-14px [@media(max-height:760px)]:pb-12px',
]
/** 分层间距：推荐区与各组带之间统一 12 */
const deckGap = 'gap-12px'
/** 推荐区卡片间距 12 */
const gridGap = 'gap-12px'
/** 推荐区行高 128（首卡跨两行 = 256 + 间距），工具卡高 74：5186 终版固定值，不再随视口高度分档 */
const heroRow = 'auto-rows-128px'

/** 原型 useStaggerEnter：标题 0/200ms → 推荐层 40/300ms → 各组延迟 160/360/500/620、时长 340/280/260/240ms，缓动 (.4,0,.2,1)、fill both */
const headAnim = 'animate-[motion-enter-up_200ms_cubic-bezier(0.4,0,0.2,1)_0ms_both]'
const heroAnim = 'animate-[motion-enter-up_300ms_cubic-bezier(0.4,0,0.2,1)_40ms_both]'
const sectionAnim = [
  'animate-[motion-enter-up_340ms_cubic-bezier(0.4,0,0.2,1)_160ms_both]',
  'animate-[motion-enter-up_280ms_cubic-bezier(0.4,0,0.2,1)_360ms_both]',
  'animate-[motion-enter-up_260ms_cubic-bezier(0.4,0,0.2,1)_500ms_both]',
  'animate-[motion-enter-up_240ms_cubic-bezier(0.4,0,0.2,1)_620ms_both]',
]

/** banner 右侧实拍图（按工具名查原型同款封面，没有的条目回落同色调渐变占位） */
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
const bannerPhoto = (b: LandingBanner) => b.image || toolCover(b.title)

/** 三张 banner 卡的 3D 倾斜（原型 useTilt：rotateX 8 / rotateY 10 / 上抬 -2px / 图片反向位移 10·6；只写 CSS 变量） */
const tilt = useTilt({ prefix: 'hero', rotateX: 8, rotateY: 10, lift: '-2px', imageX: 10, imageY: 6 })
const heroTransform =
  '[transform:perspective(800px)_rotateX(var(--hero-rx,0deg))_rotateY(var(--hero-ry,0deg))_translateY(var(--hero-lift,0px))] [transform-style:preserve-3d] will-change-transform motion-reduce:!transform-none'
const imgBase = '[transform:translate3d(var(--hero-img-x,0px),var(--hero-img-y,0px),0)_scale(1.02)]'
const imgHover = 'group-hover:[transform:translate3d(var(--hero-img-x,0px),var(--hero-img-y,0px),0)_scale(1.04)]'

/**
 * 底部爆款货架：当前行业的创意广场模板前 4 条（GET /api/v1/plaza/templates?industry=…，严格按行业）。
 * 行业复用智能体页的偏好（useIndustry）：已选直接用；未选就地出行业选择（匿名可选，不跳转）。
 * 页面没开货架（data.shelf 为假）不请求；失败、行业整理中或一条都没有整块不渲染（不放占位）。
 */
const SHELF_SIZE = 4
const router = useRouter()
const ind = useIndustry()
const shelf = ref<IPlazaTemplate[]>([])
const shelfAnim = 'animate-[motion-enter-up_320ms_cubic-bezier(0.4,0,0.2,1)_760ms_both]'
let shelfSeq = 0
async function loadShelf() {
  const cur = ind.current.value
  if (!props.data.shelf || !cur) {
    shelf.value = []
    return
  }
  const mine = ++shelfSeq
  try {
    const res = await plazaTemplates({ industry: cur.code, subIndustry: ind.sub.value || undefined, page: 1, size: SHELF_SIZE })
    if (mine === shelfSeq) shelf.value = (res.data?.data ?? []).slice(0, SHELF_SIZE)
  } catch (err) {
    if (mine !== shelfSeq) return
    shelf.value = []
    if (isIndustryGate(err)) ind.handleGone()
  }
}
onMounted(() => {
  if (props.data.shelf) void ind.load()
})
watch(() => [ind.current.value?.code ?? '', ind.sub.value] as const, () => void loadShelf(), { immediate: true })
const showGate = computed(() => !!props.data.shelf && ind.needGate.value)
function onSelectIndustry(code: string) {
  ind.select(code)
}
const shelfCover = (t: IPlazaTemplate) => t.payload?.result?.[0] ?? t.payload?.image_urls?.[0] ?? ''
const shelfTarget = (t: IPlazaTemplate) => ({ path: '/agent', query: { plazaTemplateId: String(t.plazaTemplateId) } })
const shelfMeta = (t: IPlazaTemplate) => (t.tags ?? []).slice(1, 3).join(' · ')
/** 作者 · N 人用过：两项都是后端可选字段，缺哪项就不拼哪项（用量为 0 / 缺失不显示，不放「0 人用过」） */
const shelfAuthorUsage = (t: IPlazaTemplate) => {
  const parts: string[] = []
  const author = t.authorName?.trim()
  if (author) parts.push(author)
  const n = t.usageCount
  if (typeof n === 'number' && Number.isFinite(n) && n > 0) parts.push(`${n > 9999 ? `${(n / 10000).toFixed(1)} 万` : n} 人用过`)
  return parts.join(' · ')
}

const focusRing =
  'outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-violet focus-visible:outline-offset-2'

/** 原型 .explore-hero：r18 squircle（2026-11-06 档位）、1px 描边、180ms ease 过渡；白卡 hover 换 violet-line 描边 + 双层阴影，紫卡 hover 只上抬 */
function bannerClass(b: LandingBanner) {
  return [
    'group relative block h-full w-full overflow-hidden box-border p-0 rounded-18px border border-solid no-underline text-left sx-squircle',
    'transition-[border-color,box-shadow,transform] duration-180 ease-[ease] motion-reduce:transition-none',
    heroTransform,
    focusRing,
    b.accent
      ? 'border-violet-border bg-[linear-gradient(var(--xq-violet-top),var(--xq-violet-bottom))] shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_1px_rgba(90,60,110,0.18),0_2px_4px_rgba(90,60,110,0.18)]'
      : 'border-line bg-white shadow-[0_10px_16px_rgba(0,0,0,0.04)]',
    b.route
      ? 'cursor-pointer hover:border-violet-line hover:shadow-[0_2px_4px_rgba(31,35,41,0.06),0_10px_24px_rgba(31,35,41,0.08)] active:shadow-[inset_0_1px_2px_rgba(31,35,41,0.08)]'
      : 'cursor-not-allowed',
  ]
}

/** 推荐位版式：首卡（大）占左列两行，其余叠在右列；<640 退成单列（首卡也只占一行） */
const heroSlot = (i: number) =>
  i === 0
    ? 'row-span-2 col-start-1 [@media(max-width:639px)]:row-span-1'
    : 'col-start-2 [@media(max-width:639px)]:col-start-1'

</script>

<template>
  <div class="h-full overflow-y-auto overflow-x-hidden box-border bg-page" :class="pageClass">
    <div class="mx-auto w-full max-w-1180px flex flex-col" :class="deckGap">
      <h1 class="m-0 text-24px font-600 leading-32px text-ink motion-reduce:animate-none" :class="headAnim">
        {{ data.title }}
      </h1>

      <!-- 三张入口 banner：前两张白卡、第三张藤紫卡（原型列宽 1fr 1fr 1.16fr；紫卡跟手 3D 倾斜） -->
      <ul
        aria-label="推荐功能"
        class="m-0 p-0 list-none grid grid-cols-2 [@media(max-width:639px)]:grid-cols-1 motion-reduce:animate-none"
        :class="[gridGap, heroRow, heroAnim]"
      >
        <li v-for="(b, bi) in data.banners" :key="b.id" class="min-w-0 min-h-0" :class="heroSlot(bi)">
          <component
            :is="b.route ? RouterLink : 'div'"
            v-bind="b.route ? { to: b.route } : { role: 'link', 'aria-disabled': 'true', tabindex: 0 }"
            :aria-label="b.route ? `${b.title}：${b.desc}` : `${b.title}（即将开放）`"
            :class="bannerClass(b)"
            @pointermove="tilt.onMove"
            @pointerleave="tilt.onLeave"
            @pointercancel="tilt.onCancel"
          >
            <!-- 实拍图：右侧 46%，常态 scale 1.02、悬停 1.04（原型 transform 160ms ease-out）；紫卡上 0.24 + luminosity + 视差 -->
            <span
              aria-hidden="true"
              class="absolute top-0 right-0 h-full overflow-hidden"
              :class="[bi === 0 ? 'w-[44%]' : 'w-[46%]', !bannerPhoto(b) ? photoTint[b.id] : '']"
            >
              <img
                v-if="bannerPhoto(b)"
                :src="bannerPhoto(b)"
                alt=""
                loading="lazy"
                class="block h-full w-full object-cover transition-transform duration-160 ease-[ease-out] motion-reduce:transition-none motion-reduce:!transform-none"
                :class="[b.accent ? 'opacity-24 mix-blend-luminosity' : 'opacity-92', imgBase, b.route ? imgHover : '']"
              />
              <span
                v-else
                class="absolute inset-0 transition-transform duration-160 ease-[ease-out] motion-reduce:transition-none motion-reduce:!transform-none"
                :class="[b.accent ? 'opacity-24 mix-blend-luminosity' : 'opacity-92', imgBase, b.route ? imgHover : '']"
              />
            </span>
            <!-- 原型的整卡遮罩：白卡左实右透，紫卡藤紫 0.92 → 0.18 -->
            <span
              aria-hidden="true"
              class="absolute inset-0"
              :class="
                b.accent
                  ? 'bg-[linear-gradient(90deg,rgba(95,63,111,0.92)_0%,rgba(95,63,111,0.72)_48%,rgba(95,63,111,0.18)_100%)]'
                  : 'bg-[linear-gradient(90deg,var(--xq-surface)_0%,var(--xq-surface)_46%,rgb(var(--xq-surface-rgb)/0.72)_66%,rgb(var(--xq-surface-rgb)/0)_100%)]'
              "
            />
            <span
              class="relative z-2 h-full box-border flex flex-col items-start"
              :class="bi === 0 ? 'py-12px px-14px sm:py-18px sm:px-20px' : 'py-12px px-14px'"
            >
              <span
                class="inline-flex items-center h-20px box-border px-8px rounded-full border border-solid text-11px font-600 leading-16px whitespace-nowrap"
                :class="
                  b.accent ? 'border-white/50 bg-white/18 text-white' : 'border-violet-line bg-white text-violet-ink'
                "
                >新手推荐</span
              >
              <span
                class="font-600"
                :class="[
                  bi === 0
                    ? 'mt-6px text-18px leading-24px line-clamp-2 sm:mt-10px sm:text-24px sm:leading-32px sm:tracking-[-0.02em] sm:line-clamp-none'
                    : 'mt-6px text-18px leading-24px line-clamp-2',
                  b.accent ? 'text-white' : 'text-ink',
                ]"
                >{{
                b.title
              }}</span>
              <span
                class="mt-2px"
                :class="[
                  bi === 0
                    ? 'max-w-190px text-11px leading-17px sm:max-w-240px sm:text-13px sm:leading-20px'
                    : 'max-w-190px text-11px leading-17px',
                  b.accent ? 'text-white/80' : 'text-muted',
                ]"
                >{{ b.desc }}</span
              >
              <span
                v-if="b.route"
                class="mt-auto inline-flex items-center gap-3px font-600"
                :class="[
                  bi === 0 ? 'h-20px text-11px sm:h-26px sm:text-13px' : 'h-20px text-11px',
                  b.accent ? 'text-white' : 'text-violet-ink',
                ]"
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
        v-for="(sec, si) in sections"
        :key="sec.label"
        :aria-labelledby="`landing-sec-${si}`"
        class="flex flex-col gap-12px box-border px-20px py-18px rounded-14px border border-solid border-line bg-surface shadow-[0_1px_2px_rgba(31,35,41,0.03)] motion-reduce:animate-none"
        :class="sectionAnim[si] ?? sectionAnim[sectionAnim.length - 1]"
      >
        <header class="flex items-baseline gap-8px">
          <h2 :id="`landing-sec-${si}`" class="m-0 text-18px font-600 leading-26px tracking-[-0.01em] text-ink">
            {{ sec.label }}
          </h2>
        </header>
        <ul
          class="m-0 p-0 list-none grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-12px gap-y-10px"
        >
          <li v-for="tool in sec.tools" :key="tool.id" class="min-w-0">
            <component
              :is="tool.route ? RouterLink : 'div'"
              v-bind="tool.route ? { to: tool.route } : { role: 'link', 'aria-disabled': 'true', tabindex: 0 }"
              :aria-label="tool.route ? `${tool.name}：${tool.tagline}` : `${tool.name}（即将开放）`"
              class="group relative flex items-center gap-12px box-border rounded-18px bg-white border border-solid border-line no-underline shadow-[0_10px_16px_rgba(0,0,0,0.04)] sx-squircle transition-[border-color,background,box-shadow,color] duration-110 motion-reduce:transition-none overflow-hidden"
              :class="[
                'h-74px',
                focusRing,
                'px-14px',
                tool.route
                  ? 'cursor-pointer hover:border-violet-line hover:bg-[linear-gradient(180deg,var(--xq-surface)_0%,var(--xq-violet-tint)_100%)] hover:shadow-[0_1px_2px_rgba(31,35,41,0.05)] active:shadow-[inset_0_1px_2px_rgba(31,35,41,0.1)]'
                  : 'cursor-not-allowed',
              ]"
            >
              <span
                class="shrink-0 grid place-items-center w-40px h-40px box-border rounded-8px border border-solid border-line bg-[linear-gradient(135deg,var(--xq-violet-icon-a),var(--xq-violet-icon-b))] shadow-[inset_0_1px_0_#fff] text-violet-ink"
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
              <span class="min-w-0 flex-1 flex flex-col gap-2px">
                <span class="flex items-center min-w-0 max-w-full gap-6px">
                  <span
                    class="truncate max-w-full text-14px font-600 leading-20px transition-colors duration-110 motion-reduce:transition-none"
                    :class="tool.route ? 'text-ink group-hover:text-violet-ink' : 'text-muted'"
                    >{{ tool.name }}</span
                  >
                  <span
                    v-if="tool.hot"
                    class="shrink-0 inline-flex items-center h-16px box-border px-5px rounded-full border border-solid border-violet-line bg-[linear-gradient(var(--xq-surface),var(--xq-violet-tint))] shadow-[0_1px_2px_rgba(31,35,41,0.05)] text-10px font-600 leading-14px text-violet-ink"
                    >最常用</span
                  >
                  <span v-if="!tool.route" class="ll-chip shrink-0 text-muted bg-surface3 border border-line"
                    >即将开放</span
                  >
                </span>
                <span class="truncate max-w-full text-11px leading-17px text-muted">{{ tool.tagline }}</span>
              </span>
              <!-- 原型 .explore-card__chev：13px 箭头，悬停 / 键盘聚焦时显出（110ms） -->
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

      <!-- 底部：爆款货架（创意广场前 4 个可一键复刻的模板；没有数据整块不出）；4 列 → <1024 两列 → <640 一列 -->
      <section
        v-if="data.shelf && (shelf.length || showGate)"
        aria-labelledby="landing-shelf"
        class="flex flex-col gap-10px min-h-0 motion-reduce:animate-none"
        :class="shelfAnim"
      >
        <header class="flex items-baseline gap-8px px-2px">
          <h2 id="landing-shelf" class="m-0 text-15px font-600 leading-22px text-ink">试着复刻这些爆款</h2>
          <RouterLink
            to="/plaza"
            class="ml-auto inline-flex items-center gap-2px text-12px text-violet-ink no-underline hover:underline"
            >去逛逛 ›</RouterLink
          >
          <button
            v-if="ind.current.value"
            type="button"
            class="m-0 cursor-pointer border-0 bg-transparent p-0 text-12px text-muted hover:text-ink"
            :class="focusRing"
            @click="ind.gateOpen.value = true"
          >
            {{ ind.current.value.name }} · 换行业
          </button>
        </header>
        <IndustryGate v-if="showGate" :industries="ind.industries.value" @select="onSelectIndustry" />
        <ul
          v-else
          class="m-0 p-0 list-none grid grid-cols-4 gap-12px [@media(max-width:1023px)]:grid-cols-2 [@media(max-width:639px)]:grid-cols-1"
        >
          <li v-for="t in shelf" :key="t.plazaTemplateId" class="min-w-0">
            <RouterLink
              :to="shelfTarget(t)"
              @click.prevent="replicateTemplate(router, t)"
              class="flex flex-col box-border p-7px rounded-18px border border-solid border-line bg-[linear-gradient(180deg,var(--xq-surface)_0%,var(--xq-upload-hover-bottom)_100%)] shadow-[0_2px_6px_rgba(31,35,41,0.05)] no-underline sx-squircle transition-[border-color,box-shadow,transform] duration-140 hover:border-violet-line hover:shadow-[0_8px_18px_rgba(31,35,41,0.09)] hover:-translate-y-1px motion-reduce:transition-none motion-reduce:hover:transform-none"
              :class="focusRing"
            >
              <span class="relative block w-full aspect-[16/9] overflow-hidden rounded-9px bg-surface2">
                <img
                  v-if="shelfCover(t)"
                  :src="shelfCover(t)"
                  :alt="t.title"
                  loading="lazy"
                  class="block h-full w-full object-cover"
                />
                <span
                  v-if="t.tags?.length"
                  class="absolute left-6px top-6px inline-flex items-center h-18px px-6px rounded-full bg-white/92 text-10px text-ink-2 shadow-[0_1px_3px_rgba(31,35,41,0.12)]"
                  >{{ t.tags[0] }}</span
                >
              </span>
              <span class="flex flex-col gap-3px min-w-0 pt-8px px-3px pb-3px">
                <span class="truncate text-13px font-600 leading-18px text-ink">{{ t.title }}</span>
                <span v-if="shelfMeta(t)" class="truncate text-11px leading-16px text-muted">{{ shelfMeta(t) }}</span>
                <span v-if="shelfAuthorUsage(t)" class="truncate text-11px leading-16px text-placeholder">{{
                  shelfAuthorUsage(t)
                }}</span>
              </span>
            </RouterLink>
          </li>
        </ul>
      </section>
      <IndustryGateModal
        v-if="data.shelf"
        v-model:show="ind.gateOpen.value"
        :industries="ind.industries.value"
        :current="ind.current.value?.code"
        @select="onSelectIndustry"
      />
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
