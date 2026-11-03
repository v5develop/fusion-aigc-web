<script setup lang="ts">
/**
 * AI海报 / AI长图：同一套 creations 接口，kind 区分。
 * 海报：类型 + 风格 + 模板（必选）+ 素材 + 比例 + 张数；长图：内容 + 模板（必选）+ 素材。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import Workbench from '../components/Workbench/index.vue'
import CopywritingPicker from '../components/CopywritingPicker/index.vue'
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
import type { ILCreation, ILCreationKind, ILCreationOptions } from '@/api/localLifeTypes.ts'
import { useAgreement, useLLList } from '../hooks.ts'
import { CREATION_STATUS_MAP, formatTime, isCreationRunning } from '../constants.ts'

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
  poster_type: '',
  poster_style: '',
  size: '',
  image_count: undefined as number | undefined,
  materials: [] as string[],
  copywriting_id: undefined as number | undefined,
})

const posterTypeOptions = computed(() =>
  (options.value?.poster_types ?? []).map((o) => ({ label: o.label, value: o.code })),
)
const posterStyleOptions = computed(() =>
  (options.value?.poster_styles ?? []).map((o) => ({ label: o.label, value: o.code })),
)
const sizeOptions = computed(() => (options.value?.sizes ?? []).map((o) => ({ label: o.label, value: o.code })))
const imageCountOptions = computed(() => {
  const max = options.value?.max_images ?? 4
  return Array.from({ length: max }, (_, i) => ({ label: `${i + 1}张`, value: i + 1 }))
})
const templateRequired = computed(() => options.value?.template_required ?? false)
const maxMaterials = computed(() => options.value?.max_materials ?? 0)

// ---------------- 模板 ----------------

const templates = ref<{ id: number; title: string; url: string }[]>([])
const templatesLoading = ref(false)
const templateId = ref<number | undefined>(undefined)

async function loadTemplates() {
  templatesLoading.value = true
  try {
    const res = await llCreationTemplates(props.kind, isPoster.value ? form.poster_type || undefined : undefined)
    templates.value = res.data?.list ?? []
    // 类型切换后原模板可能不在新列表里，失效就清掉
    if (templateId.value && !templates.value.some((t) => t.id === templateId.value)) templateId.value = undefined
  } finally {
    templatesLoading.value = false
  }
}

watch(
  () => [props.kind, form.poster_type],
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
  form.copywriting_id = c.id
  showCopyPicker.value = false
}

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
    await llCreationSubmit(
      {
        kind: props.kind,
        content: form.content.trim(),
        template_id: templateId.value,
        poster_type: isPoster.value ? form.poster_type || undefined : undefined,
        poster_style: isPoster.value ? form.poster_style || undefined : undefined,
        size: form.size || undefined,
        image_count: form.image_count,
        material_urls: form.materials.length ? form.materials : undefined,
        copywriting_id: form.copywriting_id,
      },
      llIdempotencyHeaders(),
    )
    message.success('已提交生成')
    form.content = ''
    form.copywriting_id = undefined
    await listCtl.refresh()
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
  if (data?.default_size) form.size = data.default_size
  if (data?.poster_types?.length && !form.poster_type) form.poster_type = data.poster_types[0]?.code ?? ''
  form.image_count = 1
  void listCtl.reload()
})

const previewShow = ref(false)
const previewItem = ref<ILCreation | null>(null)

function openPreview(item: ILCreation) {
  if (item.status !== 1) return
  previewItem.value = item
  previewShow.value = true
}

async function removeItem(item: ILCreation) {
  await llCreationRemove(item.id)
  message.success('已删除')
  void listCtl.refresh()
}
</script>

<template>
  <Workbench :title="pageTitle" :submit="submit" :loading="submitting">
    <template #default>
      <div class="mb-14px">
        <div class="ll-label">
          {{ isPoster ? '海报信息' : '长图内容' }}
          <span class="flex gap-10px">
            <span class="ll-link" :class="{ 'opacity-60 !cursor-not-allowed': aiWriting }" @click="aiWriteContent">{{
              aiWriting ? 'AI帮写中…' : '✨ AI帮写'
            }}</span>
            <span class="ll-link" @click="showCopyPicker = true">选择AI文案</span>
          </span>
        </div>
        <n-input
          v-model:value="form.content"
          type="textarea"
          :rows="5"
          :maxlength="options?.max_content_len || undefined"
          show-count
          :placeholder="
            isPoster ? '活动主题、时间、优惠信息等，画在海报上的文字' : '要放进长图的分段内容，AI 会按模板排版'
          "
        />
      </div>

      <template v-if="isPoster">
        <div class="mb-14px grid grid-cols-2 gap-10px">
          <div class="min-w-0">
            <div class="ll-label">海报类型</div>
            <n-select v-model:value="form.poster_type" size="small" :options="posterTypeOptions" />
          </div>
          <div class="min-w-0">
            <div class="ll-label">风格</div>
            <n-select
              v-model:value="form.poster_style"
              size="small"
              clearable
              :options="posterStyleOptions"
              placeholder="选填"
            />
          </div>
        </div>
      </template>

      <div class="mb-14px">
        <div class="ll-label">模板{{ templateRequired ? '（必选）' : '（选填）' }}</div>
        <div class="grid grid-cols-3 gap-8px max-h-300px overflow-auto" v-loading="templatesLoading">
          <div
            v-for="t in templates"
            :key="t.id"
            class="relative overflow-hidden rounded-8px border-2 border-solid bg-surface2 cursor-pointer transition-colors"
            :class="templateId === t.id ? 'border-violet' : 'border-transparent hover:border-violet-line'"
            @click="templateId = t.id"
          >
            <img :src="t.url" alt="" class="block w-full aspect-[3/4] object-cover" />
            <div class="truncate px-6px py-3px text-11px leading-16px text-ink-2">{{ t.title }}</div>
            <span
              v-if="templateId === t.id"
              class="absolute top-4px right-4px w-18px h-18px flex items-center justify-center rounded-full bg-violet text-12px text-white"
              aria-hidden="true"
              >✓</span
            >
          </div>
          <div v-if="!templatesLoading && !templates.length" class="col-span-full ll-empty !text-12px py-24px">
            暂无模板
          </div>
        </div>
      </div>

      <div class="mb-14px">
        <div class="ll-label">参考素材（选填，最多{{ maxMaterials }}张）</div>
        <ImageUpload
          v-model:imgList="form.materials"
          btnName="上传素材图"
          :topRightTips="false"
          multiple
          :limitNumber="maxMaterials || undefined"
        />
      </div>

      <div class="mb-14px grid grid-cols-2 gap-10px">
        <div class="min-w-0">
          <div class="ll-label">比例</div>
          <n-select
            v-model:value="form.size"
            size="small"
            :options="sizeOptions"
            :disabled="!sizeOptions.length"
            placeholder="默认"
          />
        </div>
        <div class="min-w-0">
          <div class="ll-label">生成张数</div>
          <n-select v-model:value="form.image_count" size="small" :options="imageCountOptions" />
        </div>
      </div>
    </template>

    <template #right>
      <div class="h-full min-h-0 flex flex-col">
        <div class="flex-none mb-14px text-16px font-600 leading-22px text-ink">生成记录</div>
        <div
          class="flex-1 min-h-0 overflow-auto grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] content-start gap-14px"
          v-loading="listCtl.loading.value"
        >
          <div v-for="item in listCtl.items.value" :key="item.id" class="ll-card overflow-hidden">
            <div class="relative cursor-pointer" @click="openPreview(item)">
              <!-- 多张取第一张做封面；视频类封面用输入图兜底 -->
              <img
                v-if="item.image_urls?.length || item.input_image_url"
                :src="item.image_urls[0] || item.input_image_url"
                alt=""
                class="block w-full aspect-[3/4] object-cover"
              />
              <div v-else class="w-full aspect-[3/4] flex items-center justify-center bg-surface2 text-32px">🎨</div>
              <div
                class="ll-chip absolute top-6px left-6px"
                :class="`ll-chip-${CREATION_STATUS_MAP[item.status]?.type}`"
              >
                {{ CREATION_STATUS_MAP[item.status]?.label }}
              </div>
              <div
                v-if="item.image_urls?.length > 1"
                class="absolute top-6px right-6px rounded-full bg-black/45 px-8px py-2px text-11px text-white"
              >
                共{{ item.image_urls.length }}张
              </div>
              <div
                v-if="item.status === 2"
                class="absolute inset-x-0 bottom-0 truncate bg-danger/85 px-8px py-4px text-11px text-white"
              >
                {{ item.fail_reason || '生成失败' }}
              </div>
            </div>
            <div class="flex items-center gap-8px px-10px py-8px text-11px text-muted">
              <span class="text-ink-2">{{ item.size || '-' }}</span>
              <span class="flex-1">{{ formatTime(item.create_time) }}</span>
              <n-popconfirm @positive-click="removeItem(item)">
                <template #trigger><span class="ll-danger-link">删除</span></template>
                确定删除这条记录？
              </n-popconfirm>
            </div>
          </div>
          <div v-if="!listCtl.loading.value && !listCtl.items.value.length" class="col-span-full ll-empty py-80px">
            还没有记录，左侧开始生成吧
          </div>
          <div
            v-if="listCtl.hasMore.value"
            class="col-span-full ll-link block text-center py-8px"
            @click="listCtl.loadMore()"
          >
            加载更多
          </div>
        </div>
      </div>
    </template>
  </Workbench>

  <CopywritingPicker v-model:show="showCopyPicker" @select="pickCopy" />

  <n-modal v-model:show="previewShow" preset="card" :title="pageTitle" class="!w-640px">
    <div v-if="previewItem" class="grid grid-cols-2 gap-10px">
      <img v-for="url in previewItem.image_urls" :key="url" :src="url" alt="" class="block w-full rounded-8px" />
    </div>
  </n-modal>
</template>
