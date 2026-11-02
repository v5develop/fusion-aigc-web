<script setup lang="ts">
/**
 * 人物形象三选一：上传照片 / 公共数字人 / AI 定制形象。
 *
 * 数字人页三个模式全开；口播、动作迁移、探店、短剧只开放前两个
 * （AI 定制没有「我的形象」列表接口，离场即丢，放进去反而让用户找不到上次生成的）。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import ImageUpload from '@/components/ImageUpload/index.vue'
import Textarea from '@/components/Textarea/index.vue'
import {
  llCreatePortrait,
  llDhOptions,
  llIdempotencyHeaders,
  llPortraitDetail,
  llPublicDigitalHumans,
  llRegeneratePortrait,
} from '@/api/localLife.ts'
import type { ILDhOptions, ILPortrait, ILPortraitSource, ILPublicDigitalHuman } from '@/api/localLifeTypes.ts'
import { useAgreement, usePollingWhile } from '@/views/local-life/hooks.ts'

const props = defineProps<{ enableAi?: boolean; title?: string }>()

const source = defineModel<ILPortraitSource>('source', { default: 'UPLOAD' })
const imageUrl = defineModel<string>('imageUrl', { default: '' })
const publicId = defineModel<number | undefined>('publicId', { default: undefined })
const portraitId = defineModel<number | undefined>('portraitId', { default: undefined })
const imageIndex = defineModel<number>('imageIndex', { default: 0 })

const message = useMessage()

const tabs = computed(() =>
  [
    { key: 'UPLOAD', label: '上传照片' },
    { key: 'PUBLIC', label: '公共数字人' },
    ...(props.enableAi ? [{ key: 'AI', label: 'AI定制形象' }] : []),
  ] as { key: ILPortraitSource; label: string }[],
)

// ---------------- 上传照片：数组 ↔ 单地址桥接 ----------------

const uploadList = ref<string[]>(imageUrl.value ? [imageUrl.value] : [])
watch(uploadList, (v) => (imageUrl.value = v[0] ?? ''), { deep: true })

// ---------------- 公共数字人 ----------------

const publicList = ref<ILPublicDigitalHuman[]>([])
const publicLoading = ref(false)

async function loadPublic() {
  publicLoading.value = true
  try {
    const res = await llPublicDigitalHumans()
    publicList.value = res.data?.list ?? []
  } finally {
    publicLoading.value = false
  }
}

// ---------------- AI 定制形象 ----------------

const dhOptions = ref<ILDhOptions | null>(null)
const portraitForm = reactive({
  gender: 'female',
  age: '',
  skin_tone: '',
  role: '',
  description: '',
})
const portrait = ref<ILPortrait | null>(null)
const generating = ref(false)

async function loadOptions() {
  const res = await llDhOptions()
  const data = res.data ?? null
  dhOptions.value = data
  if (!portraitForm.age && data?.ages?.length) portraitForm.age = data.ages[0]?.code ?? ''
  if (!portraitForm.skin_tone && data?.skin_tones?.length) portraitForm.skin_tone = data.skin_tones[0]?.code ?? ''
}

/** 轮询形象生成结果，终态自动收掉 */
const { start: startPortraitPolling } = usePollingWhile(
  () => llPortraitDetail(portrait.value!.id),
  (data) => {
    if (!data || data.status < 1) return true
    portrait.value = data
    generating.value = false
    if (data.status === 1) {
      message.success('形象已生成，请选择一张')
    } else {
      message.error(data.fail_reason || '形象生成失败')
    }
    return false
  },
)

async function generatePortrait() {
  if (generating.value) return
  if (!portraitForm.age) return message.warning('请选择年龄段')
  if (!portraitForm.skin_tone) return message.warning('请选择肤色')

  const { ensureAgreed } = useAgreement()
  if (!(await ensureAgreed())) return

  generating.value = true
  portrait.value = null
  portraitId.value = undefined
  try {
    const res = await llCreatePortrait(
      {
        gender: portraitForm.gender as 'female' | 'male',
        age: portraitForm.age,
        skin_tone: portraitForm.skin_tone,
        role: portraitForm.role || undefined,
        description: portraitForm.description || undefined,
      },
      llIdempotencyHeaders(),
    )
    portrait.value = res.data
    startPortraitPolling()
  } catch {
    generating.value = false
  }
}

async function regeneratePortrait() {
  if (!portrait.value || generating.value) return
  generating.value = true
  portrait.value = { ...portrait.value, status: 0, image_urls: [] }
  try {
    const res = await llRegeneratePortrait(portrait.value.id, llIdempotencyHeaders())
    portrait.value = res.data
    startPortraitPolling()
  } catch {
    generating.value = false
  }
}

function pickPortraitImage(index: number) {
  imageIndex.value = index
  portraitId.value = portrait.value!.id
}

onMounted(() => {
  void loadPublic()
  if (props.enableAi) void loadOptions()
})
</script>

<template>
  <div class="person-source">
    <div class="module-title">{{ title ?? '人物形象' }}</div>
    <div class="tabs">
      <div
        v-for="tab in tabs"
        :key="tab.key"
        class="ll-pill"
        :class="{ 'll-pill-active': source === tab.key }"
        @click="source = tab.key"
      >
        {{ tab.label }}
      </div>
    </div>

    <!-- 上传照片 -->
    <div v-if="source === 'UPLOAD'" class="tab-content">
      <ImageUpload v-model:imgList="uploadList" btnName="上传人物照片" :topRightTips="false" :limitNumber="1">
        <span class="hint">支持 jpg/png/webp，人脸清晰的正面照效果更佳</span>
      </ImageUpload>
    </div>

    <!-- 公共数字人 -->
    <div v-else-if="source === 'PUBLIC'" class="tab-content" v-loading="publicLoading">
      <div class="public-grid">
        <div
          v-for="item in publicList"
          :key="item.id"
          class="public-card"
          :class="{ selected: publicId === item.id }"
          @click="publicId = item.id"
        >
          <img :src="item.image_url || item.avatar_url" alt="" />
          <div class="name">{{ item.name }}</div>
          <div class="role">{{ item.role_label }}</div>
        </div>
        <div v-if="!publicLoading && !publicList.length" class="empty">暂无公共数字人</div>
      </div>
    </div>

    <!-- AI 定制形象 -->
    <div v-else class="tab-content">
      <template v-if="!portrait || portrait.status !== 1">
        <div class="option-row">
          <span class="option-label">性别</span>
          <n-radio-group v-model:value="portraitForm.gender" size="small">
            <n-radio-button value="female">女</n-radio-button>
            <n-radio-button value="male">男</n-radio-button>
          </n-radio-group>
        </div>
        <div class="option-row">
          <span class="option-label">年龄</span>
          <n-select
            v-model:value="portraitForm.age"
            size="small"
            :options="(dhOptions?.ages ?? []).map((o) => ({ label: o.label, value: o.code }))"
            placeholder="请选择"
          />
        </div>
        <div class="option-row">
          <span class="option-label">肤色</span>
          <n-select
            v-model:value="portraitForm.skin_tone"
            size="small"
            :options="(dhOptions?.skin_tones ?? []).map((o) => ({ label: o.label, value: o.code }))"
            placeholder="请选择"
          />
        </div>
        <div class="option-row">
          <span class="option-label">职业</span>
          <n-select
            v-model:value="portraitForm.role"
            size="small"
            clearable
            :options="(dhOptions?.roles ?? []).map((o) => ({ label: o.label, value: o.code }))"
            placeholder="选填"
          />
        </div>
        <div class="option-row top">
          <span class="option-label">外貌描述</span>
          <Textarea v-model:value="portraitForm.description" placeholder="补充外貌细节，如：短发、圆脸、爱笑（选填）" />
        </div>
        <div class="gen-btn" :class="{ disabled: generating }" @click="generatePortrait">
          <span>{{ generating ? '形象生成中…' : '生成形象' }}</span>
        </div>
      </template>

      <template v-else>
        <div class="portrait-grid">
          <div
            v-for="(url, index) in portrait.image_urls"
            :key="url"
            class="portrait-card"
            :class="{ selected: portraitId === portrait.id && imageIndex === index }"
            @click="pickPortraitImage(index)"
          >
            <img :src="url" alt="" />
          </div>
        </div>
        <div class="regen" @click="regeneratePortrait">不满意？重新生成</div>
      </template>
    </div>
  </div>
</template>

<style scoped lang="less">
.person-source {
  .module-title {
    font-size: 14px;
    font-weight: 600;
    color: #1f2329;
    margin-bottom: 10px;
  }

  .tabs {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
    flex-wrap: wrap;

    .tab {
      padding: 5px 14px;
      border-radius: 14px;
      font-size: 12px;
      color: #4b5563;
      background: #f7f8f9;
      cursor: pointer;
      transition: all 0.2s;

      &.active {
        color: #fff;
        background: #875f9a;
      }
    }
  }

  .tab-content {
    .hint {
      color: #6e7681;
      font-size: 12px;
      margin-top: 8px;
      display: inline-block;
    }

    .public-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      max-height: 260px;
      overflow: auto;

      .public-card {
        border: 2px solid transparent;
        border-radius: 8px;
        overflow: hidden;
        cursor: pointer;
        position: relative;
        background: #f7f8f9;

        img {
          width: 100%;
          aspect-ratio: 3 / 4;
          object-fit: cover;
          display: block;
        }

        .name {
          font-size: 12px;
          padding: 4px 6px 0;
          color: #1f2329;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .role {
          font-size: 11px;
          color: #5f6673;
          padding: 0 6px 6px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        &.selected {
          border-color: #875f9a;

          &::after {
            content: '✓';
            position: absolute;
            top: 4px;
            right: 4px;
            width: 18px;
            height: 18px;
            border-radius: 50%;
            background: #875f9a;
            color: #fff;
            font-size: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
          }
        }
      }

      .empty {
        grid-column: 1 / -1;
        text-align: center;
        color: #5f6673;
        font-size: 12px;
        padding: 20px 0;
      }
    }

    .option-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;

      &.top {
        align-items: flex-start;
      }

      .option-label {
        width: 56px;
        flex-shrink: 0;
        font-size: 13px;
        color: #4b5563;
      }
    }

    .gen-btn {
      height: 38px;
      border-radius: 19px;
      border: 1px solid #875f9a;
      color: #875f9a;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      cursor: pointer;
      margin-top: 4px;

      &:hover {
        background: rgba(135, 95, 154, 0.06);
      }

      &.disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
    }

    .portrait-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;

      .portrait-card {
        border: 2px solid transparent;
        border-radius: 8px;
        overflow: hidden;
        cursor: pointer;

        img {
          width: 100%;
          aspect-ratio: 9 / 16;
          object-fit: cover;
          display: block;
        }

        &.selected {
          border-color: #875f9a;
        }
      }
    }

    .regen {
      text-align: center;
      color: #875f9a;
      font-size: 12px;
      margin-top: 10px;
      cursor: pointer;
    }
  }
}
</style>
