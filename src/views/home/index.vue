<script setup lang="ts">
/**
 * 首页 = 工具箱（v1.0 原型 ToolsView）。
 * 每个工具独立提交、结果进各自的历史记录；有对应页面的卡片直达该页，没有的显示「即将开放」。
 * 12 个 Java v1 工具的卡片指向共用工具页 /tools/:toolId（路由取自 ./tools 的 route）。
 */
import { computed, nextTick, ref } from 'vue'
import { RouterLink } from 'vue-router'
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
// 样式逐值对齐原型 ToolsView / CreationPillTabs（卡片与图标底板 r8：原型 v3 把 rounded-2xl / rounded-xl 强制为 8px）：#f1ecf3 = color-mix(#875f9a 12%, #fff)，rgba(31,35,41,0.08) = color-mix(#1f2329 8%, transparent)
const focusRing =
  'outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-violet focus-visible:outline-offset-2'
const cardBase =
  'flex flex-col items-start gap-12px w-full h-full p-16px rounded-8px bg-white text-left border-none ' +
  'transition-[box-shadow,transform] duration-200 ease ' +
  'focus-visible:-translate-y-2px focus-visible:shadow-[0_4px_16px_rgba(31,35,41,0.08)] ' +
  focusRing
</script>

<template>
  <div class="h-full flex flex-col bg-page">
    <div class="shrink-0 flex flex-col gap-16px pt-24px pl-24px pr-34px pb-8px">
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
            active === tab.key ? 'bg-[#f1ecf3] text-violet font-600' : 'bg-white text-ink-2 font-500 hover:text-violet',
          ]"
          @click="active = tab.key"
          @keydown="onTabKeydown($event, i)"
        >
          {{ tab.label }}
        </button>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable] px-24px pt-8px pb-24px">
      <ul
        id="home-tool-panel"
        role="tabpanel"
        :aria-labelledby="`home-tool-tab-${active}`"
        class="m-0 p-0 list-none grid gap-12px grid-cols-[repeat(auto-fill,minmax(240px,1fr))]"
      >
        <li v-for="tool in list" :key="tool.id">
          <component
            :is="tool.route ? RouterLink : 'div'"
            v-bind="tool.route ? { to: tool.route } : { role: 'link', 'aria-disabled': 'true', tabindex: 0 }"
            :aria-label="tool.route ? tool.name : `${tool.name}（即将开放）`"
            :aria-describedby="`home-tool-desc-${tool.id}`"
            :class="[
              cardBase,
              tool.route
                ? 'no-underline cursor-pointer hover:-translate-y-2px hover:shadow-[0_4px_16px_rgba(31,35,41,0.08)]'
                : 'cursor-not-allowed',
            ]"
          >
            <span class="w-full flex items-center gap-12px">
              <span
                class="shrink-0 flex items-center justify-center w-44px h-44px rounded-8px bg-[#f1ecf3] text-violet"
                :class="tool.route ? '' : 'opacity-60'"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                  :innerHTML="tool.icon"
                />
              </span>
              <span
                class="min-w-0 flex-1 truncate text-16px font-600 leading-22px"
                :class="tool.route ? 'text-ink' : 'text-muted'"
              >
                {{ tool.name }}
              </span>
              <span v-if="!tool.route" class="ll-chip shrink-0 text-muted bg-surface3 border border-line"
                >即将开放</span
              >
            </span>
            <span
              :id="`home-tool-desc-${tool.id}`"
              class="line-clamp-2 min-h-40px text-14px font-500 leading-20px text-muted"
            >
              {{ tool.description }}
            </span>
            <span class="text-12px leading-16px text-placeholder">
              {{ toolInputShapeLabels[tool.inputShape] }}
            </span>
          </component>
        </li>
      </ul>
    </div>
  </div>
</template>
