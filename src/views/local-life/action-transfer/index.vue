<script setup lang="ts">
import { modelLabelOf } from '@/utils/model-label'
/**
 * 动作迁移：把一段动作视频里的肢体动作迁移给指定人物。
 * 动作视频二选一：预置（运营维护）/ 我导入的（上传后登记，可删）。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import Workbench from '../components/Workbench/index.vue'
import PersonSource from '../components/PersonSource/index.vue'
import FormCard from '../components/FormCard/index.vue'
import Field from '../components/Field/index.vue'
import SettingsBar from '../components/SettingsBar/index.vue'
import VideoUpload from '@/components/VideoUpload/index.vue'
import {
  llActionVideoImport,
  llActionVideoRemove,
  llActionVideos,
  llCreationList,
  llCreationOptions,
  llCreationRemove,
  llCreationSubmit,
  llIdempotencyHeaders,
} from '@/api/local-life.ts'
import type { ILActionVideo, ILCreation, ILCreationOptions } from '@/api/local-life-types.ts'
import IconButton from '@/components/IconButton/index.vue'
import HistoryList from '../components/HistoryList/index.vue'
import HistoryCard from '../components/HistoryList/HistoryCard.vue'
import { useHistorySelection } from '../components/HistoryList/selection.ts'
import ResultPreview from '../components/ResultPreview/index.vue'
import { useLLQuote } from '../components/Workbench/useLLQuote.ts'
import { useAgreement, useLLList } from '../hooks.ts'
import { CREATION_STATUS_MAP, isCreationRunning } from '../constants.ts'

defineOptions({ name: 'local-life-action-transfer' })

const message = useMessage()
const { ensureAgreed } = useAgreement()

// ---------------- 人物 ----------------

const portraitSource = ref<'UPLOAD' | 'PUBLIC'>('UPLOAD')
const personImage = ref('')
const personPublicId = ref<number | undefined>(undefined)

// ---------------- 动作视频 ----------------

const presets = ref<ILActionVideo[]>([])
const mine = ref<ILActionVideo[]>([])
const loadingVideos = ref(false)
const selectedKey = ref('') // `p:{id}` / `m:{id}`，预置与我的可能同 id，用前缀区分

async function loadVideos() {
  loadingVideos.value = true
  try {
    const res = await llActionVideos()
    presets.value = res.data?.presets ?? []
    mine.value = res.data?.mine ?? []
    if (selectedKey.value && !findVideo(selectedKey.value)) selectedKey.value = ''
  } finally {
    loadingVideos.value = false
  }
}

function findVideo(key: string): ILActionVideo | undefined {
  const [prefix, idStr] = [key[0], Number(key.slice(1))]
  const list = prefix === 'p' ? presets.value : mine.value
  return list.find((v) => v.id === idStr)
}

// 导入动作视频：上传成功后登记
const importList = ref<{ url: string; thumbnail?: string; name?: string }[]>([])
watch(
  importList,
  async (list) => {
    const latest = list[list.length - 1]
    if (!latest?.url) return
    try {
      await llActionVideoImport({ url: latest.url, coverUrl: latest.thumbnail })
      message.success('动作视频已导入')
      importList.value = []
      await loadVideos()
    } catch {
      importList.value = []
    }
  },
  { deep: true },
)

async function removeMine(item: ILActionVideo) {
  await llActionVideoRemove(item.id)
  message.success('已删除')
  await loadVideos()
}

// ---------------- 模型 ----------------

const options = ref<ILCreationOptions | null>(null)
const model = ref<string | undefined>(undefined)
const modelOptions = computed(() =>
  (options.value?.models ?? []).map((o) => ({ label: modelLabelOf(o.label), value: o.code })),
)
/** 底部设置行读写的对象：model 直接映射到 model ref，提交仍读 model */
const modelSetting = reactive({
  get model() {
    return model.value
  },
  set model(value: string | undefined) {
    model.value = value
  },
})

// 提交前报价：按档位计（动作视频时长提交时也未知，后端按档位默认时长计价，与冻结一致）
const { estimate } = useLLQuote(() => ({ tool: 'actionTransfer', model: model.value || undefined }))

// ---------------- 提交 ----------------

const submitting = ref(false)

async function submit() {
  if (submitting.value) return
  if (portraitSource.value === 'UPLOAD' && !personImage.value) return message.warning('请上传人物照片')
  if (portraitSource.value === 'PUBLIC' && !personPublicId.value) return message.warning('请选择一位公共数字人')
  if (!selectedKey.value) return message.warning('请选择一段动作视频')

  if (!(await ensureAgreed())) return

  const video = findVideo(selectedKey.value)
  if (!video) return message.warning('动作视频已失效，请重新选择')

  submitting.value = true
  try {
    const res = await llCreationSubmit(
      {
        kind: 'actionTransfer',
        portrait_source: portraitSource.value,
        ...(portraitSource.value === 'UPLOAD' ? { imageUrl: personImage.value } : { publicId: personPublicId.value }),
        ...(selectedKey.value[0] === 'p' ? { actionVideoId: video.id } : { myActionVideoId: video.id }),
        model: model.value || undefined,
      },
      llIdempotencyHeaders(),
    )
    message.success('已提交，动作迁移生成中')
    // 明确选中接口返回的新记录（不依赖「新记录排第一」）；先刷列表，免得新 id 还不在列表里时预览闪到旧记录
    await listCtl.refresh()
    if (res.data?.id) selectId(res.data.id)
    else followLatest()
  } finally {
    submitting.value = false
  }
}

// ---------------- 右侧：生成记录 ----------------

const listCtl = useLLList<ILCreation>((params) => llCreationList('actionTransfer', params), isCreationRunning, 5000)

onMounted(async () => {
  const res = await llCreationOptions('actionTransfer')
  const data = res.data ?? null
  options.value = data
  if (data?.models?.length) model.value = data.models[0]?.code
  void loadVideos()
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
</script>

<template>
  <Workbench
    title="动作迁移"
    :submit="submit"
    :loading="submitting"
    submit-text="开始迁移"
    :estimate="estimate"
    :history-count="listCtl.total.value"
  >
    <template #default>
      <PersonSource
        paste-primary
        v-model:source="portraitSource"
        v-model:image-url="personImage"
        v-model:public-id="personPublicId"
        title="人物形象"
      />

      <FormCard title="动作视频" required hint="二选一">
        <div v-loading="loadingVideos" class="flex flex-col gap-12px">
          <Field label="预置动作">
            <div class="grid grid-cols-3 gap-8px max-h-200px overflow-auto" role="radiogroup" aria-label="预置动作">
              <button
                v-for="v in presets"
                :key="'p' + v.id"
                type="button"
                role="radio"
                :aria-checked="selectedKey === 'p' + v.id"
                class="group relative block w-full p-0 overflow-hidden rounded-lg border border-solid sx-grad-upload text-left cursor-pointer sx-focus transition-[border-color,box-shadow] duration-mid ease-sx motion-reduce:transition-none"
                :class="
                  selectedKey === 'p' + v.id
                    ? 'border-violet ring-1 ring-violet'
                    : 'border-line hover:(border-violet-line shadow-raised)'
                "
                @click="selectedKey = 'p' + v.id"
              >
                <video
                  :src="v.url"
                  :poster="v.coverUrl"
                  muted
                  preload="metadata"
                  class="block w-full aspect-[9/16] object-cover pointer-events-none"
                />
                <span class="block truncate px-6px py-4px text-11px leading-16px text-ink-2">{{ v.name }}</span>
              </button>
              <div
                v-if="!loadingVideos && !presets.length"
                class="col-span-full rounded-md border border-dashed border-line-strong text-center text-11px leading-[1.65] text-muted py-8px"
              >
                暂无预置动作
              </div>
            </div>
          </Field>

          <Field :label="mine.length ? `我导入的（${mine.length}）` : '我导入的'">
            <div class="grid grid-cols-3 gap-8px max-h-200px overflow-auto" role="radiogroup" aria-label="我导入的">
              <div v-for="v in mine" :key="'m' + v.id" class="group relative">
                <button
                  type="button"
                  role="radio"
                  :aria-checked="selectedKey === 'm' + v.id"
                  class="group relative block w-full p-0 overflow-hidden rounded-lg border border-solid sx-grad-upload text-left cursor-pointer sx-focus transition-[border-color,box-shadow] duration-mid ease-sx motion-reduce:transition-none"
                  :class="
                    selectedKey === 'm' + v.id
                      ? 'border-violet ring-1 ring-violet'
                      : 'border-line hover:(border-violet-line shadow-raised)'
                  "
                  @click="selectedKey = 'm' + v.id"
                >
                  <video
                    :src="v.url"
                    :poster="v.coverUrl"
                    muted
                    preload="metadata"
                    class="block w-full aspect-[9/16] object-cover pointer-events-none"
                  />
                  <span class="block truncate px-6px py-4px text-11px leading-16px text-ink-2">{{ v.name }}</span>
                </button>
                <n-popconfirm @positive-click="removeMine(v)">
                  <template #trigger>
                    <button
                      type="button"
                      class="absolute top-4px right-4px w-24px h-24px flex items-center justify-center p-0 rounded-full border-none bg-black/60 text-14px text-white cursor-pointer sx-hit sx-reveal sx-focus"
                      :aria-label="`删除动作视频：${v.name}`"
                    >
                      ×
                    </button>
                  </template>
                  删除这个动作视频？
                </n-popconfirm>
              </div>
              <!-- 上传槽为通栏设计（限量的角标 + 按钮 + 资产库入口一行），放单格里会被挤压错位，占满一行 -->
              <div class="col-span-full">
                <VideoUpload fromAsset v-model:videoList="importList" btnName="+ 导入动作视频" :limitNumber="1" />
              </div>
            </div>
          </Field>
        </div>
      </FormCard>
    </template>

    <template #settings>
      <SettingsBar v-model:data="modelSetting" :model-options="modelOptions" />
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
          :title="item.model ? '动作迁移 · ' + modelLabelOf(item.model) : '动作迁移'"
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
        :title="'动作迁移'"
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
</template>
