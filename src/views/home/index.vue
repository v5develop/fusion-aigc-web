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
const focusRing =
  'outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-violet focus-visible:outline-offset-2'
const cardBase =
  'flex flex-col items-start gap-12px w-full h-full p-16px rounded-12px bg-white text-left border border-transparent ' +
  focusRing
</script>

<template>
  <div class="h-full overflow-y-auto bg-page">
    <div class="px-24px pt-24px pb-24px">
      <header>
        <h1 class="m-0 text-20px font-600 leading-28px text-ink">工具箱</h1>
        <p class="m-0 mt-4px text-13px leading-20px text-muted">
          覆盖图片与视频创作能力，每个工具独立提交、结果进各自的历史记录
        </p>
      </header>

      <div role="tablist" aria-label="工具分类" class="mt-16px flex flex-wrap gap-8px">
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
          class="px-12px py-6px rounded-6px text-13px leading-20px cursor-pointer border-none transition-colors"
          :class="[
            focusRing,
            active === tab.key
              ? 'bg-violet-soft text-violet-ink font-500 shadow-[inset_0_1px_2px_rgba(80,55,95,0.12)]'
              : 'bg-white text-ink-2 hover:bg-surface3 hover:text-ink',
          ]"
          @click="active = tab.key"
          @keydown="onTabKeydown($event, i)"
        >
          {{ tab.label }}
        </button>
      </div>

      <ul
        id="home-tool-panel"
        role="tabpanel"
        :aria-labelledby="`home-tool-tab-${active}`"
        class="mt-16px mb-0 p-0 list-none grid gap-12px grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6"
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
                ? 'no-underline cursor-pointer transition-all duration-200 hover:-translate-y-2px hover:border-line hover:shadow-[0_4px_16px_rgba(31,35,41,0.08)]'
                : 'cursor-not-allowed',
            ]"
          >
            <span class="w-full flex items-center gap-12px">
              <span
                class="shrink-0 flex items-center justify-center w-44px h-44px rounded-10px bg-violet-soft text-violet"
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
                class="min-w-0 flex-1 truncate text-15px font-600 leading-22px"
                :class="tool.route ? 'text-ink' : 'text-muted'"
              >
                {{ tool.name }}
              </span>
              <span v-if="!tool.route" class="ll-chip shrink-0 text-muted bg-surface3 border border-line"
                >即将开放</span
              >
            </span>
            <span :id="`home-tool-desc-${tool.id}`" class="line-clamp-2 min-h-40px text-13px leading-20px text-muted">
              {{ tool.description }}
            </span>
            <span class="mt-auto text-12px leading-18px text-placeholder">
              {{ toolInputShapeLabels[tool.inputShape] }}
            </span>
          </component>
        </li>
      </ul>
    </div>
  </div>
</template>
