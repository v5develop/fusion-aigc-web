<script setup lang="ts">
/**
 * AI海报 / AI长图：同一套 creations 接口，kind 区分。
 * 海报：类型 + 风格 + 模板（必选）+ 素材 + 比例 + 张数；长图：内容 + 模板（必选）+ 素材。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import Workbench from '../components/Workbench/index.vue'
import CopywritingPicker from '../components/CopywritingPicker/index.vue'
import FormCard from '../components/FormCard/index.vue'
import Field from '../components/Field/index.vue'
import ChipGroup from '../components/ChipGroup/index.vue'
import PromptBox from '../components/PromptBox/index.vue'
import PromptActions from '../components/PromptActions/index.vue'
import SettingsBar from '../components/SettingsBar/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import IconButton from '@/components/IconButton/index.vue'
import HistoryList from '../components/HistoryList/index.vue'
import HistoryCard from '../components/HistoryList/HistoryCard.vue'
import { useHistorySelection } from '../components/HistoryList/selection.ts'
import ResultPreview from '../components/ResultPreview/index.vue'
import { useLLQuote } from '../components/Workbench/useLLQuote.ts'
import {
  llCopywritingAiWrite,
  llCreationList,
  llCreationOptions,
  llCreationRemove,
  llCreationSubmit,
  llCreationTemplates,
  llIdempotencyHeaders,
} from '@/api/local-life.ts'
import type { ILCreation, ILCreationKind, ILCreationOptions } from '@/api/local-life-types.ts'
import { useAgreement, useLLList } from '../hooks.ts'
import { CREATION_STATUS_MAP, isCreationRunning } from '../constants.ts'

const props = defineProps<{ kind: ILCreationKind }>()

const isPoster = computed(() => props.kind === 'poster')
const pageTitle = computed(() => (isPoster.value ? 'AI海报' : 'AI长图'))

defineOptions({ name: 'local-life-poster' })

const message = useMessage()
const { ensureAgreed } = useAgreement()

// ---------------- 表单 ----------------

const options = ref<ILCreationOptions | null>(null)
const form = reactive({
  content: '',
  posterType: '',
  posterStyle: '',
  size: '',
  imageCount: undefined as number | undefined,
  materials: [] as string[],
  copywritingId: undefined as number | undefined,
})

const posterTypeOptions = computed(() =>
  (options.value?.posterTypes ?? []).map((o) => ({ label: o.label, value: o.code })),
)
const posterStyleOptions = computed(() =>
  (options.value?.posterStyles ?? []).map((o) => ({ label: o.label, value: o.code })),
)
const sizeOptions = computed(() => (options.value?.sizes ?? []).map((o) => ({ label: o.label, value: o.code })))
const imageCountOptions = computed(() => {
  const max = options.value?.maxImages ?? 4
  return Array.from({ length: max }, (_, i) => ({ label: `${i + 1}张`, value: i + 1 }))
})
const templateRequired = computed(() => options.value?.templateRequired ?? false)
const maxMaterials = computed(() => options.value?.maxMaterials ?? 0)

// ---------------- 模板 ----------------

const templates = ref<{ id: number; title: string; url: string }[]>([])
const templatesLoading = ref(false)
const templateId = ref<number | undefined>(undefined)

async function loadTemplates() {
  templatesLoading.value = true
  try {
    const res = await llCreationTemplates(props.kind, isPoster.value ? form.posterType || undefined : undefined)
    templates.value = res.data?.list ?? []
    // 类型切换后原模板可能不在新列表里，失效就清掉
    if (templateId.value && !templates.value.some((t) => t.id === templateId.value)) templateId.value = undefined
  } finally {
    templatesLoading.value = false
  }
}

watch(
  () => [props.kind, form.posterType],
  () => {
    void loadTemplates()
  },
)

// ---------------- AI帮写 / 选择AI文案 ----------------

const showCopyPicker = ref(false)
const aiWriting = ref(false)

async function aiWriteContent() {
  aiWriting.value = true
  try {
    const res = await llCopywritingAiWrite({
      scene: isPoster.value ? 'poster_info' : 'long_image',
      context: form.content.trim() || undefined,
    })
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

// 提交前报价：按张计（海报档位不影响价格），提交即冻结
const { estimate } = useLLQuote(() => ({ tool: props.kind, imageCount: form.imageCount }))

// ---------------- 提交 ----------------

const submitting = ref(false)

async function submit() {
  if (submitting.value) return
  if (!form.content.trim()) return message.warning(isPoster.value ? '请输入海报信息' : '请输入长图内容')
  if (templateRequired.value && !templateId.value) return message.warning('请选择一个模板')
  if (form.materials.length > maxMaterials.value) return message.warning(`素材最多 ${maxMaterials.value} 张`)

  if (!(await ensureAgreed())) return

  submitting.value = true
  try {
    const res = await llCreationSubmit(
      {
        kind: props.kind,
        content: form.content.trim(),
        templateId: templateId.value,
        posterType: isPoster.value ? form.posterType || undefined : undefined,
        posterStyle: isPoster.value ? form.posterStyle || undefined : undefined,
        size: form.size || undefined,
        imageCount: form.imageCount,
        materialUrls: form.materials.length ? form.materials : undefined,
        copywritingId: form.copywritingId,
      },
      llIdempotencyHeaders(),
    )
    message.success('已提交生成')
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

// ---------------- 右侧：生成记录 ----------------

const listCtl = useLLList<ILCreation>((params) => llCreationList(props.kind, params), isCreationRunning, 4000)

onMounted(async () => {
  const res = await llCreationOptions(props.kind)
  const data = res.data ?? null
  options.value = data
  if (data?.defaultSize) form.size = data.defaultSize
  if (data?.posterTypes?.length && !form.posterType) form.posterType = data.posterTypes[0]?.code ?? ''
  form.imageCount = 1
  void listCtl.reload()
})

// 三栏：中栏历史选中哪条，右栏就预览哪条（null = 跟随最新）
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
</script>

<template>
  <Workbench
    :title="pageTitle"
    :submit="submit"
    :loading="submitting"
    :estimate="estimate"
    :history-count="listCtl.total.value"
  >
    <template #default>
      <FormCard :title="isPoster ? '海报信息' : '长图内容'" required>
        <PromptBox
          v-model="form.content"
          :label="isPoster ? '海报信息' : '长图内容'"
          size="lg"
          :max-length="options?.maxContentLen || undefined"
          :placeholder="
            isPoster ? '活动主题、时间、优惠信息等，画在海报上的文字' : '要放进长图的分段内容，AI 会按模板排版'
          "
        >
          <template #actions>
            <PromptActions :loading="aiWriting" @ai="aiWriteContent" @pick="showCopyPicker = true" />
          </template>
        </PromptBox>
      </FormCard>

      <FormCard v-if="isPoster" title="海报偏好">
        <Field label="海报类型">
          <ChipGroup v-model="form.posterType" :options="posterTypeOptions" label="海报类型" />
        </Field>
        <Field label="风格">
          <ChipGroup v-model="form.posterStyle" :options="posterStyleOptions" label="风格" empty-label="不限" />
        </Field>
      </FormCard>

      <FormCard title="模板" :required="templateRequired" :hint="templateRequired ? '必选' : '选填'">
        <div
          v-loading="templatesLoading"
          class="grid grid-cols-3 gap-8px max-h-300px min-h-80px overflow-auto"
          role="radiogroup"
          aria-label="模板"
        >
          <button
            v-for="t in templates"
            :key="t.id"
            type="button"
            role="radio"
            :aria-checked="templateId === t.id"
            class="relative block p-0 overflow-hidden rounded-lg border border-solid sx-grad-upload text-left cursor-pointer sx-focus transition-[border-color,box-shadow] duration-mid ease-sx motion-reduce:transition-none"
            :class="
              templateId === t.id
                ? 'border-violet ring-1 ring-violet'
                : 'border-line hover:(border-violet-line shadow-raised)'
            "
            @click="templateId = t.id"
          >
            <img :src="t.url" alt="" class="block w-full aspect-[3/4] object-cover" />
            <span class="block truncate px-6px py-4px text-11px leading-16px text-ink-2">{{ t.title }}</span>
            <span
              v-if="templateId === t.id"
              class="absolute top-4px right-4px w-18px h-18px flex items-center justify-center rounded-full sx-grad-primary shadow-btn text-12px text-white"
              aria-hidden="true"
              >✓</span
            >
          </button>
          <div
            v-if="!templatesLoading && !templates.length"
            class="col-span-full rounded-md border border-dashed border-line-strong text-center text-11px leading-[1.65] text-muted py-24px"
          >
            暂无模板
          </div>
        </div>
      </FormCard>

      <FormCard title="参考素材" :hint="`选填 · 最多 ${maxMaterials} 张`">
        <ImageUpload
          fromAsset
          v-model:imgList="form.materials"
          btnName="上传素材图"
          :topRightTips="false"
          multiple
          :limitNumber="maxMaterials || undefined"
        />
      </FormCard>
    </template>

    <template #settings>
      <SettingsBar
        v-model:data="form"
        :fields="[
          { field: 'size', label: '比例', options: sizeOptions },
          { field: 'image_count', label: '生成张数', options: imageCountOptions },
        ]"
      />
    </template>

    <!-- 三栏（Workbench #history / #preview）：记录从右栏网格移到中栏历史卡，点卡在右栏预览（原来的预览弹窗由预览区取代） -->
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
          :title="item.content || pageTitle"
          :status="CREATION_STATUS_MAP[item.status]?.type ?? 'running'"
          :status-label="CREATION_STATUS_MAP[item.status]?.label ?? ''"
          :time="item.createTime"
          :thumb="item.imageUrls?.[0] || item.inputImageUrl"
          :count="item.imageUrls?.length ?? 0"
          :fail-reason="item.status === 2 ? item.failReason || '生成失败' : ''"
          :eta-sec="90"
          :selected="current?.id === item.id"
          @select="select(item)"
        >
          <template #actions>
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
        :title="current?.content || pageTitle"
        :status="current ? (CREATION_STATUS_MAP[current.status]?.type ?? 'running') : 'running'"
        :status-label="current ? (CREATION_STATUS_MAP[current.status]?.label ?? '') : ''"
        :time="current?.createTime"
        :images="current?.imageUrls ?? []"
        :fail-reason="current?.failReason"
        :record-id="current?.id"
        ratio="3 / 4"
      >
        <template v-if="current?.size" #meta>
          <span class="truncate text-ink-2">{{ current.size }}</span>
        </template>
      </ResultPreview>
    </template>
  </Workbench>

  <CopywritingPicker v-model:show="showCopyPicker" @select="pickCopy" />
</template>
