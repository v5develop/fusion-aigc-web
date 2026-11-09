<script setup lang="ts">
/**
 * 历史卡操作行：前导（时间 / 状态胶囊）在左，操作钮在右。
 *
 * 行宽放得下时：#primary + #secondary 全部内联（IconButton sm，间距 8）；
 * 放不下时（224 列里时间变长 / 胶囊占位 / <1440 分栏更窄）：只保留 #primary（下载），
 * 其余收进「更多」IconButton 的菜单（n-dropdown，键盘可达）；删除项可带 confirm，先二次确认再触发。
 *
 *   <HistoryActionRow :more-items="[{ key: 'delete', label: '删除', danger: true, confirm: '删除这条记录？' }, …]" @more="onMore">
 *     <template #lead><span>{{ shortTime }}</span></template>
 *     <template #primary><IconButton label="下载" size="sm" …/></template>
 *     <template #secondary>…删除 / 重新编辑 IconButton…</template>
 *   </HistoryActionRow>
 *
 * 前导内容压在整卡按钮之上（悬停提示可用），点它发 lead-click，宿主接到「选中这条」。
 */
import { computed, h, ref } from 'vue'
import { NDropdown, NPopconfirm } from 'naive-ui'
import type { DropdownOption } from 'naive-ui'
import IconButton from '@/components/IconButton/index.vue'
import { useFitActions } from '@/utils/composables/useFitActions.ts'

export interface HistoryMoreItem {
  key: string
  label: string
  danger?: boolean
  disabled?: boolean
  /** 有值：选中后先弹这句确认，确认才触发 more 事件 */
  confirm?: string
}

const props = defineProps<{ moreItems: HistoryMoreItem[] }>()
const emit = defineEmits<{ more: [key: string]; 'lead-click': [] }>()

const row = ref<HTMLElement | null>(null)
const { collapsed } = useFitActions(row)

const pending = ref<HistoryMoreItem | null>(null)
const options = computed<DropdownOption[]>(() =>
  props.moreItems.map((i) => ({
    key: i.key,
    label: i.label,
    disabled: i.disabled,
    props: i.danger ? { style: { color: '#b4433e' } } : undefined,
  })),
)

function onSelect(key: string) {
  const item = props.moreItems.find((i) => i.key === key)
  if (!item) return
  if (item.confirm) pending.value = item
  else emit('more', key)
}
function confirmPending() {
  const item = pending.value
  pending.value = null
  if (item) emit('more', item.key)
}

const MoreIcon = () =>
  h('svg', { viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': 'true' }, [
    h('circle', { cx: 6, cy: 12, r: 1.6 }),
    h('circle', { cx: 12, cy: 12, r: 1.6 }),
    h('circle', { cx: 18, cy: 12, r: 1.6 }),
  ])
</script>

<template>
  <div ref="row" class="flex min-w-0 items-center gap-6px">
    <!-- 前导区铺满剩余宽度、超出裁掉；前导内容（固有宽度，供 useFitActions 量）压在整卡按钮之上（relative z-1），
         这样时间上的 title 悬停提示能出来；点它仍算点卡片（lead-click，由宿主接到选中） -->
    <span data-fit-lead class="min-w-0 flex-1 flex items-center overflow-hidden">
      <span data-fit-lead-content class="relative z-1 flex-none inline-flex items-center" @click="emit('lead-click')"><slot name="lead" /></span>
    </span>
    <span data-fit-actions class="relative z-1 ml-auto flex flex-none items-center gap-8px">
      <slot name="primary" />
      <template v-if="!collapsed"><slot name="secondary" /></template>
      <span v-else class="inline-flex">
        <n-popconfirm
          :show="!!pending"
          trigger="manual"
          positive-text="删除"
          negative-text="取消"
          @positive-click="confirmPending"
          @negative-click="pending = null"
          @clickoutside="pending = null"
        >
          <template #trigger>
            <n-dropdown trigger="click" placement="bottom-end" :options="options" @select="onSelect">
              <IconButton label="更多" size="sm"><component :is="MoreIcon" /></IconButton>
            </n-dropdown>
          </template>
          {{ pending?.confirm }}
        </n-popconfirm>
      </span>
    </span>
  </div>
</template>
