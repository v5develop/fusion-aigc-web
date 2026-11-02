<script setup lang="ts">
/**
 * 工作流页 /workflow?flow=&category=&template=（query 形状与 v1.0 原型一致；契约 14 个 wf:* 按 schemas.ts 渲染）。
 *
 * <p>版式沿用工具页（views/tools）：左操作（模板切换 + 上传 + 参数，底部固定提交栏）/ 中历史 / 右结果 + 说明。
 * 提交打 Java v1 现有路由（schema.javaEndpoint），请求体按 schema 映射组装；服装工作流的 content 取
 * GET /api/v1/workflows/templates/{flow} 下发的模板 prompt。结果与历史都取
 * GET /api/v1/workflows/{templateTitle}/histories（提交只回 workflowHistoryIds）。
 */
import { computed, reactive, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useMessage } from 'naive-ui'
import { toApiError } from '@/api/index.ts'
import {
  submitWorkflow,
  workflowHistories,
  workflowTemplates,
  type WorkflowHistoryItem,
  type WorkflowTemplateView,
} from '@/api/workflows.ts'
import { useUserInfoStore } from '@/stores/userInfo'
import ToolUploadSlot from '@/views/tools/ToolUploadSlot.vue'
import {
  resolveWorkflowSchema,
  taskCountOf,
  toWorkflowJavaValue,
  workflowFlowLabels,
  workflowSchemas,
  type WorkflowField,
  type WorkflowSchema,
} from './schemas'
import { isWorkflowTerminal, useWorkflowHistory } from './useWorkflowHistory'

const route = useRoute()
const message = useMessage()
const userInfo = useUserInfoStore()

const q = (v: unknown) => (Array.isArray(v) ? String(v[0] ?? '') : String(v ?? ''))
const schema = computed<WorkflowSchema | undefined>(() =>
  resolveWorkflowSchema(q(route.query.flow), q(route.query.category), q(route.query.template)),
)
const mapped = computed(() => schema.value?.status === 'mapped')
/**
 * s1.1 上传态（纯展示）：图片槽是「材料片」（60×100 叠片 + 片下两行说明），同排、两块之间画切口；
 * 视频槽是单槽云影球卡，排在图片后面。校验与提交仍按 schema 顺序。
 */
const imageUploads = computed(() => (schema.value?.uploads ?? []).filter((u) => u.kind !== 'video'))
const videoUploads = computed(() => (schema.value?.uploads ?? []).filter((u) => u.kind === 'video'))

/** 同 flow 的模板切换项（链接保持原型的 query 形状） */
const siblings = computed(() => workflowSchemas.filter((s) => s.flow === schema.value?.flow))
const linkOf = (s: WorkflowSchema) => ({
  path: '/workflow',
  query: { flow: s.flow, category: s.category, template: s.name },
})

// ---------------- 表单状态 ----------------

const uploads = reactive<Record<number, string[]>>({})
const values = reactive<Record<string, any>>({})
const submitting = ref(false)
const selectedId = ref<number | null>(null)

const history = useWorkflowHistory(() => (mapped.value ? (schema.value?.templateTitle ?? '') : ''))

function reportError(err: unknown, fallback = '操作失败，请重试') {
  const apiErr = toApiError(err)
  if (apiErr && apiErr.code !== -1 && !apiErr.httpStatus) return
  if (apiErr?.isNetwork) message.error('网络异常或请求超时，请稍后在历史记录里确认是否已提交')
  else message.error(err instanceof Error && err.message ? err.message : fallback)
}

function setUploads(slot: number, urls: string[]) {
  uploads[slot] = urls
}

function clampNumber(f: WorkflowField) {
  const n = Math.round(Number(values[f.key]))
  values[f.key] = Math.min(f.max ?? Infinity, Math.max(f.min ?? -Infinity, Number.isFinite(n) ? n : (f.min ?? 1)))
}

function resetForm(s: WorkflowSchema) {
  for (const key of Object.keys(uploads)) delete uploads[Number(key)]
  for (const key of Object.keys(values)) delete values[key]
  for (const u of s.uploads) uploads[u.slot] = []
  for (const f of s.fields) if (f.default !== undefined) values[f.key] = f.default
  selectedId.value = null
}

// ---------------- 模板（GET /workflows/templates/{flow}） ----------------

const templatesByFlow = reactive<Record<string, WorkflowTemplateView[] | undefined>>({})
const templatesFailed = reactive<Record<string, boolean>>({})

async function loadTemplates(flow: string) {
  if (templatesByFlow[flow]) return
  templatesFailed[flow] = false
  try {
    const res = await workflowTemplates(flow)
    templatesByFlow[flow] = res.data ?? []
  } catch (err) {
    templatesFailed[flow] = true
    reportError(err, '模板加载失败')
  }
}

const templateView = computed(() =>
  schema.value ? templatesByFlow[schema.value.flow]?.find((t) => t.title === schema.value!.templateTitle) : undefined,
)
const templatePrompt = computed(() => templateView.value?.payload?.payload?.prompt?.trim() ?? '')
const sampleUrl = computed(() => templateView.value?.payload?.result?.[0] ?? '')
/** 模板中文名以后端为准，契约名兜底 */
const nameOf = (s: WorkflowSchema) =>
  templatesByFlow[s.flow]?.find((t) => t.title === s.templateTitle)?.titleZh || s.name

watch(
  schema,
  (s) => {
    history.stop()
    if (!s) return
    resetForm(s)
    if (s.status !== 'mapped') return
    void loadTemplates(s.flow)
    history.reload().catch((err) => reportError(err, '历史记录加载失败'))
  },
  { immediate: true },
)

// ---------------- 就绪判定 ----------------

const disabledReason = computed(() => {
  const s = schema.value
  if (!s) return ''
  if (s.status !== 'mapped') return '该工作流即将开放'
  if (s.contentSource === 'template-prompt') {
    if (templatesFailed[s.flow]) return '模板加载失败，请刷新页面重试'
    if (!templatesByFlow[s.flow]) return '模板加载中…'
    if (!templateView.value) return '该模板暂未启用'
    if (!templatePrompt.value) return '该模板缺少生成配置，暂不可用'
  }
  for (const u of s.uploads) {
    if (u.required && !uploads[u.slot]?.length) return `还没上传${u.label}`
  }
  for (const f of s.fields) {
    if (!f.required) continue
    const v = values[f.key]
    if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) return `请填写${f.label}`
  }
  return ''
})

const costText = computed(() => {
  const s = schema.value
  if (!s || !mapped.value) return ''
  const n = taskCountOf(s, values, uploads)
  const unit = `按${s.submit.costUnit}计费，提交即扣点`
  return n > 1 ? `将生成 ${n} 个任务 · ${unit}` : unit
})

// ---------------- 组装请求体 ----------------

function buildBody(s: WorkflowSchema): Record<string, unknown> {
  const body: Record<string, unknown> = { ...s.fixedBody }
  for (const f of s.fields) {
    const v = toWorkflowJavaValue(f, values[f.key])
    if (v !== undefined) body[f.javaKey] = v
  }
  if (s.contentSource === 'template-prompt') body.content = templatePrompt.value
  const imageUrls: string[] = []
  for (const u of [...s.uploads].sort((a, b) => a.slot - b.slot)) {
    const urls = uploads[u.slot] ?? []
    if (!urls.length) continue
    if (u.javaKey === 'imageUrls') imageUrls.push(...urls)
    else if (u.javaKey === 'prdImageUrls') body.prdImageUrls = urls.map((url) => ({ url }))
    else body[u.javaKey] = urls[0]
  }
  if (imageUrls.length) body.imageUrls = imageUrls
  return body
}

async function onSubmit() {
  const s = schema.value
  if (!s || submitting.value || disabledReason.value) return
  submitting.value = true
  let ok = false
  try {
    await submitWorkflow(s.javaEndpoint, buildBody(s))
    ok = true
  } catch (err) {
    reportError(err, '提交失败，请重试')
  } finally {
    submitting.value = false
    if (ok) message.success('已提交，结果会出现在历史记录里')
    // 失败也刷新一次：超时 / 断网时任务可能已在服务端创建
    selectedId.value = null
    void userInfo.updateUserInfo()
    history.afterSubmit().catch((err) => reportError(err, '历史记录刷新失败'))
  }
}

// ---------------- 历史与结果 ----------------

const current = computed<WorkflowHistoryItem | null>(
  () => history.items.value.find((i) => i.workflowHistoryId === selectedId.value) ?? history.items.value[0] ?? null,
)

const isVideoUrl = (u: string) => /\.(mp4|webm|mov)(\?|#|$)/i.test(u)

function outputsOf(item: WorkflowHistoryItem) {
  const images = [...(item.data?.resultImageUrls ?? [])]
  const videos = [...(item.data?.resultVideoUrls ?? [])]
  const result = item.data?.result
  const urls = [result?.taskResult?.url, ...(result?.tasks ?? []).map((t) => t.taskResult?.url)]
  for (const url of urls) {
    if (url && !images.includes(url) && !videos.includes(url)) (isVideoUrl(url) ? videos : images).push(url)
  }
  return { images, videos }
}

function thumbOf(item: WorkflowHistoryItem) {
  return outputsOf(item).images[0] ?? item.data?.inputImageUrls?.[0] ?? item.data?.payload?.imageUrls?.[0] ?? ''
}

const errorOf = (item: WorkflowHistoryItem) =>
  item.data?.result?.error || item.data?.result?.tasks?.find((t) => t.error)?.error || ''

/** 下载走 original=true 的同一条历史（不带水印）；拿不到时退回查看地址 */
async function downloadOriginal(item: WorkflowHistoryItem, kind: 'images' | 'videos', index: number) {
  const fallback = outputsOf(item)[kind][index]
  let url = fallback
  try {
    const res = await workflowHistories(schema.value?.templateTitle ?? '', 1, 20, true)
    const hit = res.data?.data?.find((i) => i.workflowHistoryId === item.workflowHistoryId)
    if (hit) url = outputsOf(hit)[kind][index] ?? fallback
  } catch (err) {
    reportError(err, '获取原图失败，已打开查看图')
  }
  if (url) window.open(url, '_blank', 'noopener')
}

const STATUS: Record<string, { text: string; cls: string }> = {
  PENDING: { text: '排队中', cls: 'll-chip-running' },
  RUNNING: { text: '生成中', cls: 'll-chip-running' },
  WAITING_MANUAL_PROCESS: { text: '处理中', cls: 'll-chip-running' },
  SUCCEED: { text: '已完成', cls: 'll-chip-success' },
  PARTIAL_SUCCEED: { text: '部分完成', cls: 'll-chip-warning' },
  FAILED: { text: '失败', cls: 'll-chip-error' },
  TIMEOUT: { text: '超时', cls: 'll-chip-error' },
  CANCELLED: { text: '已取消', cls: 'll-chip-warning' },
}
const statusOf = (s: string) => STATUS[s] ?? { text: s || '未知', cls: 'll-chip-warning' }
const formatTime = (v?: string | null) => (v ? v.replace('T', ' ').slice(0, 16) : '')

const focusRing = 'outline-none focus-visible:(outline-2 outline-solid outline-violet outline-offset-2)'
const inputCls =
  'w-full box-border rounded-6px border border-solid border-line-strong bg-white px-10px py-7px text-13px text-ink ' +
  'focus:(border-violet outline-none shadow-[0_0_0_2px_rgba(135,95,154,0.18)])'
</script>

<template>
  <div v-if="!schema" class="h-full flex flex-col items-center justify-center gap-12px bg-page">
    <p class="m-0 text-15px text-ink">没有找到这个工作流</p>
    <RouterLink to="/" class="ll-link" :class="focusRing">返回首页</RouterLink>
  </div>

  <div v-else class="grid h-full min-h-0 gap-12px p-12px bg-page grid-cols-[380px_260px_minmax(0,1fr)]">
    <!-- 左：操作区 -->
    <section class="ll-card flex min-h-0 flex-col overflow-hidden" aria-labelledby="wf-title">
      <div class="flex-none pt-14px px-14px pb-4px">
        <p class="m-0 mb-4px text-12px text-placeholder">{{ workflowFlowLabels[schema.flow] }}</p>
        <h1 id="wf-title" class="m-0 text-15px font-600 text-ink">{{ nameOf(schema) }}</h1>
      </div>

      <nav class="flex-none px-14px pt-8px pb-4px" aria-label="切换模板">
        <ul class="m-0 p-0 list-none flex flex-wrap gap-6px">
          <li v-for="s in siblings" :key="s.schemaId">
            <RouterLink
              :to="linkOf(s)"
              replace
              class="ll-pill no-underline"
              :class="[focusRing, s.schemaId === schema.schemaId ? 'll-pill-active' : '']"
              :aria-current="s.schemaId === schema.schemaId ? 'page' : undefined"
            >
              {{ nameOf(s) }}
              <span v-if="s.status !== 'mapped'" class="ml-4px text-11px text-placeholder">即将开放</span>
            </RouterLink>
          </li>
        </ul>
      </nav>

      <div v-if="!mapped" class="flex-1 min-h-0 flex flex-col items-center justify-center gap-8px px-14px">
        <p class="m-0 text-15px font-600 text-ink">即将开放</p>
        <p class="m-0 text-13px text-muted text-center leading-20px">「{{ schema.name }}」正在接入中，敬请期待</p>
      </div>

      <form
        v-else
        id="wf-form"
        class="flex-1 min-h-0 overflow-y-auto pt-10px px-14px pb-14px flex flex-col gap-16px [scrollbar-gutter:stable]"
        @submit.prevent="onSubmit"
      >
        <div v-if="imageUploads.length" data-plate-row class="flex items-start gap-16px">
          <ToolUploadSlot
            v-for="u in imageUploads"
            :id="`wf-upload-${u.slot}`"
            :key="`${schema.schemaId}-${u.slot}`"
            :model-value="uploads[u.slot] ?? []"
            :spec="u"
            layout="material"
            :disabled="submitting"
            @update:model-value="setUploads(u.slot, $event)"
          />
        </div>
        <ToolUploadSlot
          v-for="u in videoUploads"
          :id="`wf-upload-${u.slot}`"
          :key="`${schema.schemaId}-${u.slot}`"
          :model-value="uploads[u.slot] ?? []"
          :spec="u"
          layout="single"
          :disabled="submitting"
          @update:model-value="setUploads(u.slot, $event)"
        />

        <template v-for="f in schema.fields" :key="`${schema.schemaId}-${f.key}`">
          <div v-if="f.type === 'chips'">
            <div :id="`wf-field-${f.key}-label`" class="ll-label">
              <span>{{ f.label }}<span v-if="f.required" class="text-danger" aria-hidden="true"> *</span></span>
            </div>
            <div role="radiogroup" :aria-labelledby="`wf-field-${f.key}-label`" class="flex flex-wrap gap-6px">
              <button
                v-for="opt in f.options"
                :key="opt"
                type="button"
                role="radio"
                :aria-checked="values[f.key] === opt"
                class="ll-pill"
                :class="[focusRing, values[f.key] === opt ? 'll-pill-active' : '']"
                @click="values[f.key] = opt"
              >
                {{ opt }}
              </button>
            </div>
          </div>

          <div v-else-if="f.type === 'select'">
            <div class="ll-label">
              <label :for="`wf-field-${f.key}`">
                {{ f.label }}<span v-if="f.required" class="text-danger" aria-hidden="true"> *</span>
              </label>
            </div>
            <select :id="`wf-field-${f.key}`" v-model="values[f.key]" :class="inputCls">
              <option v-for="opt in f.options" :key="opt" :value="opt">{{ opt }}</option>
            </select>
          </div>

          <div v-else-if="f.type === 'number'">
            <div class="ll-label">
              <label :for="`wf-field-${f.key}`">
                {{ f.label }}<span v-if="f.required" class="text-danger" aria-hidden="true"> *</span>
              </label>
              <span class="text-12px text-placeholder">{{ f.min }}–{{ f.max }}</span>
            </div>
            <input
              :id="`wf-field-${f.key}`"
              v-model.number="values[f.key]"
              type="number"
              :min="f.min"
              :max="f.max"
              step="1"
              :class="inputCls"
              @change="clampNumber(f)"
            />
          </div>

          <div v-else-if="f.type === 'textarea'">
            <div class="ll-label">
              <label :for="`wf-field-${f.key}`">
                {{ f.label }}<span v-if="f.required" class="text-danger" aria-hidden="true"> *</span>
              </label>
              <span class="text-12px text-placeholder">{{ (values[f.key] ?? '').length }} / {{ f.maxLength }}</span>
            </div>
            <textarea
              :id="`wf-field-${f.key}`"
              v-model="values[f.key]"
              rows="4"
              :maxlength="f.maxLength"
              :placeholder="`请输入${f.label}（选填）`"
              :class="[inputCls, 'resize-y leading-20px']"
            />
          </div>
        </template>
      </form>

      <!-- 底部固定提交栏 -->
      <div class="flex-none flex items-center gap-12px pt-10px px-14px pb-12px border-t border-solid border-line-soft">
        <div class="flex flex-1 min-w-0 flex-col gap-2px" aria-live="polite">
          <span class="text-12px text-ink-2">{{ costText }}</span>
          <span v-if="disabledReason" class="text-11px leading-15px text-warning">{{ disabledReason }}</span>
        </div>
        <button
          type="submit"
          form="wf-form"
          class="ll-btn-primary flex-none h-40px px-22px py-0"
          :class="focusRing"
          :disabled="!!disabledReason || submitting"
        >
          {{ submitting ? '提交中…' : schema.submit.label }}
        </button>
      </div>
    </section>

    <!-- 中：历史记录 -->
    <section class="ll-card flex min-h-0 flex-col overflow-hidden" aria-labelledby="wf-history-title">
      <div class="flex-none flex items-center justify-between pt-14px px-14px pb-8px">
        <h2 id="wf-history-title" class="m-0 text-14px font-600 text-ink">历史记录</h2>
        <span v-if="history.running.value" class="ll-chip ll-chip-running">{{ history.running.value }} 个进行中</span>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto px-10px pb-10px">
        <p v-if="!mapped" class="ll-empty m-0 py-24px">即将开放</p>
        <p v-else-if="history.loading.value && !history.items.value.length" class="ll-empty m-0 py-24px">加载中…</p>
        <p v-else-if="!history.items.value.length" class="ll-empty m-0 py-24px px-8px leading-20px">
          还没有记录。左边传好素材、点底部按钮提交，每次提交都会在这里留一条
        </p>
        <ul v-else class="m-0 p-0 list-none flex flex-col gap-6px">
          <li v-for="item in history.items.value" :key="item.workflowHistoryId">
            <button
              type="button"
              class="w-full flex items-center gap-10px p-8px rounded-8px border border-solid text-left cursor-pointer transition-colors"
              :class="[
                focusRing,
                current?.workflowHistoryId === item.workflowHistoryId
                  ? 'border-violet-line bg-violet-soft'
                  : 'border-transparent bg-transparent hover:bg-surface2',
              ]"
              :aria-pressed="current?.workflowHistoryId === item.workflowHistoryId"
              :aria-label="`${formatTime(item.createdAt)} ${statusOf(item.status).text}`"
              @click="selectedId = item.workflowHistoryId"
            >
              <span
                class="flex-none w-44px h-44px overflow-hidden rounded-6px bg-surface3 flex items-center justify-center"
              >
                <img v-if="thumbOf(item)" :src="thumbOf(item)" alt="" class="w-full h-full object-cover" />
                <span v-else class="text-11px text-placeholder">—</span>
              </span>
              <span class="min-w-0 flex-1 flex flex-col gap-4px">
                <span class="ll-chip self-start" :class="statusOf(item.status).cls">{{
                  statusOf(item.status).text
                }}</span>
                <span class="text-11px text-placeholder">{{ formatTime(item.createdAt) }}</span>
              </span>
            </button>
          </li>
        </ul>
      </div>
    </section>

    <!-- 右：结果 + 说明 -->
    <section class="ll-card flex min-h-0 flex-col overflow-hidden" aria-labelledby="wf-result-title">
      <div class="flex-1 min-h-0 overflow-y-auto p-14px flex flex-col gap-14px">
        <div>
          <h2 id="wf-result-title" class="m-0 mb-10px text-14px font-600 text-ink">生成结果</h2>
          <div v-if="mapped && current" class="flex flex-col gap-10px">
            <div class="flex items-center gap-8px">
              <span class="ll-chip" :class="statusOf(current.status).cls">{{ statusOf(current.status).text }}</span>
              <span class="text-12px text-placeholder">{{ formatTime(current.createdAt) }}</span>
            </div>
            <p v-if="!isWorkflowTerminal(current.status)" class="ll-empty m-0 py-24px">
              任务进行中，结果出来后会自动显示
            </p>
            <template v-else>
              <p
                v-if="current.status !== 'SUCCEED' && current.status !== 'PARTIAL_SUCCEED'"
                class="m-0 text-13px text-danger"
                role="status"
              >
                {{ errorOf(current) || '任务未成功，点数已按规则退回' }}
              </p>
              <p v-else-if="current.status === 'PARTIAL_SUCCEED'" class="m-0 text-12px text-warning" role="status">
                部分任务未成功，未成功的点数已按规则退回
              </p>
              <ul class="m-0 p-0 list-none grid gap-10px grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
                <li v-for="(url, i) in outputsOf(current).images" :key="url">
                  <div class="rounded-8px overflow-hidden border border-solid border-line bg-surface3">
                    <img :src="url" :alt="`结果图 ${i + 1}`" class="block w-full max-h-420px object-contain" />
                  </div>
                  <div class="mt-6px flex gap-8px">
                    <button
                      type="button"
                      class="ll-pill"
                      :class="focusRing"
                      @click="downloadOriginal(current, 'images', i)"
                    >
                      下载原图
                    </button>
                    <a :href="url" target="_blank" rel="noopener" class="ll-pill no-underline" :class="focusRing"
                      >放大查看</a
                    >
                  </div>
                </li>
                <li v-for="(url, i) in outputsOf(current).videos" :key="url" class="col-span-full">
                  <video :src="url" controls class="block w-full max-h-480px rounded-8px bg-black" />
                  <button
                    type="button"
                    class="ll-pill mt-6px"
                    :class="focusRing"
                    @click="downloadOriginal(current, 'videos', i)"
                  >
                    下载视频
                  </button>
                </li>
              </ul>
              <p
                v-if="
                  (current.status === 'SUCCEED' || current.status === 'PARTIAL_SUCCEED') &&
                  !outputsOf(current).images.length &&
                  !outputsOf(current).videos.length
                "
                class="ll-empty m-0 py-24px"
              >
                任务已完成，但没有返回产物地址
              </p>
            </template>
          </div>
          <p v-else class="ll-empty m-0 py-32px">{{ mapped ? '提交后，结果会显示在这里' : '即将开放' }}</p>
        </div>

        <!-- 使用说明 -->
        <div class="rounded-10px bg-surface2 p-14px">
          <h3 class="m-0 mb-6px text-13px font-600 text-ink">使用说明</h3>
          <ol class="m-0 pl-18px text-12px leading-20px text-muted">
            <li>依次上传：{{ schema.uploads.map((u) => u.label).join('、') }}</li>
            <li v-if="schema.fields.length">选择{{ schema.fields.map((f) => f.label).join('、') }}</li>
            <li>点击「{{ schema.submit.label }}」，结果在历史记录里查看与下载</li>
          </ol>
          <p class="m-0 mt-8px text-12px text-placeholder">计费：按{{ schema.submit.costUnit }}计费，提交即扣点</p>
          <figure v-if="sampleUrl && !isVideoUrl(sampleUrl)" class="m-0 mt-10px">
            <img
              :src="sampleUrl"
              :alt="`${schema.name}示例效果`"
              class="block max-w-full max-h-240px rounded-8px object-contain"
            />
            <figcaption class="mt-4px text-11px text-placeholder">示例效果</figcaption>
          </figure>
        </div>
      </div>
    </section>
  </div>
</template>
