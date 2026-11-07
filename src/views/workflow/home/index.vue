<script setup lang="ts">
/**
 * /workflow/home：「工作流」导航首页（原型没有，版式取本地生活导航首页 / views/image/LandingPage.vue 的结构）。
 * 只读静态 schema（../schemas.ts），不发任何请求：分区按 workflowTree 的业务域顺序（服装 / 电商 / 视频 / 视觉），
 * 模板取 workflowSchemas 里 isWorkflowListed 的项，与工作流页的模板切换目录同一份；没有可见模板的分区（电商）不出。
 * 卡片链接用 workflowRouteOf（/workflow?flow=&category=&template=），与工作流页、工具目录同一 query 形状。
 * 卡片短说明逐字取原型 data/next-directory.ts 的 WF_DESC。
 */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import PageEmpty from '@/components/PageEmpty/index.vue'
import { toolCover } from '@/views/image/toolCovers.ts'
import { isWorkflowListed, workflowRouteOf, workflowSchemas, workflowTree, type WorkflowSchema } from '../schemas'

defineOptions({ name: 'workflow-home' })

/** 原型 next-directory.ts WF_DESC（只摘本仓库有 schema 的模板） */
const TAGLINES: Record<string, string> = {
  模特替换: '替换模特',
  模特换脸: '只换人脸',
  背景替换: '更换背景',
  模特换脸换背景: '脸景同换',
  模特试穿: '服装试穿',
  服装上身: '衣穿模特',
  双人换衣: '双人同款',
  鞋子上脚: '鞋款上脚',
  配饰穿戴: '配饰上身',
  单图复制: '同款复制',
  SKU替换: '批量换货',
  模特带货: '模特卖货',
  商品替换: '原片换品',
  口播带货: '产品口播',
}

/** 模板名 → 封面（public/images/tool-covers；名称相同的取 toolCover，其余按下表） */
const TEMPLATE_COVERS: Record<string, string> = {
  单图复制: '/images/tool-covers/single-copy.jpg',
  SKU替换: '/images/tool-covers/sku-replace.jpg',
  模特带货: '/images/tool-covers/model-sell.jpg',
  商品替换: '/images/tool-covers/product-replace-video.jpg',
  口播带货: '/images/tool-covers/oral-sell.jpg',
}
const coverOf = (name: string) => TEMPLATE_COVERS[name] ?? toolCover(name)

/** 没有封面的模板：每个模板一枚区分度够的图标（24×24、单色 currentColor） */
const TEMPLATE_ICONS: Record<string, string> = {
  模特替换: '<circle cx="9" cy="8" r="3"/><path d="M3.6 20c0-3.2 2.4-5.4 5.4-5.4s5.4 2.2 5.4 5.4"/><path d="M17 5l3 3-3 3"/><path d="M20 8h-5"/>',
  模特换脸: '<circle cx="12" cy="12" r="8"/><path d="M9 10.4h.01M15 10.4h.01"/><path d="M9 15c1.6 1.4 4.4 1.4 6 0"/>',
  背景替换: '<rect x="3.4" y="4.4" width="17.2" height="15.2" rx="2"/><path d="M3.4 15l5-4.4 4.2 3.6 3-2.4 5 4.4"/><circle cx="16.4" cy="8.8" r="1.4"/>',
  模特换脸换背景: '<circle cx="9" cy="10" r="3"/><path d="M3.6 20c0-3 2.4-5 5.4-5"/><rect x="12" y="6" width="8.4" height="8.4" rx="1.6"/><path d="M12 12.4l2.6-2.2 2 1.6 1.6-1.2 2.2 2"/>',
  模特试穿: '<path d="M9 4.2 4 6.6l1.8 4 1.8-.8V20h8.8V9.8l1.8.8 1.8-4L15 4.2a3 3 0 0 1-6 0z"/>',
  服装上身: '<path d="M8 4l-4.4 2.4 1.6 3.4 2-.8V20h9.6V9l2 .8 1.6-3.4L16 4a4 4 0 0 1-8 0z"/><path d="M12 11v6"/>',
  双人换衣: '<circle cx="8" cy="7.4" r="2.6"/><circle cx="16.4" cy="7.4" r="2.6"/><path d="M3.4 19c0-3 2.2-5 4.6-5s4.6 2 4.6 5"/><path d="M12 19c0-3 2-5 4.4-5s4.2 2 4.2 5"/>',
  鞋子上脚: '<path d="M3.4 15.6V9l4 1.4 2.2 2.8 6.2 1.4c2.8.6 4.8 1.2 4.8 2.6v.8H3.4z"/><path d="M3.4 18.4h17.2"/>',
  配饰穿戴: '<circle cx="12" cy="14.4" r="5"/><path d="M12 9.4V4.2M9.4 4.2h5.2"/><path d="M12 12v2.4l1.6 1"/>',
}

/** 按业务域画的近似图标（24×24、单色 currentColor） */
const FLOW_ICONS: Record<string, string> = {
  fashion: '<path d="M9 4.2 4 6.6l1.8 4 1.8-.8V20h8.8V9.8l1.8.8 1.8-4L15 4.2a3 3 0 0 1-6 0z"/>',
  video:
    '<rect x="3.4" y="6" width="12.4" height="12" rx="2"/><path d="M15.8 10.4l4.8-2.8v8.8l-4.8-2.8"/><path d="M8.4 9.6v4.8l3.6-2.4z"/>',
  visual:
    '<rect x="7.4" y="3.4" width="13.2" height="13.2" rx="2"/><path d="M16.6 20.6H5.4a2 2 0 0 1-2-2V7.4"/><path d="M7.4 13.4l3.6-3.4 2.8 2.6 2-1.8 4.8 4.2"/>',
}

interface HomeCard {
  key: string
  name: string
  tagline: string
  /** undefined = 未映射（即将开放） */
  route?: string
  icon: string
  cover: string
}

const sections = computed(() =>
  workflowTree
    .map((f) => ({
      flow: f.flow,
      label: f.label,
      cards: workflowSchemas
        .filter((s) => s.flow === f.flow && isWorkflowListed(s))
        .map(
          (s: WorkflowSchema): HomeCard => ({
            key: s.schemaId,
            name: s.name,
            tagline: TAGLINES[s.name] ?? '',
            route: s.status === 'mapped' ? workflowRouteOf(s.templateTitle) : undefined,
            icon: TEMPLATE_ICONS[s.name] ?? FLOW_ICONS[s.flow] ?? '',
            cover: coverOf(s.name),
          }),
        ),
    }))
    .filter((sec) => sec.cards.length > 0),
)

const pageClass = [
  'pt-18px px-20px pb-20px',
  '[@media(min-height:960px)]:pt-20px [@media(min-height:960px)]:pb-24px',
  '[@media(min-height:761px)_and_(max-height:880px)]:pt-14px [@media(min-height:761px)_and_(max-height:880px)]:px-16px [@media(min-height:761px)_and_(max-height:880px)]:pb-16px',
  '[@media(max-height:760px)]:pt-10px [@media(max-height:760px)]:px-14px [@media(max-height:760px)]:pb-12px',
]
const deckGap =
  'gap-16px [@media(min-height:960px)]:gap-18px [@media(min-height:761px)_and_(max-height:880px)]:gap-10px [@media(max-height:760px)]:gap-8px'
const gridGap = 'gap-12px [@media(min-height:761px)_and_(max-height:880px)]:gap-8px [@media(max-height:760px)]:gap-6px'
const cardH =
  'h-74px [@media(min-height:960px)]:h-78px [@media(min-height:761px)_and_(max-height:880px)]:h-64px [@media(max-height:760px)]:h-58px'
const headAnim = 'animate-[motion-enter-up_200ms_cubic-bezier(0.4,0,0.2,1)_0ms_both]'
const sectionAnim = [
  'animate-[motion-enter-up_340ms_cubic-bezier(0.4,0,0.2,1)_80ms_both]',
  'animate-[motion-enter-up_280ms_cubic-bezier(0.4,0,0.2,1)_200ms_both]',
  'animate-[motion-enter-up_260ms_cubic-bezier(0.4,0,0.2,1)_320ms_both]',
  'animate-[motion-enter-up_240ms_cubic-bezier(0.4,0,0.2,1)_440ms_both]',
]
function onImgError(e: Event) {
  ;(e.target as HTMLImageElement).style.visibility = 'hidden'
}

const focusRing =
  'outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-violet focus-visible:outline-offset-2'
</script>

<template>
  <div class="h-full overflow-y-auto box-border bg-page" :class="pageClass">
    <div class="max-w-1180px mx-auto w-full flex flex-col" :class="deckGap">
      <header class="flex flex-col gap-4px motion-reduce:animate-none" :class="headAnim">
        <h1 class="m-0 text-24px font-600 leading-32px text-ink">工作流</h1>
        <p class="m-0 text-13px leading-20px text-muted">选好模板，上传素材，一键出图出视频</p>
      </header>

      <PageEmpty v-if="!sections.length" text="暂无可用模板" />

      <section
        v-for="(sec, si) in sections"
        :key="sec.flow"
        :aria-labelledby="`workflow-home-sec-${si}`"
        class="flex flex-col gap-12px [@media(min-height:761px)_and_(max-height:880px)]:gap-8px [@media(max-height:760px)]:gap-6px motion-reduce:animate-none"
        :class="sectionAnim[si] ?? sectionAnim[sectionAnim.length - 1]"
      >
        <header class="flex items-baseline gap-8px px-2px">
          <h2 :id="`workflow-home-sec-${si}`" class="m-0 text-15px font-600 leading-22px text-ink">{{ sec.label }}</h2>
          <span class="text-12px text-muted tabular-nums" :aria-label="`共 ${sec.cards.length} 个`">{{
            sec.cards.length
          }}</span>
        </header>
        <ul class="m-0 p-0 list-none grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" :class="gridGap">
          <li v-for="card in sec.cards" :key="card.key" class="min-w-0">
            <component
              :is="card.route ? RouterLink : 'div'"
              v-bind="card.route ? { to: card.route } : { role: 'link', 'aria-disabled': 'true', tabindex: 0 }"
              :aria-label="card.route ? `${card.name}：${card.tagline}` : `${card.name}（即将开放）`"
              class="group relative flex items-center gap-12px box-border rounded-18px bg-white border border-solid border-line no-underline shadow-[0_10px_16px_rgba(0,0,0,0.04)] sx-squircle transition-[border-color,background,box-shadow,color] duration-110 motion-reduce:transition-none overflow-hidden"
              :class="[
                cardH,
                focusRing,
                card.cover ? '!px-0' : 'px-14px',
                card.route
                  ? 'cursor-pointer hover:border-violet-line hover:bg-[linear-gradient(180deg,#fff_0%,#f8f3fc_100%)] hover:shadow-[0_1px_2px_rgba(31,35,41,0.05)] active:shadow-[inset_0_1px_2px_rgba(31,35,41,0.1)]'
                  : 'cursor-not-allowed',
              ]"
            >
              <span
                v-if="card.cover"
                class="relative self-stretch aspect-[16/9] shrink-0 overflow-hidden bg-surface2"
                aria-hidden="true"
              >
                <img
                  :src="card.cover"
                  alt=""
                  loading="lazy"
                  class="block h-full w-full object-cover transition-transform duration-200 ease-out motion-reduce:transition-none group-hover:scale-[1.05]"
                  :class="card.route ? '' : 'opacity-60'"
                  @error="onImgError"
                />
                <span
                  class="absolute inset-y-0 right-0 w-18px bg-[linear-gradient(90deg,transparent,#fff)] pointer-events-none"
                />
              </span>
              <span
                v-else
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
                  :class="card.route ? '' : 'opacity-60'"
                  :innerHTML="card.icon"
                />
              </span>
              <span class="min-w-0 flex-1 flex flex-col gap-2px" :class="card.cover ? 'pl-10px pr-14px' : ''">
                <span class="flex items-center gap-6px min-w-0">
                  <span
                    class="truncate text-14px font-600 leading-20px transition-colors duration-110 motion-reduce:transition-none"
                    :class="card.route ? 'text-ink group-hover:text-violet-ink' : 'text-muted'"
                    >{{ card.name }}</span
                  >
                  <span v-if="!card.route" class="ll-chip shrink-0 text-muted bg-surface3 border border-line"
                    >即将开放</span
                  >
                </span>
                <span v-if="card.tagline" class="truncate text-11px leading-17px text-muted">{{ card.tagline }}</span>
              </span>
              <svg
                v-if="card.route"
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
                :class="card.cover ? 'absolute right-14px top-1/2 -translate-y-1/2' : 'mr-14px'"
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
