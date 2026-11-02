<script setup lang="ts">
/**
 * 画布节点编辑器（全屏页，不套管理页壳）：
 * 顶栏（返回 / 标题 / 保存状态 / 运行数）+ 左侧节点类型窄条 + Vue Flow 画布 + 右侧参数面板。
 * 接口契约见 fusion_aigc_go/docs/api/api-canvas.md；快照 {nodes, edges} 整段存取 + 乐观锁保存。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { ConnectionMode, VueFlow, useVueFlow, type EdgeMouseEvent, type NodeMouseEvent } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
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
import { normalizeHandle, validateConnection } from './graph.ts'
import { editorDialog, useCanvasEditor } from './useCanvasEditor.ts'

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
function isValidConnection(connection: { source?: string | null; target?: string | null; sourceHandle?: string | null; targetHandle?: string | null }) {
  if (!connection.source || !connection.target) return false
  const conn = { source: connection.source, target: connection.target, sourceHandle: connection.sourceHandle, targetHandle: connection.targetHandle }
  const pool =
    normalizeHandle(conn.targetHandle) === 'prompt'
      ? edges.value.filter((edge) => !(edge.target === conn.target && normalizeHandle(edge.targetHandle) === 'prompt'))
      : edges.value
  return validateConnection(nodes.value, pool, conn).ok
}

function onConnect(connection: { source?: string | null; target?: string | null; sourceHandle?: string | null; targetHandle?: string | null }) {
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
  const sourceHandle = start.handleId ?? (source.type === 'text' ? 'text' : source.type === 'video' ? 'video' : 'image-out')
  let targetHandle = 'image'
  if (source.type === 'text') targetHandle = 'prompt'
  else if (target.data.kind === 'video') {
    const usedFirst = edges.value.some((edge) => edge.target === targetId && edge.targetHandle === 'image1')
    targetHandle = usedFirst ? 'image2' : 'image1'
  } else if (target.data.kind === 'tool' && target.data.tool === 'tryon') {
    const usedGarment = edges.value.some((edge) => edge.target === targetId && edge.targetHandle === 'garment')
    targetHandle = usedGarment ? 'models' : 'garment'
  }
  store.connect({ source: source.id, target: targetId, sourceHandle, targetHandle })
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
      onPositiveClick: () => {
        void store.flushSave()
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

const saveStateClass = computed(() => ({
  'is-error': saveState.value === 'error' || saveState.value === 'conflict',
  'is-saving': saveState.value === 'saving' || saveState.value === 'dirty',
}))

function spawn(kind: 'text' | 'image' | 'video' | 'image-model' | 'video-model' | 'tool') {
  const created = store.addNode(kind)
  if (!created) return
  void nextTick(() => {
    setCenter(created.position.x + 170, created.position.y + 160, { zoom: 0.86, duration: 220 })
  })
}

const palette = [
  { kind: 'text' as const, icon: 'text', label: '提示词' },
  { kind: 'image' as const, icon: 'image', label: '图片' },
  { kind: 'video' as const, icon: 'video', label: '视频' },
  { kind: 'image-model' as const, icon: 'model', label: '图片生成' },
  { kind: 'video-model' as const, icon: 'video', label: '视频生成' },
  { kind: 'tool' as const, icon: 'tool', label: '工具' },
]
</script>

<template>
  <n-config-provider :theme-overrides="llTheme" abstract>
    <div class="flex flex-col h-100vh overflow-hidden bg-white">
      <header class="flex shrink-0 items-center gap-12px h-48px px-14px border-b border-line bg-white">
        <button type="button" class="grid shrink-0 w-28px h-28px p-0 place-items-center border border-line rounded-6px bg-white text-ink-2 cursor-pointer hover:border-violet hover:text-violet-ink" title="返回画布列表" @click="backToList">
          <EditorIcon name="back" :size="16" />
        </button>
        <div class="w-260px">
          <n-input v-model:value="title" size="small" placeholder="未命名画布" maxlength="100" />
        </div>
        <span class="shrink-0 text-placeholder text-12px whitespace-nowrap [&.is-saving]:text-warning [&.is-error]:text-danger" :class="saveStateClass">{{ saveText }}</span>
        <span v-if="runningCount" class="shrink-0 px-8px py-2px border border-violet-line rounded-999px bg-violet-soft text-violet-ink text-11px whitespace-nowrap">运行中 {{ runningCount }}</span>
        <n-button size="small" :loading="saveState === 'saving'" @click="store.saveNow()">保存</n-button>
      </header>

      <div class="flex flex-1 min-h-0">
        <aside class="flex flex-col shrink-0 gap-6px w-64px px-8px py-10px border-r border-line bg-surface2 overflow-y-auto">
          <button
            v-for="item in palette"
            :key="item.kind"
            type="button"
            class="flex flex-col items-center gap-4px px-2px py-8px border border-transparent rounded-8px bg-transparent text-ink-2 text-10px cursor-pointer hover:border-violet-line hover:bg-violet-soft hover:text-violet-ink"
            :title="`添加${item.label}节点`"
            @click="spawn(item.kind)"
          >
            <EditorIcon :name="item.icon" :size="17" />
            <span>{{ item.label }}</span>
          </button>

          <div class="flex-1 min-h-8px" />

          <button type="button" class="flex flex-col items-center gap-4px px-2px py-8px border border-transparent rounded-8px bg-transparent text-ink-2 text-10px cursor-pointer hover:border-violet-line hover:bg-violet-soft hover:text-violet-ink" title="放大" @click="zoomIn()">
            <EditorIcon name="zoomIn" :size="17" />
          </button>
          <button type="button" class="flex flex-col items-center gap-4px px-2px py-8px border border-transparent rounded-8px bg-transparent text-ink-2 text-10px cursor-pointer hover:border-violet-line hover:bg-violet-soft hover:text-violet-ink" title="缩小" @click="zoomOut()">
            <EditorIcon name="zoomOut" :size="17" />
          </button>
          <button type="button" class="flex flex-col items-center gap-4px px-2px py-8px border border-transparent rounded-8px bg-transparent text-ink-2 text-10px cursor-pointer hover:border-violet-line hover:bg-violet-soft hover:text-violet-ink" title="适应画布" @click="fitView({ padding: 0.2, duration: 200 })">
            <EditorIcon name="fit" :size="17" />
          </button>
        </aside>

        <div v-loading="loading" class="relative flex-1 min-w-0">
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
            :zoom-on-double-click="false"
            :delete-key-code="null"
            :connect-on-click="false"
            :connection-mode="ConnectionMode.Strict"
            :is-valid-connection="isValidConnection"
            @node-click="onNodeClick"
            @pane-click="onPaneClick"
            @edge-click="onEdgeClick"
            @connect="onConnect"
            @connect-start="onConnectStart"
            @connect-end="onConnectEnd"
          >
            <Background :gap="24" :size="1.2" pattern-color="rgba(31, 35, 41, 0.18)" />

            <template #edge-canvas-bezier="edgeProps">
              <EditorBezierEdge v-bind="edgeProps" />
            </template>
            <template #node-text="nodeProps">
              <EditorTextNode v-bind="nodeProps" @remove="store.removeNode(nodeProps.id)" />
            </template>
            <template #node-image="nodeProps">
              <EditorImageNode v-bind="nodeProps" @remove="store.removeNode(nodeProps.id)" />
            </template>
            <template #node-video="nodeProps">
              <EditorVideoNode v-bind="nodeProps" @remove="store.removeNode(nodeProps.id)" />
            </template>
            <template #node-model="nodeProps">
              <EditorModelNode v-bind="nodeProps" @remove="store.removeNode(nodeProps.id)" />
            </template>
            <template #node-tool="nodeProps">
              <EditorToolNode v-bind="nodeProps" @remove="store.removeNode(nodeProps.id)" />
            </template>
            <template #node-module="nodeProps">
              <EditorModuleNode v-bind="nodeProps" />
            </template>
          </VueFlow>

          <div v-if="!loading && !nodes.length" class="absolute top-50% left-50% -translate-x-50% -translate-y-50% px-36px py-24px border border-dashed border-line-strong rounded-12px bg-white/90 text-center pointer-events-auto">
            <strong class="block mb-6px text-ink text-14px">{{ loadError ? '画布加载失败' : '这是一张新画布' }}</strong>
            <p v-if="loadError" class="m-0 mb-10px text-muted text-12px">{{ loadError }}</p>
            <p v-else class="m-0 mb-10px text-muted text-12px">从左侧添加提示词 / 图片 / 生成节点开始</p>
            <n-button v-if="loadError" size="small" @click="store.init(canvasId)">重试</n-button>
          </div>
        </div>

        <NodeParamsPanel v-if="selectedNode" :node="selectedNode" />
      </div>
    </div>
  </n-config-provider>
</template>
