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
import FormCard from '../components/FormCard/index.vue'
import Field from '../components/Field/index.vue'
import SegTabs from '../components/SegTabs/index.vue'
import PromptBox from '../components/PromptBox/index.vue'
import PromptActions from '../components/PromptActions/index.vue'
import SettingsBar from '../components/SettingsBar/index.vue'
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
import HistoryList from '../components/HistoryList/index.vue'
import HistoryCard from '../components/HistoryList/HistoryCard.vue'
import { useHistorySelection } from '../components/HistoryList/selection.ts'
import ResultPreview from '../components/ResultPreview/index.vue'
import { useLLQuote } from '../components/Workbench/useLLQuote.ts'
import IconButton from '@/components/IconButton/index.vue'
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
const PERSON_SEGMENTS = [
  { key: false, label: '不出现人物' },
  { key: true, label: '指定人物' },
]

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

// ---------------- 中栏历史列表 ----------------

const listCtl = useLLList<ILVideoCreation>((params) => llVideoList(props.kind, params), isVideoRunning, 5000)

// 三栏：中栏历史选中哪条，右栏就展示哪条的详情（null = 跟随最新）
const { current, select, selectId, followLatest } = useHistorySelection(listCtl.items)
const runningCount = computed(() => listCtl.items.value.filter(isVideoRunning).length)

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

// ---------------- 详情：剧本 / 成片 ----------------

const activeVideo = ref<ILVideoCreation | null>(null)
const detailLoading = ref(false)
const scriptScenes = computed(() => parseScript(activeVideo.value?.script))
const scriptRaw = computed(() => (scriptScenes.value ? '' : (activeVideo.value?.script ?? '')))

// 复刻专用的确认参数，这里只对 model/size 生效（复刻页有自己的组件；此处防御性保留）
const { start: startVideoPoll, stop: stopVideoPoll } = usePollingWhile(
  () => llVideoDetail(detailId!),
  (data) => {
    if (!data) return true
    // 兜底：回来的不是当前展示的这条（已切走）就收掉这条链
    if (data.id !== detailId) return false
    activeVideo.value = data
    if (data.status === 0 || data.status === 2) return true
    void listCtl.refresh()
    if (data.status === 1) message.success('剧本已出，请确认')
    else if (data.status === 3) message.success('视频已生成')
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
  try {
    const res = await llVideoDetail(id)
    if (seq !== openSeq) return // 期间又切了别的，丢弃过期结果
    activeVideo.value = res.data
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

// 提交前报价：构思剧本不收费，确认出片时按档位 × 时长冻结——按钮上写「出片消耗」，数字与出片冻结同一套算价
// 左栏按钮是「新建」：按表单参数报价，不带右栏选中记录的 id（带了会按旧记录的档位 / 时长算）
const { estimate } = useLLQuote(
  () => ({ tool: props.kind, model: form.model || undefined, duration: form.duration }),
  () => '出片消耗',
)

const submitting = ref(false)

async function submit() {
  if (submitting.value) return
  if (!form.user_text.trim()) return message.warning(isExplore.value ? '请输入视频文案' : '请输入短剧主题')
  if (options.value?.prop_required && !form.prop_url.length) return message.warning('请上传商品图')

  if (!(await ensureAgreed())) return

  submitting.value = true
  try {
    const res = await llVideoCreate(
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
    message.success('重新构思中')
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
    await llVideoGenerate(id, {}, llIdempotencyHeaders())
    message.success('开始出片，预计几分钟')
    // 等待期间切到了别的记录就不把右栏拉回来，列表刷新会反映这条的新状态
    if (detailId === id) await openDetail(id, { silent: true })
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
  <Workbench :title="pageTitle" :submit="submit" :loading="submitting" submit-text="生成分镜剧本" :estimate="estimate" :history-count="listCtl.total.value">
    <template #default>
      <FormCard :title="isExplore ? '视频文案' : '短剧主题'" required>
        <PromptBox
          v-model="form.user_text"
          :label="isExplore ? '视频文案' : '短剧主题'"
          size="lg"
          :max-length="maxTextLen"
          :placeholder="isExplore ? '想拍一条什么样的探店视频？' : '想拍一个什么样的带货小剧场？'"
        >
          <template #actions>
            <PromptActions :loading="aiWriting" @ai="aiWriteText" @pick="showCopyPicker = true" />
          </template>
        </PromptBox>
      </FormCard>

      <FormCard v-if="!isExplore" title="商品卖点" hint="选填">
        <n-input
          v-model:value="form.selling_points"
          size="small"
          :maxlength="options?.max_selling_points_len || 200"
          show-count
          placeholder="如：便携榨汁杯、30秒出汁、USB充电"
        />
      </FormCard>

      <FormCard title="素材图" hint="每类最多 1 张">
        <Field :label="isExplore ? '道具图' : '商品图'" :required="!isExplore">
          <template #extra>
            <span class="text-11px leading-16px text-muted">{{ isExplore ? '选填 · 1 张' : '必填 · 1 张' }}</span>
          </template>
          <ImageUpload
            fromAsset
            v-model:imgList="form.prop_url"
            btnName="上传图片"
            :topRightTips="false"
            :limitNumber="1"
          />
        </Field>
        <Field :label="isExplore ? '门店图' : '环境图'">
          <template #extra>
            <span class="text-11px leading-16px text-muted">选填 · 1 张</span>
          </template>
          <ImageUpload
            fromAsset
            v-model:imgList="form.env1_url"
            btnName="上传图片"
            :topRightTips="false"
            :limitNumber="1"
          />
        </Field>
        <Field v-if="isExplore" label="店内图">
          <template #extra>
            <span class="text-11px leading-16px text-muted">选填 · 1 张</span>
          </template>
          <ImageUpload
            fromAsset
            v-model:imgList="form.env2_url"
            btnName="上传图片"
            :topRightTips="false"
            :limitNumber="1"
          />
        </Field>
      </FormCard>

      <FormCard title="出镜人物" hint="选填">
        <SegTabs v-model="withPerson" :options="PERSON_SEGMENTS" label="出镜人物" />
        <PersonSource
          v-if="withPerson"
          v-model:source="portraitSource"
          v-model:image-url="personImage"
          v-model:public-id="personPublicId"
          title="出镜人物来源"
          bare
        />
      </FormCard>

      <FormCard title="关联店铺档案" hint="选填">
        <ShopProfileSelect v-model:value="form.shop_profile_id" />
      </FormCard>
    </template>

    <template #settings>
      <SettingsBar
        v-model:data="form"
        :model-options="modelOptions"
        :fields="[
          { field: 'duration', label: '时长', options: durationOptions },
          { field: 'size', label: '比例', options: sizeOptions },
        ]"
      />
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
          :title="item.user_text || '未命名'"
          :status="VIDEO_STATUS_MAP[item.status]?.type ?? 'running'"
          :status-label="VIDEO_STATUS_MAP[item.status]?.label ?? ''"
          :time="item.create_time"
          :thumb="item.char_url || item.env1_url"
          placeholder="视频"
          :fail-reason="item.status === 4 ? item.fail_reason || '生成失败' : ''"
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
              {{ activeVideo.user_text || '未命名' }}
            </h2>
            <!-- 改版前详情头的「删除」（历史卡上也有一个）：同一个接口、同样的二次确认 -->
            <n-popconfirm @positive-click="removeItem(activeVideo!)">
              <template #trigger>
                <button type="button" class="flex-none sx-btn-ghost !px-10px !text-danger">删除</button>
              </template>
              确定删除这条记录？
            </n-popconfirm>
          </div>
          <div class="mt-8px mb-14px text-11px leading-16px text-muted tabular-nums">
            {{ activeVideo.duration }}s · {{ activeVideo.size }} · {{ formatTime(activeVideo.create_time) }}
          </div>

          <!-- 构思中 / 生成中 -->
          <div
            v-if="activeVideo.status === 0 || activeVideo.status === 2"
            class="bg-white rounded-lg border border-solid border-line shadow-card-v3 flex items-center justify-center gap-10px p-40px text-13px text-ink-2"
          >
            <n-spin size="small" />
            <span>{{ activeVideo.status === 0 ? 'AI 正在构思分镜剧本…' : '视频生成中，预计 2~10 分钟…' }}</span>
          </div>

          <!-- 失败 -->
          <div
            v-else-if="activeVideo.status === 4"
            class="bg-white rounded-lg border border-solid border-line shadow-card-v3 flex flex-col items-center justify-center gap-10px p-40px text-13px text-ink-2"
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
              class="mb-14px rounded-8px border border-solid border-warning-line bg-warning-soft px-12px py-8px text-12px text-alert-warning"
            >
              分镜剧本已出（剧本只读）。不满意就重新构思；满意就确认生成。
            </div>

            <template v-if="scriptScenes">
              <div
                v-for="(scene, i) in scriptScenes"
                :key="i"
                class="bg-white rounded-lg border border-solid border-line shadow-card-v3 px-16px py-14px mb-10px"
              >
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
              class="bg-white rounded-lg border border-solid border-line shadow-card-v3 p-14px text-13px leading-22px text-ink whitespace-pre-wrap"
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
              :autoplay="userPicked"
              class="block w-full max-h-70vh rounded-lg bg-black"
            />
            <div class="flex gap-10px mt-14px">
              <n-button size="small" @click="replan" :loading="replanning">换个剧本重新拍</n-button>
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

  <CopywritingPicker v-model:show="showCopyPicker" @select="pickCopy" />
</template>
