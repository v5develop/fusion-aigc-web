<script setup lang="ts">
/**
 * 画布节点编辑器（对齐原型 CanvasView + canvas-v31 皮肤）：
 * 顶栏（返回 / 标题✎ / 保存状态 / 运行数 / 模板 · 保存 · 另存为 · 执行模型）
 * + 左侧「画布资产」栏 + Vue Flow 画布（左竖工具条 / 底横工具条）+ 右侧参数面板（选中节点时出现）。
 * 接口契约见 fusion_aigc_go/docs/api/api-canvas.md；快照 {nodes, edges} 整段存取 + 乐观锁保存。
 */
import { computed, h, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { DropdownOption } from 'naive-ui'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { ConnectionMode, VueFlow, useVueFlow, type EdgeMouseEvent, type NodeMouseEvent } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
// Vue Flow 必需的基础样式：节点绝对定位、变换原点、连线 SVG overflow:visible、Handle 贴边定位。
// 缺了它连线会被 SVG 裁掉（看不到线），节点 / 端口也会落回文档流而错位。
import '@vue-flow/core/dist/style.css'
import { llTheme } from '@/views/local-life/theme.ts'
import EditorIcon from './EditorIcon.vue'
import EditorBezierEdge from './EditorBezierEdge.vue'
import EditorTextNode from './nodes/EditorTextNode.vue'
import EditorImageNode from './nodes/EditorImageNode.vue'
import EditorVideoNode from './nodes/EditorVideoNode.vue'
import EditorModelNode from './nodes/EditorModelNode.vue'
import EditorToolNode from './nodes/EditorToolNode.vue'
import EditorModuleNode from './nodes/EditorModuleNode.vue'
import NodeParamsPanel from './NodeParamsPanel.vue'
import EditorAssetPanel from './EditorAssetPanel.vue'
import TitleModal from '../TitleModal.vue'
import TemplatePicker from '../TemplatePicker.vue'
import AssetPickerModal from '@/views/studio/components/AssetPickerModal/index.vue'
import { canvasSaveAs } from '@/api/canvasHome.ts'
import { normalizeHandle, validateConnection } from './graph.ts'
import { editorDialog, editorMessage, useCanvasEditor } from './useCanvasEditor.ts'
import type { CanvasEditorNode } from './types.ts'
import { FOCUS_RING, TOOLBAR, TOOLBAR_BTN, TOP_BTN, TOP_BTN_PRIMARY, type QuickAddKind } from './ui.ts'

defineOptions({ name: 'canvas-editor' })

const route = useRoute()
const router = useRouter()
const store = useCanvasEditor()
const FLOW_ID = 'canvas-editor-flow'
const { fitView, zoomIn, zoomOut, setCenter } = useVueFlow(FLOW_ID)

const canvasId = computed(() => String(route.params.id ?? ''))

const {
  nodes,
  edges,
  title,
  loading,
  loadError,
  saveState,
  saveError,
  lastSavedAt,
  dirty,
  selectedNode,
  runningCount,
} = store

// ---------------- 加载 ----------------

onMounted(() => {
  void store.loadCatalog()
  void store.init(canvasId.value)
})

watch(
  () => route.params.id,
  (id) => {
    if (id && route.name === 'canvas-editor') void store.init(String(id))
  },
)

// 节点先挂载、连线后补：Handle 尺寸就绪前加边会被 Vue Flow 丢弃
watch(loading, async (value) => {
  if (value || !nodes.value.length) return
  await nextTick()
  if (edges.value.length) void fitView({ padding: 0.15, maxZoom: 1 })
})

// ---------------- 选中 ----------------

const selectedEdgeId = ref('')

function onNodeClick(event: NodeMouseEvent) {
  selectedEdgeId.value = ''
  store.selectNode(event.node.id)
}

function onPaneClick() {
  selectedEdgeId.value = ''
  store.selectNode('')
}

function onEdgeClick(event: EdgeMouseEvent) {
  store.selectNode('')
  selectedEdgeId.value = event.edge.id
}

// ---------------- 连线 ----------------

/** 拖拽过程中的实时校验（提示词口按「新线替换旧线」算容量） */
function isValidConnection(connection: {
  source?: string | null
  target?: string | null
  sourceHandle?: string | null
  targetHandle?: string | null
}) {
  if (!connection.source || !connection.target) return false
  const conn = {
    source: connection.source,
    target: connection.target,
    sourceHandle: connection.sourceHandle,
    targetHandle: connection.targetHandle,
  }
  const pool =
    normalizeHandle(conn.targetHandle) === 'prompt'
      ? edges.value.filter((edge) => !(edge.target === conn.target && normalizeHandle(edge.targetHandle) === 'prompt'))
      : edges.value
  return validateConnection(nodes.value, pool, conn).ok
}

function onConnect(connection: {
  source?: string | null
  target?: string | null
  sourceHandle?: string | null
  targetHandle?: string | null
}) {
  if (!connection.source || !connection.target) return
  const ok = store.connect({
    source: connection.source,
    target: connection.target,
    sourceHandle: connection.sourceHandle,
    targetHandle: connection.targetHandle,
  })
  if (ok) selectedEdgeId.value = ''
}

/** 拖到节点主体（未命中端口）时按来源类型自动挑输入口 */
let connectStart: { nodeId?: string | null; handleId?: string | null } | null = null

function onConnectStart(payload: { nodeId?: string | null; handleId?: string | null }) {
  connectStart = payload
}

function onConnectEnd(event?: MouseEvent) {
  const start = connectStart
  connectStart = null
  if (!start?.nodeId || !event) return
  const under = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null
  const nodeEl = under?.closest<HTMLElement>('.vue-flow__node')
  const targetId = nodeEl?.dataset.id
  if (!targetId || targetId === start.nodeId) return
  const source = store.findNode(start.nodeId)
  const target = store.findNode(targetId)
  if (!source || !target) return
  const sourceHandle =
    start.handleId ?? (source.type === 'text' ? 'text' : source.type === 'video' ? 'video' : 'image-out')
  const targetHandle = autoTargetHandle(source, target)
  store.connect({ source: source.id, target: targetId, sourceHandle, targetHandle })
}

/** 未命中端口时按来源 / 目标类型挑输入口（拖到节点主体、「+」快捷添加共用） */
function autoTargetHandle(source: CanvasEditorNode, target: CanvasEditorNode): string {
  const targetId = target.id
  let targetHandle = 'image'
  if (source.type === 'text' || (source.data.kind === 'tool' && source.data.tool === 'i2p')) targetHandle = 'prompt'
  else if (target.data.kind === 'video' && source.type === 'model' && source.data.kind === 'video') {
    targetHandle = 'video'
  } else if (target.data.kind === 'video') {
    const usedFirst = edges.value.some((edge) => edge.target === targetId && edge.targetHandle === 'image1')
    targetHandle = usedFirst ? 'image2' : 'image1'
  } else if (target.data.kind === 'tool' && target.data.tool === 'tryon') {
    const usedGarment = edges.value.some((edge) => edge.target === targetId && edge.targetHandle === 'garment')
    targetHandle = usedGarment ? 'models' : 'garment'
  }
  return targetHandle
}

/** 节点的输出口 id（与各节点组件里 source Handle 的 id 一致） */
function outputHandleOf(node: CanvasEditorNode): string {
  if (node.type === 'text') return 'text'
  if (node.type === 'video') return 'video'
  if (node.type === 'image') return 'image'
  if (node.type === 'tool') return node.data.tool === 'i2p' ? 'text' : 'image-out'
  return node.data.inputOnly ? 'video' : 'image-out'
}

/** 输出口旁「+」：新建下游节点并自动连线（新建 / 连线 / 校验全走 store 既有方法） */
function quickAdd(sourceId: string, kind: QuickAddKind) {
  const source = store.findNode(sourceId)
  if (!source) return
  const created = spawn(kind)
  const target = created ? store.findNode(created.id) : undefined
  if (!target) return
  store.connect({
    source: source.id,
    target: target.id,
    sourceHandle: outputHandleOf(source),
    targetHandle: autoTargetHandle(source, target),
  })
}

// ---------------- 删除 / 快捷键 ----------------

function deleteSelection() {
  if (selectedEdgeId.value) {
    store.removeEdgeById(selectedEdgeId.value)
    selectedEdgeId.value = ''
    return
  }
  if (selectedNode.value) store.removeNode(selectedNode.value.id)
}

function onKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    void store.saveNow()
    return
  }
  const target = event.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
  if (event.key === 'Escape') {
    selectedEdgeId.value = ''
    store.selectNode('')
    return
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    deleteSelection()
  }
}

// ---------------- 离开保护 ----------------

const leaveConfirmed = ref(false)

function confirmLeave(): Promise<boolean> {
  return new Promise((resolve) => {
    editorDialog.warning({
      title: '有未保存的修改',
      content: '离开前将尝试自动保存，也可以直接离开（改动会丢失）。',
      positiveText: '保存并离开',
      negativeText: '直接离开',
      onClose: () => resolve(false),
      onMaskClick: () => resolve(false),
      // Esc 关闭不走上面任何回调：兜底按「留下」处理，避免导航守卫永远挂起
      onAfterLeave: () => resolve(false),
      // 先等保存真正落地再放行：离开后 dispose 会让排队中的保存直接放弃，改动就丢了
      onPositiveClick: async () => {
        const ok = await store.flushSave()
        if (!ok) {
          editorMessage.error('保存未成功，已留在当前页面')
          resolve(false)
          return
        }
        resolve(true)
      },
      onNegativeClick: () => resolve(true),
    })
  })
}

onBeforeRouteLeave(async () => {
  if (!dirty.value || leaveConfirmed.value) return true
  const ok = await confirmLeave()
  leaveConfirmed.value = ok
  return ok
})

function onBeforeUnload(event: BeforeUnloadEvent) {
  if (!dirty.value) return
  event.preventDefault()
  event.returnValue = ''
  void store.flushSave()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('beforeunload', onBeforeUnload)
  store.dispose()
})
onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))

function backToList() {
  void router.push({ name: 'canvas' })
}

// ---------------- 顶栏展示 ----------------

const saveText = computed(() => {
  if (saveState.value === 'saving') return '保存中…'
  if (saveState.value === 'conflict') return '版本冲突'
  if (saveState.value === 'error') return saveError.value || '保存失败'
  if (saveState.value === 'dirty') return '未保存更改'
  if (lastSavedAt.value) {
    const d = new Date(lastSavedAt.value)
    const p = (n: number) => String(n).padStart(2, '0')
    return `已保存 ${p(d.getHours())}:${p(d.getMinutes())}`
  }
  return '已保存'
})

/** 保存状态小标（原型 .wf-save-state：surface-3 底 / muted / 11px；失败红、冲突琥珀、待存琥珀字） */
const saveStateClass = computed(() => {
  if (saveState.value === 'error') return 'bg-danger-soft text-danger'
  if (saveState.value === 'conflict') return 'bg-warning-soft text-warning'
  if (saveState.value === 'saving' || saveState.value === 'dirty') return 'bg-surface3 text-warning'
  return 'bg-surface3 text-muted'
})

// 标题：原型是「标题 + ✎」按钮，点开变输入框（回车 / 失焦收起）；写的仍是 store.title
const titleEditing = ref(false)
const titleInputRef = ref<HTMLInputElement | null>(null)

function startTitleEdit() {
  titleEditing.value = true
  void nextTick(() => {
    titleInputRef.value?.focus()
    titleInputRef.value?.select()
  })
}

function commitTitle() {
  titleEditing.value = false
}

// ---------------- 执行（只调既有 runNode，不新增编排） ----------------

/** 可执行的选中节点：生成节点 / 工具节点 */
const runTarget = computed(() => {
  const node = selectedNode.value
  return node && (node.type === 'model' || node.type === 'tool') ? node : undefined
})

const runHint = computed(() =>
  runTarget.value
    ? `执行选中的「${runTarget.value.data.title}」（暂不支持一键按依赖执行全部）`
    : '先在画布上选中一个生成或工具节点（暂不支持一键执行全部）',
)

function runSelected() {
  if (runTarget.value) void store.runNode(runTarget.value.id)
}

// ---------------- 另存为 / 模板（只接既有接口与弹层） ----------------

const showSaveAs = ref(false)
const savingAs = ref(false)
const saveAsInitial = computed(() => `${title.value || '未命名画布'} - 副本`)

async function doSaveAs(newTitle: string) {
  if (savingAs.value) return
  savingAs.value = true
  try {
    // 服务端按已保存快照复制：先把待保存改动落地
    const saved = await store.flushSave()
    if (!saved) {
      editorMessage.error('当前改动未保存成功，暂不能另存为')
      return
    }
    const res = await canvasSaveAs(canvasId.value, newTitle || undefined)
    showSaveAs.value = false
    editorMessage.success('已另存为副本')
    const id = res.data?.id
    if (id) void router.push({ name: 'canvas-editor', params: { id } })
  } catch (error) {
    editorMessage.error(error instanceof Error && error.message ? error.message : '另存为失败，请稍后重试')
  } finally {
    savingAs.value = false
  }
}

const showTemplates = ref(false)

function onCreatedFromTemplate(id: string) {
  if (id) void router.push({ name: 'canvas-editor', params: { id } })
}

// ---------------- 资产栏 / 素材库 ----------------

function locateNode(id: string) {
  const node = store.findNode(id)
  if (!node) return
  selectedEdgeId.value = ''
  store.selectNode(id)
  void setCenter(node.position.x + 160, node.position.y + 150, { zoom: 1, duration: 300 })
}

const showAssetPicker = ref(false)

/** 素材库选中的图片：逐张新建图片节点并写入地址（同上传后的写法） */
function addLibraryImages(urls: string[]) {
  let last: CanvasEditorNode | undefined
  for (const url of urls) {
    const created = store.addNode('image')
    if (!created) break
    store.updateNodeData(created.id, { image: url })
    last = created
  }
  if (last) {
    const at = last.position
    void nextTick(() => setCenter(at.x + 120, at.y + 100, { zoom: 0.86, duration: 220 }))
  }
}

// ---------------- 画布工具条 ----------------

/** 原型默认「选择」：拖拽框选，滚轮 / 触控板平移；「拖动」：拖拽平移画布 */
const toolMode = ref<'select' | 'pan'>('select')
const snapEnabled = ref(false)

function spawn(kind: 'text' | 'image' | 'video' | 'image-model' | 'video-model' | 'tool') {
  const created = store.addNode(kind)
  if (!created) return undefined
  void nextTick(() => {
    setCenter(created.position.x + 170, created.position.y + 160, { zoom: 0.86, duration: 220 })
  })
  return created
}

const addOptions: DropdownOption[] = [
  { key: 'text', label: '提示词' },
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'image-model', label: '图片生成' },
  { key: 'video-model', label: '视频生成' },
  { key: 'tool', label: '工具' },
]

function onAddSelect(key: string | number) {
  spawn(key as 'text' | 'image' | 'video' | 'image-model' | 'video-model' | 'tool')
}

function openPromptLibrary() {
  window.open(router.resolve({ name: 'prompt-library' }).href, '_blank', 'noopener')
}

function openHelp() {
  const line = (text: string, cls = 'm-0 mb-6px text-ink-2 text-13px leading-20px') => h('p', { class: cls }, text)
  editorDialog.info({
    title: '画布缩放说明',
    positiveText: '我知道了',
    content: () =>
      h('div', [
        line('macOS：按住 ⌘，同时滚动鼠标滚轮；触控板可双指捏合'),
        line('Windows：按住 Ctrl，同时滚动鼠标滚轮'),
        line('也可以用下方工具条的放大 / 缩小 / 适应画布按钮。'),
        line('提示：默认滚轮是上下平移画布，只有配合组合键时才会缩放。', 'm-0 mt-8px text-muted text-12px'),
      ]),
  })
}
</script>

<template>
  <n-config-provider :theme-overrides="llTheme" abstract>
    <div class="flex flex-col h-100vh overflow-hidden bg-page">
      <header class="flex shrink-0 items-center gap-8px h-48px px-12px border-b border-b-solid border-line bg-white">
        <button
          type="button"
          class="grid shrink-0 w-28px h-28px p-0 place-items-center border border-solid border-transparent rounded-4px bg-transparent text-ink-2 cursor-pointer hover:border-line hover:bg-surface2 hover:text-ink"
          :class="FOCUS_RING"
          title="返回画布首页"
          aria-label="返回画布首页"
          @click="backToList"
        >
          <EditorIcon name="arrowBack" :size="18" />
        </button>
        <input
          v-if="titleEditing"
          ref="titleInputRef"
          v-model="title"
          class="w-240px h-30px px-8px border border-solid border-violet rounded-4px bg-white text-ink text-14px font-600 leading-20px outline-none shadow-[0_0_0_3px_rgba(135,95,154,0.14)]"
          maxlength="100"
          placeholder="未命名画布"
          aria-label="画布标题"
          @keydown.enter="commitTitle"
          @blur="commitTitle"
        />
        <button
          v-else
          type="button"
          class="flex min-w-0 items-center gap-6px h-30px px-8px border border-solid border-transparent rounded-4px bg-transparent text-ink text-14px font-600 leading-20px cursor-pointer hover:border-line hover:bg-surface2"
          :class="FOCUS_RING"
          title="重新命名"
          :aria-label="`重新命名：${title || '未命名画布'}`"
          @click="startTitleEdit"
        >
          <span class="overflow-hidden text-ellipsis whitespace-nowrap max-w-320px">{{ title || '未命名画布' }}</span>
          <EditorIcon name="pencil" :size="14" />
        </button>
        <span
          class="shrink-0 px-7px py-2px rounded-4px text-11px whitespace-nowrap"
          :class="saveStateClass"
          :title="saveState === 'error' ? saveError : undefined"
          >{{ saveText }}</span
        >
        <span
          v-if="runningCount"
          class="shrink-0 px-7px py-2px border border-solid border-violet-line rounded-4px bg-violet-soft text-violet-ink text-11px whitespace-nowrap"
          >运行中 {{ runningCount }}</span
        >

        <div class="flex items-center gap-6px ml-auto">
          <button
            type="button"
            :class="TOP_BTN"
            title="模板库：从模板新建一张画布（不改动当前画布）"
            @click="showTemplates = true"
          >
            <EditorIcon name="card" :size="16" /> 模板
          </button>
          <button
            type="button"
            :class="TOP_BTN"
            :aria-disabled="saveState === 'saving' || undefined"
            title="保存当前画布（Ctrl/Cmd+S）"
            @click="saveState !== 'saving' && store.saveNow()"
          >
            {{ saveState === 'saving' ? '保存中…' : '保存' }}
          </button>
          <button type="button" :class="TOP_BTN" title="复制当前画布到一张新画布" @click="showSaveAs = true">
            另存为
          </button>
          <button
            type="button"
            :class="TOP_BTN_PRIMARY"
            :aria-disabled="!runTarget || undefined"
            :title="runHint"
            @click="runSelected"
          >
            执行模型
          </button>
        </div>
      </header>

      <div class="flex flex-1 min-h-0">
        <EditorAssetPanel @locate="locateNode" @add-from-library="showAssetPicker = true" />

        <div v-loading="loading" class="relative flex-1 min-w-0 overflow-hidden bg-page">
          <VueFlow
            :id="FLOW_ID"
            v-model:nodes="nodes"
            v-model:edges="edges"
            class="w-full h-full"
            :default-viewport="{ x: 40, y: 20, zoom: 0.86 }"
            :min-zoom="0.2"
            :max-zoom="2"
            :zoom-on-scroll="false"
            :pan-on-scroll="true"
            :pan-on-drag="toolMode === 'pan'"
            :selection-key-code="toolMode === 'select' ? true : 'Shift'"
            :snap-to-grid="snapEnabled"
            :snap-grid="[20, 20]"
            :zoom-on-double-click="false"
            :delete-key-code="null"
            :connect-on-click="false"
            :connection-mode="ConnectionMode.Strict"
            :connection-line-style="{ stroke: '#875f9a', strokeWidth: 2, strokeLinecap: 'round' }"
            :is-valid-connection="isValidConnection"
            @node-click="onNodeClick"
            @pane-click="onPaneClick"
            @edge-click="onEdgeClick"
            @connect="onConnect"
            @connect-start="onConnectStart"
            @connect-end="onConnectEnd"
          >
            <Background :gap="24" :size="1.2" pattern-color="rgba(31, 35, 41, 0.20)" />

            <template #edge-canvas-bezier="edgeProps">
              <EditorBezierEdge v-bind="edgeProps" />
            </template>
            <template #node-text="nodeProps">
              <EditorTextNode
                v-bind="nodeProps"
                @remove="store.removeNode(nodeProps.id)"
                @locate="locateNode"
                @quick-add="(kind: QuickAddKind) => quickAdd(nodeProps.id, kind)"
              />
            </template>
            <template #node-image="nodeProps">
              <EditorImageNode
                v-bind="nodeProps"
                @remove="store.removeNode(nodeProps.id)"
                @quick-add="(kind: QuickAddKind) => quickAdd(nodeProps.id, kind)"
              />
            </template>
            <template #node-video="nodeProps">
              <EditorVideoNode
                v-bind="nodeProps"
                @remove="store.removeNode(nodeProps.id)"
                @quick-add="(kind: QuickAddKind) => quickAdd(nodeProps.id, kind)"
              />
            </template>
            <template #node-model="nodeProps">
              <EditorModelNode
                v-bind="nodeProps"
                @remove="store.removeNode(nodeProps.id)"
                @quick-add="(kind: QuickAddKind) => quickAdd(nodeProps.id, kind)"
              />
            </template>
            <template #node-tool="nodeProps">
              <EditorToolNode
                v-bind="nodeProps"
                @remove="store.removeNode(nodeProps.id)"
                @quick-add="(kind: QuickAddKind) => quickAdd(nodeProps.id, kind)"
              />
            </template>
            <template #node-module="nodeProps">
              <EditorModuleNode v-bind="nodeProps" />
            </template>
          </VueFlow>

          <div
            v-if="!loading && !nodes.length"
            class="absolute top-50% left-50% -translate-x-50% -translate-y-50% px-36px py-24px border border-dashed border-line-strong rounded-8px bg-white/90 text-center pointer-events-auto"
          >
            <strong class="block mb-6px text-ink text-14px">{{ loadError ? '画布加载失败' : '这是一张新画布' }}</strong>
            <p v-if="loadError" class="m-0 mb-10px text-muted text-13px">{{ loadError }}</p>
            <p v-else class="m-0 mb-10px text-muted text-13px">
              点左侧工具条「+」添加节点，或「从素材库添加」放入素材。
            </p>
            <n-button v-if="loadError" size="small" @click="store.init(canvasId)">重试</n-button>
          </div>

          <!-- 左竖工具条（原型 .wf-toolbar-left：left 12 / 垂直居中） -->
          <div
            :class="TOOLBAR"
            class="left-12px top-50% -translate-y-50% flex-col"
            role="toolbar"
            aria-label="画布工具"
          >
            <button
              type="button"
              :class="[TOOLBAR_BTN, { 'is-on': toolMode === 'pan' }]"
              title="拖动模式（平移画布）"
              aria-label="拖动模式"
              :aria-pressed="toolMode === 'pan'"
              @click="toolMode = 'pan'"
            >
              <EditorIcon name="hand" :size="19" />
            </button>
            <button
              type="button"
              :class="[TOOLBAR_BTN, { 'is-on': toolMode === 'select' }]"
              title="选择模式（框选节点）"
              aria-label="选择模式"
              :aria-pressed="toolMode === 'select'"
              @click="toolMode = 'select'"
            >
              <EditorIcon name="pointer" :size="18" />
            </button>
            <span class="h-1px mx-6px my-2px bg-line" aria-hidden="true" />
            <n-dropdown trigger="click" placement="right-start" :options="addOptions" @select="onAddSelect">
              <button type="button" :class="TOOLBAR_BTN" title="添加节点" aria-label="添加节点">
                <EditorIcon name="plus" :size="20" />
              </button>
            </n-dropdown>
            <span class="h-1px mx-6px my-2px bg-line" aria-hidden="true" />
            <button
              type="button"
              :class="TOOLBAR_BTN"
              title="从素材库导入"
              aria-label="从素材库导入"
              @click="showAssetPicker = true"
            >
              <EditorIcon name="albums" :size="18" />
            </button>
            <button
              type="button"
              :class="TOOLBAR_BTN"
              title="提示词库（新标签页打开）"
              aria-label="提示词库（新标签页打开）"
              @click="openPromptLibrary"
            >
              <EditorIcon name="book" :size="18" />
            </button>
          </div>

          <!-- 底横工具条（原型 .wf-toolbar-bottom：bottom 16 / 水平居中） -->
          <div
            :class="TOOLBAR"
            class="bottom-16px left-50% -translate-x-50% items-center"
            role="toolbar"
            aria-label="画布视图"
          >
            <button
              type="button"
              :class="TOOLBAR_BTN"
              :aria-disabled="!runTarget || undefined"
              :title="runTarget ? '执行选中节点' : '先选中一个生成或工具节点'"
              aria-label="执行选中节点"
              @click.stop="runSelected"
            >
              <EditorIcon name="play" :size="16" />
            </button>
            <button
              type="button"
              :class="[TOOLBAR_BTN, { 'is-on': snapEnabled }]"
              title="对齐网格（20px，默认关）"
              aria-label="对齐网格"
              :aria-pressed="snapEnabled"
              @click.stop="snapEnabled = !snapEnabled"
            >
              <EditorIcon name="grid" :size="16" />
            </button>
            <button type="button" :class="TOOLBAR_BTN" title="放大" aria-label="放大" @click.stop="zoomIn()">
              <EditorIcon name="plus" :size="16" />
            </button>
            <button type="button" :class="TOOLBAR_BTN" title="缩小" aria-label="缩小" @click.stop="zoomOut()">
              <EditorIcon name="minus" :size="16" />
            </button>
            <button
              type="button"
              :class="TOOLBAR_BTN"
              title="适应画布"
              aria-label="适应画布"
              @click.stop="fitView({ padding: 0.18, duration: 200 })"
            >
              <EditorIcon name="fit" :size="16" />
            </button>
            <button
              type="button"
              :class="TOOLBAR_BTN"
              aria-disabled="true"
              title="撤销（暂未支持）"
              aria-label="撤销（暂未支持）"
            >
              <EditorIcon name="undo" :size="16" />
            </button>
            <button
              type="button"
              :class="TOOLBAR_BTN"
              aria-disabled="true"
              title="重做（暂未支持）"
              aria-label="重做（暂未支持）"
            >
              <EditorIcon name="redo" :size="16" />
            </button>
            <button
              type="button"
              :class="TOOLBAR_BTN"
              aria-disabled="true"
              title="批量下载所有图片 / 视频输出（暂未支持）"
              aria-label="批量下载（暂未支持）"
            >
              <EditorIcon name="download" :size="16" />
            </button>
            <button type="button" :class="TOOLBAR_BTN" title="缩放说明" aria-label="缩放说明" @click.stop="openHelp">
              <EditorIcon name="help" :size="16" />
            </button>
          </div>
        </div>

        <NodeParamsPanel v-if="selectedNode" :node="selectedNode" />
      </div>

      <TitleModal
        v-model:show="showSaveAs"
        title="另存为副本"
        label="副本标题"
        :initial="saveAsInitial"
        placeholder="留空则自动命名为「原标题 - 副本」"
        :loading="savingAs"
        @confirm="doSaveAs"
      />
      <TemplatePicker v-model:show="showTemplates" @created="onCreatedFromTemplate" />
      <AssetPickerModal v-model:show="showAssetPicker" :limit="10" @select="addLibraryImages" />
    </div>
  </n-config-provider>
</template>
