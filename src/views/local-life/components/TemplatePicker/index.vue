<script setup lang="ts">
/**
 * 全案设计 · 选择设计模板弹窗：官方模板（local-life-templates，按档案行业过滤）+ 我的模板（user-local-life-templates）。
 * 两组同一种卡片样式；选中即回填第 2 步。
 */
import { NModal, NSpin } from 'naive-ui'
import type { TemplateCard } from '../../useFullSet.ts'

defineProps<{
  systemTemplates: TemplateCard[]
  userTemplates: TemplateCard[]
  loading: boolean
  error: boolean
  current: TemplateCard | null
}>()
const show = defineModel<boolean>('show', { default: false })
const emit = defineEmits<{ select: [item: TemplateCard]; retry: [] }>()

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet'
/** 小号次按钮（spec 默认按钮缩到 28 高） */
const smallBtn = 'sx-btn !h-28px !px-10px !text-12px transition-[border-color,background,color] duration-fast ease-sx'

function choose(item: TemplateCard) {
  emit('select', item)
  show.value = false
}
</script>

<template>
  <n-modal v-model:show="show" preset="card" title="选择模板" class="max-w-[92vw]" style="width: 760px">
    <n-spin :show="loading">
      <div class="min-h-200px flex flex-col gap-16px">
        <div v-if="error" class="sx-empty flex-1" role="alert">
          <span class="sx-empty-title !text-danger">模板加载失败</span>
          <button type="button" :class="smallBtn" @click="emit('retry')">重试</button>
        </div>
        <template v-else>
          <section
            v-for="group in [
              { key: 'system', title: '官方模板', list: systemTemplates },
              { key: 'user', title: '我的模板', list: userTemplates },
            ]"
            :key="group.key"
            class="flex flex-col gap-8px"
            :aria-label="group.title"
          >
            <h3 class="m-0 text-13px font-600 leading-20px text-ink">{{ group.title }}</h3>
            <p v-if="!loading && !group.list.length" class="sx-empty m-0 !min-h-80px !p-12px">
              <span class="sx-empty-desc">暂无模板</span>
            </p>
            <ul v-else class="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-10px p-0">
              <li v-for="item in group.list" :key="`${item.source}-${item.id}`">
                <button
                  type="button"
                  :aria-pressed="current?.source === item.source && current?.id === item.id"
                  :class="[
                    'w-full flex cursor-pointer flex-col overflow-hidden rounded-lg border border-solid p-0 text-left',
                    'transition-[border-color,background,box-shadow] duration-mid ease-sx motion-reduce:transition-none',
                    current?.source === item.source && current?.id === item.id
                      ? 'border-violet-line sx-grad-tint ring-1 ring-violet'
                      : 'border-line bg-white hover:(border-violet-line shadow-raised)',
                    focusRing,
                  ]"
                  @click="choose(item)"
                >
                  <span
                    class="aspect-[3/4] w-full flex items-center justify-center overflow-hidden bg-sunken text-placeholder"
                  >
                    <img v-if="item.cover" :src="item.cover" alt="" class="h-full w-full object-cover" loading="lazy" />
                    <svg
                      v-else
                      viewBox="0 0 24 24"
                      width="20"
                      height="20"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.6"
                      aria-hidden="true"
                    >
                      <path d="M4 5h16v14H4z" />
                      <path d="M20 15l-5-5-9 9" />
                    </svg>
                  </span>
                  <span class="truncate px-10px py-8px text-12px font-600 leading-18px text-ink">{{ item.title }}</span>
                </button>
              </li>
            </ul>
          </section>
        </template>
      </div>
    </n-spin>
  </n-modal>
</template>
