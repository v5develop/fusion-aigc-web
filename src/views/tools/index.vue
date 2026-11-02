<script setup lang="ts">
/**
 * 工具箱共用工具页 /tools/:toolId（12 个工具按 schemas.ts 渲染）。
 *
 * <p>版式对齐 v1.0 原型 ToolWorkspaceColumns：左操作（上传 + 参数，自己滚，底部固定提交栏）/
 * 中历史 / 右结果 + 功能介绍。左栏 460、内边距 13，正好放下 s1.1 的 B3.1 上传卡 434×742。提交打 Java v1 现有路由（schema.javaRoute），请求体按 schema 的
 * javaKey 映射组装；结果与历史都取 GET /api/v1/tools/{toolTitle}/histories（异步工具只回任务号）。
 */
import { computed, reactive, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useMessage } from 'naive-ui'
import { toApiError } from '@/api/index.ts'
import { upload } from '@/api/ossUpload.ts'
import { submitCutout, submitTool, toolOcr, voiceList, type ToolHistoryItem, type VoiceItem } from '@/api/tools.ts'
import { useUserInfoStore } from '@/stores/userInfo'
import { findToolSchema, isFieldVisible, toJavaValue, type ToolField, type ToolSchema } from './schemas'
import { catalogFor } from './catalog'
import { isTerminal, useToolHistory } from './useToolHistory'
import ToolUploadSlot from './ToolUploadSlot.vue'
import MaskPainter from './MaskPainter.vue'

/** Java 同步抠图「等不及」的专用码（ErrorCode.TASK_PROCESSING） */
const TASK_PROCESSING_CODE = 3010

interface Region {
  targetText: string
  text: string
  include: boolean
  rect: {
    angle: number
    height: number
    left: number
    top: number
    width: number
    pos: { x: number; y: number }[]
  }
}

const route = useRoute()
const message = useMessage()
const userInfo = useUserInfoStore()

const toolId = computed(() => String(route.params.toolId ?? ''))
const schema = computed<ToolSchema | undefined>(() => findToolSchema(toolId.value))
/** 左侧目录（原型「AI 图片」分组栏）；当前工具高亮 */
const catalog = computed(() => catalogFor(toolId.value))

// ---------------- 表单状态 ----------------

const uploads = reactive<Record<number, string[]>>({})
const values = reactive<Record<string, any>>({})
const maskRef = ref<InstanceType<typeof MaskPainter> | null>(null)
const maskHasStroke = ref(false)
const regions = ref<Region[]>([])
const ocrLoading = ref(false)
const voices = ref<VoiceItem[]>([])
const voicesLoaded = ref(false)
const submitting = ref(false)
const progressText = ref('')
/** 同步抠图本次直接拿到的结果 */
const syncResultUrl = ref('')
const selectedId = ref<number | null>(null)

const history = useToolHistory(() => schema.value?.historyTitle ?? '')

/**
 * 业务失败（HTTP 200 + code≠0）请求层已 toast，这里只补请求层不提示的那几类：
 * 传输层失败（超时 / 断网）、无信封的 HTTP 错误、非请求错误（如蒙版生成失败）。
 */
function reportError(err: unknown, fallback = '操作失败，请重试') {
  const apiErr = toApiError(err)
  if (apiErr && apiErr.code !== -1 && !apiErr.httpStatus) return
  if (apiErr?.isNetwork) message.error('网络异常或请求超时，请稍后在历史记录里确认是否已提交')
  else message.error(err instanceof Error && err.message ? err.message : fallback)
}

/** MaskPainter 在 v-for 里渲染，字符串 ref 会变成数组，用函数 ref 取单个实例 */
function setMaskRef(el: unknown) {
  maskRef.value = (el as InstanceType<typeof MaskPainter> | null) ?? null
}

function setUploads(slot: number, urls: string[]) {
  uploads[slot] = urls
}

function clampNumber(f: ToolField) {
  const n = Math.round(Number(values[f.key]))
  const fallback = f.min ?? 1
  values[f.key] = Math.min(f.max ?? Infinity, Math.max(f.min ?? -Infinity, Number.isFinite(n) ? n : fallback))
}

function resetForm(s: ToolSchema) {
  for (const key of Object.keys(uploads)) delete uploads[Number(key)]
  for (const key of Object.keys(values)) delete values[key]
  for (const u of s.uploads) uploads[u.slot] = []
  for (const f of s.fields) if (f.default !== undefined) values[f.key] = f.default
  maskHasStroke.value = false
  regions.value = []
  syncResultUrl.value = ''
  selectedId.value = null
  progressText.value = ''
}

watch(
  schema,
  (s) => {
    history.stop()
    if (!s) return
    resetForm(s)
    history.reload().catch((err) => reportError(err, '历史记录加载失败'))
    if (s.fields.some((f) => f.type === 'voice') && !voicesLoaded.value) {
      loadVoices().catch((err) => reportError(err, '音色列表加载失败'))
    }
  },
  { immediate: true },
)

const visibleFields = computed(() => (schema.value?.fields ?? []).filter((f) => isFieldVisible(f, values)))
/** 上传槽位的显示顺序：s1.1 产品替换「替换素材」在上、底图片格在下（只换显示顺序，校验与提交仍按 schema 顺序） */
const displayUploads = computed(() =>
  [...(schema.value?.uploads ?? [])].sort((a, b) => Number(b.layout === 'material') - Number(a.layout === 'material')),
)
const singleImage = computed(() => uploads[0]?.[0] ?? '')

// 换图后蒙版与识别结果都作废
watch(singleImage, () => {
  regions.value = []
})

// ---------------- 音色 ----------------

async function loadVoices() {
  const res = await voiceList()
  voices.value = res.data?.data ?? []
  voicesLoaded.value = true
  if (!values.voice && voices.value[0]) values.voice = voices.value[0].voiceId
}

const selectedVoice = computed(() => voices.value.find((v) => v.voiceId === values.voice))

/** 音色 meta 结构未定（待联调）：只认里面形如音频地址的字符串作为试听源 */
const auditionUrl = computed(() => {
  const meta = selectedVoice.value?.meta
  if (!meta || typeof meta !== 'object') return ''
  const hit = Object.values(meta as Record<string, unknown>).find(
    (v) => typeof v === 'string' && /^https?:\/\/.+\.(mp3|wav|m4a|aac|ogg)(\?|$)/i.test(v),
  )
  return (hit as string) ?? ''
})

let audio: HTMLAudioElement | null = null
function playAudition() {
  if (!auditionUrl.value) return
  audio?.pause()
  audio = new Audio(auditionUrl.value)
  void audio.play().catch(() => message.error('试听播放失败'))
}

// ---------------- 文字识别（文字替换） ----------------

async function runOcr() {
  if (!singleImage.value || ocrLoading.value) return
  ocrLoading.value = true
  try {
    const res = await toolOcr(singleImage.value)
    const list = res.data?.Results ?? []
    regions.value = list
      .filter((r) => r.Text && r.TextRectangles?.Pos?.length === 4)
      .map((r) => {
        const t = r.TextRectangles!
        return {
          targetText: r.Text!,
          text: r.Text!,
          include: true,
          rect: {
            angle: t.Angle ?? 0,
            height: Math.round(t.Height ?? 0),
            left: Math.round(t.Left ?? 0),
            top: Math.round(t.Top ?? 0),
            width: Math.round(t.Width ?? 0),
            pos: t.Pos!.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
          },
        }
      })
    if (!regions.value.length) message.warning('没有识别到可替换的文字')
  } catch (err) {
    reportError(err, '文字识别失败')
  } finally {
    ocrLoading.value = false
  }
}

// 文字替换：原图上传后自动识别（复用 runOcr / toolOcr，无需点按钮）
const hasRegionField = computed(() => !!schema.value?.fields.some((f) => f.type === 'region-list'))
watch(singleImage, (url) => {
  if (url && hasRegionField.value) void runOcr()
})

// ---------------- 就绪判定 ----------------

const disabledReason = computed(() => {
  const s = schema.value
  if (!s) return ''
  for (const u of s.uploads) {
    if (u.required && !uploads[u.slot]?.length) return `还没上传${u.label.replace(/（.*）/, '')}`
  }
  for (const f of visibleFields.value) {
    if (!f.required || f.uiOnly) continue
    if (f.type === 'mask') {
      if (!maskHasStroke.value) return '请先涂抹要消除的区域'
      continue
    }
    if (f.type === 'region-list') {
      if (!regions.value.length) return '请先识别图片中的文字'
      if (!regions.value.some((r) => r.include && r.text.trim())) return '至少保留一条要替换的文字'
      continue
    }
    if (f.type === 'voice') {
      if (!selectedVoice.value) return voicesLoaded.value && !voices.value.length ? '暂无可用音色' : '请选择配音音色'
      continue
    }
    const v = values[f.key]
    if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) return `请填写${f.label}`
  }
  return ''
})

/** 本次会拆成几次提交（单值键多张 = 逐张提交） */
const fanOutCount = computed(() => {
  const s = schema.value
  if (!s) return 0
  const fan = s.uploads.find((u) => u.javaKey !== 'imageUrls' && u.max > 1)
  return fan ? Math.max(uploads[fan.slot]?.length ?? 0, 1) : 1
})

const costText = computed(() => {
  const s = schema.value
  if (!s) return ''
  const unit = `按${s.submit.costUnit}计费，提交即扣点`
  return fanOutCount.value > 1 ? `将提交 ${fanOutCount.value} 个任务 · ${unit}` : unit
})

// ---------------- 组装请求体 ----------------

function fieldEntries(f: ToolField): [string, unknown][] {
  if (f.uiOnly) return []
  if (f.type === 'region-list') {
    const info = regions.value
      .filter((r) => r.include && r.text.trim())
      .map((r) => ({ targetText: r.targetText, text: r.text.trim(), textRectangles: r.rect }))
    return [['textInformation', info]]
  }
  if (f.type === 'voice') {
    const v = selectedVoice.value
    return v
      ? [
          ['voiceModel', v.model],
          ['voiceKey', v.voiceKey],
        ]
      : []
  }
  if (f.type === 'mask') return [] // 提交时先上传蒙版再填 maskUrl
  const value = toJavaValue(f, values[f.key])
  return value === undefined || typeof f.javaKey !== 'string' ? [] : [[f.javaKey, value]]
}

async function buildBodies(s: ToolSchema): Promise<Record<string, unknown>[]> {
  const base: Record<string, unknown> = {}
  for (const f of visibleFields.value) for (const [k, v] of fieldEntries(f)) base[k] = v

  if (s.fields.some((f) => f.type === 'mask')) {
    const file = await maskRef.value?.exportMask()
    if (!file) throw new Error('蒙版生成失败，请重新涂抹')
    const [maskUrl] = await upload([file], undefined, { compress: false })
    base.maskUrl = maskUrl
  }

  let fan: { key: string; urls: string[] } | null = null
  for (const u of s.uploads) {
    const urls = uploads[u.slot] ?? []
    if (!urls.length) continue
    if (u.javaKey === 'imageUrls') base.imageUrls = [...urls]
    else if (u.max > 1) fan = { key: u.javaKey, urls }
    else base[u.javaKey] = urls[0]
  }
  return fan ? fan.urls.map((url) => ({ ...base, [fan!.key]: url })) : [base]
}

// ---------------- 提交 ----------------

async function onSubmit() {
  const s = schema.value
  if (!s || submitting.value || disabledReason.value) return
  submitting.value = true
  progressText.value = ''
  let done = 0
  let total = 0
  try {
    if (s.sync) {
      await submitSync()
      return
    }
    const bodies = await buildBodies(s)
    total = bodies.length
    for (const body of bodies) {
      if (total > 1) progressText.value = `正在提交 ${done + 1} / ${total}`
      await submitTool(s.javaRoute, body)
      done += 1
    }
  } catch (err) {
    reportError(err, '提交失败，请重试')
  } finally {
    submitting.value = false
    progressText.value = ''
    if (done > 0) {
      message.success(done === total ? `已提交 ${done} 个任务` : `已提交 ${done} / ${total} 个任务，其余未提交`)
    }
    if (!s.sync) {
      // 失败也刷新一次：超时 / 断网时任务可能已在服务端创建
      selectedId.value = null
      void userInfo.updateUserInfo()
      history.afterSubmit().catch((err) => reportError(err, '历史记录刷新失败'))
    }
  }
}

/** 同步抠图：成功直接出图；3010 = 任务仍在跑（拦截器已提示），结果会出现在历史里 */
async function submitSync() {
  syncResultUrl.value = ''
  try {
    const res = await submitCutout(singleImage.value)
    syncResultUrl.value = res.data?.url ?? ''
  } catch (err) {
    if (toApiError(err)?.code !== TASK_PROCESSING_CODE) throw err
  } finally {
    selectedId.value = null
    void userInfo.updateUserInfo()
    history.afterSubmit().catch((err) => reportError(err, '历史记录刷新失败'))
  }
}

// ---------------- 历史与结果 ----------------

const current = computed<ToolHistoryItem | null>(
  () => history.items.value.find((i) => i.aiToolHistoryId === selectedId.value) ?? history.items.value[0] ?? null,
)

const isVideoUrl = (u: string) => /\.(mp4|webm|mov)(\?|#|$)/i.test(u)

function outputsOf(item: ToolHistoryItem) {
  const images = [...(item.resultImageUrls ?? [])]
  const videos = [...(item.resultVideoUrls ?? [])]
  const url = item.result?.url
  if (url && !images.includes(url) && !videos.includes(url)) (isVideoUrl(url) ? videos : images).push(url)
  return { images, videos }
}

function thumbOf(item: ToolHistoryItem) {
  const out = outputsOf(item)
  return out.images[0] ?? item.inputImageUrls?.[0] ?? item.payload?.imageUrls?.[0] ?? ''
}

const STATUS: Record<string, { text: string; cls: string }> = {
  PENDING: { text: '排队中', cls: 'll-chip-running' },
  RUNNING: { text: '生成中', cls: 'll-chip-running' },
  WAITING_MANUAL_PROCESS: { text: '处理中', cls: 'll-chip-running' },
  SUCCEED: { text: '已完成', cls: 'll-chip-success' },
  FAILED: { text: '失败', cls: 'll-chip-error' },
  TIMEOUT: { text: '超时', cls: 'll-chip-error' },
  CANCELLED: { text: '已取消', cls: 'll-chip-warning' },
}
const statusOf = (s: string) => STATUS[s] ?? { text: s || '未知', cls: 'll-chip-warning' }

function formatTime(v?: string | null) {
  if (!v) return ''
  return v.replace('T', ' ').slice(0, 16)
}

const focusRing = 'outline-none focus-visible:(outline-2 outline-solid outline-violet outline-offset-2)'
const inputCls =
  'w-full box-border rounded-6px border border-solid border-line-strong bg-white px-10px py-7px text-13px text-ink ' +
  'focus:(border-violet outline-none shadow-[0_0_0_2px_rgba(135,95,154,0.18)])'
</script>

<template>
  <div v-if="!schema" class="h-full flex flex-col items-center justify-center gap-12px bg-page">
    <p class="m-0 text-15px text-ink">没有找到这个工具</p>
    <RouterLink to="/" class="ll-link" :class="focusRing">返回工具箱</RouterLink>
  </div>

  <div v-else class="grid h-full min-h-0 gap-12px p-12px bg-page grid-cols-[152px_460px_260px_minmax(0,1fr)]">
    <!-- 目录：原型左栏，按分组列出工具；没有页面的条目显示「即将开放」 -->
    <nav class="ll-card flex min-h-0 flex-col overflow-hidden" aria-labelledby="tool-catalog-title">
      <h2 id="tool-catalog-title" class="flex-none m-0 pt-14px px-12px pb-6px text-15px font-600 text-ink">
        {{ catalog.title }}
      </h2>
      <div class="flex-1 min-h-0 overflow-y-auto px-6px pb-10px">
        <section
          v-for="(g, gi) in catalog.groups"
          :key="g.label"
          :class="gi ? 'mt-8px pt-8px border-t border-solid border-line-soft' : ''"
          :aria-labelledby="`tool-catalog-group-${gi}`"
        >
          <h3 :id="`tool-catalog-group-${gi}`" class="m-0 px-6px py-6px text-12px font-500 text-muted">
            {{ g.label }}
          </h3>
          <ul class="m-0 p-0 list-none flex flex-col gap-2px">
            <li v-for="e in g.entries" :key="e.id">
              <component
                :is="e.route ? RouterLink : 'div'"
                v-bind="
                  e.route
                    ? { to: e.route, 'aria-current': e.id === toolId ? 'page' : undefined }
                    : { 'aria-disabled': 'true' }
                "
                :aria-label="e.route ? `${e.name}，${e.tagline}` : `${e.name}（即将开放）`"
                class="flex items-center gap-8px px-6px py-5px rounded-8px border border-solid no-underline transition-colors"
                :class="[
                  e.route ? focusRing : 'cursor-not-allowed',
                  e.id === toolId
                    ? 'border-line-strong bg-surface3'
                    : e.route
                      ? 'border-transparent hover:bg-surface2'
                      : 'border-transparent',
                ]"
              >
                <span
                  class="flex-none grid place-items-center w-30px h-30px rounded-6px bg-violet-soft text-violet-ink"
                  :class="e.route ? '' : 'opacity-60'"
                  aria-hidden="true"
                >
                  <svg
                    v-if="e.icon"
                    class="w-16px h-16px"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    :innerHTML="e.icon"
                  />
                </span>
                <span class="min-w-0 flex flex-col gap-1px">
                  <span class="truncate text-13px font-500 leading-18px" :class="e.route ? 'text-ink' : 'text-muted'">
                    {{ e.name }}
                  </span>
                  <span class="truncate text-11px leading-15px text-placeholder">
                    {{ e.route ? e.tagline : '即将开放' }}
                  </span>
                </span>
              </component>
            </li>
          </ul>
        </section>
      </div>
    </nav>

    <!-- 左：操作区 -->
    <section class="ll-card flex min-h-0 flex-col overflow-hidden" aria-labelledby="tool-title">
      <div class="flex-none pt-14px px-14px pb-4px">
        <h1 id="tool-title" class="m-0 text-15px font-600 text-ink">{{ schema.title }}</h1>
      </div>
      <form
        id="tool-form"
        class="flex-1 min-h-0 overflow-y-auto pt-6px px-13px pb-14px flex flex-col gap-16px [scrollbar-gutter:stable]"
        @submit.prevent="onSubmit"
      >
        <ToolUploadSlot
          v-for="u in displayUploads"
          :id="`tool-upload-${u.slot}`"
          :key="`${schema.homeId}-${u.slot}`"
          :model-value="uploads[u.slot] ?? []"
          :spec="u"
          :layout="u.layout"
          :disabled="submitting"
          asset-picker
          @update:model-value="setUploads(u.slot, $event)"
        />

        <template v-for="f in visibleFields" :key="`${schema.homeId}-${f.key}`">
          <!-- 涂抹蒙版 -->
          <div v-if="f.type === 'mask'">
            <div class="ll-label">
              <span>{{ f.label }}<span class="text-danger" aria-hidden="true"> *</span></span>
            </div>
            <MaskPainter v-if="singleImage" :ref="setMaskRef" :src="singleImage" @change="maskHasStroke = $event" />
            <p v-else class="m-0 ll-empty py-12px">先上传原图，再在图上涂抹要消除的区域</p>
          </div>

          <!-- 识别结果（文字替换） -->
          <div v-else-if="f.type === 'region-list'">
            <div class="ll-label">
              <span id="tool-regions-label">{{ f.label }}<span class="text-danger" aria-hidden="true"> *</span></span>
              <button
                type="button"
                class="ll-pill"
                :class="focusRing"
                :disabled="!singleImage || ocrLoading || submitting"
                @click="runOcr"
              >
                {{ ocrLoading ? '识别中…' : regions.length ? '重新识别' : '识别文字' }}
              </button>
            </div>
            <ul
              v-if="ocrLoading"
              class="m-0 p-0 list-none flex flex-col gap-8px"
              role="status"
              aria-live="polite"
              aria-label="识别中…"
            >
              <li
                v-for="n in 4"
                :key="n"
                class="tool-skeleton-row h-70px box-border rounded-8px bg-surface2"
                aria-hidden="true"
              />
            </ul>
            <p v-else-if="!regions.length" class="m-0 ll-empty py-12px">
              {{ singleImage ? '点击「识别文字」，识别结果会列在这里（识别单独计费）' : '先上传原图' }}
            </p>
            <ul v-else class="m-0 p-0 list-none flex flex-col gap-8px" aria-labelledby="tool-regions-label">
              <li v-for="(r, i) in regions" :key="i" class="rounded-8px border border-solid border-line p-8px">
                <label class="flex items-center gap-6px text-12px text-muted">
                  <input v-model="r.include" type="checkbox" class="accent-violet" />
                  <span class="truncate">原文：{{ r.targetText }}</span>
                </label>
                <input
                  v-model="r.text"
                  type="text"
                  :maxlength="f.maxLength"
                  :disabled="!r.include"
                  :aria-label="`替换「${r.targetText}」为`"
                  :class="[inputCls, 'mt-6px']"
                />
              </li>
            </ul>
          </div>

          <!-- 配音音色 -->
          <div v-else-if="f.type === 'voice'">
            <div class="ll-label">
              <label :for="`tool-field-${f.key}`"
                >{{ f.label }}<span class="text-danger" aria-hidden="true"> *</span></label
              >
              <button
                v-if="schema.actions.includes('试听') && auditionUrl"
                type="button"
                class="ll-link border-none bg-transparent p-0"
                :class="focusRing"
                @click="playAudition"
              >
                试听
              </button>
            </div>
            <select :id="`tool-field-${f.key}`" v-model="values[f.key]" :class="inputCls" :disabled="!voices.length">
              <option v-if="!voices.length" :value="undefined">{{ voicesLoaded ? '暂无可用音色' : '加载中…' }}</option>
              <option v-for="v in voices" :key="v.voiceId" :value="v.voiceId">{{ v.voiceName }}</option>
            </select>
          </div>

          <!-- 胶囊单选 -->
          <div v-else-if="f.type === 'chips'">
            <div :id="`tool-field-${f.key}-label`" class="ll-label">
              <span>{{ f.label }}<span v-if="f.required" class="text-danger" aria-hidden="true"> *</span></span>
            </div>
            <div role="radiogroup" :aria-labelledby="`tool-field-${f.key}-label`" class="flex flex-wrap gap-6px">
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

          <!-- 下拉 -->
          <div v-else-if="f.type === 'select'">
            <div class="ll-label">
              <label :for="`tool-field-${f.key}`">
                {{ f.label }}<span v-if="f.required" class="text-danger" aria-hidden="true"> *</span>
              </label>
            </div>
            <select :id="`tool-field-${f.key}`" v-model="values[f.key]" :class="inputCls">
              <option v-for="opt in f.options" :key="opt" :value="opt">{{ opt }}</option>
            </select>
          </div>

          <!-- 多行文本 -->
          <div v-else-if="f.type === 'textarea'">
            <div class="ll-label">
              <label :for="`tool-field-${f.key}`">
                {{ f.label }}<span v-if="f.required" class="text-danger" aria-hidden="true"> *</span>
              </label>
              <span class="text-12px text-placeholder">{{ (values[f.key] ?? '').length }} / {{ f.maxLength }}</span>
            </div>
            <textarea
              :id="`tool-field-${f.key}`"
              v-model="values[f.key]"
              rows="5"
              :maxlength="f.maxLength"
              :placeholder="`请输入${f.label}`"
              :class="[inputCls, 'resize-y leading-20px']"
            />
          </div>

          <!-- 数字 / 张数 -->
          <div v-else-if="f.type === 'number' || f.type === 'stepper'">
            <div class="ll-label">
              <label :for="`tool-field-${f.key}`">
                {{ f.label }}<span v-if="f.required" class="text-danger" aria-hidden="true"> *</span>
              </label>
              <span class="text-12px text-placeholder">{{ f.min }}–{{ f.max }}</span>
            </div>
            <input
              :id="`tool-field-${f.key}`"
              v-model.number="values[f.key]"
              type="number"
              :min="f.min"
              :max="f.max"
              step="1"
              :class="inputCls"
              @change="clampNumber(f)"
            />
          </div>

          <!-- 开关 -->
          <div v-else-if="f.type === 'switch'" class="flex items-center justify-between">
            <span :id="`tool-field-${f.key}-label`" class="text-13px text-ink-2">{{ f.label }}</span>
            <button
              type="button"
              role="switch"
              :aria-checked="!!values[f.key]"
              :aria-labelledby="`tool-field-${f.key}-label`"
              class="relative w-36px h-20px rounded-full border-none cursor-pointer transition-colors"
              :class="[focusRing, values[f.key] ? 'bg-violet' : 'bg-line-strong']"
              @click="values[f.key] = !values[f.key]"
            >
              <span
                class="absolute top-2px w-16px h-16px rounded-full bg-white shadow transition-all"
                :class="values[f.key] ? 'left-18px' : 'left-2px'"
                aria-hidden="true"
              />
            </button>
          </div>
        </template>
      </form>

      <!-- 底部固定提交栏 -->
      <!-- 原型：整宽主按钮，第二行写消耗；还不能提交的原因留在按钮上方一行小字 -->
      <div class="flex-none flex flex-col gap-6px pt-10px px-13px pb-12px border-t border-solid border-line-soft">
        <p
          v-if="disabledReason"
          id="tool-submit-reason"
          class="m-0 text-11px leading-15px text-warning text-center"
          aria-live="polite"
        >
          {{ disabledReason }}
        </p>
        <button
          type="submit"
          form="tool-form"
          class="ll-btn-primary w-full h-56px py-0 px-16px flex-col !gap-2px !rounded-10px"
          :class="focusRing"
          :disabled="!!disabledReason || submitting"
          :aria-describedby="disabledReason ? 'tool-submit-reason' : undefined"
        >
          <span class="text-15px font-600 leading-20px">{{ submitting ? '提交中…' : schema.submit.label }}</span>
          <span class="text-11px font-400 leading-15px opacity-85" aria-live="polite">{{
            progressText || costText
          }}</span>
        </button>
      </div>
    </section>

    <!-- 中：历史记录 -->
    <section class="ll-card flex min-h-0 flex-col overflow-hidden" aria-labelledby="tool-history-title">
      <div class="flex-none flex items-center justify-between pt-14px px-14px pb-8px">
        <h2 id="tool-history-title" class="m-0 text-14px font-600 text-ink">历史记录</h2>
        <span class="flex items-center gap-6px">
          <span v-if="history.running.value" class="text-11px text-violet-ink"
            >{{ history.running.value }} 个进行中</span
          >
          <span class="text-12px text-placeholder">{{ history.total.value || history.items.value.length }} 条</span>
        </span>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto px-10px pb-10px">
        <p v-if="history.loading.value && !history.items.value.length" class="ll-empty m-0 py-24px">加载中…</p>
        <p v-else-if="!history.items.value.length" class="ll-empty m-0 py-24px px-8px leading-20px">
          还没有记录。左边传好素材、点底部按钮提交，每次提交都会在这里留一条
        </p>
        <ul v-else class="m-0 p-0 list-none flex flex-col gap-6px">
          <li v-for="item in history.items.value" :key="item.aiToolHistoryId">
            <button
              type="button"
              class="w-full flex items-center gap-10px p-8px rounded-8px border border-solid text-left cursor-pointer transition-colors"
              :class="[
                focusRing,
                current?.aiToolHistoryId === item.aiToolHistoryId
                  ? 'border-violet-line bg-violet-soft'
                  : 'border-transparent bg-transparent hover:bg-surface2',
              ]"
              :aria-pressed="current?.aiToolHistoryId === item.aiToolHistoryId"
              :aria-label="`${formatTime(item.createdAt)} ${statusOf(item.status).text}`"
              @click="selectedId = item.aiToolHistoryId"
            >
              <span
                class="flex-none w-44px h-44px overflow-hidden rounded-6px bg-surface3 flex items-center justify-center"
              >
                <img v-if="thumbOf(item)" :src="thumbOf(item)" alt="" class="w-full h-full object-cover" />
                <span v-else class="text-11px text-placeholder">{{ schema.media === 'video' ? '视频' : '—' }}</span>
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

    <!-- 右：结果 + 功能介绍 -->
    <section class="ll-card flex min-h-0 flex-col overflow-hidden" aria-labelledby="tool-result-title">
      <div class="flex-1 min-h-0 overflow-y-auto p-14px flex flex-col gap-14px">
        <div>
          <h2 id="tool-result-title" class="m-0 mb-10px text-14px font-600 text-ink">生成结果</h2>

          <!-- 同步抠图本次直接拿到的结果 -->
          <div v-if="syncResultUrl" class="mb-12px">
            <div
              class="rounded-8px overflow-hidden border border-solid border-line bg-[repeating-conic-gradient(#eff1f3_0_25%,#fff_0_50%)] bg-[length:16px_16px]"
            >
              <img
                :src="syncResultUrl"
                alt="本次抠图结果"
                class="block max-w-full max-h-480px mx-auto object-contain"
              />
            </div>
            <div class="mt-8px flex gap-8px">
              <a
                :href="syncResultUrl"
                target="_blank"
                rel="noopener"
                download
                class="ll-pill no-underline"
                :class="focusRing"
                >下载结果</a
              >
              <a :href="syncResultUrl" target="_blank" rel="noopener" class="ll-pill no-underline" :class="focusRing"
                >放大查看抠图结果</a
              >
            </div>
          </div>

          <div v-if="current" class="flex flex-col gap-10px">
            <div class="flex items-center gap-8px">
              <span class="ll-chip" :class="statusOf(current.status).cls">{{ statusOf(current.status).text }}</span>
              <span class="text-12px text-placeholder">{{ formatTime(current.createdAt) }}</span>
            </div>
            <p v-if="!isTerminal(current.status)" class="ll-empty m-0 py-24px">任务进行中，结果出来后会自动显示</p>
            <p v-else-if="current.status !== 'SUCCEED'" class="m-0 text-13px text-danger" role="status">
              {{ current.errorMessage || '任务未成功，点数已按规则退回' }}
            </p>
            <template v-else>
              <ul class="m-0 p-0 list-none grid gap-10px grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
                <li v-for="(url, i) in outputsOf(current).images" :key="url">
                  <div class="rounded-8px overflow-hidden border border-solid border-line bg-surface3">
                    <img :src="url" :alt="`结果图 ${i + 1}`" class="block w-full max-h-420px object-contain" />
                  </div>
                  <div class="mt-6px flex gap-8px">
                    <a
                      :href="url"
                      target="_blank"
                      rel="noopener"
                      download
                      class="ll-pill no-underline"
                      :class="focusRing"
                      >下载结果</a
                    >
                    <a :href="url" target="_blank" rel="noopener" class="ll-pill no-underline" :class="focusRing"
                      >放大查看</a
                    >
                  </div>
                </li>
                <li v-for="url in outputsOf(current).videos" :key="url" class="col-span-full">
                  <video :src="url" controls class="block w-full max-h-480px rounded-8px bg-black" />
                  <a
                    :href="url"
                    target="_blank"
                    rel="noopener"
                    download
                    class="ll-pill no-underline mt-6px"
                    :class="focusRing"
                    >下载视频</a
                  >
                </li>
              </ul>
              <p
                v-if="!outputsOf(current).images.length && !outputsOf(current).videos.length"
                class="ll-empty m-0 py-24px"
              >
                任务已完成，但没有返回产物地址
              </p>
            </template>
          </div>
          <p v-else-if="!syncResultUrl" class="ll-empty m-0 py-32px">提交后，结果会显示在这里</p>
        </div>

        <!-- 功能介绍 -->
        <div class="rounded-10px bg-surface2 p-14px">
          <h3 class="m-0 mb-6px text-13px font-600 text-ink">功能介绍</h3>
          <p class="m-0 text-13px leading-20px text-ink-2">{{ schema.description }}</p>
          <ol class="m-0 mt-8px pl-18px text-12px leading-20px text-muted">
            <li v-for="step in schema.steps" :key="step">{{ step }}</li>
          </ol>
          <p class="m-0 mt-8px text-12px text-placeholder">计费：按{{ schema.submit.costUnit }}计费，提交即扣点</p>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* 骨架呼吸：UnoCSS 原子类只能引用动画名，关键帧本身写不成原子类，故此处是唯一允许的 CSS；1.2s 循环，仅动透明度，不改尺寸 */
@keyframes tool-skeleton-breathe {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
  }
}

.tool-skeleton-row {
  animation: tool-skeleton-breathe 1.2s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .tool-skeleton-row {
    animation: none;
  }
}
</style>
