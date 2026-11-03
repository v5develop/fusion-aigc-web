<script setup lang="ts">
/**
 * 节点头部「…」菜单（原型 .wf-node-more：22px 命中、16px 字号、muted）。
 * 原型 v3.1 皮肤里删除钮 display:none，删除收进这个菜单；这里只挂已有的删除能力。
 * 出图类节点（imageActionsFor = 节点 id）额外挂图片动作：识别 / 图片编辑 / 多视图 / 图层，
 * 节点及其直接上游都没有图时置灰。
 */
import { computed } from 'vue'
import type { DropdownOption } from 'naive-ui'
import { NODE_ICON_BTN } from './ui.ts'
import { IMAGE_ACTIONS, collectImageSources, openImageAction, type ImageActionKind } from './imageActions.ts'

const props = defineProps<{
  /** 节点标题，用于无障碍名 */
  title: string
  /** false = 不可删除（模板承接的结果图节点） */
  removable?: boolean
  /** 挂图片动作的节点 id（不传 = 不挂） */
  imageActionsFor?: string
}>()

const emit = defineEmits<{ remove: [] }>()

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

/** 菜单浮层用 sx-pop 投影 + r8 */
const menuProps = () => ({ class: '!shadow-pop !rounded-8px' })
</script>

<template>
  <n-dropdown
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
