<script setup lang="ts">
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
import {
  llCopywritingAiWrite,
  llCreationList,
  llCreationOptions,
  llCreationRemove,
  llCreationSubmit,
  llCreationTemplates,
  llIdempotencyHeaders,
} from '@/api/localLife.ts'
import type { ILCreation, ILCreationOptions } from '@/api/localLifeTypes.ts'
import { useAgreement, useLLList } from '../hooks.ts'
import { CREATION_STATUS_MAP, formatTime, isCreationRunning } from '../constants.ts'

defineOptions({ name: 'local-life-voiceover' })

const message = useMessage()
const { ensureAgreed } = useAgreement()

const BG_SEGMENTS = [
  { key: 'AI', label: 'AI智能匹配' },
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
  copywriting_id: undefined as number | undefined,
})

const portraitSource = ref<'UPLOAD' | 'PUBLIC'>('UPLOAD')
const personImage = ref('')
const personPublicId = ref<number | undefined>(undefined)

const modelOptions = computed(() => (options.value?.models ?? []).map((o) => ({ label: o.label, value: o.code })))
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
  form.copywriting_id = c.id
  showCopyPicker.value = false
}

// ---------------- 提交 ----------------

const submitting = ref(false)

async function submit() {
  if (submitting.value) return
  if (!form.content.trim()) return message.warning('请输入口播文案')
  if (portraitSource.value === 'UPLOAD' && !personImage.value) return message.warning('请上传人物照片')
  if (portraitSource.value === 'PUBLIC' && !personPublicId.value) return message.warning('请选择一位公共数字人')
  if (bgSource.value === 'PRESET' && !bgId.value) return message.warning('请选择一个背景')

  if (!(await ensureAgreed())) return

  submitting.value = true
  try {
    await llCreationSubmit(
      {
        kind: 'voiceover',
        content: form.content.trim(),
        portrait_source: portraitSource.value,
        ...(portraitSource.value === 'UPLOAD' ? { image_url: personImage.value } : { public_id: personPublicId.value }),
        background_source: bgSource.value,
        background_id: bgSource.value === 'PRESET' ? bgId.value : undefined,
        background_url: bgSource.value === 'UPLOAD' ? bgUrl.value : undefined,
        model: form.model || undefined,
        duration: form.duration,
        size: form.size || undefined,
        copywriting_id: form.copywriting_id,
      },
      llIdempotencyHeaders(),
    )
    message.success('已提交，口播视频生成中')
    form.content = ''
    form.copywriting_id = undefined
    await listCtl.refresh()
  } finally {
    submitting.value = false
  }
}

// ---------------- 右侧：生成记录（视频） ----------------

const listCtl = useLLList<ILCreation>((params) => llCreationList('voiceover', params), isCreationRunning, 5000)

onMounted(async () => {
  const res = await llCreationOptions('voiceover')
  options.value = res.data ?? null
  form.model = res.data?.default_model
  form.duration = res.data?.default_duration
  void loadBackgrounds()
  void listCtl.reload()
})

const previewShow = ref(false)
const previewUrl = ref('')

function openPreview(item: ILCreation) {
  if (item.status !== 1 || !item.video_url) return
  previewUrl.value = item.video_url
  previewShow.value = true
}

async function removeItem(item: ILCreation) {
  await llCreationRemove(item.id)
  message.success('已删除')
  void listCtl.refresh()
}

watch(bgSource, () => {
  if (bgSource.value === 'PRESET' && !bgList.value.length) void loadBackgrounds()
})
</script>

<template>
  <Workbench title="数字人口播" :submit="submit" :loading="submitting" submit-text="生成口播视频">
    <template #default>
      <FormCard title="口播文案" required>
        <PromptBox v-model="form.content" label="口播文案" size="lg" placeholder="数字人要播报的内容，字数不限">
          <template #actions>
            <PromptActions :loading="aiWriting" @ai="aiWriteContent" @pick="showCopyPicker = true" />
          </template>
        </PromptBox>
      </FormCard>

      <PersonSource
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
            <span class="block truncate px-6px py-4px text-11px leading-16px text-ink-2">{{ b.title }}</span>
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

    <template #right>
      <div class="h-full min-h-0 flex flex-col">
        <h2 class="m-0 mb-14px flex-none text-16px font-600 leading-22px text-ink">生成记录</h2>
        <div
          v-loading="listCtl.loading.value"
          class="flex-1 min-h-0 overflow-auto grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-14px content-start"
        >
          <div
            v-for="item in listCtl.items.value"
            :key="item.id"
            class="bg-white rounded-lg border border-solid border-line shadow-card-v3 overflow-hidden"
          >
            <div class="relative cursor-pointer" @click="openPreview(item)">
              <img
                v-if="item.input_image_url"
                :src="item.input_image_url"
                alt=""
                class="block w-full aspect-[9/16] object-cover"
              />
              <div v-else class="w-full aspect-[9/16] flex items-center justify-center text-32px sx-grad-icon">🎙️</div>
              <div
                class="sx-chip flex-shrink-0 absolute top-6px left-6px"
                :class="`ll-chip-${CREATION_STATUS_MAP[item.status]?.type}`"
              >
                {{ CREATION_STATUS_MAP[item.status]?.label }}
              </div>
              <div
                v-if="item.status === 2"
                class="absolute inset-x-0 bottom-0 truncate px-8px py-4px bg-danger/85 text-11px text-white"
              >
                {{ item.fail_reason || '生成失败' }}
              </div>
            </div>
            <div class="px-10px py-8px flex flex-col gap-2px">
              <span class="line-clamp-2 text-12px leading-17px text-ink">{{ item.content }}</span>
              <span class="text-11px leading-16px text-muted"
                >{{ item.duration ? item.duration + 's' : '' }} {{ item.size }} {{ formatTime(item.create_time) }}</span
              >
              <n-popconfirm @positive-click="removeItem(item)">
                <template #trigger
                  ><span class="ll-danger-link transition-colors duration-fast w-fit text-11px">删除</span></template
                >
                确定删除这条记录？
              </n-popconfirm>
            </div>
          </div>
          <div
            v-if="!listCtl.loading.value && !listCtl.items.value.length"
            class="col-span-full sx-empty !min-h-240px text-12px leading-[1.65] text-muted"
          >
            还没有记录，左侧开始生成吧
          </div>
          <div
            v-if="listCtl.hasMore.value"
            class="col-span-full ll-link transition-colors duration-fast block text-center py-8px"
            @click="listCtl.loadMore()"
          >
            加载更多
          </div>
        </div>
      </div>
    </template>
  </Workbench>

  <CopywritingPicker v-model:show="showCopyPicker" @select="pickCopy" />

  <n-modal v-model:show="previewShow" preset="card" title="口播视频" class="!w-420px">
    <video v-if="previewUrl" :src="previewUrl" controls autoplay class="block w-full rounded-8px" />
  </n-modal>
</template>
