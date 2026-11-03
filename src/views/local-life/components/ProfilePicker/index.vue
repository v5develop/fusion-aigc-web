<script setup lang="ts">
/**
 * 全案设计 · 选择品牌档案弹窗。
 * 数据来自 useFullSet（按 LL_PROFILE_SOURCE 取 Java brand-profiles 或 Go shop-profiles），这里只负责展示与选择。
 */
import { RouterLink } from 'vue-router'
import { NModal, NSpin } from 'naive-ui'
import type { LLProfileItem, LLProfileSource } from '@/api/localLifeFull.ts'

defineProps<{
  profiles: LLProfileItem[]
  loading: boolean
  error: boolean
  currentId?: number
  source: LLProfileSource
}>()
const show = defineModel<boolean>('show', { default: false })
const emit = defineEmits<{ select: [item: LLProfileItem]; retry: [] }>()

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet'

function choose(item: LLProfileItem) {
  emit('select', item)
  show.value = false
}
</script>

<template>
  <n-modal v-model:show="show" preset="card" title="选择品牌档案" class="max-w-[92vw]" style="width: 520px">
    <n-spin :show="loading">
      <div class="min-h-160px flex flex-col gap-8px">
        <div v-if="error" class="flex flex-1 flex-col items-center justify-center gap-8px py-24px text-13px text-muted">
          <span>品牌档案加载失败</span>
          <button type="button" :class="['ll-pill', focusRing]" @click="emit('retry')">重试</button>
        </div>
        <div
          v-else-if="!loading && !profiles.length"
          class="flex flex-1 flex-col items-center justify-center gap-8px py-24px text-13px text-muted"
        >
          <span>暂无品牌档案</span>
          <RouterLink v-if="source === 'go'" to="/local-life/shop-profile" :class="['ll-pill no-underline', focusRing]">
            店铺档案
          </RouterLink>
        </div>
        <ul v-else class="m-0 max-h-420px flex flex-col list-none gap-8px overflow-y-auto p-0" aria-label="品牌档案">
          <li v-for="item in profiles" :key="item.id">
            <button
              type="button"
              :aria-pressed="currentId === item.id"
              :class="[
                'w-full flex cursor-pointer items-center gap-10px rounded-8px border bg-white px-12px py-10px text-left transition-colors',
                currentId === item.id
                  ? 'border-violet-line bg-violet-soft'
                  : 'border-line hover:(border-violet-line bg-violet-soft)',
                focusRing,
              ]"
              @click="choose(item)"
            >
              <span class="h-36px w-36px shrink-0 overflow-hidden rounded-6px bg-sunken">
                <img v-if="item.logoUrl" :src="item.logoUrl" alt="" class="h-full w-full object-cover" />
              </span>
              <span class="min-w-0 flex-1 truncate text-13px font-600 text-ink">{{ item.title }}</span>
            </button>
          </li>
        </ul>
      </div>
    </n-spin>
  </n-modal>
</template>
