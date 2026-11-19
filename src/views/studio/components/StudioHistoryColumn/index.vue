<script setup lang="ts">
/**
 * 三栏工作台 · 中列历史列表（批次卡片，对齐原型 StudioHistoryColumn ml 卡片）。
 *
 * <p>卡片：左 44 叠放缩略（优先提交时的输入图，没有再用结果图，最多叠 3 张，右上角标总张数；悬停看大图、点击开灯箱，
 * 灯箱优先放结果图）→ 右侧第一行提示词（没有就用「功能 · N 张」），张数 / 成功 / 失败 / 点数放在悬停提示里；
 * 失败 / 部分成功 / 已取消时第二行给状态与原因；底行时间（今天 HH:mm，其它天 MM-DD，完整时间在悬停提示）+ 下载 / 删除 / 重新编辑。
 * 进行中的批次显示骨架 + 进度条与百分比（任务 progress 均值，终态任务按 100 算），右侧保留「取消批次」。
 * 点击卡片选中批次交给右列预览；顶部「搜索提示词」按已加载批次本地过滤，底部翻页每页 8 条（原型 ML_PAGE_SIZE）；
 * 翻到最后一页且后端还有游标时「下一页」先拉下一批，列表末尾保留「加载更多」/「没有更多了」。
 * 在跑批次由 useStudioHistory 自动轮询。
 */
import { computed, ref, watch } from 'vue'
import { NPopover, useMessage } from 'naive-ui'
import IconButton from '@/components/IconButton/index.vue'
import MediaLightbox from '@/components/MediaLightbox/index.vue'
import CreationHistoryHeader from '@/components/Creation/CreationHistoryHeader.vue'
import { studioCancelBatch, studioDeleteBatch } from '@/api/studio.ts'
import type { StudioBatchDetail } from '@/api/studio-types.ts'
import { canSaveAsJpg, downloadImagesAsZip } from '@/utils/download.ts'
import { saveImagesAsJpg } from '@/utils/batchDownload.ts'
import type { useStudioHistory } from '../../hooks.ts'
import { parseStudioPayload } from '../../payload.ts'
import { KIND_LABEL, batchChip, batchProgress, formatTime, isBatchTerminal, isTransientResult } from '../../constants.ts'
import DotWave from '@/components/DotWave.vue'
import HistoryActionRow from '@/components/HistoryActionRow/index.vue'
import { formatFullTime, formatShortTime } from '@/utils/time.ts'
import { ossResize, thumbFallback } from '@/utils/oss'

const props = defineProps<{
  /** useStudioHistory 实例（游标分页 + 在跑批次轮询） */
  history: ReturnType<typeof useStudioHistory>
  /** 当前选中的批次 id（右列在预览的那条） */
  selectedId: number | null
}>()

const emit = defineEmits<{
  select: [detail: StudioBatchDetail]
  /** 重新编辑：payload 已 JSON.parse，回填由页面负责 */
  reedit: [payload: Record<string, unknown>, detail: StudioBatchDetail]
}>()

const message = useMessage()
const ctl = props.history

/** 头部「N 个进行中」 */
const runningCount = computed(() => ctl.items.value.filter((d) => !isBatchTerminal(d.batch.status)).length)

// ---------------- 操作 ----------------

const acting = ref(false)

async function cancelBatch(d: StudioBatchDetail) {
  if (acting.value) return
  acting.value = true
  try {
    const res = await studioCancelBatch(d.batch.id)
    message.success(`已取消 ${res.data?.canceledTasks ?? 0} 个未开始任务，点数原路退回`)
    await ctl.refresh()
  } finally {
    acting.value = false
  }
}

async function removeBatch(d: StudioBatchDetail) {
  await studioDeleteBatch(d.batch.id)
  message.success('已删除这条记录')
  ctl.drop(d.batch.id)
  await ctl.refresh()
}

/** 下载：多张打包成 zip，一张直接下（跨域抓不到时 util 自己降级成逐张 / 新标签页） */
const downloading = ref<number | null>(null)
async function download(d: StudioBatchDetail) {
  const urls = resultsOf(d)
  if (!urls.length || downloading.value !== null) return
  downloading.value = d.batch.id
  try {
    const t = formatTime(d.batch.createdAt).replace(/[\s:]/g, '-')
    await downloadImagesAsZip(urls, `${KIND_LABEL[d.batch.kind] ?? '商拍'}_${t || d.batch.id}`)
  } finally {
    downloading.value = null
  }
}

/** 全部另存为 JPG：与「下载」同一份结果、同一个包名（后缀 _JPG）；多张才出，单张用详情里的单图入口 */
const savingJpg = ref<number | null>(null)
const jpgCount = (d: StudioBatchDetail) => resultsOf(d).filter((u) => canSaveAsJpg(u)).length
async function saveAllJpg(d: StudioBatchDetail) {
  const urls = resultsOf(d)
  if (!urls.length || savingJpg.value !== null) return
  savingJpg.value = d.batch.id
  try {
    const t = formatTime(d.batch.createdAt).replace(/[\s:]/g, '-')
    const base = `${KIND_LABEL[d.batch.kind] ?? '商拍'}_${t || d.batch.id}`
    await saveImagesAsJpg(urls.map((src) => ({ src, name: base })), { zipName: base })
  } finally {
    savingJpg.value = null
  }
}

// ---------------- 卡片内容 ----------------

/** 提交快照（payload JSON）；解析失败按空对象 */
function payloadOf(d: StudioBatchDetail): Record<string, unknown> {
  return parseStudioPayload(d.batch.payload)
}
const strList = (v: unknown) =>
  (Array.isArray(v) ? v : []).filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u))

/** 提交时的输入图：换装 = 服装图 + 模特图；姿态 = 人物图 + 姿势图；图片生成 = 参考图 */
function inputsOf(d: StudioBatchDetail): string[] {
  const p = payloadOf(d)
  if (d.batch.kind === 'tryon') {
    const garments = (Array.isArray(p.garmentImages) ? p.garmentImages : []).map(
      (g) => (g as { url?: unknown } | null)?.url,
    )
    return [...strList(garments), ...strList(p.modelImageUrls)]
  }
  if (d.batch.kind === 'pose') return [...strList([p.sourceImageUrl]), ...strList(p.poseImageUrls)]
  return strList(p.imageUrls)
}
/** 已出的结果图（成功任务，按任务顺序） */
const resultsOf = (d: StudioBatchDetail) => d.tasks.filter((t) => t.status === 2 && t.resultUrl).map((t) => t.resultUrl)

/** 左侧叠放图：优先输入图（用户传的），没有再看结果图 / 封面；最多 3 张 */
function stackOf(d: StudioBatchDetail) {
  const inputs = inputsOf(d)
  if (inputs.length) return inputs.slice(0, 3)
  const results = resultsOf(d)
  if (results.length) return results.slice(0, 3)
  return d.batch.coverUrl ? [d.batch.coverUrl] : []
}
/**
 * 缩略图加载失败且是某张成品的短期签名地址（入库中 / 未能入库 / 免费档，10 分钟过期）：现签一次那张
 * （同一地址只补一次，见 useStudioHistory.refreshTask）；输入图 / 封面不处理
 */
function onStackError(d: StudioBatchDetail, url: string | undefined) {
  const task = url ? d.tasks.find((t) => t.resultUrl === url) : undefined
  if (task && isTransientResult(task)) void ctl.refreshTask(task.taskId, url)
}
function stackCount(d: StudioBatchDetail) {
  return inputsOf(d).length || resultsOf(d).length || (d.batch.coverUrl ? 1 : 0)
}

/** 卡片第一行：提示词（换装 prompt / 姿态 global_prompt / 图片生成 prompt），没有就用「功能 · N 张」 */
function promptOf(d: StudioBatchDetail) {
  const p = payloadOf(d)
  const text = [p.prompt, p.globalPrompt].find((v) => typeof v === 'string' && v.trim())
  return typeof text === 'string' ? text.trim() : `${KIND_LABEL[d.batch.kind] ?? '批次'} · ${d.batch.taskTotal} 张`
}
/** 悬停提示：完整提示词 + 统计 */
function statsOf(d: StudioBatchDetail) {
  const b = d.batch
  return `${KIND_LABEL[b.kind] ?? b.kind} · ${b.taskTotal} 张 · 成功 ${b.taskDone} · 失败 ${b.taskFailed} · ${b.estimatedPoints} 点`
}

/** 进行中进度：任务 progress 均值（成功 / 失败 / 取消按 100）；没有任务明细时按完成数估 */
function progressOf(d: StudioBatchDetail) {
  if (!d.tasks.length) return batchProgress(d.batch)
  const sum = d.tasks.reduce((acc, t) => acc + ([2, 3, 4].includes(t.status) ? 100 : Math.max(0, t.progress || 0)), 0)
  return Math.max(0, Math.min(100, Math.round(sum / d.tasks.length)))
}

// ---------------- 灯箱 ----------------

const lightboxShow = ref(false)
const lightboxIndex = ref(0)
/** 与 MediaLightbox 的 items 同形 */
const lightboxItems = ref<{ url: string; type?: 'image' | 'video'; name?: string }[]>([])
/** 灯箱条目：优先结果图；没有结果就放输入图 */
function openLightbox(d: StudioBatchDetail) {
  const results = resultsOf(d)
  const urls = results.length ? results : inputsOf(d)
  if (!urls.length) return
  const word = results.length ? '结果' : '输入图'
  lightboxItems.value = urls.map((url, i) => ({
    url,
    type: 'image',
    name: `${KIND_LABEL[d.batch.kind] ?? ''}${word}-${i + 1}`,
  }))
  lightboxIndex.value = 0
  lightboxShow.value = true
}

function reedit(d: StudioBatchDetail) {
  const payload = parseStudioPayload(d.batch.payload)
  if (!d.batch.payload || !Object.keys(payload).length) {
    message.error('该记录没有可回填的参数')
    return
  }
  emit('reedit', payload, d)
}

// ---------------- 搜索 + 翻页（原型 .v3-hist__tools / .v3-hist__pager） ----------------

/** 每页 8 条（原型 ML_PAGE_SIZE） */
const PAGE_SIZE = 8
const query = ref('')
const page = ref(1)

/** 一条批次可被搜到的提示词：提交快照里的 prompt / global_prompt / pose_prompts + 各任务 prompt_summary */
function promptTextOf(d: StudioBatchDetail): string {
  const parts: string[] = []
  const p = parseStudioPayload(d.batch.payload)
  if (typeof p.prompt === 'string') parts.push(p.prompt)
  if (typeof p.globalPrompt === 'string') parts.push(p.globalPrompt)
  if (p.posePrompts && typeof p.posePrompts === 'object') {
    for (const v of Object.values(p.posePrompts as Record<string, unknown>)) {
      if (typeof v === 'string') parts.push(v)
    }
  }
  for (const t of d.tasks) if (t.promptSummary) parts.push(t.promptSummary)
  return parts.join('\n').toLowerCase()
}

const filtered = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return ctl.items.value
  return ctl.items.value.filter((d) => promptTextOf(d).includes(keyword))
})
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)))
const paged = computed(() => filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE))
/** 最后一页且后端还有下一批（不搜索时才拉，搜索只在已加载的记录里找） */
const canFetchMore = computed(() => !query.value.trim() && page.value >= pages.value && ctl.hasMore.value)

watch(query, () => {
  page.value = 1
})
watch(pages, (total) => {
  if (page.value > total) page.value = total
})

const listEl = ref<HTMLElement | null>(null)

async function nextPage() {
  if (page.value < pages.value) page.value += 1
  else if (canFetchMore.value && !ctl.loadingMore.value) {
    await ctl.loadMore()
    if (page.value < pages.value) page.value += 1
  } else return
  listEl.value?.scrollTo({ top: 0 })
}

function prevPage() {
  if (page.value <= 1) return
  page.value -= 1
  listEl.value?.scrollTo({ top: 0 })
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <CreationHistoryHeader count-inline :count="ctl.items.value.length" :running="runningCount" />

    <!-- 搜索（原型 .v3-hist__tools：高 30、左 10 放 13 放大镜、字 11；只在有记录时出现） -->
    <div v-if="ctl.items.value.length" class="relative flex flex-none items-center px-12px pb-8px">
      <svg
        class="pointer-events-none absolute left-22px h-13px w-13px text-placeholder"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </svg>
      <input
        v-model="query"
        type="search"
        placeholder="搜索提示词"
        aria-label="搜索历史记录"
        class="h-34px w-full box-border rounded-15px border border-solid border-line bg-white pl-27px pr-8px text-13px text-ink outline-none placeholder:text-placeholder hover:border-control focus:(border-violet shadow-[0_0_0_2px_rgba(138,99,159,0.16)])"
      />
    </div>

    <div
      ref="listEl"
      class="stu-scroll flex-1 min-h-0 px-12px overflow-y-auto [scrollbar-gutter:stable]"
      v-loading="ctl.loading.value"
    >
      <!-- 卡片列表（原型 .v3-hist__list.is-cards：gap 8，内边距 2 0 10） -->
      <div class="flex flex-col gap-8px pt-2px pb-10px">
        <!-- 卡片（原型 .v3-hist__card：44 缩略 + 内容两栏、gap 10、内边距 10、r18、最小高 74；选中 柔紫线 + 白→#faf4fd） -->
        <div
          v-for="d in paged"
          :key="d.batch.id"
          class="sx-squircle flex flex-none gap-10px items-center min-h-74px box-border p-10px border border-solid rounded-18px cursor-pointer transition-[border-color,background-color,box-shadow] duration-fast sx-focus"
          :class="
            d.batch.id === selectedId
              ? 'border-violet-line bg-gradient-to-b from-white to-violet-soft-tint shadow-[0_1px_2px_rgba(31,35,41,0.05),inset_0_1px_0_#fff]'
              : 'border-line bg-white hover:(border-control shadow-[0_1px_2px_rgba(31,35,41,0.05)])'
          "
          tabindex="0"
          :aria-current="d.batch.id === selectedId ? 'true' : undefined"
          :aria-label="`${promptOf(d)}，${statsOf(d)}`"
          @click="emit('select', d)"
          @keydown.enter.self.prevent="emit('select', d)"
          @keydown.space.self.prevent="emit('select', d)"
        >
          <!-- 进行中：骨架 + 进度条（原型 .v3-hist__skeleton-* / .v3-hist__progress） -->
          <template v-if="!isBatchTerminal(d.batch.status)">
            <span
              class="relative block w-44px h-44px flex-[0_0_44px] rounded-14px bg-gradient-to-b from-white to-violet-soft-tint shadow-[inset_0_0_0_1px_var(--xq-violet-line)]"
              aria-hidden="true"
            >
              <DotWave class="absolute inset-0" />
            </span>
            <div class="flex flex-1 min-w-0 min-h-52px flex-col justify-center gap-8px">
              <span class="stu-shimmer block w-82% h-10px rounded-4px" aria-hidden="true" />
              <span class="stu-shimmer block w-64% h-10px rounded-4px" aria-hidden="true" />
              <div class="flex min-w-0 items-center gap-6px" @click.stop>
                <div
                  class="flex-1 min-w-0 h-4px overflow-hidden rounded-pill bg-line-soft"
                  role="progressbar"
                  :aria-valuenow="progressOf(d)"
                  aria-valuemin="0"
                  aria-valuemax="100"
                  :aria-label="`${batchChip(d.batch.status).label}，生成进度`"
                  :title="`${batchChip(d.batch.status).label} · ${statsOf(d)}`"
                >
                  <div
                    class="h-full rounded-pill sx-grad-progress transition-[width] duration-slow ease-sx"
                    :style="{ width: progressOf(d) + '%' }"
                  />
                </div>
                <b class="flex-none text-11px font-600 leading-16px text-ink-2 tabular-nums">{{ progressOf(d) }}%</b>
                <n-popconfirm @positive-click="cancelBatch(d)">
                  <template #trigger>
                    <IconButton label="取消批次" size="sm">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                      >
                        <circle cx="12" cy="12" r="8.5" />
                        <path d="M9 9l6 6M15 9l-6 6" />
                      </svg>
                    </IconButton>
                  </template>
                  只会取消还没开始的任务，已开始的继续跑完，确定取消？
                </n-popconfirm>
              </div>
            </div>
          </template>

          <template v-else>
            <!-- 叠放缩略（原型 .v3-hist__stack：44 / r14，2 张起右上错位叠影，角标总张数）：悬停看大图，点击开灯箱 -->
            <NPopover
              trigger="hover"
              placement="right-start"
              raw
              :show-arrow="false"
              :delay="240"
              :disabled="!stackOf(d).length"
            >
              <template #trigger>
                <button
                  type="button"
                  class="relative w-44px h-44px flex-[0_0_44px] box-border p-0 border border-solid border-line rounded-14px bg-surface3 text-11px text-placeholder sx-focus"
                  :class="[
                    stackOf(d).length ? 'cursor-zoom-in' : 'cursor-default',
                    stackCount(d) >= 3
                      ? 'shadow-[3px_-3px_0_-1px_var(--xq-surface),3px_-3px_0_0_var(--xq-line),6px_-6px_0_-1px_var(--xq-surface),6px_-6px_0_0_var(--xq-line)]'
                      : stackCount(d) === 2
                        ? 'shadow-[3px_-3px_0_-1px_var(--xq-surface),3px_-3px_0_0_var(--xq-line)]'
                        : '',
                  ]"
                  :aria-label="stackOf(d).length ? '放大图片' : '没有可预览的图片'"
                  :aria-disabled="!stackOf(d).length || undefined"
                  @click.stop="openLightbox(d)"
                >
                  <img
                    v-if="stackOf(d)[0]"
                    :src="ossResize(stackOf(d)[0], 44, 44)"
                    alt=""
                    loading="lazy"
                    decoding="async"
                    class="block w-full h-full rounded-13px object-cover"
                    @error="(e: Event) => thumbFallback(e, stackOf(d)[0]) || onStackError(d, stackOf(d)[0])"
                  />
                  <span v-else>{{ (KIND_LABEL[d.batch.kind] ?? '批次').slice(0, 2) }}</span>
                  <span
                    v-if="stackCount(d) > 1"
                    class="absolute z-2 -top-4px -right-4px grid min-w-16px h-16px box-border place-items-center px-4px border border-solid border-white rounded-full bg-ink text-surface text-10px font-600 leading-none"
                    aria-hidden="true"
                    >{{ stackCount(d) }}</span
                  >
                </button>
              </template>
              <img
                v-if="stackOf(d)[0]"
                :src="ossResize(stackOf(d)[0], 220)"
                alt=""
                decoding="async"
                class="block max-w-220px max-h-280px rounded-8px border border-solid border-line bg-white object-contain shadow-[0_12px_32px_rgba(31,35,41,0.18),0_2px_8px_rgba(31,35,41,0.08)]"
              />
            </NPopover>

            <div class="flex flex-1 min-w-0 min-h-52px flex-col justify-center gap-6px">
              <p
                class="m-0 min-w-0 line-clamp-1 text-12px leading-18px text-ink"
                :title="`${promptOf(d)}\n${statsOf(d)}`"
              >
                {{ promptOf(d) }}
              </p>
              <!-- 非全部成功：状态 + 原因（全部成功不出这一行，状态只显示一次） -->
              <div
                v-if="d.batch.status !== 4"
                class="flex min-w-0 items-center gap-6px text-11px leading-16px"
                :title="d.batch.errorReason || statsOf(d)"
              >
                <span class="ll-chip" :class="batchChip(d.batch.status).cls">{{
                  batchChip(d.batch.status).label
                }}</span>
                <span v-if="d.batch.errorReason" class="min-w-0 truncate text-danger">{{ d.batch.errorReason }}</span>
              </div>
              <!-- 操作行：时间左、三颗按钮右（间距 8，sm 视觉 24 / 命中 32） -->
              <HistoryActionRow
                class="min-h-24px"
                :more-items="[
                  { key: 'zoom', label: '放大', disabled: !stackOf(d).length },
                  { key: 'delete', label: '删除', danger: true, confirm: '删除这条记录？' },
                  { key: 'reedit', label: '重新编辑' },
                ]"
                @more="(k) => (k === 'zoom' ? openLightbox(d) : k === 'delete' ? removeBatch(d) : reedit(d))"
                @lead-click="emit('select', d)"
                @click.stop
              >
                <template #lead>
                  <span
                    class="flex-none text-11px leading-16px text-muted tabular-nums whitespace-nowrap"
                    :title="formatFullTime(d.batch.createdAt)"
                    :aria-label="formatFullTime(d.batch.createdAt)"
                    >{{ formatShortTime(d.batch.createdAt) }}</span
                  >
                </template>
                <template #primary>
                  <IconButton
                    :label="resultsOf(d).length > 1 ? `下载 ${resultsOf(d).length} 张（打包）` : '下载'"
                    size="sm"
                    :disabled="!resultsOf(d).length"
                    :loading="downloading === d.batch.id"
                    @click="download(d)"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />
                    </svg>
                  </IconButton>
                  <IconButton
                    v-if="jpgCount(d) > 1"
                    label="全部另存为 JPG"
                    size="sm"
                    :loading="savingJpg === d.batch.id"
                    :disabled="savingJpg !== null"
                    @click="saveAllJpg(d)"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                      <path d="M14 3v5h5" />
                      <text x="12" y="17" text-anchor="middle" font-size="6.5" font-weight="700" fill="currentColor" stroke="none" font-family="system-ui, sans-serif">JPG</text>
                    </svg>
                  </IconButton>
                </template>
                <template #secondary>
                  <n-popconfirm positive-text="删除" negative-text="取消" @positive-click="removeBatch(d)">
                    <template #trigger>
                      <IconButton label="删除" size="sm" variant="danger">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.8"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M4.5 7h15M9.5 7V5h5v2M6.5 7l1 12.5h9l1-12.5M10.5 11v5M13.5 11v5" />
                        </svg>
                      </IconButton>
                    </template>
                    删除这条记录？
                  </n-popconfirm>
                  <IconButton label="重新编辑" size="sm" @click="reedit(d)">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M4 20h4L19 9l-4-4L4 16z" />
                      <path d="M13.5 6.5l4 4" />
                    </svg>
                  </IconButton>
                </template>
              </HistoryActionRow>
            </div>
          </template>
        </div>

        <!-- 空态 = 一张历史卡大小（原型 .v3-hist__empty.sx-empty：高 65、内边距 0 10、28 圆图标在左） -->
        <div
          v-if="!ctl.loading.value && !ctl.items.value.length"
          class="flex h-65px flex-none items-center gap-8px box-border px-10px border border-dashed border-line-strong rounded-lg bg-gradient-to-b from-white to-surface2 text-left"
        >
          <span
            class="grid w-28px h-28px flex-[0_0_28px] box-border place-items-center border border-solid border-line rounded-full bg-white text-violet-ink"
            aria-hidden="true"
          >
            <svg
              class="w-16px h-16px"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 7.5V12l3 2" />
            </svg>
          </span>
          <span class="flex min-w-0 flex-1 flex-col gap-1px overflow-hidden">
            <b class="text-13px font-600 leading-18px text-ink-2">还没有生成记录</b>
            <span
              class="overflow-hidden text-11px leading-15px text-muted whitespace-nowrap text-ellipsis"
              title="左边传好素材、点底部按钮提交，每次生成都会在这一列留一条；点一条就能在右边看它的产物"
              >左边传好素材、点底部按钮提交，每次生成都会在这一列留一条；点一条就能在右边看它的产物</span
            >
          </span>
        </div>
        <!-- 搜索无结果（原型：没有匹配的记录 / 换个关键词再试） -->
        <div
          v-if="ctl.items.value.length && !paged.length"
          class="flex flex-col gap-2px box-border px-10px py-12px border border-dashed border-line-strong rounded-lg bg-gradient-to-b from-white to-surface2 text-center"
        >
          <b class="text-13px font-600 leading-18px text-ink-2">没有匹配的记录</b>
          <span class="text-11px leading-15px text-muted">换个关键词再试</span>
        </div>

        <!-- 列表底部：「加载更多」向后端拉下一批（游标 ctl.hasMore / ctl.loadMore），拉回的记录追加进
             已加载列表；下方翻页只在已加载的记录上切片。只在最后一页（列表真正的末尾）出现。 -->
        <template v-if="ctl.items.value.length && page >= pages">
          <div v-if="ctl.loadingMore.value" class="pt-8px pb-2px text-11px text-center">加载中…</div>
          <div v-else-if="ctl.hasMore.value" class="ll-link py-8px !text-13px text-center" @click="ctl.loadMore()">
            加载更多
          </div>
          <div v-else class="pt-8px pb-2px text-11px text-center text-placeholder">没有更多了</div>
        </template>
      </div>
    </div>

    <!-- 翻页（原型 .v3-hist__pager：26 方钮 + 「页 / 总页」11 muted，上 8 下 2） -->
    <div
      v-if="ctl.items.value.length"
      class="flex flex-none items-center justify-center gap-10px px-12px pt-8px pb-10px"
    >
      <IconButton label="上一页" :disabled="page <= 1" @click="prevPage">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </IconButton>
      <span class="text-12px leading-16px text-muted tabular-nums" aria-live="polite">{{ page }} / {{ pages }}</span>
      <IconButton
        label="下一页"
        :disabled="(page >= pages && !canFetchMore) || ctl.loadingMore.value"
        @click="nextPage"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
      </IconButton>
    </div>

    <MediaLightbox v-model:show="lightboxShow" v-model:index="lightboxIndex" :items="lightboxItems" />
  </div>
</template>

<style scoped lang="less">
@import '@/assets/variables.less';

/* 进行中骨架的流光（原型 .v3-hist__skeleton-*：1.2s 左右扫，减少动效时静止） */
.stu-shimmer {
  background: linear-gradient(90deg, var(--xq-skeleton-a) 25%, var(--xq-skeleton-b) 50%, var(--xq-skeleton-a) 75%);
  background-size: 200% 100%;
  animation: stu-hist-shimmer 1.2s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .stu-shimmer {
    animation: none;
  }
}
@keyframes stu-hist-shimmer {
  from {
    background-position: 200% 0;
  }
  to {
    background-position: -200% 0;
  }
}

/* 滚动条 mixin 无法用原子类表达 */
.stu-scroll {
  .scrollbar-autohide(@width: 8px, @trackColor: var(--xq-surface), @thumbColor: rgb(var(--xq-ink-rgb) / 0.1), @thumbWidth: 4px, @hoverColor: rgb(var(--xq-ink-rgb) / 0.35));
}
</style>
