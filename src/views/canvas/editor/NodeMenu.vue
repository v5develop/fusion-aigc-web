<script setup lang="ts">
/**
 * 节点头部「…」钮（原型 .wf-node-more：22px 视觉、28px+ 命中、16px 字号、muted）。
 *
 * <p>菜单本体与节点右键菜单是同一份定义（画布页 index.vue 的 nodeMenuGroups）：画布页 provide
 * NODE_MENU_HOST，这里只把「…」的位置交过去，由画布页在它下方弹出同一个菜单。
 * 没注入到宿主（节点组件被单独复用）时退回旧的下拉：图片动作 + 删除节点。
 */
import { computed, inject } from 'vue'
import type { DropdownOption } from 'naive-ui'
import { useNodeId } from '@vue-flow/core'
import { NODE_ICON_BTN, NODE_MENU_HOST } from './ui.ts'
import { IMAGE_ACTIONS, collectImageSources, openImageAction, type ImageActionKind } from './imageActions.ts'

const props = defineProps<{
  /** 节点标题，用于无障碍名 */
  title: string
  /** false = 不可删除（模板承接的结果图节点）；仅退回下拉时使用，宿主菜单自己判断 */
  removable?: boolean
  /** 挂图片动作的节点 id（不传 = 不挂）；仅退回下拉时使用 */
  imageActionsFor?: string
}>()

const emit = defineEmits<{ remove: [] }>()

const host = inject(NODE_MENU_HOST, null)
// 节点组件内渲染时能注入到所在节点 id；拿不到（不在 Vue Flow 节点里）就只能走退回下拉
const nodeId = useNodeId() || props.imageActionsFor || ''
const useHost = Boolean(host && nodeId)

function openHost(event: MouseEvent) {
  if (!host || !nodeId) return
  const trigger = event.currentTarget as HTMLElement
  host.open(nodeId, trigger.getBoundingClientRect(), trigger)
}

// ---------- 退回下拉 ----------
const hasImage = computed(() => (props.imageActionsFor ? collectImageSources(props.imageActionsFor).length > 0 : false))

const options = computed<DropdownOption[]>(() => [
  ...(props.imageActionsFor
    ? [
        ...IMAGE_ACTIONS.map((item) => ({
          key: `action:${item.kind}`,
          label: hasImage.value ? item.label : `${item.label}（先上传或生成图片）`,
          disabled: !hasImage.value,
        })),
        { key: 'divider', type: 'divider' },
      ]
    : []),
  {
    key: 'remove',
    label: props.removable === false ? '删除节点（模板结果节点不可删）' : '删除节点',
    disabled: props.removable === false,
  },
])

function onSelect(key: string | number) {
  if (key === 'remove') emit('remove')
  else if (props.imageActionsFor && typeof key === 'string' && key.startsWith('action:')) {
    openImageAction(props.imageActionsFor, key.slice('action:'.length) as ImageActionKind)
  }
}

const menuProps = () => ({ class: '!shadow-pop !rounded-8px' })
</script>

<template>
  <button
    v-if="useHost"
    type="button"
    :class="NODE_ICON_BTN"
    class="!w-22px !h-22px after:!-inset-5px"
    title="更多"
    :aria-label="`${title} 更多操作`"
    aria-haspopup="menu"
    data-node-menu-trigger
    @click.stop="openHost"
  >
    …
  </button>
  <n-dropdown
    v-else
    trigger="click"
    placement="bottom-end"
    size="small"
    :options="options"
    :menu-props="menuProps"
    @select="onSelect"
  >
    <button
      type="button"
      :class="NODE_ICON_BTN"
      class="!w-22px !h-22px"
      title="更多"
      :aria-label="`${title} 更多操作`"
      aria-haspopup="menu"
      @click.stop
    >
      …
    </button>
  </n-dropdown>
</template>
