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
watch(importList, async (list) => {
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
}, { deep: true })

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

      <div class="field">
        <div class="label">动作视频（二选一）</div>
        <div class="video-group" v-loading="loadingVideos">
          <div class="group-title">预置动作</div>
          <div class="video-grid">
            <div
              v-for="v in presets"
              :key="'p' + v.id"
              class="video-card"
              :class="{ selected: selectedKey === 'p' + v.id }"
              @click="selectedKey = 'p' + v.id"
            >
              <video :src="v.url" :poster="v.cover_url" muted preload="metadata" />
              <div class="name">{{ v.name }}</div>
            </div>
            <div v-if="!loadingVideos && !presets.length" class="empty">暂无预置动作</div>
          </div>

          <div class="group-title">
            我导入的
            <span v-if="mine.length" class="count">（{{ mine.length }}）</span>
          </div>
          <div class="video-grid">
            <div
              v-for="v in mine"
              :key="'m' + v.id"
              class="video-card"
              :class="{ selected: selectedKey === 'm' + v.id }"
              @click="selectedKey = 'm' + v.id"
            >
              <video :src="v.url" :poster="v.cover_url" muted preload="metadata" />
              <div class="name">{{ v.name }}</div>
              <n-popconfirm @positive-click="removeMine(v)">
                <template #trigger><span class="del" @click.stop>删</span></template>
                删除这个动作视频？
              </n-popconfirm>
            </div>
            <div class="import-area">
              <VideoUpload v-model:videoList="importList" btnName="+ 导入动作视频" :limitNumber="1" />
            </div>
          </div>
        </div>
      </div>

      <div v-if="modelOptions.length" class="field">
        <div class="label">模型</div>
        <n-select v-model:value="model" size="small" :options="modelOptions" />
      </div>
    </template>

    <template #right>
      <div class="right-inner">
        <div class="list-title">生成记录</div>
        <div class="record-grid" v-loading="listCtl.loading.value">
          <div v-for="item in listCtl.items.value" :key="item.id" class="record-card">
            <div class="cover" @click="openPreview(item)">
              <img v-if="item.input_image_url" :src="item.input_image_url" alt="" />
              <div v-else class="cover-fallback">🕺</div>
              <div class="ll-chip" :class="`ll-chip-${CREATION_STATUS_MAP[item.status]?.type}`">{{ CREATION_STATUS_MAP[item.status]?.label }}</div>
              <div v-if="item.status === 2" class="fail-tip">{{ item.fail_reason || '生成失败' }}</div>
            </div>
            <div class="meta">
              <span class="model">{{ item.model || '-' }}</span>
              <span class="time">{{ formatTime(item.create_time) }}</span>
              <n-popconfirm @positive-click="removeItem(item)">
                <template #trigger><span class="del">删除</span></template>
                确定删除这条记录？
              </n-popconfirm>
            </div>
          </div>
          <div v-if="!listCtl.loading.value && !listCtl.items.value.length" class="empty">还没有记录，左侧开始生成吧</div>
          <div v-if="listCtl.hasMore.value" class="more" @click="listCtl.loadMore()">加载更多</div>
        </div>
      </div>
    </template>
  </Workbench>

  <n-modal v-model:show="previewShow" preset="card" title="迁移结果" style="width: 420px">
    <video v-if="previewUrl" :src="previewUrl" controls autoplay style="width: 100%; border-radius: 8px" />
  </n-modal>
</template>

<style scoped lang="less">
.field {
  margin-bottom: 14px;

  .label {
    font-size: 13px;
    color: #1f2329;
    margin-bottom: 6px;
  }
}

.video-group {
  .group-title {
    font-size: 12px;
    color: #5f6673;
    margin: 8px 0;

    .count {
      color: #6e7681;
    }
  }

  .video-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    max-height: 200px;
    overflow: auto;
    margin-bottom: 10px;

    .video-card {
      border: 2px solid transparent;
      border-radius: 8px;
      overflow: hidden;
      cursor: pointer;
      position: relative;
      background: #f7f8f9;

      video {
        width: 100%;
        aspect-ratio: 9 / 16;
        object-fit: cover;
        display: block;
        pointer-events: none;
      }

      .name {
        font-size: 11px;
        color: #4b5563;
        padding: 3px 6px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      &.selected {
        border-color: #875f9a;
      }

      .del {
        position: absolute;
        top: 4px;
        right: 4px;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: rgba(0, 0, 0, 0.5);
        color: #fff;
        font-size: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.2s;
      }

      &:hover .del {
        opacity: 1;
      }
    }

    .import-area {
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .empty {
      grid-column: 1 / -1;
      text-align: center;
      color: #5f6673;
      font-size: 12px;
      padding: 8px 0;
    }
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

  .record-grid {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 14px;
    align-content: start;

    .record-card {
      background: #fff;
      border-radius: 10px;
      overflow: hidden;

      .cover {
        position: relative;
        cursor: pointer;

        img {
          width: 100%;
          aspect-ratio: 9 / 16;
          object-fit: cover;
          display: block;
        }

        .cover-fallback {
          width: 100%;
          aspect-ratio: 9 / 16;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 32px;
          background: #f7f8f9;
        }

        .ll-chip {
          position: absolute;
          top: 6px;
          left: 6px;
        }

        .fail-tip {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(180, 67, 62, 0.85);
          color: #fff;
          font-size: 11px;
          padding: 4px 8px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      }

      .meta {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        font-size: 11px;
        color: #5f6673;

        .model {
          color: #4b5563;
        }

        .time {
          flex: 1;
        }

        .del {
          color: #b4433e;
          cursor: pointer;
        }
      }
    }

    .empty {
      grid-column: 1 / -1;
      text-align: center;
      color: #5f6673;
      font-size: 13px;
      padding: 80px 0;
    }

    .more {
      grid-column: 1 / -1;
      text-align: center;
      color: #875f9a;
      font-size: 12px;
      padding: 8px 0;
      cursor: pointer;
    }
  }
}
</style>
