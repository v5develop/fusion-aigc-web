<script setup lang="ts">
/**
 * 探店视频 / 带货短剧：两步流程 ——
 * 1. 提交表单 → 构思分镜剧本（status 0 → 1，轮询详情）；
 * 2. 剧本确认（只读，不满意重新构思 replan）→ 出片（status 2 → 3/4，继续轮询）。
 * 状态 1 时 script 是剧本 JSON（scenes[]）；解析失败整段兜底展示。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import Workbench from '../components/Workbench/index.vue'
import PersonSource from '../components/PersonSource/index.vue'
import ShopProfileSelect from '../components/ShopProfileSelect/index.vue'
import CopywritingPicker from '../components/CopywritingPicker/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import {
  llCopywritingAiWrite,
  llIdempotencyHeaders,
  llVideoCreate,
  llVideoDetail,
  llVideoGenerate,
  llVideoList,
  llVideoOptions,
  llVideoRemove,
  llVideoReplan,
} from '@/api/localLife.ts'
import type { ILVideoCreation, ILVideoKind, ILVideoOptions } from '@/api/localLifeTypes.ts'
import { useAgreement, useLLList, usePollingWhile } from '../hooks.ts'
import { VIDEO_STATUS_MAP, formatTime, isVideoRunning, parseScript } from '../constants.ts'

const props = defineProps<{ kind: ILVideoKind }>()

defineOptions({ name: 'local-life-video-creation' })

const isExplore = computed(() => props.kind === 'exploreShop')
const pageTitle = computed(() => (isExplore.value ? '探店视频' : '带货短剧'))

const message = useMessage()
const { ensureAgreed } = useAgreement()

// ---------------- 表单 ----------------

const options = ref<ILVideoOptions | null>(null)
const form = reactive({
  user_text: '',
  selling_points: '',
  prop_url: [] as string[], // 短剧商品图 / 探店道具图（单张）
  env1_url: [] as string[], // 探店门店图 / 短剧环境图
  env2_url: [] as string[], // 探店店内图
  duration: undefined as number | undefined,
  size: undefined as string | undefined,
  model: undefined as string | undefined,
  shop_profile_id: undefined as number | undefined,
  copywriting_id: undefined as number | undefined,
})

const portraitSource = ref<'UPLOAD' | 'PUBLIC'>('UPLOAD')
const personImage = ref('')
const personPublicId = ref<number | undefined>(undefined)
const withPerson = ref(false) // 出镜人物选填，开关控制

const modelOptions = computed(() => (options.value?.models ?? []).map((o) => ({ label: o.label, value: o.code })))
const sizeOptions = computed(() => (options.value?.sizes ?? []).map((o) => ({ label: o.label, value: o.code })))
const durationOptions = computed(() => (options.value?.durations ?? []).map((d) => ({ label: `${d}s`, value: d })))
const maxTextLen = computed(() => options.value?.max_user_text_len ?? 500)

const showCopyPicker = ref(false)
const aiWriting = ref(false)

async function aiWriteText() {
  aiWriting.value = true
  try {
    const res = await llCopywritingAiWrite({
      scene: isExplore.value ? 'explore_shop' : 'short_drama',
      context: form.user_text.trim() || undefined,
    })
    form.user_text = res.data?.text ?? ''
  } finally {
    aiWriting.value = false
  }
}

function pickCopy(c: { id: number; body: string }) {
  form.user_text = c.body.slice(0, maxTextLen.value)
  form.copywriting_id = c.id
  showCopyPicker.value = false
}

// ---------------- 右侧列表 ----------------

const view = ref<'list' | 'detail'>('list')
const listCtl = useLLList<ILVideoCreation>((params) => llVideoList(props.kind, params), isVideoRunning, 5000)

onMounted(async () => {
  const res = await llVideoOptions(props.kind)
  options.value = res.data ?? null
  form.model = res.data?.default_model
  form.duration = res.data?.default_duration
  form.size = res.data?.default_size
  void listCtl.reload()
})

async function removeItem(item: ILVideoCreation) {
  await llVideoRemove(item.id)
  message.success('已删除')
  if (activeVideo.value?.id === item.id) {
    view.value = 'list'
    activeVideo.value = null
  }
  void listCtl.refresh()
}

// ---------------- 详情：剧本 / 成片 ----------------

const activeVideo = ref<ILVideoCreation | null>(null)
const detailLoading = ref(false)
const scriptScenes = computed(() => parseScript(activeVideo.value?.script))
const scriptRaw = computed(() => (scriptScenes.value ? '' : activeVideo.value?.script ?? ''))

// 复刻专用的确认参数，这里只对 model/size 生效（复刻页有自己的组件；此处防御性保留）
const { start: startVideoPoll } = usePollingWhile(
  () => llVideoDetail(activeVideo.value!.id),
  (data) => {
    if (!data) return true
    activeVideo.value = data
    if (data.status === 0 || data.status === 2) return true
    void listCtl.refresh()
    if (data.status === 1) message.success('剧本已出，请确认')
    else if (data.status === 3) message.success('视频已生成')
    return false
  },
  5000,
)

async function openDetail(id: number, opts: { silent?: boolean } = {}) {
  view.value = 'detail'
  detailLoading.value = !opts.silent
  try {
    const res = await llVideoDetail(id)
    activeVideo.value = res.data
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
  if (!form.user_text.trim()) return message.warning(isExplore.value ? '请输入视频文案' : '请输入短剧主题')
  if (options.value?.prop_required && !form.prop_url.length) return message.warning('请上传商品图')

  if (!(await ensureAgreed())) return

  submitting.value = true
  try {
    await llVideoCreate(
      {
        kind: props.kind,
        user_text: form.user_text.trim(),
        selling_points: isExplore.value ? undefined : form.selling_points.trim() || undefined,
        shop_profile_id: form.shop_profile_id,
        ...(withPerson.value
          ? {
              portrait_source: portraitSource.value,
              ...(portraitSource.value === 'UPLOAD' ? { image_url: personImage.value } : { public_id: personPublicId.value }),
            }
          : {}),
        env1_url: form.env1_url[0],
        env2_url: isExplore.value ? form.env2_url[0] : undefined,
        prop_url: form.prop_url[0],
        duration: form.duration,
        size: form.size || undefined,
        model: form.model || undefined,
        copywriting_id: form.copywriting_id,
      },
      llIdempotencyHeaders(),
    )
    message.success('已提交，剧本构思中')
    form.user_text = ''
    form.copywriting_id = undefined
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
    message.success('重新构思中')
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
    await llVideoGenerate(activeVideo.value.id, {}, llIdempotencyHeaders())
    message.success('开始出片，预计几分钟')
    await openDetail(activeVideo.value.id, { silent: true })
    void listCtl.refresh()
  } finally {
    generating.value = false
  }
}

function sceneTime(s: { start_sec?: number; end_sec?: number }) {
  if (s.start_sec == null && s.end_sec == null) return ''
  return `${s.start_sec ?? 0}s ~ ${s.end_sec ?? '?'}s`
}
</script>

<template>
  <Workbench :title="pageTitle" :submit="submit" :loading="submitting" submit-text="生成分镜剧本">
    <template #default>
      <div class="field">
        <div class="label">
          {{ isExplore ? '视频文案' : '短剧主题' }}
          <span class="links">
            <span class="link" :class="{ disabled: aiWriting }" @click="aiWriteText">{{ aiWriting ? 'AI帮写中…' : '✨ AI帮写' }}</span>
            <span class="link" @click="showCopyPicker = true">选择AI文案</span>
          </span>
        </div>
        <n-input
          v-model:value="form.user_text"
          type="textarea"
          :rows="4"
          :maxlength="maxTextLen"
          show-count
          :placeholder="isExplore ? '想拍一条什么样的探店视频？' : '想拍一个什么样的带货小剧场？'"
        />
      </div>

      <div v-if="!isExplore" class="field">
        <div class="label">商品卖点（选填）</div>
        <n-input
          v-model:value="form.selling_points"
          :maxlength="options?.max_selling_points_len || 200"
          placeholder="如：便携榨汁杯、30秒出汁、USB充电"
        />
      </div>

      <div class="field">
        <div class="label">{{ isExplore ? '道具图（选填）' : '商品图（必填）' }}</div>
        <ImageUpload v-model:imgList="form.prop_url" btnName="上传图片" :topRightTips="false" :limitNumber="1" />
      </div>

      <div class="field">
        <div class="label">{{ isExplore ? '门店图（选填）' : '环境图（选填）' }}</div>
        <ImageUpload v-model:imgList="form.env1_url" btnName="上传图片" :topRightTips="false" :limitNumber="1" />
      </div>

      <div v-if="isExplore" class="field">
        <div class="label">店内图（选填）</div>
        <ImageUpload v-model:imgList="form.env2_url" btnName="上传图片" :topRightTips="false" :limitNumber="1" />
      </div>

      <div class="field">
        <div class="label">出镜人物（选填）</div>
        <div class="seg">
          <span class="ll-pill" :class="{ 'll-pill-active': !withPerson }" @click="withPerson = false">不出现人物</span>
          <span class="ll-pill" :class="{ 'll-pill-active': withPerson }" @click="withPerson = true">指定人物</span>
        </div>
        <PersonSource
          v-if="withPerson"
          v-model:source="portraitSource"
          v-model:image-url="personImage"
          v-model:public-id="personPublicId"
        />
      </div>

      <div class="field">
        <div class="label">关联店铺档案</div>
        <ShopProfileSelect v-model:value="form.shop_profile_id" />
      </div>

      <div class="field three-col">
        <div v-if="durationOptions.length">
          <div class="label">时长</div>
          <n-select v-model:value="form.duration" size="small" :options="durationOptions" />
        </div>
        <div v-if="sizeOptions.length">
          <div class="label">比例</div>
          <n-select v-model:value="form.size" size="small" :options="sizeOptions" />
        </div>
        <div v-if="modelOptions.length">
          <div class="label">模型</div>
          <n-select v-model:value="form.model" size="small" :options="modelOptions" />
        </div>
      </div>
    </template>

    <template #right>
      <div class="right-inner">
        <!-- 列表 -->
        <template v-if="view === 'list'">
          <div class="list-title">我的{{ pageTitle }}</div>
          <div class="video-list" v-loading="listCtl.loading.value">
            <div v-for="item in listCtl.items.value" :key="item.id" class="video-item" @click="openDetail(item.id)">
              <img v-if="item.char_url || item.env1_url" class="cover" :src="item.char_url || item.env1_url" alt="" />
              <div v-else class="cover placeholder">🎬</div>
              <div class="info">
                <div class="head">
                  <span class="name">{{ item.user_text || '未命名' }}</span>
                  <span class="ll-chip" :class="`ll-chip-${VIDEO_STATUS_MAP[item.status]?.type}`">{{ VIDEO_STATUS_MAP[item.status]?.label }}</span>
                </div>
                <div class="sub">{{ item.duration }}s · {{ item.size }} · {{ formatTime(item.create_time) }}</div>
              </div>
            </div>
            <div v-if="!listCtl.loading.value && !listCtl.items.value.length" class="empty">还没有记录，左侧开始创作吧</div>
            <div v-if="listCtl.hasMore.value" class="more" @click="listCtl.loadMore()">加载更多</div>
          </div>
        </template>

        <!-- 详情：剧本确认 / 成片 -->
        <template v-else>
          <div class="back" @click="view = 'list'">← 返回列表</div>
          <div v-if="activeVideo" class="detail" v-loading="detailLoading">
            <div class="detail-head">
              <span class="ll-chip" :class="`ll-chip-${VIDEO_STATUS_MAP[activeVideo.status]?.type}`">{{ VIDEO_STATUS_MAP[activeVideo.status]?.label }}</span>
              <h2>{{ activeVideo.user_text || '未命名' }}</h2>
              <n-popconfirm @positive-click="removeItem(activeVideo!)">
                <template #trigger><span class="del">删除</span></template>
                确定删除这条记录？
              </n-popconfirm>
            </div>
            <div class="meta">{{ activeVideo.duration }}s · {{ activeVideo.size }} · {{ formatTime(activeVideo.create_time) }}</div>

            <!-- 构思中 / 生成中 -->
            <div v-if="activeVideo.status === 0 || activeVideo.status === 2" class="running-box">
              <n-spin size="small" />
              <span>{{ activeVideo.status === 0 ? 'AI 正在构思分镜剧本…' : '视频生成中，预计 2~10 分钟…' }}</span>
            </div>

            <!-- 失败 -->
            <div v-else-if="activeVideo.status === 4" class="failed-box">
              <p>{{ activeVideo.fail_reason || '生成失败' }}</p>
              <div class="ops">
                <n-button size="small" @click="replan" :loading="replanning">重新构思</n-button>
                <n-button size="small" type="primary" @click="confirmGenerate" :loading="generating">重新出片</n-button>
              </div>
            </div>

            <!-- 待确认：分镜剧本 -->
            <template v-else-if="activeVideo.status === 1">
              <div class="plan-tip">分镜剧本已出（剧本只读）。不满意就重新构思；满意就确认生成。</div>

              <template v-if="scriptScenes">
                <div v-for="(scene, i) in scriptScenes" :key="i" class="scene-card">
                  <div class="scene-head">
                    <span class="scene-name">{{ scene.scene_name || `分镜 ${i + 1}` }}</span>
                    <span v-if="sceneTime(scene)" class="scene-time">{{ sceneTime(scene) }}</span>
                  </div>
                  <div v-if="scene.camera" class="scene-line"><b>镜头</b>{{ scene.camera }}</div>
                  <div v-if="scene.dialogue" class="scene-line dialogue"><b>台词</b>{{ scene.dialogue }}</div>
                  <div v-if="scene.image_ref" class="scene-line"><b>画面</b>{{ scene.image_ref }}</div>
                </div>
              </template>
              <div v-else-if="scriptRaw" class="script-raw">{{ scriptRaw }}</div>

              <div class="plan-ops">
                <n-button size="small" :loading="replanning" @click="replan">重新构思</n-button>
                <n-button size="small" type="primary" :loading="generating" @click="confirmGenerate">确认生成视频</n-button>
              </div>
            </template>

            <!-- 已完成 -->
            <template v-else-if="activeVideo.status === 3">
              <video
                v-if="activeVideo.video_url"
                :src="activeVideo.video_url"
                controls
                autoplay
                class="result-video"
              />
              <div class="plan-ops">
                <n-button size="small" @click="replan" :loading="replanning">换个剧本重新拍</n-button>
              </div>
            </template>
          </div>
        </template>
      </div>
    </template>
  </Workbench>

  <CopywritingPicker v-model:show="showCopyPicker" @select="pickCopy" />
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

    .links {
      display: flex;
      gap: 10px;

      .link {
        color: #875f9a;
        font-size: 12px;
        cursor: pointer;

        &.disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      }
    }
  }
}

.seg {
  display: flex;
  gap: 6px;
}

.three-col {
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

      .ops {
        display: flex;
        gap: 10px;
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

    .scene-card {
      background: #fff;
      border-radius: 10px;
      padding: 14px 16px;
      margin-bottom: 10px;

      .scene-head {
        display: flex;
        justify-content: space-between;
        margin-bottom: 8px;

        .scene-name {
          font-weight: 600;
          font-size: 14px;
          color: #1f2329;
        }

        .scene-time {
          font-size: 12px;
          color: #875f9a;
        }
      }

      .scene-line {
        font-size: 13px;
        color: #555;
        line-height: 20px;
        margin-bottom: 4px;

        b {
          color: #5f6673;
          font-weight: normal;
          margin-right: 8px;
        }

        &.dialogue {
          color: #1f2329;
        }
      }
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
