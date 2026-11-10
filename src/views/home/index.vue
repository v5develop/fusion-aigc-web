<script setup lang="ts">
/**
 * 首页 = 工具箱（v1.0 原型 ToolsView）。
 * 每个工具独立提交、结果进各自的历史记录；有对应页面的卡片直达该页，没有的显示「即将开放」。
 * 12 个 Java v1 工具的卡片指向共用工具页 /tools/:toolId（路由取自 ./tools 的 route）。
 */
import { computed, nextTick, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { toolCover } from '@/views/image/tool-covers.ts'
import { tools, toolCategories, toolInputShapeLabels, type ToolCategory } from './tools'

type TabKey = 'all' | ToolCategory

const tabs: { key: TabKey; label: string }[] = [{ key: 'all', label: '全部' }, ...toolCategories]

const active = ref<TabKey>('all')
const tabRefs = ref<HTMLButtonElement[]>([])

const list = computed(() => (active.value === 'all' ? tools : tools.filter((t) => t.category === active.value)))

// WAI-ARIA tabs：左右键在分类间移动并选中，Home/End 跳到首尾
function onTabKeydown(e: KeyboardEvent, index: number) {
  const last = tabs.length - 1
  const next =
    e.key === 'ArrowRight'
      ? index === last
        ? 0
        : index + 1
      : e.key === 'ArrowLeft'
        ? index === 0
          ? last
          : index - 1
        : e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? last
            : -1
  if (next < 0) return
  e.preventDefault()
  active.value = tabs[next]!.key
  nextTick(() => tabRefs.value[next]?.focus())
}

// 本项目 UnoCSS 未启用 transformerVariantGroup：变体分组写法不生效，hover / focus-visible 必须逐条写
// 卡片材质对齐原型 AiExploreView / material-align.css 与 views/image/LandingPage.vue：r18 squircle、1px line、0 10px 16px 阴影
const focusRing =
  'outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-violet focus-visible:outline-offset-2'

/** 高度档位（区间互斥，类名必须字面量）：页面内边距 默认 → ≤880 → ≤760 */
const pagePad =
  'pt-8px pb-24px [@media(min-height:761px)_and_(max-height:880px)]:pb-16px [@media(max-height:760px)]:pt-4px [@media(max-height:760px)]:pb-12px'
const headPad =
  'pt-24px pb-8px [@media(min-height:761px)_and_(max-height:880px)]:pt-16px [@media(max-height:760px)]:pt-10px [@media(max-height:760px)]:pb-4px'
const gridGap = 'gap-12px [@media(min-height:761px)_and_(max-height:880px)]:gap-8px [@media(max-height:760px)]:gap-6px'

/** 入场：与 LandingPage 同一条 motion-enter-up（头部 200ms、网格 300ms 延后 80ms） */
const headAnim = 'animate-[motion-enter-up_200ms_cubic-bezier(0.4,0,0.2,1)_0ms_both]'
const gridAnim = 'animate-[motion-enter-up_300ms_cubic-bezier(0.4,0,0.2,1)_80ms_both]'

const cardBase =
  'group relative flex items-stretch box-border w-full h-full min-h-92px overflow-hidden rounded-18px sx-squircle ' +
  'bg-white border border-solid border-line no-underline text-left shadow-[0_10px_16px_rgba(0,0,0,0.04)] ' +
  'transition-[border-color,background,box-shadow,color] duration-110 motion-reduce:transition-none ' +
  focusRing
const cardLive =
  'cursor-pointer hover:border-violet-line hover:bg-[linear-gradient(180deg,#fff_0%,#f8f3fc_100%)] hover:shadow-[0_1px_2px_rgba(31,35,41,0.05)] active:shadow-[inset_0_1px_2px_rgba(31,35,41,0.1)]'

/** 「最常用」：沿用 landing.ts 的 hot 工具名（口播带货在本目录无对应项） */
const hotNames = new Set(['高清放大', '智能消除', '商品精修', '产品替换', '视频高清'])
</script>

<template>
  <div class="h-full flex flex-col bg-page">
    <div class="shrink-0 px-24px">
      <div class="max-w-1180px mx-auto flex flex-col gap-16px motion-reduce:animate-none" :class="[headPad, headAnim]">
        <header>
          <h1 class="m-0 text-20px font-600 leading-28px text-ink">工具箱</h1>
          <p class="m-0 mt-4px text-14px font-500 leading-20px text-muted">
            覆盖图片与视频创作能力，每个工具独立提交、结果进各自的历史记录
          </p>
        </header>

        <div role="tablist" aria-label="工具分类" class="flex flex-wrap gap-8px">
          <button
            v-for="(tab, i) in tabs"
            :id="`home-tool-tab-${tab.key}`"
            :key="tab.key"
            ref="tabRefs"
            type="button"
            role="tab"
            :aria-selected="active === tab.key"
            aria-controls="home-tool-panel"
            :tabindex="active === tab.key ? 0 : -1"
            class="h-32px px-12px rounded-8px text-14px leading-20px cursor-pointer border-none transition-[background-color,color] duration-200 ease"
            :class="[
              focusRing,
              active === tab.key
                ? 'bg-[#f1ecf3] text-violet font-600'
                : 'bg-white text-ink-2 font-500 hover:text-violet',
            ]"
            @click="active = tab.key"
            @keydown="onTabKeydown($event, i)"
          >
            {{ tab.label }}
          </button>
        </div>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable] px-24px" :class="pagePad">
      <ul
        id="home-tool-panel"
        :key="active"
        role="tabpanel"
        :aria-labelledby="`home-tool-tab-${active}`"
        class="max-w-1180px mx-auto m-0 p-0 list-none grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] motion-reduce:animate-none"
        :class="[gridGap, gridAnim]"
      >
        <li v-for="tool in list" :key="tool.id" class="min-w-0">
          <component
            :is="tool.route ? RouterLink : 'div'"
            v-bind="
              tool.route
                ? { to: tool.route }
                : { role: 'link', 'aria-disabled': 'true', tabindex: 0, title: '即将开放' }
            "
            :aria-label="tool.route ? tool.name : `${tool.name}（即将开放）`"
            :aria-describedby="`home-tool-desc-${tool.id}`"
            :class="[cardBase, tool.route ? cardLive : 'cursor-not-allowed']"
          >
            <!-- 封面：左侧满高，右缘 18px 白渐隐，悬停 1.05；宽度固定以给文字留够位置（4 列 × 1180 内卡宽约 283） -->
            <span
              v-if="toolCover(tool.name)"
              class="relative shrink-0 self-stretch w-100px overflow-hidden bg-surface2"
              aria-hidden="true"
            >
              <img
                :src="toolCover(tool.name)"
                alt=""
                loading="lazy"
                class="block h-full w-full object-cover transition-transform duration-200 ease-out motion-reduce:transition-none motion-reduce:transform-none group-hover:scale-[1.05]"
                :class="tool.route ? '' : 'opacity-60'"
              />
              <span
                class="absolute inset-y-0 right-0 w-18px bg-[linear-gradient(90deg,transparent,#fff)] pointer-events-none"
              />
            </span>
            <span v-else class="shrink-0 pl-14px pt-14px">
              <span
                class="grid place-items-center w-40px h-40px box-border rounded-8px border border-solid border-line bg-[linear-gradient(135deg,#f6effa,#efe6f5)] shadow-[inset_0_1px_0_#fff] text-violet-ink"
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
            </span>

            <span
              class="min-w-0 flex-1 flex flex-col gap-2px py-12px pr-14px"
              :class="toolCover(tool.name) ? 'pl-10px' : 'pl-12px'"
            >
              <span class="flex items-center gap-6px min-w-0">
                <span
                  class="truncate text-14px font-600 leading-20px transition-colors duration-110 motion-reduce:transition-none"
                  :class="tool.route ? 'text-ink group-hover:text-violet-ink' : 'text-muted'"
                  >{{ tool.name }}</span
                >
                <span
                  v-if="hotNames.has(tool.name)"
                  class="shrink-0 inline-flex items-center h-16px box-border px-5px rounded-full border border-solid border-violet-line bg-[linear-gradient(#fff,#f8f3fc)] shadow-[0_1px_2px_rgba(31,35,41,0.06)] text-10px font-600 leading-14px text-violet-ink"
                  >最常用</span
                >
                <span v-if="!tool.route" class="ll-chip shrink-0 text-muted bg-surface3 border border-line"
                  >即将开放</span
                >
              </span>
              <span :id="`home-tool-desc-${tool.id}`" class="line-clamp-2 min-h-36px text-12px leading-18px text-muted">
                {{ tool.description }}
              </span>
              <span class="text-11px leading-16px text-placeholder">
                {{ toolInputShapeLabels[tool.inputShape] }}
              </span>
            </span>

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
              class="absolute right-12px top-14px text-placeholder opacity-0 transition-opacity duration-110 group-hover:opacity-100 group-hover:text-violet-ink group-focus-visible:opacity-100 group-focus-visible:text-violet-ink motion-reduce:transition-none"
            >
              <path d="m9 6 6 6-6 6" />
            </svg>
          </component>
        </li>
      </ul>
    </div>
  </div>
</template>

<style>
/* 同 LandingPage：UnoCSS 的 animate-[…] 只引用名字，关键帧不加 scoped（同名同值，重复定义无副作用） */
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
