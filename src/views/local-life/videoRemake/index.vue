<script setup lang="ts">
/**
 * 爆款视频复刻：两种来源二选一 ——
 * - 上传本地视频（≤50M / ≤3 分钟，格式以后端下发为准）
 * - 粘贴抖音/快手/小红书/B站分享链接（整段分享文案直接粘）
 * 流程：提交解析（复刻是解析原片，70）→ 状态 1 待确认（剧情分析纯文本）→ 复刻视频（71）→ 成片。
 * 确认时可以改剧情 prompt / 模型 / 比例。
 */
import { computed, onMounted, ref, watch } from 'vue'
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
import { useAgreement, useLLList, usePollingWhile } from '../hooks.ts'
import { VIDEO_STATUS_MAP, formatBytes, formatTime, isVideoRunning } from '../constants.ts'

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

// ---------------- 右侧列表 ----------------

const view = ref<'list' | 'detail'>('list')
const listCtl = useLLList<ILVideoCreation>((params) => llVideoList('videoRemake', params), isVideoRunning, 5000)

async function removeItem(item: ILVideoCreation) {
  await llVideoRemove(item.id)
  message.success('已删除')
  if (activeVideo.value?.id === item.id) {
    view.value = 'list'
    activeVideo.value = null
  }
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

const { start: startVideoPoll } = usePollingWhile(
  () => llVideoDetail(activeVideo.value!.id),
  (data) => {
    if (!data) return true
    activeVideo.value = data
    if (data.status === 0 || data.status === 2) return true
    void listCtl.refresh()
    if (data.status === 1) message.success('剧情分析已出，请确认')
    else if (data.status === 3) message.success('复刻视频已生成')
    return false
  },
  5000,
)

async function openDetail(id: number, opts: { silent?: boolean } = {}) {
  view.value = 'detail'
  detailLoading.value = !opts.silent
  editingPrompt.value = false
  try {
    const res = await llVideoDetail(id)
    activeVideo.value = res.data
    remakePrompt.value = ''
    if (res.data && isVideoRunning(res.data)) startVideoPoll()
  } finally {
    detailLoading.value = false
  }
}

watch(view, (v) => {
  if (v === 'list') activeVideo.value = null
})

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
    await llVideoCreate(
      {
        kind: 'videoRemake',
        source: source.value,
        video_url: source.value === 'upload' ? videoList.value[0]?.url : undefined,
        link: source.value === 'link' ? link.value.trim() : undefined,
      },
      llIdempotencyHeaders(),
    )
    message.success('已提交，正在解析原片')
    await listCtl.refresh()
  } finally {
    submitting.value = false
  }
}

const replanning = ref(false)
async function replan() {
  if (!activeVideo.value || replanning.value) return
  replanning.value = true
  try {
    await llVideoReplan(activeVideo.value.id, llIdempotencyHeaders())
    message.success('重新解析中')
    await openDetail(activeVideo.value.id, { silent: true })
    void listCtl.refresh()
  } finally {
    replanning.value = false
  }
}

const generating = ref(false)
async function confirmGenerate() {
  if (!activeVideo.value || generating.value) return

  if (!(await ensureAgreed())) return

  generating.value = true
  try {
    await llVideoGenerate(
      activeVideo.value.id,
      {
        prompt: editingPrompt.value && remakePrompt.value.trim() ? remakePrompt.value.trim() : undefined,
        model: remakeModel.value || undefined,
        size: remakeSize.value || undefined,
      },
      llIdempotencyHeaders(),
    )
    message.success('开始复刻，预计 2~10 分钟')
    await openDetail(activeVideo.value.id, { silent: true })
    void listCtl.refresh()
  } finally {
    generating.value = false
  }
}
</script>

<template>
  <Workbench title="爆款视频复刻" :submit="submit" :loading="submitting" submit-text="解析视频">
    <template #default>
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

      <FormCard title="说明">
        <p class="m-0 text-12px leading-20px text-muted">
          AI 会解析原片的分镜与节奏，产出剧情分析；确认后按分析结果复刻同款视频。可在确认时调整模型与比例。
        </p>
      </FormCard>
    </template>

    <template #right>
      <div class="h-full min-h-0 flex flex-col">
        <!-- 列表 -->
        <template v-if="view === 'list'">
          <h2 class="m-0 flex-none mb-14px text-16px font-600 leading-22px text-ink">我的复刻</h2>
          <div v-loading="listCtl.loading.value" class="flex-1 min-h-0 overflow-auto">
            <div
              v-for="item in listCtl.items.value"
              :key="item.id"
              class="bg-white rounded-lg border border-solid border-line shadow-card-v3 flex gap-12px p-12px mb-10px cursor-pointer transition-[border-color,box-shadow] duration-mid ease-[ease] motion-reduce:transition-none hover:(border-violet-line shadow-raised-hover)"
              @click="openDetail(item.id)"
            >
              <img
                v-if="item.cover_url"
                class="w-64px h-64px flex-none rounded-8px object-cover"
                :src="item.cover_url"
                alt=""
              />
              <div
                v-else
                class="w-64px h-64px flex-none rounded-8px flex items-center justify-center text-24px sx-grad-icon border border-solid border-violet-soft-2 shadow-[inset_0_1px_0_#fff]"
              >
                🔥
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-8px">
                  <span class="flex-1 truncate text-14px font-600 text-ink">{{ item.title || '未命名复刻' }}</span>
                  <span class="sx-chip flex-shrink-0" :class="`ll-chip-${VIDEO_STATUS_MAP[item.status]?.type}`">{{
                    VIDEO_STATUS_MAP[item.status]?.label
                  }}</span>
                </div>
                <div class="mt-4px text-11px leading-16px text-muted tabular-nums">
                  {{ item.source === 'link' ? '链接解析' : '本地上传' }} · {{ formatTime(item.create_time) }}
                </div>
              </div>
            </div>
            <div
              v-if="!listCtl.loading.value && !listCtl.items.value.length"
              class="sx-empty !min-h-240px text-12px leading-[1.65] text-muted"
            >
              还没有复刻记录，左侧开始吧
            </div>
            <div
              v-if="listCtl.hasMore.value"
              class="ll-link transition-colors duration-fast block text-center py-8px"
              @click="listCtl.loadMore()"
            >
              加载更多
            </div>
          </div>
        </template>

        <!-- 详情 -->
        <template v-else>
          <button
            type="button"
            class="flex-none w-fit mb-12px -ml-8px sx-btn-ghost !h-28px !px-8px hover:!text-violet-ink transition-colors duration-fast"
            @click="view = 'list'"
          >
            ← 返回列表
          </button>
          <div v-if="activeVideo" v-loading="detailLoading" class="flex-1 min-h-0 overflow-auto">
            <div class="flex items-center gap-10px">
              <span class="sx-chip flex-shrink-0" :class="`ll-chip-${VIDEO_STATUS_MAP[activeVideo.status]?.type}`">{{
                VIDEO_STATUS_MAP[activeVideo.status]?.label
              }}</span>
              <h2 class="m-0 flex-1 truncate text-16px font-600 leading-22px text-ink">
                {{ activeVideo.title || '未命名复刻' }}
              </h2>
              <n-popconfirm @positive-click="removeItem(activeVideo!)">
                <template #trigger
                  ><span class="flex-none text-12px ll-danger-link transition-colors duration-fast"
                    >删除</span
                  ></template
                >
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
              <n-button size="small" @click="view = 'list'">换个视频重试</n-button>
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
                autoplay
                class="mt-14px block w-full max-h-70vh rounded-lg bg-black"
              />
              <div class="flex gap-10px mt-14px">
                <n-button size="small" @click="view = 'list'">再复刻一条</n-button>
              </div>
            </template>
          </div>
        </template>
      </div>
    </template>
  </Workbench>
</template>
