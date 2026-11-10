<script setup lang="ts">
/**
 * 从模板创建画布弹层：scope 页签（官方 / 我的 / 全部）+ 模板卡片单选 + 标题选填。
 * 确认后 POST /canvases/from-template {template_id, title?}，成功 emit created 由父页刷新列表。
 */
import { ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { canvasFromTemplate, canvasTemplates } from '@/api/canvas-home.ts'
import type { ICanvasTemplate } from '@/api/canvas-home.ts'
import { toApiError } from '@/api/index.ts'

const show = defineModel<boolean>('show', { required: true })

const props = defineProps<{
  /** 首页点了未能映射到接口的模板：按此标题预选（命中则选中，未命中不动） */
  hint?: string
}>()

const emit = defineEmits<{ created: [id: string] }>()

const message = useMessage()

type Scope = 'official' | 'user' | 'all'

const SCOPES: { key: Scope; label: string }[] = [
  { key: 'official', label: '官方模板' },
  { key: 'user', label: '我的模板' },
  { key: 'all', label: '全部' },
]

const scope = ref<Scope>('official')
const templates = ref<ICanvasTemplate[]>([])
const loading = ref(false)
const selected = ref<ICanvasTemplate | null>(null)
const title = ref('')
const creating = ref(false)

watch(show, (v) => {
  if (!v) return
  selected.value = null
  title.value = ''
  void loadTemplates()
})

function applyHint() {
  const h = props.hint?.replace(/\s+/g, '')
  if (!h) return
  const hit = templates.value.find((t) => t.title.replace(/\s+/g, '').includes(h))
  if (hit) selected.value = hit
}

watch(scope, () => {
  void loadTemplates()
})

// 切页签快速来回时，慢回包不能把当前页签的列表覆盖掉
let loadSeq = 0

async function loadTemplates() {
  const cur = ++loadSeq
  loading.value = true
  try {
    const res = await canvasTemplates(scope.value)
    if (cur !== loadSeq) return
    templates.value = res.data?.items ?? []
    if (!selected.value) applyHint()
  } catch {
    // 业务失败拦截器已 toast；网络失败在这里兜底
    if (cur === loadSeq) templates.value = []
  } finally {
    if (cur === loadSeq) loading.value = false
  }
}

async function create() {
  if (creating.value) return
  if (!selected.value) return message.warning('请先选择一个模板')
  creating.value = true
  try {
    const res = await canvasFromTemplate({
      templateId: selected.value.id,
      title: title.value.trim() || undefined,
    })
    message.success('画布已创建')
    show.value = false
    emit('created', res.data?.id ?? '')
  } catch (err) {
    if ((toApiError(err)?.code ?? -1) === -1) message.error('创建失败，请检查网络后重试')
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <n-modal v-model:show="show" preset="card" title="从模板创建画布" style="width: 780px">
    <div>
      <div class="flex items-center justify-between gap-12px mb-14px">
        <!-- 页签：原型 .wf-library__cats（28px / r4 / 13px，选中藤紫浅底 600） -->
        <div class="flex gap-4px" role="tablist" aria-label="模板范围">
          <button
            v-for="s in SCOPES"
            :key="s.key"
            type="button"
            role="tab"
            :aria-selected="scope === s.key"
            class="h-28px px-10px border border-solid rounded-4px text-13px cursor-pointer transition-colors duration-120 focus-visible:(outline outline-2 outline-solid outline-violet outline-offset-2)"
            :class="
              scope === s.key
                ? 'border-violet-line bg-violet-soft text-violet-ink font-600'
                : 'border-transparent bg-transparent text-ink-2 hover:bg-surface2'
            "
            @click="scope = s.key"
          >
            {{ s.label }}
          </button>
        </div>
        <n-input
          v-model:value="title"
          :maxlength="100"
          placeholder="画布标题，选填，留空用模板标题"
          style="width: 260px"
        />
      </div>

      <div
        class="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-10px max-h-420px overflow-auto min-h-160px"
        v-loading="loading"
      >
        <!-- 模板卡：原型 .wf-templates__grid > button（内边距 10、gap 6、r8、1px line；预览高 116 / r6） -->
        <div
          v-for="t in templates"
          :key="t.id"
          role="button"
          tabindex="0"
          :aria-pressed="selected?.id === t.id"
          class="relative flex flex-col gap-6px p-10px overflow-hidden border border-solid border-line rounded-8px bg-white text-left cursor-pointer transition-[box-shadow,border-color] duration-120 ease-[ease] hover:(border-violet-line shadow-[0_1px_2px_rgba(16,24,40,0.06)]) focus-visible:(outline outline-2 outline-solid outline-violet outline-offset-2)"
          :class="{ '!border-violet !shadow-[0_0_0_1px_#875f9a]': selected?.id === t.id }"
          @click="selected = t"
          @keydown.enter.self.prevent="selected = t"
          @keydown.space.self.prevent="selected = t"
        >
          <div class="h-116px overflow-hidden rounded-6px bg-[rgba(135,95,154,0.09)]">
            <img v-if="t.coverUrl" :src="t.coverUrl" alt="" class="block w-full h-full object-cover" />
            <div v-else class="h-full flex items-center justify-center text-13px text-violet-ink">模板</div>
          </div>
          <div class="text-13px font-600 text-ink overflow-hidden text-ellipsis whitespace-nowrap">
            {{ t.title }}
          </div>
          <div
            class="text-11px text-muted leading-[1.45] overflow-hidden min-h-32px [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]"
          >
            {{ t.description }}
          </div>
          <div class="text-11px text-placeholder">{{ t.nodeCount }} 个节点 · {{ t.edgeCount }} 条连线</div>
          <span v-if="selected?.id === t.id" class="ll-chip ll-chip-running absolute top-16px right-16px !bg-white"
            >已选择</span
          >
        </div>

        <div
          v-if="!loading && !templates.length"
          class="col-span-full py-50px border border-dashed border-line-strong rounded-8px bg-white text-muted text-13px text-center"
        >
          这个范围下暂无模板
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-10px">
        <n-button @click="show = false">取消</n-button>
        <n-button type="primary" :loading="creating" :disabled="!selected" @click="create">创建画布</n-button>
      </div>
    </template>
  </n-modal>
</template>
