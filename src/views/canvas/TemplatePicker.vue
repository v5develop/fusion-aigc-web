<script setup lang="ts">
/**
 * 从模板创建画布弹层：scope 页签（官方 / 我的 / 全部）+ 模板卡片单选 + 标题选填。
 * 确认后 POST /canvases/from-template {template_id, title?}，成功 emit created 由父页刷新列表。
 */
import { ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { canvasFromTemplate, canvasTemplates } from '@/api/canvasHome.ts'
import type { ICanvasTemplate } from '@/api/canvasHome.ts'
import { toApiError } from '@/api/index.ts'

const show = defineModel<boolean>('show', { required: true })

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
      template_id: selected.value.id,
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
  <n-modal v-model:show="show" preset="card" title="从模板创建画布" style="width: 720px">
    <div>
      <div class="flex items-center justify-between gap-12px mb-14px">
        <div class="flex gap-8px">
          <span
            v-for="s in SCOPES"
            :key="s.key"
            class="ll-pill"
            :class="{ 'll-pill-active': scope === s.key }"
            @click="scope = s.key"
          >
            {{ s.label }}
          </span>
        </div>
        <n-input
          v-model:value="title"
          :maxlength="100"
          placeholder="画布标题，选填，留空用模板标题"
          style="width: 260px"
        />
      </div>

      <div
        class="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-12px max-h-420px overflow-auto min-h-160px"
        v-loading="loading"
      >
        <div
          v-for="t in templates"
          :key="t.id"
          class="ll-card relative cursor-pointer p-0 overflow-hidden transition-[box-shadow,border-color] duration-200 hover:shadow-[0_4px_12px_0_rgba(31,35,41,0.12)]"
          :class="{ '!border-violet !shadow-[0_0_0_1px_#875f9a]': selected?.id === t.id }"
          @click="selected = t"
        >
          <div class="h-96px bg-violet-soft">
            <img v-if="t.cover_url" :src="t.cover_url" alt="" class="block w-full h-full object-cover" />
            <div v-else class="h-full flex items-center justify-center text-13px text-violet-ink">模板</div>
          </div>
          <div class="px-12px pt-10px pb-12px">
            <div class="text-13px font-600 text-ink mb-4px overflow-hidden text-ellipsis whitespace-nowrap">
              {{ t.title }}
            </div>
            <div
              class="text-12px text-muted leading-18px mb-6px overflow-hidden min-h-36px [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]"
            >
              {{ t.description }}
            </div>
            <div class="text-11px text-placeholder">{{ t.node_count }} 个节点 · {{ t.edge_count }} 条连线</div>
          </div>
          <span v-if="selected?.id === t.id" class="ll-chip ll-chip-running absolute top-8px right-8px !bg-white"
            >已选择</span
          >
        </div>

        <div v-if="!loading && !templates.length" class="ll-empty col-span-full bg-white rounded-12px py-50px">
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
