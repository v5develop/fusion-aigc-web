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
import VideoUpload from '@/components/VideoUpload/index.vue'
import { llIdempotencyHeaders, llVideoCreate, llVideoDetail, llVideoGenerate, llVideoList, llVideoOptions, llVideoRemove, llVideoReplan } from '@/api/localLife.ts'
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
      <div class="field">
        <div class="label">视频来源</div>
        <div class="seg">
          <span class="ll-pill" :class="{ 'll-pill-active': source === 'upload' }" @click="source = 'upload'">上传视频</span>
          <span v-if="linkEnabled" class="ll-pill" :class="{ 'll-pill-active': source === 'link' }" @click="source = 'link'">链接查视频</span>
        </div>
        <div v-if="source === 'upload'" class="upload-wrap">
          <VideoUpload v-model:videoList="videoList" btnName="上传视频" :limitNumber="1" />
          <div v-if="limitHint" class="hint">{{ limitHint }}，支持 {{ (options?.video_formats ?? []).join(' / ') }}</div>
        </div>
        <template v-else>
          <n-input
            v-model:value="link"
            type="textarea"
            :rows="4"
            placeholder="粘贴抖音 / 快手 / 小红书 / B站的分享文案即可（带口令、表情都能识别）"
          />
          <div class="hint">提交后自动解析标题与原片；仅支持 3 分钟、50M 以内的视频</div>
        </template>
      </div>

      <div class="field">
        <div class="label">说明</div>
        <div class="desc-box">
          AI 会解析原片的分镜与节奏，产出剧情分析；确认后按分析结果复刻同款视频。
          可在确认时调整模型与比例。
        </div>
      </div>
    </template>

    <template #right>
      <div class="right-inner">
        <!-- 列表 -->
        <template v-if="view === 'list'">
          <div class="list-title">我的复刻</div>
          <div class="video-list" v-loading="listCtl.loading.value">
            <div v-for="item in listCtl.items.value" :key="item.id" class="video-item" @click="openDetail(item.id)">
              <img v-if="item.cover_url" class="cover" :src="item.cover_url" alt="" />
              <div v-else class="cover placeholder">🔥</div>
              <div class="info">
                <div class="head">
                  <span class="name">{{ item.title || '未命名复刻' }}</span>
                  <span class="ll-chip" :class="`ll-chip-${VIDEO_STATUS_MAP[item.status]?.type}`">{{ VIDEO_STATUS_MAP[item.status]?.label }}</span>
                </div>
                <div class="sub">{{ item.source === 'link' ? '链接解析' : '本地上传' }} · {{ formatTime(item.create_time) }}</div>
              </div>
            </div>
            <div v-if="!listCtl.loading.value && !listCtl.items.value.length" class="empty">还没有复刻记录，左侧开始吧</div>
            <div v-if="listCtl.hasMore.value" class="more" @click="listCtl.loadMore()">加载更多</div>
          </div>
        </template>

        <!-- 详情 -->
        <template v-else>
          <div class="back" @click="view = 'list'">← 返回列表</div>
          <div v-if="activeVideo" class="detail" v-loading="detailLoading">
            <div class="detail-head">
              <span class="ll-chip" :class="`ll-chip-${VIDEO_STATUS_MAP[activeVideo.status]?.type}`">{{ VIDEO_STATUS_MAP[activeVideo.status]?.label }}</span>
              <h2>{{ activeVideo.title || '未命名复刻' }}</h2>
              <n-popconfirm @positive-click="removeItem(activeVideo!)">
                <template #trigger><span class="del">删除</span></template>
                确定删除这条记录？
              </n-popconfirm>
            </div>
            <div v-if="activeVideo.source_url" class="meta">原片：{{ activeVideo.source_url }}</div>

            <!-- 解析中 / 生成中 -->
            <div v-if="activeVideo.status === 0 || activeVideo.status === 2" class="running-box">
              <n-spin size="small" />
              <span>{{ activeVideo.status === 0 ? '正在解析原片，几十秒到几分钟…' : '复刻视频生成中，预计 2~10 分钟…' }}</span>
            </div>

            <!-- 失败 -->
            <div v-else-if="activeVideo.status === 4" class="failed-box">
              <p>{{ activeVideo.fail_reason || '解析失败' }}</p>
              <n-button size="small" @click="view = 'list'">换个视频重试</n-button>
            </div>

            <!-- 待确认：剧情分析 -->
            <template v-else-if="activeVideo.status === 1">
              <div v-if="activeVideo.cover_url || activeVideo.source_video_url" class="origin-box">
                <video
                  v-if="activeVideo.source_video_url"
                  :src="activeVideo.source_video_url"
                  :poster="activeVideo.cover_url"
                  controls
                  muted
                  class="origin-video"
                />
              </div>

              <div class="plan-tip">以下是原片的剧情分析（只读）。确认后按此复刻；也可以改写剧情再复刻。</div>
              <div class="script-raw">{{ activeVideo.script }}</div>

              <div class="confirm-form">
                <div class="field">
                  <div class="label">
                    改写剧情（选填）
                    <span class="link" @click="editingPrompt = !editingPrompt">{{ editingPrompt ? '收起' : '展开' }}</span>
                  </div>
                  <n-input
                    v-if="editingPrompt"
                    v-model:value="remakePrompt"
                    type="textarea"
                    :rows="4"
                    placeholder="想改哪里写清楚，AI 会按改写后的剧情复刻"
                  />
                </div>
                <div class="field two-col">
                  <div v-if="modelOptions.length">
                    <div class="label">模型</div>
                    <n-select v-model:value="remakeModel" size="small" :options="modelOptions" />
                  </div>
                  <div v-if="sizeOptions.length">
                    <div class="label">比例</div>
                    <n-select v-model:value="remakeSize" size="small" clearable :options="sizeOptions" placeholder="跟原片" />
                  </div>
                </div>
              </div>

              <div class="plan-ops">
                <n-button size="small" :loading="replanning" @click="replan">重新解析</n-button>
                <n-button size="small" type="primary" :loading="generating" @click="confirmGenerate">复刻视频</n-button>
              </div>
            </template>

            <!-- 已完成 -->
            <template v-else-if="activeVideo.status === 3">
              <video v-if="activeVideo.video_url" :src="activeVideo.video_url" controls autoplay class="result-video" />
              <div class="plan-ops">
                <n-button size="small" @click="view = 'list'">再复刻一条</n-button>
              </div>
            </template>
          </div>
        </template>
      </div>
    </template>
  </Workbench>
</template>

<style scoped lang="less">
.field {
  margin-bottom: 14px;

  .label {
    font-size: 13px;
    color: #1f2329;
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    justify-content: space-between;

    .link {
      color: #875f9a;
      font-size: 12px;
      cursor: pointer;
    }
  }

  .hint {
    font-size: 11px;
    color: #6e7681;
    margin-top: 6px;
  }

  .desc-box {
    font-size: 12px;
    color: #5f6673;
    line-height: 20px;
    background: #f7f8f9;
    border-radius: 8px;
    padding: 10px 12px;
  }
}

.seg {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}

.two-col {
  display: flex;
  gap: 10px;

  > div {
    flex: 1;
  }
}

.right-inner {
  height: 100%;
  padding: 24px 32px;
  display: flex;
  flex-direction: column;

  .list-title {
    font-size: 16px;
    font-weight: 600;
    color: #1f2329;
    margin-bottom: 14px;
    flex-shrink: 0;
  }

  .video-list {
    flex: 1;
    min-height: 0;
    overflow: auto;

    .video-item {
      display: flex;
      gap: 12px;
      background: #fff;
      border-radius: 10px;
      padding: 12px;
      margin-bottom: 10px;
      cursor: pointer;
      transition: box-shadow 0.2s;

      &:hover {
        box-shadow: 0 2px 8px 0 rgba(0, 0, 0, 0.08);
      }

      .cover {
        width: 64px;
        height: 64px;
        border-radius: 8px;
        object-fit: cover;
        flex-shrink: 0;

        &.placeholder {
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
          background: #f7f8f9;
        }
      }

      .info {
        flex: 1;
        min-width: 0;

        .head {
          display: flex;
          align-items: center;
          gap: 8px;

          .name {
            flex: 1;
            font-weight: 600;
            font-size: 14px;
            color: #1f2329;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
        }

        .sub {
          font-size: 11px;
          color: #5f6673;
          margin-top: 4px;
        }
      }
    }

    .empty {
      text-align: center;
      color: #5f6673;
      font-size: 13px;
      padding: 80px 0;
    }

    .more {
      text-align: center;
      color: #875f9a;
      font-size: 12px;
      padding: 8px 0;
      cursor: pointer;
    }
  }

  .back {
    flex-shrink: 0;
    font-size: 13px;
    color: #4b5563;
    cursor: pointer;
    margin-bottom: 12px;
    width: fit-content;

    &:hover {
      color: #875f9a;
    }
  }

  .detail {
    flex: 1;
    min-height: 0;
    overflow: auto;

    .detail-head {
      display: flex;
      align-items: center;
      gap: 10px;

      h2 {
        flex: 1;
        font-size: 18px;
        color: #1f2329;
        margin: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .del {
        flex-shrink: 0;
        font-size: 12px;
        color: #b4433e;
        cursor: pointer;
      }
    }

    .meta {
      font-size: 12px;
      color: #5f6673;
      margin: 8px 0 14px;
      word-break: break-all;
    }

    .running-box,
    .failed-box {
      background: #fff;
      border-radius: 10px;
      padding: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      color: #4b5563;
      font-size: 13px;
    }

    .failed-box {
      flex-direction: column;

      p {
        margin: 0 0 12px;
        color: #b4433e;
      }
    }

    .origin-box {
      margin-bottom: 14px;

      .origin-video {
        width: 100%;
        max-height: 320px;
        border-radius: 10px;
        background: #000;
        display: block;
      }
    }

    .plan-tip {
      font-size: 12px;
      color: #94651f;
      background: #fbf4e8;
      border-radius: 8px;
      padding: 8px 12px;
      margin-bottom: 14px;
    }

    .script-raw {
      background: #fff;
      border-radius: 10px;
      padding: 16px;
      font-size: 13px;
      color: #1f2329;
      line-height: 22px;
      white-space: pre-wrap;
    }

    .confirm-form {
      margin-top: 14px;
      background: #fff;
      border-radius: 10px;
      padding: 14px 16px;

      .field {
        margin-bottom: 12px;

        .label {
          font-size: 13px;
          color: #1f2329;
          margin-bottom: 6px;
          display: flex;
          justify-content: space-between;

          .link {
            color: #875f9a;
            font-size: 12px;
            cursor: pointer;
          }
        }
      }
    }

    .plan-ops {
      display: flex;
      gap: 10px;
      margin-top: 14px;
    }

    .result-video {
      width: 100%;
      max-height: 70vh;
      border-radius: 12px;
      background: #000;
      display: block;
    }
  }
}
</style>
