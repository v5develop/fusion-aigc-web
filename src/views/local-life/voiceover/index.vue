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
      <div class="field">
        <div class="label">
          口播文案
          <span class="links">
            <span class="link" :class="{ disabled: aiWriting }" @click="aiWriteContent">{{ aiWriting ? 'AI帮写中…' : '✨ AI帮写' }}</span>
            <span class="link" @click="showCopyPicker = true">选择AI文案</span>
          </span>
        </div>
        <n-input v-model:value="form.content" type="textarea" :rows="6" placeholder="数字人要播报的内容，字数不限" />
      </div>

      <PersonSource
        v-model:source="portraitSource"
        v-model:image-url="personImage"
        v-model:public-id="personPublicId"
        title="人物形象"
      />

      <div class="field">
        <div class="label">背景</div>
        <div class="seg">
          <span
            v-for="seg in BG_SEGMENTS"
            :key="seg.key"
            class="ll-pill"
            :class="{ 'll-pill-active': bgSource === seg.key }"
            @click="bgSource = seg.key"
          >
            {{ seg.label }}
          </span>
        </div>
        <div v-if="bgSource === 'PRESET'" class="bg-grid" v-loading="bgLoading">
          <div v-for="b in bgList" :key="b.id" class="bg" :class="{ selected: bgId === b.id }" @click="bgId = b.id">
            <img :src="b.url" alt="" />
            <div class="name">{{ b.title }}</div>
          </div>
          <div v-if="!bgLoading && !bgList.length" class="empty">暂无预设背景</div>
        </div>
        <template v-if="bgSource === 'UPLOAD'">
          <ImageUpload v-model:imgList="bgImageList" btnName="上传背景图" :topRightTips="false" :limitNumber="1" />
        </template>
        <div v-if="bgSource === 'AI'" class="hint">不选背景，AI 按文案内容自动匹配场景</div>
      </div>

      <div class="field three-col">
        <div v-if="modelOptions.length">
          <div class="label">出片模型</div>
          <n-select v-model:value="form.model" size="small" :options="modelOptions" />
        </div>
        <div v-if="durationOptions.length">
          <div class="label">时长</div>
          <n-select v-model:value="form.duration" size="small" :options="durationOptions" />
        </div>
        <div v-if="sizeOptions.length">
          <div class="label">比例</div>
          <n-select v-model:value="form.size" size="small" :options="sizeOptions" />
        </div>
      </div>
    </template>

    <template #right>
      <div class="right-inner">
        <div class="list-title">生成记录</div>
        <div class="record-grid" v-loading="listCtl.loading.value">
          <div v-for="item in listCtl.items.value" :key="item.id" class="record-card">
            <div class="cover" @click="openPreview(item)">
              <img v-if="item.input_image_url" :src="item.input_image_url" alt="" />
              <div v-else class="cover-fallback">🎙️</div>
              <div class="ll-chip" :class="`ll-chip-${CREATION_STATUS_MAP[item.status]?.type}`">{{ CREATION_STATUS_MAP[item.status]?.label }}</div>
              <div v-if="item.status === 2" class="fail-tip">{{ item.fail_reason || '生成失败' }}</div>
            </div>
            <div class="meta">
              <span class="content">{{ item.content }}</span>
              <span class="sub">{{ item.duration ? item.duration + 's' : '' }} {{ item.size }} {{ formatTime(item.create_time) }}</span>
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

  <CopywritingPicker v-model:show="showCopyPicker" @select="pickCopy" />

  <n-modal v-model:show="previewShow" preset="card" title="口播视频" style="width: 420px">
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
    display: flex;
    align-items: center;
    justify-content: space-between;

    .links {
      display: flex;
      gap: 10px;

      .link {
        color: #875f9a;
        font-size: 12px;
        cursor: pointer;

        &.disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      }
    }
  }

  .hint {
    font-size: 11px;
    color: #6e7681;
    margin-top: 6px;
  }
}

.seg {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}

.bg-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  max-height: 220px;
  overflow: auto;

  .bg {
    border: 2px solid transparent;
    border-radius: 8px;
    overflow: hidden;
    cursor: pointer;
    position: relative;

    img {
      width: 100%;
      aspect-ratio: 9 / 16;
      object-fit: cover;
      display: block;
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
  }

  .empty {
    grid-column: 1 / -1;
    text-align: center;
    color: #5f6673;
    font-size: 12px;
    padding: 24px 0;
  }
}

.three-col {
  display: flex;
  gap: 10px;

  > div {
    flex: 1;
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
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
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
        padding: 8px 10px;
        display: flex;
        flex-direction: column;
        gap: 2px;

        .content {
          font-size: 12px;
          color: #1f2329;
          line-height: 17px;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .sub {
          font-size: 11px;
          color: #5f6673;
        }

        .del {
          font-size: 11px;
          color: #b4433e;
          cursor: pointer;
          width: fit-content;
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
