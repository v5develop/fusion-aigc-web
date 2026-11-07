<script setup lang="ts">
/**
 * 创意广场：「模板广场」（默认）/「素材广场」两个标签页。
 * 当前标签记在 URL ?tab=templates|assets，刷新不丢；切走的面板用 KeepAlive 保留筛选与已加载分页。
 */
import { computed, nextTick, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import TemplatesPanel from './components/TemplatesPanel.vue'
import AssetsPanel from './components/AssetsPanel.vue'

type PlazaTab = 'templates' | 'assets'

const TABS: { key: PlazaTab; label: string }[] = [
  { key: 'templates', label: '模板广场' },
  { key: 'assets', label: '素材广场' },
]

const route = useRoute()
const router = useRouter()

const active = computed<PlazaTab>(() => (route.query.tab === 'assets' ? 'assets' : 'templates'))

function select(tab: PlazaTab) {
  if (tab === active.value) return
  void router.replace({ query: { ...route.query, tab } })
}

// 方向键在标签间移动（同工作室页的 tablist 交互）
const tabRefs = ref<HTMLButtonElement[]>([])
function onTabKeydown(e: KeyboardEvent, index: number) {
  const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
  if (!step) return
  e.preventDefault()
  const next = (index + step + TABS.length) % TABS.length
  const target = TABS[next]
  if (!target) return
  select(target.key)
  void nextTick(() => tabRefs.value[next]?.focus())
}
</script>

<template>
  <div class="h-full flex flex-col bg-page">
    <div class="shrink-0 px-20px pt-18px">
      <div class="mx-auto flex max-w-1180px flex-col gap-12px pb-12px">
        <h1 class="m-0 text-20px font-600 leading-28px text-ink">创意广场</h1>
        <!-- 原型 .ref-tabs：纯文字页签 15px，选中 600 墨色，间距 20；py-5px 把命中高度撑到 32（-my-5px 抵消，版面不变） -->
        <div class="flex items-center gap-20px" role="tablist" aria-label="广场分类">
          <button
            v-for="(tab, index) in TABS"
            :id="`plaza-tab-${tab.key}`"
            :key="tab.key"
            ref="tabRefs"
            type="button"
            role="tab"
            :aria-selected="active === tab.key"
            aria-controls="plaza-tab-panel"
            :tabindex="active === tab.key ? 0 : -1"
            :class="[
              'cursor-pointer border-none bg-transparent px-0 py-5px -my-5px text-15px leading-22px [transition:color_0.12s] motion-reduce:transition-none',
              'focus-visible:(outline outline-2 outline-violet outline-offset-2)',
              active === tab.key ? 'font-600 text-ink' : 'font-500 text-muted hover:text-ink',
            ]"
            @click="select(tab.key)"
            @keydown="onTabKeydown($event, index)"
          >
            {{ tab.label }}
          </button>
        </div>
      </div>
    </div>

    <div id="plaza-tab-panel" role="tabpanel" :aria-labelledby="`plaza-tab-${active}`" class="min-h-0 flex-1">
      <KeepAlive>
        <TemplatesPanel v-if="active === 'templates'" />
        <AssetsPanel v-else />
      </KeepAlive>
    </div>
  </div>
</template>
