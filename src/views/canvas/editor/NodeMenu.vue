<script setup lang="ts">
/**
 * 节点头部「…」菜单（原型 .wf-node-more：22px 命中、16px 字号、muted）。
 * 原型 v3.1 皮肤里删除钮 display:none，删除收进这个菜单；这里只挂已有的删除能力。
 */
import { computed } from 'vue'
import type { DropdownOption } from 'naive-ui'
import { NODE_ICON_BTN } from './ui.ts'

const props = defineProps<{
  /** 节点标题，用于无障碍名 */
  title: string
  /** false = 不可删除（模板承接的结果图节点） */
  removable?: boolean
}>()

const emit = defineEmits<{ remove: [] }>()

const options = computed<DropdownOption[]>(() => [
  {
    key: 'remove',
    label: props.removable === false ? '删除节点（模板结果节点不可删）' : '删除节点',
    disabled: props.removable === false,
  },
])

function onSelect(key: string | number) {
  if (key === 'remove') emit('remove')
}
</script>

<template>
  <n-dropdown trigger="click" placement="bottom-end" size="small" :options="options" @select="onSelect">
    <button
      type="button"
      :class="NODE_ICON_BTN"
      class="!w-22px !h-22px"
      title="更多"
      :aria-label="`${title} 更多操作`"
      @click.stop
    >
      …
    </button>
  </n-dropdown>
</template>
