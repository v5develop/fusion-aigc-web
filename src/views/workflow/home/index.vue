<script setup lang="ts">
/**
 * /workflow/home：「工作流」导航首页（原型没有，版式取本地生活导航首页 / views/picture/LandingPage.vue 的结构）。
 * 只读静态 schema（../schemas.ts），不发任何请求：分区按 workflowTree 的业务域顺序（服装 / 电商 / 视频 / 视觉），
 * 模板取 workflowSchemas 里 isWorkflowListed 的项，与工作流页的模板切换目录同一份；没有可见模板的分区（电商）不出。
 * 卡片链接用 workflowRouteOf（/workflow?flow=&category=&template=），与工作流页、工具目录同一 query 形状。
 * 卡片短说明逐字取原型 data/next-directory.ts 的 WF_DESC。
 */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
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
            icon: FLOW_ICONS[s.flow] ?? '',
          }),
        ),
    }))
    .filter((sec) => sec.cards.length > 0),
)

const focusRing =
  'outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-violet focus-visible:outline-offset-2'
</script>

<template>
  <div class="h-full overflow-y-auto box-border bg-page pt-18px px-16px pb-20px sm:px-20px">
    <div class="max-w-1180px flex flex-col gap-16px">
      <header class="flex flex-col gap-4px">
        <h1 class="m-0 text-24px font-600 leading-32px text-ink">工作流</h1>
        <p class="m-0 text-13px leading-20px text-muted">选好模板，上传素材，一键出图出视频</p>
      </header>

      <section
        v-for="(sec, si) in sections"
        :key="sec.flow"
        :aria-labelledby="`workflow-home-sec-${si}`"
        class="flex flex-col gap-12px"
      >
        <header class="flex items-baseline gap-8px px-2px">
          <h2 :id="`workflow-home-sec-${si}`" class="m-0 text-15px font-600 leading-22px text-ink">{{ sec.label }}</h2>
          <span class="text-12px text-muted tabular-nums" :aria-label="`共 ${sec.cards.length} 个`">{{
            sec.cards.length
          }}</span>
        </header>
        <ul class="m-0 p-0 list-none grid grid-cols-1 gap-12px sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <li v-for="card in sec.cards" :key="card.key" class="min-w-0">
            <component
              :is="card.route ? RouterLink : 'div'"
              v-bind="card.route ? { to: card.route } : { role: 'link', 'aria-disabled': 'true', tabindex: 0 }"
              :aria-label="card.route ? `${card.name}：${card.tagline}` : `${card.name}（即将开放）`"
              class="group relative flex items-center gap-12px h-74px box-border px-14px rounded-8px bg-white border border-solid border-line no-underline shadow-[0_10px_16px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow,transform] duration-160 motion-reduce:transition-none"
              :class="[
                focusRing,
                card.route
                  ? 'cursor-pointer hover:-translate-y-2px hover:border-violet-line hover:shadow-[0_4px_16px_rgba(31,35,41,0.08)] motion-reduce:hover:transform-none'
                  : 'cursor-not-allowed',
              ]"
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
                  :class="card.route ? '' : 'opacity-60'"
                  :innerHTML="card.icon"
                />
              </span>
              <span class="min-w-0 flex-1 flex flex-col gap-2px">
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
