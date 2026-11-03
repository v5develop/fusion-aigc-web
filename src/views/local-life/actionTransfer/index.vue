<script setup lang="ts">
/**
 * 动作迁移：把一段动作视频里的肢体动作迁移给指定人物。
 * 动作视频二选一：预置（运营维护）/ 我导入的（上传后登记，可删）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import Workbench from '../components/Workbench/index.vue'
import PersonSource from '../components/PersonSource/index.vue'
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
} from '@/api/localLife.ts'
import type { ILActionVideo, ILCreation, ILCreationOptions } from '@/api/localLifeTypes.ts'
import { useAgreement, useLLList } from '../hooks.ts'
import { CREATION_STATUS_MAP, formatTime, isCreationRunning } from '../constants.ts'

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
      await llActionVideoImport({ url: latest.url, cover_url: latest.thumbnail })
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
const modelOptions = computed(() => (options.value?.models ?? []).map((o) => ({ label: o.label, value: o.code })))

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
    await llCreationSubmit(
      {
        kind: 'actionTransfer',
        portrait_source: portraitSource.value,
        ...(portraitSource.value === 'UPLOAD' ? { image_url: personImage.value } : { public_id: personPublicId.value }),
        ...(selectedKey.value[0] === 'p' ? { action_video_id: video.id } : { my_action_video_id: video.id }),
        model: model.value || undefined,
      },
      llIdempotencyHeaders(),
    )
    message.success('已提交，动作迁移生成中')
    await listCtl.refresh()
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
</script>

<template>
  <Workbench title="动作迁移" :submit="submit" :loading="submitting" submit-text="开始迁移">
    <template #default>
      <PersonSource
        v-model:source="portraitSource"
        v-model:image-url="personImage"
        v-model:public-id="personPublicId"
        title="人物形象"
      />

      <div class="mb-14px">
        <div class="ll-label">动作视频（二选一）</div>
        <div v-loading="loadingVideos">
          <div class="my-8px text-12px text-muted">预置动作</div>
          <div class="grid grid-cols-3 gap-8px max-h-200px overflow-auto mb-10px">
            <div
              v-for="v in presets"
              :key="'p' + v.id"
              class="group relative overflow-hidden rounded-8px border-2 border-solid bg-surface2 cursor-pointer transition-colors"
              :class="selectedKey === 'p' + v.id ? 'border-violet' : 'border-transparent'"
              @click="selectedKey = 'p' + v.id"
            >
              <video
                :src="v.url"
                :poster="v.cover_url"
                muted
                preload="metadata"
                class="block w-full aspect-[9/16] object-cover pointer-events-none"
              />
              <div class="truncate px-6px py-3px text-11px text-ink-2">{{ v.name }}</div>
            </div>
            <div v-if="!loadingVideos && !presets.length" class="col-span-full ll-empty !text-12px py-8px">
              暂无预置动作
            </div>
          </div>

          <div class="my-8px text-12px text-muted">
            我导入的
            <span v-if="mine.length" class="text-placeholder">（{{ mine.length }}）</span>
          </div>
          <div class="grid grid-cols-3 gap-8px max-h-200px overflow-auto mb-10px">
            <div
              v-for="v in mine"
              :key="'m' + v.id"
              class="group relative overflow-hidden rounded-8px border-2 border-solid bg-surface2 cursor-pointer transition-colors"
              :class="selectedKey === 'm' + v.id ? 'border-violet' : 'border-transparent'"
              @click="selectedKey = 'm' + v.id"
            >
              <video
                :src="v.url"
                :poster="v.cover_url"
                muted
                preload="metadata"
                class="block w-full aspect-[9/16] object-cover pointer-events-none"
              />
              <div class="truncate px-6px py-3px text-11px text-ink-2">{{ v.name }}</div>
              <n-popconfirm @positive-click="removeMine(v)">
                <template #trigger>
                  <span
                    class="absolute top-4px right-4px w-18px h-18px flex items-center justify-center rounded-full bg-black/50 text-10px text-white cursor-pointer opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                    @click.stop
                    >删</span
                  >
                </template>
                删除这个动作视频？
              </n-popconfirm>
            </div>
            <div class="flex items-center justify-center">
              <VideoUpload v-model:videoList="importList" btnName="+ 导入动作视频" :limitNumber="1" />
            </div>
          </div>
        </div>
      </div>

      <div v-if="modelOptions.length" class="mb-14px">
        <div class="ll-label">模型</div>
        <n-select v-model:value="model" size="small" :options="modelOptions" />
      </div>
    </template>

    <template #right>
      <div class="h-full min-h-0 flex flex-col">
        <h2 class="m-0 flex-none mb-14px text-16px font-600 leading-22px text-ink">生成记录</h2>
        <div
          v-loading="listCtl.loading.value"
          class="flex-1 min-h-0 overflow-auto grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-14px content-start"
        >
          <div v-for="item in listCtl.items.value" :key="item.id" class="ll-card overflow-hidden">
            <div class="relative cursor-pointer" @click="openPreview(item)">
              <img
                v-if="item.input_image_url"
                :src="item.input_image_url"
                alt=""
                class="block w-full aspect-[9/16] object-cover"
              />
              <div v-else class="w-full aspect-[9/16] flex items-center justify-center text-32px bg-surface2">🕺</div>
              <div
                class="ll-chip absolute top-6px left-6px"
                :class="`ll-chip-${CREATION_STATUS_MAP[item.status]?.type}`"
              >
                {{ CREATION_STATUS_MAP[item.status]?.label }}
              </div>
              <div
                v-if="item.status === 2"
                class="absolute inset-x-0 bottom-0 truncate px-8px py-4px text-11px text-white bg-[rgba(180,67,62,0.85)]"
              >
                {{ item.fail_reason || '生成失败' }}
              </div>
            </div>
            <div class="flex items-center gap-8px px-10px py-8px text-11px text-muted">
              <span class="text-ink-2">{{ item.model || '-' }}</span>
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

  <n-modal v-model:show="previewShow" preset="card" title="迁移结果" style="width: 420px">
    <video v-if="previewUrl" :src="previewUrl" controls autoplay class="block w-full rounded-8px" />
  </n-modal>
</template>
