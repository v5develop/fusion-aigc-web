<script setup lang="ts">
/**
 * 编辑器内「从模板插入」弹层（原型 CanvasView .wf-templates）：scope 页签 + 模板卡片，点卡片即取详情并插入。
 * 只负责选模板与取快照（GET /templates/{id}），插入由父页调 templateInsert.ts + store.pasteClipboard 完成。
 * 画布首页的「从模板新建画布」仍走 ../TemplatePicker.vue，不受影响。
 */
import { ref, watch } from 'vue'
import { canvasTemplateDetail, canvasTemplates } from '@/api/canvas-home.ts'
import type { ICanvasTemplate, ICanvasTemplateDetail } from '@/api/canvas-home.ts'

const show = defineModel<boolean>('show', { required: true })

const emit = defineEmits<{ insert: [template: ICanvasTemplateDetail] }>()

type Scope = 'official' | 'user' | 'all'

const SCOPES: { key: Scope; label: string }[] = [
  { key: 'official', label: '官方模板' },
  { key: 'user', label: '我的模板' },
  { key: 'all', label: '全部' },
]

const scope = ref<Scope>('official')
const templates = ref<ICanvasTemplate[]>([])
const loading = ref(false)
/** 正在取详情的模板 id（防连点） */
const picking = ref<number | null>(null)

watch(show, (v) => {
  if (v) void loadTemplates()
})
watch(scope, () => {
  void loadTemplates()
})

let loadSeq = 0
async function loadTemplates() {
  const cur = ++loadSeq
  loading.value = true
  try {
    const res = await canvasTemplates(scope.value)
    if (cur === loadSeq) templates.value = res.data?.items ?? []
  } catch {
    if (cur === loadSeq) templates.value = []
  } finally {
    if (cur === loadSeq) loading.value = false
  }
}

let pickSeq = 0
async function pick(t: ICanvasTemplate) {
  if (picking.value != null) return
  picking.value = t.id
  const cur = ++pickSeq
  try {
    const res = await canvasTemplateDetail(t.id)
    // 弹窗已被关掉 / 已有更新的点击：丢弃过期响应，别往画布里插
    if (!show.value || cur !== pickSeq || !res.data) return
    show.value = false
    emit('insert', res.data)
  } catch {
    // 业务失败拦截器已 toast
  } finally {
    picking.value = null
  }
}
</script>

<template>
  <n-modal v-model:show="show" preset="card" style="width: 780px" :bordered="false">
    <template #header>
      <div>
        <div class="text-15px font-600 text-ink">从模板插入</div>
        <p class="m-0 mt-4px text-12px font-400 text-muted">每个模板是一块带底色的模块，插入后节点和连线都可继续改。</p>
      </div>
    </template>
    <div>
      <div class="flex gap-4px mb-14px" role="tablist" aria-label="模板范围">
        <button
          v-for="s in SCOPES"
          :key="s.key"
          type="button"
          role="tab"
          :aria-selected="scope === s.key"
          class="h-32px px-10px border border-solid rounded-4px text-13px cursor-pointer transition-colors duration-120 focus-visible:(outline outline-2 outline-solid outline-violet outline-offset-2)"
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

      <div
        v-loading="loading"
        class="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-10px max-h-420px overflow-auto min-h-160px"
      >
        <button
          v-for="t in templates"
          :key="t.id"
          type="button"
          :disabled="picking != null"
          :aria-busy="picking === t.id || undefined"
          class="relative flex flex-col gap-6px p-10px overflow-hidden border border-solid border-line rounded-8px bg-white text-left cursor-pointer transition-[box-shadow,border-color] duration-120 ease-[ease] hover:(border-violet-line shadow-[0_1px_2px_rgba(16,24,40,0.06)]) disabled:cursor-wait focus-visible:(outline outline-2 outline-solid outline-violet outline-offset-2)"
          @click="pick(t)"
        >
          <div class="h-116px w-full overflow-hidden rounded-6px bg-[rgba(135,95,154,0.09)]">
            <img v-if="t.coverUrl" :src="t.coverUrl" alt="" loading="lazy" class="block w-full h-full object-cover" />
            <div v-else class="h-full flex items-center justify-center text-13px text-violet-ink">模板</div>
          </div>
          <div class="w-full text-13px font-600 text-ink overflow-hidden text-ellipsis whitespace-nowrap">
            {{ t.title }}
          </div>
          <div
            class="text-11px text-muted leading-[1.45] overflow-hidden min-h-32px [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]"
          >
            {{ t.description }}
          </div>
          <div class="text-11px text-placeholder">
            {{ picking === t.id ? '正在插入…' : `${t.nodeCount} 个节点 · ${t.edgeCount} 条连线` }}
          </div>
        </button>

        <div
          v-if="!loading && !templates.length"
          class="col-span-full py-50px border border-dashed border-line-strong rounded-8px bg-white text-muted text-13px text-center"
        >
          这个范围下暂无模板
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex items-center justify-between gap-10px">
        <span class="text-12px text-placeholder">插入后可在画布上继续改；模板只带结构，不带生成结果</span>
        <n-button @click="show = false">关闭</n-button>
      </div>
    </template>
  </n-modal>
</template>
