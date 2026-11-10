<script setup lang="ts">
import { modelLabelOf } from '@/utils/modelLabel'
/**
 * AI数字人工作台：形象（上传/公共/AI定制）+ 系统音色 + 配音内容 → 口播视频。
 * 生成前必须已同意《AIGC功能使用约定》（后端 1007，前端先弹约定弹窗）。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import Workbench from '../components/Workbench/index.vue'
import PersonSource from '../components/PersonSource/index.vue'
import CopywritingPicker from '../components/CopywritingPicker/index.vue'
import FormCard from '../components/FormCard/index.vue'
import ChipGroup from '../components/ChipGroup/index.vue'
import PromptBox from '../components/PromptBox/index.vue'
import PromptActions from '../components/PromptActions/index.vue'
import SettingsBar from '../components/SettingsBar/index.vue'
import {
  llCopywritingAiWrite,
  llCreateDigitalHuman,
  llDhOptions,
  llDigitalHumanList,
  llDigitalHumanRemove,
  llIdempotencyHeaders,
  llVoiceCategories,
  llVoices,
} from '@/api/localLife.ts'
import type {
  ILCreateDigitalHumanReq,
  ILDigitalHuman,
  ILDhOptions,
  ILPortraitSource,
  ILVoice,
} from '@/api/localLifeTypes.ts'
import IconButton from '@/components/IconButton/index.vue'
import HistoryList from '../components/HistoryList/index.vue'
import HistoryCard from '../components/HistoryList/HistoryCard.vue'
import { useHistorySelection } from '../components/HistoryList/selection.ts'
import ResultPreview from '../components/ResultPreview/index.vue'
import { useLLQuote } from '../components/Workbench/useLLQuote.ts'
import { useAgreement, useLLList } from '../hooks.ts'
import { DH_STATUS_MAP, isDhRunning } from '../constants.ts'

defineOptions({ name: 'local-life-digital-human' })

const message = useMessage()
const { ensureAgreed } = useAgreement()

// ---------------- 形象 ----------------

const portraitSource = ref<ILPortraitSource>('UPLOAD')
const personImage = ref('')
const personPublicId = ref<number | undefined>(undefined)
const personPortraitId = ref<number | undefined>(undefined)
const personImageIndex = ref(0)

// ---------------- 音色 ----------------

const voiceCategories = ref<{ code: string; label: string; value: string }[]>([])
const activeCategory = ref<string | null>(null)
const voices = ref<ILVoice[]>([])
const voicesLoading = ref(false)
const voiceId = ref<number | undefined>(undefined)
const selectedVoice = computed(() => voices.value.find((v) => v.id === voiceId.value))

async function loadVoices() {
  voicesLoading.value = true
  try {
    const res = await llVoices(activeCategory.value ?? undefined)
    voices.value = res.data?.list ?? []
  } finally {
    voicesLoading.value = false
  }
}

watch(activeCategory, loadVoices)

// 试听：全局只放一个音频，切播自动互斥
const audioEl = ref<HTMLAudioElement | null>(null)
const playingId = ref<number | null>(null)

function preview(voice: ILVoice) {
  const el = audioEl.value
  if (!el) return
  if (playingId.value === voice.id) {
    el.pause()
    return
  }
  el.src = voice.preview_url
  el.play()
  playingId.value = voice.id
}

function onAudioEnd() {
  playingId.value = null
}

function onAudioPause() {
  playingId.value = null
}

// ---------------- 配音内容 ----------------

const dhOptions = ref<ILDhOptions | null>(null)
const script = ref('')
const scriptModel = ref<string | undefined>(undefined)
const copywritingId = ref<number | undefined>(undefined)
const showCopyPicker = ref(false)
const aiWriting = ref(false)

const modelOptions = computed(() => (dhOptions.value?.models ?? []).map((o) => ({ label: modelLabelOf(o.label), value: o.code })))
const selectedModel = computed(() => modelOptions.value.find((o) => o.value === scriptModel.value))
const maxScriptLen = computed(() => dhOptions.value?.max_script_len ?? 50)
/** 配音内容卡头说明：随出片模型档变化（原「出片模型」下拉下面那句） */
const scriptHint = computed(() =>
  selectedModel.value?.value === 'lite' ? 'Lite 档更省点数，配音最长 25 秒' : '默认档，配音最长 30 秒',
)
/** 底部设置行读写的对象：model 直接映射到 scriptModel，提交仍读 scriptModel */
const modelSetting = reactive({
  get model() {
    return scriptModel.value
  },
  set model(value: string | undefined) {
    scriptModel.value = value
  },
})

async function aiWriteScript() {
  aiWriting.value = true
  try {
    const res = await llCopywritingAiWrite({ scene: 'dh_script', context: script.value.trim() || undefined })
    script.value = res.data?.text ?? ''
    copywritingId.value = undefined
  } finally {
    aiWriting.value = false
  }
}

function pickCopy(c: { id: number; body: string }) {
  script.value = c.body
  copywritingId.value = c.id
  showCopyPicker.value = false
}

// 提交前报价：按配音实际时长计费，提交前时长未知——后端给最短时长的价（显示「N 点起」），配音出来后才冻结
const { quote, estimate } = useLLQuote(() => ({ tool: 'digitalHuman', model: scriptModel.value || undefined }))
// 余额够最低价、但不够该档最长配音的价（sufficient_max=false）：只轻提示，不拦提交（配音短的话照样够）
const balanceHint = computed(() => {
  const q = quote.value
  if (!q || !q.available || !q.charged || !q.balance_known || q.sufficient_max !== false) return undefined
  return '余额可能不足以覆盖较长配音'
})

// ---------------- 提交 ----------------

const submitting = ref(false)

async function submit() {
  if (submitting.value) return

  if (portraitSource.value === 'UPLOAD' && !personImage.value) return message.warning('请上传人物照片')
  if (portraitSource.value === 'PUBLIC' && !personPublicId.value) return message.warning('请选择一位公共数字人')
  if (portraitSource.value === 'AI' && !personPortraitId.value) return message.warning('请先生成并选择一张定制形象')
  if (!voiceId.value) return message.warning('请选择一个音色')
  if (!script.value.trim()) return message.warning('请输入配音内容')
  if (script.value.length > maxScriptLen.value) return message.warning(`配音内容最多 ${maxScriptLen.value} 字`)

  if (!(await ensureAgreed())) return

  submitting.value = true
  try {
    const body: ILCreateDigitalHumanReq = {
      portrait_source: portraitSource.value,
      voice_id: voiceId.value,
      script: script.value.trim(),
      model: scriptModel.value || undefined,
      copywriting_id: copywritingId.value,
    }
    if (portraitSource.value === 'UPLOAD') body.image_url = personImage.value
    if (portraitSource.value === 'PUBLIC') body.public_id = personPublicId.value
    if (portraitSource.value === 'AI') {
      body.portrait_id = personPortraitId.value
      body.image_index = personImageIndex.value
    }
    const res = await llCreateDigitalHuman(body, llIdempotencyHeaders())
    message.success('已提交，数字人生成中')
    // 明确选中接口返回的新记录（不依赖「新记录排第一」）；先刷列表，免得新 id 还不在列表里时预览闪到旧记录
    await listCtl.refresh()
    if (res.data?.id) selectId(res.data.id)
    else followLatest()
  } finally {
    submitting.value = false
  }
}

// ---------------- 右侧：我的数字人 ----------------

const listCtl = useLLList<ILDigitalHuman>((params) => llDigitalHumanList(params), isDhRunning, 4000)
onMounted(async () => {
  void listCtl.reload()
  void loadVoices()
  const catRes = await llVoiceCategories()
  voiceCategories.value = catRes.data?.list ?? []
  const res = await llDhOptions()
  const data = res.data ?? null
  dhOptions.value = data
  // 出片模型默认档：后端下发第一项
  if (data?.models?.length) scriptModel.value = data.models[0]?.code
})

// 三栏：中栏历史选中哪条，右栏就预览哪条（null = 跟随最新；原来的预览弹窗由预览区取代）
const { current, select, selectId, followLatest } = useHistorySelection(listCtl.items)
const runningCount = computed(() => listCtl.items.value.filter(isDhRunning).length)

async function removeItem(item: ILDigitalHuman) {
  await llDigitalHumanRemove(item.id)
  message.success('已删除')
  // 先在本地摘掉这条：删的若是右栏正在预览的，立即回落到最新一条（不等列表刷新）；随后静默刷新对齐服务端
  listCtl.items.value = listCtl.items.value.filter((i) => i.id !== item.id)
  listCtl.total.value = Math.max(0, listCtl.total.value - 1)
  void listCtl.refresh()
}
</script>

<template>
  <Workbench title="AI数字人" :submit="submit" :loading="submitting" submit-text="生成数字人" :submit-hint="balanceHint" :estimate="estimate" :history-count="listCtl.total.value">
    <template #default>
      <PersonSource
        v-model:source="portraitSource"
        v-model:image-url="personImage"
        v-model:public-id="personPublicId"
        v-model:portrait-id="personPortraitId"
        v-model:image-index="personImageIndex"
        :enable-ai="true"
      />

      <FormCard title="音色" required :hint="selectedVoice ? `已选：${selectedVoice.name}` : ''">
        <ChipGroup
          v-model="activeCategory"
          :options="voiceCategories.map((c) => ({ label: c.label, value: c.code }))"
          label="音色分类"
          empty-label="全部"
          :empty-value="null"
        />
        <div
          v-loading="voicesLoading"
          class="max-h-232px min-h-60px overflow-auto flex flex-col gap-6px"
          role="radiogroup"
          aria-label="音色"
        >
          <div
            v-for="voice in voices"
            :key="voice.id"
            role="radio"
            :aria-checked="voiceId === voice.id"
            tabindex="0"
            class="flex items-center justify-between gap-8px min-h-44px box-border px-12px py-6px rounded-md border border-solid cursor-pointer sx-focus transition-[border-color,background,box-shadow] duration-mid ease-sx motion-reduce:transition-none"
            :class="
              voiceId === voice.id
                ? 'border-violet-line sx-grad-tint shadow-[0_1px_2px_rgba(31,35,41,0.05)]'
                : 'border-line bg-white hover:(border-violet-line shadow-raised)'
            "
            @click="voiceId = voice.id"
            @keydown.enter.prevent="voiceId = voice.id"
            @keydown.space.prevent="voiceId = voice.id"
          >
            <div class="min-w-0 flex flex-col gap-2px">
              <span
                class="truncate text-13px leading-18px"
                :class="voiceId === voice.id ? 'font-600 text-violet-ink' : 'font-500 text-ink'"
                >{{ voice.name }}</span
              >
              <span class="truncate text-11px leading-16px text-muted">{{ voice.style }}</span>
            </div>
            <button
              type="button"
              class="sx-btn !h-28px !px-10px !text-12px flex-none transition-[border-color,color] duration-fast"
              :class="{ '!text-violet-ink !border-violet-line': playingId === voice.id }"
              :aria-label="`${playingId === voice.id ? '停止' : '试听'}：${voice.name}`"
              @click.stop="preview(voice)"
            >
              {{ playingId === voice.id ? '停止' : '试听' }}
            </button>
          </div>
          <div
            v-if="!voicesLoading && !voices.length"
            class="rounded-md border border-dashed border-line-strong text-center text-11px leading-[1.65] text-muted py-16px"
          >
            该分类暂无音色
          </div>
        </div>
      </FormCard>

      <FormCard title="配音内容" required :hint="modelOptions.length ? scriptHint : ''">
        <PromptBox
          v-model="script"
          label="配音内容"
          :max-length="maxScriptLen"
          placeholder="数字人要说的话，50 字以内口播效果最佳"
        >
          <template #actions>
            <PromptActions :loading="aiWriting" @ai="aiWriteScript" @pick="showCopyPicker = true" />
          </template>
        </PromptBox>
      </FormCard>
    </template>

    <template #settings>
      <SettingsBar v-model:data="modelSetting" :model-options="modelOptions" />
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
          :title="item.name || '数字人'"
          :status="DH_STATUS_MAP[item.status]?.type ?? 'running'"
          :status-label="DH_STATUS_MAP[item.status]?.label ?? ''"
          :time="item.create_time"
          :thumb="item.cover_url || item.image_url"
          placeholder="视频"
          :fail-reason="item.status === 3 ? item.fail_reason || '生成失败' : ''"
          :eta-sec="240"
          :selected="current?.id === item.id"
          @select="select(item)"
        >
          <template #actions>
            <IconButton
              v-if="item.status === 2 && item.video_url"
              label="下载视频"
              size="sm"
              :href="item.video_url"
              target="_blank"
              download
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
              </svg>
            </IconButton>
            <n-popconfirm @positive-click="removeItem(item)">
              <template #trigger>
                <IconButton label="删除记录" size="sm" variant="danger">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
                  </svg>
                </IconButton>
              </template>
              确定删除这个数字人？
            </n-popconfirm>
          </template>
        </HistoryCard>
      </HistoryList>
    </template>

    <template #preview>
      <ResultPreview
        :active="!!current"
        :title="current?.name || '数字人'"
        :status="current ? (DH_STATUS_MAP[current.status]?.type ?? 'running') : 'running'"
        :status-label="current ? (DH_STATUS_MAP[current.status]?.label ?? '') : ''"
        :time="current?.create_time"
        :video="current?.status === 2 ? current.video_url : undefined"
        :poster="current?.cover_url || current?.image_url"
        :fail-reason="current?.status === 3 ? current.fail_reason : ''"
        ratio="9 / 16"
      >
        <template v-if="current" #meta>
          <span class="truncate text-ink-2">{{ [current.voice_name, current.duration ? current.duration + 's' : '', modelLabelOf(current.model)].filter(Boolean).join(' · ') }}</span>
        </template>
      </ResultPreview>
    </template>
  </Workbench>

  <audio ref="audioEl" @ended="onAudioEnd" @pause="onAudioPause" />

  <CopywritingPicker v-model:show="showCopyPicker" @select="pickCopy" />
</template>
