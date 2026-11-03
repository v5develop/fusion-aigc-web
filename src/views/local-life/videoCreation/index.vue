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
const scriptRaw = computed(() => (scriptScenes.value ? '' : (activeVideo.value?.script ?? '')))

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
              ...(portraitSource.value === 'UPLOAD'
                ? { image_url: personImage.value }
                : { public_id: personPublicId.value }),
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
      <div class="mb-14px">
        <div class="ll-label">
          {{ isExplore ? '视频文案' : '短剧主题' }}
          <span class="flex gap-10px">
            <span class="ll-link" :class="{ 'opacity-60 !cursor-not-allowed': aiWriting }" @click="aiWriteText">{{
              aiWriting ? 'AI帮写中…' : '✨ AI帮写'
            }}</span>
            <span class="ll-link" @click="showCopyPicker = true">选择AI文案</span>
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

      <div v-if="!isExplore" class="mb-14px">
        <div class="ll-label">商品卖点（选填）</div>
        <n-input
          v-model:value="form.selling_points"
          size="small"
          :maxlength="options?.max_selling_points_len || 200"
          placeholder="如：便携榨汁杯、30秒出汁、USB充电"
        />
      </div>

      <div class="mb-14px">
        <div class="ll-label">{{ isExplore ? '道具图（选填）' : '商品图（必填）' }}</div>
        <ImageUpload v-model:imgList="form.prop_url" btnName="上传图片" :topRightTips="false" :limitNumber="1" />
      </div>

      <div class="mb-14px">
        <div class="ll-label">{{ isExplore ? '门店图（选填）' : '环境图（选填）' }}</div>
        <ImageUpload v-model:imgList="form.env1_url" btnName="上传图片" :topRightTips="false" :limitNumber="1" />
      </div>

      <div v-if="isExplore" class="mb-14px">
        <div class="ll-label">店内图（选填）</div>
        <ImageUpload v-model:imgList="form.env2_url" btnName="上传图片" :topRightTips="false" :limitNumber="1" />
      </div>

      <div class="mb-14px">
        <div class="ll-label">出镜人物（选填）</div>
        <div class="flex flex-wrap gap-8px">
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

      <div class="mb-14px">
        <div class="ll-label">关联店铺档案</div>
        <ShopProfileSelect v-model:value="form.shop_profile_id" />
      </div>

      <div class="mb-14px flex gap-10px">
        <div v-if="durationOptions.length" class="flex-1 min-w-0">
          <div class="ll-label">时长</div>
          <n-select v-model:value="form.duration" size="small" :options="durationOptions" />
        </div>
        <div v-if="sizeOptions.length" class="flex-1 min-w-0">
          <div class="ll-label">比例</div>
          <n-select v-model:value="form.size" size="small" :options="sizeOptions" />
        </div>
        <div v-if="modelOptions.length" class="flex-1 min-w-0">
          <div class="ll-label">模型</div>
          <n-select v-model:value="form.model" size="small" :options="modelOptions" />
        </div>
      </div>
    </template>

    <template #right>
      <div class="h-full min-h-0 flex flex-col">
        <!-- 列表 -->
        <template v-if="view === 'list'">
          <h2 class="m-0 flex-none mb-14px text-16px font-600 leading-22px text-ink">我的{{ pageTitle }}</h2>
          <div v-loading="listCtl.loading.value" class="flex-1 min-h-0 overflow-auto">
            <div
              v-for="item in listCtl.items.value"
              :key="item.id"
              class="ll-card flex gap-12px p-12px mb-10px cursor-pointer transition-[border-color,box-shadow] duration-[0.18s] ease-[ease] hover:(border-violet-line shadow-[0_4px_16px_rgba(31,35,41,0.08)])"
              @click="openDetail(item.id)"
            >
              <img
                v-if="item.char_url || item.env1_url"
                class="w-64px h-64px flex-none rounded-8px object-cover"
                :src="item.char_url || item.env1_url"
                alt=""
              />
              <div
                v-else
                class="w-64px h-64px flex-none rounded-8px flex items-center justify-center text-24px bg-surface2"
              >
                🎬
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-8px">
                  <span class="flex-1 truncate text-14px font-600 text-ink">{{ item.user_text || '未命名' }}</span>
                  <span class="ll-chip" :class="`ll-chip-${VIDEO_STATUS_MAP[item.status]?.type}`">{{
                    VIDEO_STATUS_MAP[item.status]?.label
                  }}</span>
                </div>
                <div class="mt-4px text-11px text-muted">
                  {{ item.duration }}s · {{ item.size }} · {{ formatTime(item.create_time) }}
                </div>
              </div>
            </div>
            <div v-if="!listCtl.loading.value && !listCtl.items.value.length" class="ll-empty py-80px">
              还没有记录，左侧开始创作吧
            </div>
            <div v-if="listCtl.hasMore.value" class="ll-link block text-center py-8px" @click="listCtl.loadMore()">
              加载更多
            </div>
          </div>
        </template>

        <!-- 详情：剧本确认 / 成片 -->
        <template v-else>
          <div
            class="flex-none w-fit mb-12px text-13px text-ink-2 cursor-pointer hover:text-violet-ink"
            @click="view = 'list'"
          >
            ← 返回列表
          </div>
          <div v-if="activeVideo" v-loading="detailLoading" class="flex-1 min-h-0 overflow-auto">
            <div class="flex items-center gap-10px">
              <span class="ll-chip" :class="`ll-chip-${VIDEO_STATUS_MAP[activeVideo.status]?.type}`">{{
                VIDEO_STATUS_MAP[activeVideo.status]?.label
              }}</span>
              <h2 class="m-0 flex-1 truncate text-16px font-600 leading-22px text-ink">
                {{ activeVideo.user_text || '未命名' }}
              </h2>
              <n-popconfirm @positive-click="removeItem(activeVideo!)">
                <template #trigger><span class="flex-none text-12px ll-danger-link">删除</span></template>
                确定删除这条记录？
              </n-popconfirm>
            </div>
            <div class="mt-8px mb-14px text-12px text-muted">
              {{ activeVideo.duration }}s · {{ activeVideo.size }} · {{ formatTime(activeVideo.create_time) }}
            </div>

            <!-- 构思中 / 生成中 -->
            <div
              v-if="activeVideo.status === 0 || activeVideo.status === 2"
              class="ll-card flex items-center justify-center gap-10px p-40px text-13px text-ink-2"
            >
              <n-spin size="small" />
              <span>{{ activeVideo.status === 0 ? 'AI 正在构思分镜剧本…' : '视频生成中，预计 2~10 分钟…' }}</span>
            </div>

            <!-- 失败 -->
            <div
              v-else-if="activeVideo.status === 4"
              class="ll-card flex flex-col items-center justify-center gap-10px p-40px text-13px text-ink-2"
            >
              <p class="m-0 text-danger">{{ activeVideo.fail_reason || '生成失败' }}</p>
              <div class="flex gap-10px">
                <n-button size="small" @click="replan" :loading="replanning">重新构思</n-button>
                <n-button size="small" type="primary" @click="confirmGenerate" :loading="generating">重新出片</n-button>
              </div>
            </div>

            <!-- 待确认：分镜剧本 -->
            <template v-else-if="activeVideo.status === 1">
              <div
                class="mb-14px rounded-8px border border-solid border-warning-line bg-warning-soft px-12px py-8px text-12px text-warning"
              >
                分镜剧本已出（剧本只读）。不满意就重新构思；满意就确认生成。
              </div>

              <template v-if="scriptScenes">
                <div v-for="(scene, i) in scriptScenes" :key="i" class="ll-card px-16px py-14px mb-10px">
                  <div class="flex items-baseline justify-between gap-8px mb-8px">
                    <span class="text-14px font-600 text-ink">{{ scene.scene_name || `分镜 ${i + 1}` }}</span>
                    <span v-if="sceneTime(scene)" class="text-12px text-violet-ink">{{ sceneTime(scene) }}</span>
                  </div>
                  <div v-if="scene.camera" class="mb-4px text-13px leading-20px text-ink-2">
                    <b class="mr-8px font-400 text-muted">镜头</b>{{ scene.camera }}
                  </div>
                  <div v-if="scene.dialogue" class="mb-4px text-13px leading-20px text-ink">
                    <b class="mr-8px font-400 text-muted">台词</b>{{ scene.dialogue }}
                  </div>
                  <div v-if="scene.image_ref" class="mb-4px text-13px leading-20px text-ink-2">
                    <b class="mr-8px font-400 text-muted">画面</b>{{ scene.image_ref }}
                  </div>
                </div>
              </template>
              <div
                v-else-if="scriptRaw"
                class="ll-card p-16px text-13px leading-22px text-ink whitespace-pre-wrap"
                v-text="scriptRaw"
              />

              <div class="flex gap-10px mt-14px">
                <n-button size="small" :loading="replanning" @click="replan">重新构思</n-button>
                <n-button size="small" type="primary" :loading="generating" @click="confirmGenerate"
                  >确认生成视频</n-button
                >
              </div>
            </template>

            <!-- 已完成 -->
            <template v-else-if="activeVideo.status === 3">
              <video
                v-if="activeVideo.video_url"
                :src="activeVideo.video_url"
                controls
                autoplay
                class="block w-full max-h-70vh rounded-10px bg-black"
              />
              <div class="flex gap-10px mt-14px">
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
