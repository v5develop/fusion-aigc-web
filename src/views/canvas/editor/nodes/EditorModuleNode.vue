<script setup lang="ts">
/**
 * 分组底板（原型 CanvasModuleNode + canvas-v31，2026-11-06 二轮升级为「可拖虚线底板」）：
 * - 模板快照里的 module 节点与「成组」产生的底板共用：虚线描边 + 浅色铺底，不参与连线；
 * - 成组底板（data.isGroup）可选中、可拖：拖底板 = 整组移动（成员由画布页在 node-drag 里按同一偏移平移，锁定成员也跟着走）；
 * - 模板模块底板只作视觉框：不接收指针，框内照样能框选 / 平移 / 双击加节点（见 editor/index.vue 的 :has 放行样式）；
 * - 右上角角钮（唯一可点处，2026-11-07 审计 35）：成组底板 =「解组」（只拆底板，成员原位保留）；
 *   模板模块 =「×」只删底板（模块内节点保留）。连成员一起删改由右键菜单「删除分组（含成员）」
 *   调 store.deleteGroupWithMembers，角钮不再做这件事（误点代价太大）。都可 Ctrl+Z 撤销。
 */
import { computed } from 'vue'
import EditorIcon from '../EditorIcon.vue'
import type { CanvasNodeData } from '../types.ts'
import IconButton from '@/components/IconButton/index.vue'
import { isGroupPlate } from '../graph.ts'
import { useCanvasEditor } from '../useCanvasEditor.ts'
import { FOCUS_RING } from '../ui.ts'

const props = defineProps<{
  id: string
  data: CanvasNodeData
  selected?: boolean
}>()

// remove 保留在声明里（画布页仍绑定），角钮不再触发它
defineEmits<{ remove: [] }>()

const store = useCanvasEditor()

const isGroup = computed(() => isGroupPlate({ id: props.id, type: 'module', position: { x: 0, y: 0 }, data: props.data }))

/** 副标题：成组底板显示「分组 · N 个节点」（成员按几何包含实时算）；模板模块沿用快照副标题 */
const subtitle = computed(() =>
  isGroup.value ? `分组 · ${store.moduleChildren(props.id).length} 个节点` : props.data.subtitle || '模板模块',
)

/** 角钮：解组 / 只删底板，都只移除底板本身 */
function removePlateOnly() {
  store.ungroup(props.id)
}

const width = computed(() => props.data.width ?? 760)
const height = computed(() => props.data.height ?? 520)
/**
 * 底板色（原型 templateTintForShell）：快照存的是 rgba 浅色直接用；旧紫 rgba(142,102,249,…) 换成藤紫 .09；
 * 只给了 #rrggbb 实色时按 .09 透明度（0x17）铺底。成组底板没给 color，落到同一档藤紫。
 */
const tint = computed(() => {
  const raw = (props.data.color ?? '').trim()
  if (!raw || /^rgba\(142,\s*102,\s*249/.test(raw)) return 'rgba(135, 95, 154, 0.09)'
  if (/^#[0-9a-f]{6}$/i.test(raw)) return `${raw}17`
  return raw
})
</script>

<template>
  <!--
    模板模块底板（非成组）只作视觉框：整块 pointer-events:none（外层 .vue-flow__node 由 editor/index.vue 里
    :has(.canvas-module-frame) 的样式一并放行），框内照样能框选 / 平移 / 双击加节点；只有右上角删除钮可点。
    成组底板可选中、可拖动（带成员走）。
  -->
  <div
    class="group relative border border-dashed rounded-8px"
    :class="[selected ? 'border-violet' : 'border-line', isGroup ? '' : 'canvas-module-frame pointer-events-none']"
    :style="{ width: `${width}px`, height: `${height}px`, background: tint }"
  >
    <div class="absolute top-12px left-14px flex items-baseline gap-6px">
      <strong class="text-13px font-600 text-[rgba(31,35,41,0.66)] tracking-[0.02em]">{{
        data.title || '模块'
      }}</strong>
      <span class="text-muted text-11px">{{ subtitle }}</span>
    </div>
    <button
      v-if="isGroup"
      type="button"
      class="sx-reveal absolute top-8px right-10px h-28px px-10px border border-solid border-control rounded-4px bg-white text-ink-2 text-12px leading-none cursor-pointer shadow-[0_1px_2px_rgba(31,35,41,0.05)] hover:border-violet-line hover:bg-violet-soft hover:text-violet-ink nodrag nopan"
      :class="FOCUS_RING"
      :aria-label="`解组「${data.title || '分组'}」（成员保留）`"
      title="解组：只拆底板，组内节点保留"
      @click.stop="removePlateOnly"
    >
      解组
    </button>
    <IconButton
      v-else
      :label="`删除模块「${data.title || '模块'}」底板（模块内节点保留）`"
      size="sm"
      variant="danger"
      class="!absolute top-10px right-12px !pointer-events-auto nodrag nopan opacity-55 hover:opacity-100 focus-visible:opacity-100"
      @click.stop="removePlateOnly"
    >
      <EditorIcon name="close" :size="12" />
    </IconButton>
  </div>
</template>
