<script setup lang="ts">
/**
 * 爆款视频复刻：两种来源二选一 ——
 * - 上传本地视频（≤50M / ≤3 分钟，格式以后端下发为准）
 * - 粘贴抖音/快手/小红书/B站分享链接（整段分享文案直接粘）
 * 流程：提交解析（复刻是解析原片，70）→ 状态 1 待确认（剧情分析纯文本）→ 复刻视频（71）→ 成片。
 * 确认时可以改剧情 prompt / 模型 / 比例。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import Workbench from '../components/Workbench/index.vue'
import FormCard from '../components/FormCard/index.vue'
import SegTabs from '../components/SegTabs/index.vue'
import PromptBox from '../components/PromptBox/index.vue'
import VideoUpload from '@/components/VideoUpload/index.vue'
import {
  llIdempotencyHeaders,
  llVideoCreate,
  llVideoDetail,
  llVideoGenerate,
  llVideoList,
  llVideoOptions,
  llVideoRemove,
  llVideoReplan,
} from '@/api/localLife.ts'
import type { ILVideoCreation, ILVideoOptions } from '@/api/localLifeTypes.ts'
import HistoryList from '../components/HistoryList/index.vue'
import HistoryCard from '../components/HistoryList/HistoryCard.vue'
import { useHistorySelection } from '../components/HistoryList/selection.ts'
import ResultPreview from '../components/ResultPreview/index.vue'
import IconButton from '@/components/IconButton/index.vue'
import { useAgreement, useLLList, usePollingWhile } from '../hooks.ts'
import { VIDEO_STATUS_MAP, formatBytes, isVideoRunning } from '../constants.ts'

defineOptions({ name: 'local-life-video-remake' })

const message = useMessage()
const { ensureAgreed } = useAgreement()

// ---------------- 表单 ----------------

const options = ref<ILVideoOptions | null>(null)
const source = ref<'upload' | 'link'>('upload')
const link = ref('')
const SOURCE_SEGMENTS = [
  { key: 'upload', label: '上传视频' },
  { key: 'link', label: '链接查视频' },
] as const
const videoList = ref<{ url: string; thumbnail?: string; name?: string }[]>([])

const modelOptions = computed(() => (options.value?.models ?? []).map((o) => ({ label: o.label, value: o.code })))
const sizeOptions = computed(() => (options.value?.sizes ?? []).map((o) => ({ label: o.label, value: o.code })))
const linkEnabled = computed(() => options.value?.link_enabled ?? false)
const limitHint = computed(() => {
  const secs = options.value?.max_video_seconds
  const bytes = formatBytes(options.value?.max_video_bytes)
  if (!secs && !bytes) return ''
  return `仅支持 ${secs ? Math.round(secs / 60) + ' 分钟' : ''}${secs && bytes ? '、' : ''}${bytes} 以内的视频`
})

onMounted(async () => {
  const res = await llVideoOptions('videoRemake')
  options.value = res.data ?? null
  remakeModel.value = res.data?.default_model
  if (!linkEnabled.value) source.value = 'upload'
  void listCtl.reload()
})

watch(source, () => {
  videoList.value = []
  link.value = ''
})

/** 「视频来源」卡的外层：重来时把焦点送到这里的第一个可聚焦控件 */
const sourceFieldRef = ref<HTMLElement | null>(null)

/**
 * 「换个视频重试」/「再复刻一条」：改版前是回到列表重新开始；三栏里左栏一直在，
 * 改成清空左栏表单（回到默认的上传来源）、把焦点送到视频上传入口并滚到可见处。右栏仍停在当前这条，不改选中。
 */
async function startOver() {
  source.value = 'upload' // 来源变化会顺带清空已选视频与链接（见上面的 watch）
  videoList.value = []
  link.value = ''
  await nextTick() // 清空后上传按钮才重新渲染出来
  const root = sourceFieldRef.value
  if (!root) return
  // <1440 时左栏与右栏并排但左栏自身可滚动：滚到上传区再聚焦，防止焦点落在视口外
  root.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  const target = root.querySelector<HTMLElement>(
    'button:not([disabled]), textarea:not([disabled]), input:not([type="file"]):not([disabled]), [tabindex]:not([tabindex="-1"])',
  )
  target?.focus({ preventScroll: true })
}

// ---------------- 中栏历史列表 ----------------

const listCtl = useLLList<ILVideoCreation>((params) => llVideoList('videoRemake', params), isVideoRunning, 5000)

// 三栏：中栏历史选中哪条，右栏就展示哪条的详情（null = 跟随最新）
const { current, select, selectId, followLatest } = useHistorySelection(listCtl.items)
const runningCount = computed(() => listCtl.items.value.filter(isVideoRunning).length)

async function removeItem(item: ILVideoCreation) {
  await llVideoRemove(item.id)
  message.success('已删除')
  if (detailId === item.id) {
    openSeq++
    detailId = null
    stopVideoPoll()
    activeVideo.value = null
  }
  // 先在本地摘掉这条，选中项立即回落到最新一条（不等列表刷新）；随后静默刷新对齐服务端
  listCtl.items.value = listCtl.items.value.filter((v) => v.id !== item.id)
  listCtl.total.value = Math.max(0, listCtl.total.value - 1)
  void listCtl.refresh()
}

// ---------------- 详情 ----------------

const activeVideo = ref<ILVideoCreation | null>(null)
const detailLoading = ref(false)

// 确认出片的可调参数
const remakePrompt = ref('')
const remakeModel = ref<string | undefined>(undefined)
const remakeSize = ref<string | undefined>(undefined)
const editingPrompt = ref(false)

const { start: startVideoPoll, stop: stopVideoPoll } = usePollingWhile(
  () => llVideoDetail(detailId!),
  (data) => {
    if (!data) return true
    // 兜底：回来的不是当前展示的这条（已切走）就收掉这条链
    if (data.id !== detailId) return false
    activeVideo.value = data
    if (data.status === 0 || data.status === 2) return true
    void listCtl.refresh()
    if (data.status === 1) message.success('剧情分析已出，请确认')
    else if (data.status === 3) message.success('复刻视频已生成')
    return false
  },
  5000,
)

/** 右栏正在展示 / 正在载入的记录 id（比 activeVideo 早一步更新，用来判断「是不是同一条」与丢弃过期响应） */
let detailId: number | null = null
let openSeq = 0
/** 详情载入失败的 id：右栏显示「重新加载」而不是一直转圈 */
const detailErrorId = ref<number | null>(null)
/** 成片自动播放只在用户亲手点了历史卡之后（进页自动跟随最新一条时不自动出声，与改版前「点开详情才播」一致） */
const userPicked = ref(false)

async function openDetail(id: number, opts: { silent?: boolean } = {}) {
  const seq = ++openSeq
  // 切到别的记录：先停掉上一条的轮询（在途结果也作废），免得它把详情写回当前
  if (detailId !== id) {
    stopVideoPoll()
    activeVideo.value = null
  }
  detailId = id
  detailErrorId.value = null
  detailLoading.value = !opts.silent
  editingPrompt.value = false
  try {
    const res = await llVideoDetail(id)
    if (seq !== openSeq) return // 期间又切了别的，丢弃过期结果
    activeVideo.value = res.data
    remakePrompt.value = ''
    if (res.data && isVideoRunning(res.data)) startVideoPoll()
  } catch {
    // 失败提示由请求层弹出；这里只把右栏切到可重试的状态
    if (seq === openSeq && !activeVideo.value) detailErrorId.value = id
  } finally {
    if (seq === openSeq) detailLoading.value = false
  }
}

// 历史列选中项变了（点卡 / 跟随最新 / 删除后回落）→ 载入它的详情；没有记录则清空右栏。
// 只盯 id 这个原始值：列表每轮轮询都会换一批新对象，盯对象会每 5 秒多打一次详情
watch(
  () => current.value?.id,
  (id) => {
    if (id == null) {
      openSeq++
      detailId = null
      stopVideoPoll()
      activeVideo.value = null
      detailErrorId.value = null
    } else if (detailId !== id) {
      void openDetail(id)
    }
  },
  { immediate: true },
)

// 选中项状态在列表里变了、而右栏这条没有在轮询（例如在别的窗口点了重新构思 / 出片）→ 静默重载一次；
// 在轮询的由详情轮询自己跟进，不重复请求
watch(
  () => current.value?.status,
  (status) => {
    const video = activeVideo.value
    if (status == null || !video || current.value?.id !== video.id) return
    if (status !== video.status && !isVideoRunning(video)) void openDetail(video.id, { silent: true })
  },
)

/** 点历史卡：选中；已经在右栏展示的这条不重载（改了一半的确认参数不能被冲掉），只有上次载入失败才重试 */
function onSelectItem(item: ILVideoCreation) {
  userPicked.value = true
  select(item)
  if (detailId !== item.id || detailErrorId.value === item.id) void openDetail(item.id)
}

// ---------------- 动作 ----------------

const submitting = ref(false)

async function submit() {
  if (submitting.value) return

  if (source.value === 'upload') {
    if (!videoList.value.length) return message.warning('请上传要复刻的视频')
  } else if (!link.value.trim()) {
    return message.warning('请粘贴视频分享链接')
  }

  if (!(await ensureAgreed())) return

  submitting.value = true
  try {
    const res = await llVideoCreate(
      {
        kind: 'videoRemake',
        source: source.value,
        video_url: source.value === 'upload' ? videoList.value[0]?.url : undefined,
        link: source.value === 'link' ? link.value.trim() : undefined,
      },
      llIdempotencyHeaders(),
    )
    message.success('已提交，正在解析原片')
    // 明确选中接口返回的新记录（不依赖「新记录排第一」）；选中项变化由上面的 watch 载入详情，
    // 新记录万一还没进列表（刷新失败），直接载入它的详情，等下一轮列表对上
    await listCtl.refresh()
    if (res.data?.id) {
      selectId(res.data.id)
      if (detailId !== res.data.id) void openDetail(res.data.id, { silent: true })
    } else {
      followLatest()
    }
  } finally {
    submitting.value = false
  }
}

const replanning = ref(false)
async function replan() {
  if (!activeVideo.value || replanning.value) return
  const id = activeVideo.value.id
  replanning.value = true
  try {
    await llVideoReplan(id, llIdempotencyHeaders())
    message.success('重新解析中')
    // 等待期间切到了别的记录就不把右栏拉回来，列表刷新会反映这条的新状态
    if (detailId === id) await openDetail(id, { silent: true })
    void listCtl.refresh()
  } finally {
    replanning.value = false
  }
}

const generating = ref(false)
async function confirmGenerate() {
  if (!activeVideo.value || generating.value) return

  if (!(await ensureAgreed())) return

  const id = activeVideo.value.id
  generating.value = true
  try {
    await llVideoGenerate(
      id,
      {
        prompt: editingPrompt.value && remakePrompt.value.trim() ? remakePrompt.value.trim() : undefined,
        model: remakeModel.value || undefined,
        size: remakeSize.value || undefined,
      },
      llIdempotencyHeaders(),
    )
    message.success('开始复刻，预计 2~10 分钟')
    // 等待期间切到了别的记录就不把右栏拉回来，列表刷新会反映这条的新状态
    if (detailId === id) await openDetail(id, { silent: true })
    void listCtl.refresh()
  } finally {
    generating.value = false
  }
}
</script>

<template>
  <Workbench title="爆款视频复刻" :submit="submit" :loading="submitting" submit-text="解析视频" :history-count="listCtl.total.value">
    <template #default>
      <div ref="sourceFieldRef" class="scroll-mt-12px">
      <FormCard title="视频来源" required :hint="source === 'upload' ? '最多 1 个' : ''">
        <SegTabs v-if="linkEnabled" v-model="source" :options="SOURCE_SEGMENTS" label="视频来源" />
        <div v-if="source === 'upload'" class="flex flex-col gap-6px">
          <VideoUpload fromAsset v-model:videoList="videoList" btnName="上传视频" :limitNumber="1" />
          <p v-if="limitHint" class="m-0 text-11px leading-16px text-muted">
            {{ limitHint }}，支持 {{ (options?.video_formats ?? []).join(' / ') }}
          </p>
        </div>
        <div v-else class="flex flex-col gap-6px">
          <PromptBox
            v-model="link"
            label="视频分享链接"
            size="sm"
            placeholder="粘贴抖音 / 快手 / 小红书 / B站的分享文案即可（带口令、表情都能识别）"
          />
          <p class="m-0 text-11px leading-16px text-muted">提交后自动解析标题与原片；仅支持 3 分钟、50M 以内的视频</p>
        </div>
      </FormCard>
      </div>

      <FormCard title="说明">
        <p class="m-0 text-12px leading-20px text-muted">
          AI 会解析原片的分镜与节奏，产出剧情分析；确认后按分析结果复刻同款视频。可在确认时调整模型与比例。
        </p>
      </FormCard>
    </template>

    <template #history>
      <HistoryList
        :count="listCtl.total.value"
        :running="runningCount"
        :loading="listCtl.loading.value"
        :has-more="listCtl.hasMore.value"
        :loading-more="listCtl.loadingMore.value"
        @load-more="listCtl.loadMore()"
      >
        <HistoryCard
          v-for="item in listCtl.items.value"
          :key="item.id"
          :title="item.title || '未命名复刻'"
          :status="VIDEO_STATUS_MAP[item.status]?.type ?? 'running'"
          :status-label="VIDEO_STATUS_MAP[item.status]?.label ?? ''"
          :time="item.create_time"
          :thumb="item.cover_url"
          placeholder="视频"
          :fail-reason="item.status === 4 ? item.fail_reason || '解析失败' : ''"
          :eta-sec="240"
          :selected="current?.id === item.id"
          @select="onSelectItem(item)"
        >
          <template #actions>
            <IconButton
              v-if="item.status === 3 && item.video_url"
              label="下载视频"
              size="sm"
              :href="item.video_url"
              target="_blank"
              download
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
              </svg>
            </IconButton>
            <n-popconfirm @positive-click="removeItem(item)">
              <template #trigger>
                <IconButton label="删除记录" size="sm" variant="danger">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
                  </svg>
                </IconButton>
              </template>
              确定删除这条记录？
            </n-popconfirm>
          </template>
        </HistoryCard>
      </HistoryList>
    </template>

    <!-- 预览区：选中记录的剧本确认 / 成片 -->
    <template #preview>
      <div v-if="activeVideo" v-loading="detailLoading" class="flex-1 min-h-0 overflow-auto p-16px">
          <div class="flex items-center gap-10px">
            <span class="sx-chip flex-shrink-0" :class="`ll-chip-${VIDEO_STATUS_MAP[activeVideo.status]?.type}`">{{
              VIDEO_STATUS_MAP[activeVideo.status]?.label
            }}</span>
            <h2 class="m-0 flex-1 truncate text-16px font-600 leading-22px text-ink">
              {{ activeVideo.title || '未命名复刻' }}
            </h2>
            <!-- 改版前详情头的「删除」（历史卡上也有一个）：同一个接口、同样的二次确认 -->
            <n-popconfirm @positive-click="removeItem(activeVideo!)">
              <template #trigger>
                <button type="button" class="flex-none sx-btn-ghost !px-10px !text-danger">删除</button>
              </template>
              确定删除这条记录？
            </n-popconfirm>
          </div>
          <div
            v-if="activeVideo.source_url"
            class="mt-8px mb-14px text-11px leading-16px text-muted tabular-nums break-all"
          >
            原片：{{ activeVideo.source_url }}
          </div>

          <!-- 解析中 / 生成中 -->
          <div
            v-if="activeVideo.status === 0 || activeVideo.status === 2"
            class="bg-white rounded-lg border border-solid border-line shadow-card-v3 mt-14px flex items-center justify-center gap-10px p-40px text-13px text-ink-2"
          >
            <n-spin size="small" />
            <span>{{
              activeVideo.status === 0 ? '正在解析原片，几十秒到几分钟…' : '复刻视频生成中，预计 2~10 分钟…'
            }}</span>
          </div>

          <!-- 失败 -->
          <div
            v-else-if="activeVideo.status === 4"
            class="bg-white rounded-lg border border-solid border-line shadow-card-v3 mt-14px flex flex-col items-center justify-center gap-10px p-40px text-13px text-ink-2"
          >
            <p class="m-0 text-danger">{{ activeVideo.fail_reason || '解析失败' }}</p>
            <n-button size="small" @click="startOver">换个视频重试</n-button>
          </div>

          <!-- 待确认：剧情分析 -->
          <template v-else-if="activeVideo.status === 1">
            <div v-if="activeVideo.cover_url || activeVideo.source_video_url" class="mt-14px mb-14px">
              <video
                v-if="activeVideo.source_video_url"
                :src="activeVideo.source_video_url"
                :poster="activeVideo.cover_url"
                controls
                muted
                class="block w-full max-h-320px rounded-lg bg-black"
              />
            </div>

            <div
              class="mt-14px mb-14px rounded-8px border border-solid border-warning-line bg-warning-soft px-12px py-8px text-12px text-alert-warning"
            >
              以下是原片的剧情分析（只读）。确认后按此复刻；也可以改写剧情再复刻。
            </div>
            <div
              class="bg-white rounded-lg border border-solid border-line shadow-card-v3 p-14px text-13px leading-22px text-ink whitespace-pre-wrap"
              v-text="activeVideo.script"
            />

            <div
              class="bg-white rounded-lg border border-solid border-line shadow-card-v3 mt-14px px-16px pt-14px pb-2px"
            >
              <div class="mb-12px">
                <div
                  class="flex items-center justify-between gap-8px mb-8px text-13px font-600 leading-20px text-ink"
                >
                  改写剧情（选填）
                  <span class="ll-link transition-colors duration-fast" @click="editingPrompt = !editingPrompt">{{
                    editingPrompt ? '收起' : '展开'
                  }}</span>
                </div>
                <n-input
                  v-if="editingPrompt"
                  v-model:value="remakePrompt"
                  type="textarea"
                  :rows="4"
                  placeholder="想改哪里写清楚，AI 会按改写后的剧情复刻"
                />
              </div>
              <div class="mb-12px flex gap-10px">
                <div v-if="modelOptions.length" class="flex-1 min-w-0">
                  <div
                    class="flex items-center justify-between gap-8px mb-8px text-13px font-600 leading-20px text-ink"
                  >
                    模型
                  </div>
                  <n-select v-model:value="remakeModel" size="small" :options="modelOptions" />
                </div>
                <div v-if="sizeOptions.length" class="flex-1 min-w-0">
                  <div
                    class="flex items-center justify-between gap-8px mb-8px text-13px font-600 leading-20px text-ink"
                  >
                    比例
                  </div>
                  <n-select
                    v-model:value="remakeSize"
                    size="small"
                    clearable
                    :options="sizeOptions"
                    placeholder="跟原片"
                  />
                </div>
              </div>
            </div>

            <div class="flex gap-10px mt-14px">
              <n-button size="small" :loading="replanning" @click="replan">重新解析</n-button>
              <n-button size="small" type="primary" :loading="generating" @click="confirmGenerate">复刻视频</n-button>
            </div>
          </template>

          <!-- 已完成 -->
          <template v-else-if="activeVideo.status === 3">
            <video
              v-if="activeVideo.video_url"
              :src="activeVideo.video_url"
              controls
              :autoplay="userPicked"
              class="mt-14px block w-full max-h-70vh rounded-lg bg-black"
            />
            <div class="flex gap-10px mt-14px">
              <n-button size="small" @click="startOver">再复刻一条</n-button>
            </div>
          </template>
      </div>
      <div v-else-if="current && detailErrorId === current.id" class="flex-1 grid place-items-center p-16px">
        <div class="flex flex-col items-center gap-10px text-13px leading-20px text-ink-2" role="status">
          详情没有加载出来
          <n-button size="small" @click="openDetail(current.id)">重新加载</n-button>
        </div>
      </div>
      <div v-else-if="current" class="flex-1 grid place-items-center"><n-spin size="small" /></div>
      <ResultPreview v-else :active="false" />
    </template>
  </Workbench>
</template>
