<script setup lang="ts">
import { modelLabelOf } from '@/utils/model-label'
/**
 * 数字人口播：一段文案 + 人物图 + 背景（AI智能匹配 / 预设背景 / 上传）→ 一步出片。
 * 与海报/长图共用 creations 接口，kind=voiceover；模板接口返回的是预设背景。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import Workbench from '../components/Workbench/index.vue'
import PersonSource from '../components/PersonSource/index.vue'
import CopywritingPicker from '../components/CopywritingPicker/index.vue'
import FormCard from '../components/FormCard/index.vue'
import SegTabs from '../components/SegTabs/index.vue'
import PromptBox from '../components/PromptBox/index.vue'
import PromptActions from '../components/PromptActions/index.vue'
import SettingsBar from '../components/SettingsBar/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import IconButton from '@/components/IconButton/index.vue'
import {
  llCopywritingAiWrite,
  llCreationList,
  llCreationOptions,
  llCreationRemove,
  llCreationSubmit,
  llCreationTemplates,
  llIdempotencyHeaders,
} from '@/api/local-life.ts'
import type { ILCreation, ILCreationOptions } from '@/api/local-life-types.ts'
import HistoryList from '../components/HistoryList/index.vue'
import HistoryCard from '../components/HistoryList/HistoryCard.vue'
import { useHistorySelection } from '../components/HistoryList/selection.ts'
import ResultPreview from '../components/ResultPreview/index.vue'
import { useLLQuote } from '../components/Workbench/useLLQuote.ts'
import { useAgreement, useLLList } from '../hooks.ts'
import { CREATION_STATUS_MAP, isCreationRunning } from '../constants.ts'

defineOptions({ name: 'local-life-voiceover' })

const message = useMessage()
const { ensureAgreed } = useAgreement()

const BG_SEGMENTS = [
  { key: 'AI', label: 'AI 智能匹配' },
  { key: 'PRESET', label: '预设背景' },
  { key: 'UPLOAD', label: '上传背景' },
] as const

// ---------------- 表单 ----------------

const options = ref<ILCreationOptions | null>(null)
const form = reactive({
  content: '',
  model: undefined as string | undefined,
  duration: undefined as number | undefined,
  size: undefined as string | undefined,
  copywritingId: undefined as number | undefined,
})

const portraitSource = ref<'UPLOAD' | 'PUBLIC'>('UPLOAD')
const personImage = ref('')
const personPublicId = ref<number | undefined>(undefined)

const modelOptions = computed(() =>
  (options.value?.models ?? []).map((o) => ({ label: modelLabelOf(o.label), value: o.code })),
)
const sizeOptions = computed(() => (options.value?.sizes ?? []).map((o) => ({ label: o.label, value: o.code })))
const durationOptions = computed(() => (options.value?.durations ?? []).map((d) => ({ label: `${d}秒`, value: d })))

// ---------------- 背景：AI / 预设 / 上传 ----------------

const bgSource = ref<'AI' | 'PRESET' | 'UPLOAD'>('AI')
const bgId = ref<number | undefined>(undefined)
const bgUrl = ref('')
const bgList = ref<{ id: number; title: string; url: string }[]>([])
const bgLoading = ref(false)

// 上传数组 ↔ 单地址桥接
const bgImageList = ref<string[]>(bgUrl.value ? [bgUrl.value] : [])
watch(bgImageList, (v) => (bgUrl.value = v[0] ?? ''), { deep: true })

async function loadBackgrounds() {
  bgLoading.value = true
  try {
    const res = await llCreationTemplates('voiceover')
    bgList.value = res.data?.list ?? []
  } finally {
    bgLoading.value = false
  }
}

// ---------------- AI帮写 / 选择AI文案 ----------------

const showCopyPicker = ref(false)
const aiWriting = ref(false)

async function aiWriteContent() {
  aiWriting.value = true
  try {
    const res = await llCopywritingAiWrite({ scene: 'voiceover', context: form.content.trim() || undefined })
    form.content = res.data?.text ?? ''
  } finally {
    aiWriting.value = false
  }
}

function pickCopy(c: { id: number; body: string }) {
  form.content = c.body
  form.copywritingId = c.id
  showCopyPicker.value = false
}

// 提交前报价：按档位 × 时长计，提交即冻结
const { estimate } = useLLQuote(() => ({ tool: 'voiceover', model: form.model || undefined, duration: form.duration }))

// ---------------- 提交 ----------------

const submitting = ref(false)

async function submit() {
  if (submitting.value) return
  if (!form.content.trim()) return message.warning('请先填写口播文案')
  if (portraitSource.value === 'UPLOAD' && !personImage.value) return message.warning('请上传人物照片')
  if (portraitSource.value === 'PUBLIC' && !personPublicId.value) return message.warning('请选择一位公共数字人')
  if (bgSource.value === 'PRESET' && !bgId.value) return message.warning('请选择一个背景')

  if (!(await ensureAgreed())) return

  submitting.value = true
  try {
    const res = await llCreationSubmit(
      {
        kind: 'voiceover',
        content: form.content.trim(),
        portrait_source: portraitSource.value,
        ...(portraitSource.value === 'UPLOAD' ? { imageUrl: personImage.value } : { publicId: personPublicId.value }),
        backgroundSource: bgSource.value,
        backgroundId: bgSource.value === 'PRESET' ? bgId.value : undefined,
        backgroundUrl: bgSource.value === 'UPLOAD' ? bgUrl.value : undefined,
        model: form.model || undefined,
        duration: form.duration,
        size: form.size || undefined,
        copywritingId: form.copywritingId,
      },
      llIdempotencyHeaders(),
    )
    message.success('已提交，口播视频生成中')
    form.content = ''
    form.copywritingId = undefined
    // 明确选中接口返回的新记录（不依赖「新记录排第一」）；先刷列表，免得新 id 还不在列表里时预览闪到旧记录
    await listCtl.refresh()
    if (res.data?.id) selectId(res.data.id)
    else followLatest()
  } finally {
    submitting.value = false
  }
}

// ---------------- 右侧：生成记录（视频） ----------------

const listCtl = useLLList<ILCreation>((params) => llCreationList('voiceover', params), isCreationRunning, 5000)

onMounted(async () => {
  const res = await llCreationOptions('voiceover')
  options.value = res.data ?? null
  form.model = res.data?.defaultModel
  form.duration = res.data?.defaultDuration
  void loadBackgrounds()
  void listCtl.reload()
})

// 三栏：中栏历史选中哪条，右栏就预览哪条（null = 跟随最新；原来的预览弹窗由预览区取代）
const { current, select, selectId, followLatest } = useHistorySelection(listCtl.items)
const runningCount = computed(() => listCtl.items.value.filter(isCreationRunning).length)

async function removeItem(item: ILCreation) {
  await llCreationRemove(item.id)
  message.success('已删除')
  // 先在本地摘掉这条：删的若是右栏正在预览的，立即回落到最新一条（不等列表刷新）；随后静默刷新对齐服务端
  listCtl.items.value = listCtl.items.value.filter((i) => i.id !== item.id)
  listCtl.total.value = Math.max(0, listCtl.total.value - 1)
  void listCtl.refresh()
}

watch(bgSource, () => {
  if (bgSource.value === 'PRESET' && !bgList.value.length) void loadBackgrounds()
})
</script>

<template>
  <Workbench
    title="数字人口播"
    :submit="submit"
    :loading="submitting"
    submit-text="生成口播视频"
    submit-hint="人物形象建议用清晰的正面照，也可选一位公共数字人"
    :estimate="estimate"
    :history-count="listCtl.total.value"
  >
    <template #default>
      <FormCard title="口播文案" required>
        <PromptBox v-model="form.content" label="口播文案" size="lg" placeholder="数字人要播报的内容，字数不限">
          <template #actions>
            <PromptActions :loading="aiWriting" @ai="aiWriteContent" @pick="showCopyPicker = true" />
          </template>
        </PromptBox>
      </FormCard>

      <PersonSource
        paste-primary
        v-model:source="portraitSource"
        v-model:image-url="personImage"
        v-model:public-id="personPublicId"
        title="人物形象"
      />

      <FormCard title="背景" :hint="bgSource === 'AI' ? '不选背景，AI 按文案内容自动匹配场景' : ''">
        <SegTabs v-model="bgSource" :options="BG_SEGMENTS" label="背景" />
        <div
          v-if="bgSource === 'PRESET'"
          v-loading="bgLoading"
          class="grid grid-cols-3 gap-8px max-h-220px min-h-80px overflow-auto"
          role="radiogroup"
          aria-label="预设背景"
        >
          <button
            v-for="b in bgList"
            :key="b.id"
            type="button"
            role="radio"
            :aria-checked="bgId === b.id"
            class="relative block p-0 overflow-hidden rounded-lg border border-solid bg-white text-left cursor-pointer sx-focus transition-[border-color,box-shadow] duration-mid ease-sx motion-reduce:transition-none"
            :class="
              bgId === b.id
                ? 'border-violet ring-1 ring-violet'
                : 'border-line hover:(border-violet-line shadow-raised)'
            "
            @click="bgId = b.id"
          >
            <img :src="b.url" alt="" class="block w-full aspect-[9/16] object-cover" />
            <span class="block truncate px-6px py-4px text-12px leading-16px text-ink-2">{{ b.title }}</span>
          </button>
          <div
            v-if="!bgLoading && !bgList.length"
            class="col-span-full rounded-md border border-dashed border-line-strong text-center text-11px leading-[1.65] text-muted py-24px"
          >
            暂无预设背景
          </div>
        </div>
        <ImageUpload
          fromAsset
          v-if="bgSource === 'UPLOAD'"
          v-model:imgList="bgImageList"
          btnName="上传背景图"
          :topRightTips="false"
          :limitNumber="1"
        />
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

    <!-- 三栏（Workbench #history / #preview）：记录从右栏网格移到中栏历史卡，点卡在右栏播放 -->
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
          :title="item.content || '数字人口播'"
          :status="CREATION_STATUS_MAP[item.status]?.type ?? 'running'"
          :status-label="CREATION_STATUS_MAP[item.status]?.label ?? ''"
          :time="item.createTime"
          :thumb="item.inputImageUrl"
          placeholder="视频"
          :fail-reason="item.status === 2 ? item.failReason || '生成失败' : ''"
          :eta-sec="240"
          :selected="current?.id === item.id"
          @select="select(item)"
        >
          <template #actions>
            <IconButton
              v-if="item.status === 1 && item.videoUrl"
              label="下载视频"
              size="sm"
              :href="item.videoUrl"
              target="_blank"
              download
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
              </svg>
            </IconButton>
            <n-popconfirm @positive-click="removeItem(item)">
              <template #trigger>
                <IconButton label="删除记录" size="sm" variant="danger">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
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

    <template #preview>
      <ResultPreview
        :active="!!current"
        :title="current ? current.content || '数字人口播' : ''"
        :status="current ? (CREATION_STATUS_MAP[current.status]?.type ?? 'running') : 'running'"
        :status-label="current ? (CREATION_STATUS_MAP[current.status]?.label ?? '') : ''"
        :time="current?.createTime"
        :video="current?.videoUrl"
        :poster="current?.inputImageUrl"
        :fail-reason="current?.failReason"
        ratio="9 / 16"
      >
        <template v-if="current" #meta>
          <span class="truncate text-ink-2">{{
            [modelLabelOf(current.model), current.duration ? current.duration + 's' : '', current.size]
              .filter(Boolean)
              .join(' · ')
          }}</span>
        </template>
      </ResultPreview>
    </template>
  </Workbench>

  <CopywritingPicker v-model:show="showCopyPicker" @select="pickCopy" />
</template>
