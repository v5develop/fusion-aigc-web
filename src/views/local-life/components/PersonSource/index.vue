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

const tabs = computed(
  () =>
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
  <div class="mb-14px">
    <div class="ll-section-title">{{ title ?? '人物形象' }}</div>
    <div class="flex flex-wrap gap-8px mb-12px">
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
    <div v-if="source === 'UPLOAD'">
      <ImageUpload v-model:imgList="uploadList" btnName="上传人物照片" :topRightTips="false" :limitNumber="1">
        <span class="inline-block mt-8px text-12px leading-18px text-placeholder"
          >支持 jpg/png/webp，人脸清晰的正面照效果更佳</span
        >
      </ImageUpload>
    </div>

    <!-- 公共数字人 -->
    <div v-else-if="source === 'PUBLIC'" v-loading="publicLoading">
      <div class="grid grid-cols-3 gap-8px max-h-260px overflow-auto">
        <div
          v-for="item in publicList"
          :key="item.id"
          class="relative overflow-hidden rounded-8px border-2 border-solid bg-surface2 cursor-pointer transition-colors"
          :class="publicId === item.id ? 'border-violet' : 'border-transparent'"
          @click="publicId = item.id"
        >
          <img :src="item.image_url || item.avatar_url" alt="" class="block w-full aspect-[3/4] object-cover" />
          <div class="truncate px-6px pt-4px text-12px leading-17px text-ink">{{ item.name }}</div>
          <div class="truncate px-6px pb-6px text-11px leading-16px text-muted">{{ item.role_label }}</div>
          <span
            v-if="publicId === item.id"
            class="absolute top-4px right-4px w-18px h-18px rounded-full bg-violet text-white text-12px flex items-center justify-center"
            aria-hidden="true"
            >✓</span
          >
        </div>
        <div v-if="!publicLoading && !publicList.length" class="col-span-full ll-empty !text-12px py-20px">
          暂无公共数字人
        </div>
      </div>
    </div>

    <!-- AI 定制形象 -->
    <div v-else>
      <template v-if="!portrait || portrait.status !== 1">
        <div class="flex items-center gap-10px mb-10px">
          <span class="w-56px flex-none text-13px text-ink-2">性别</span>
          <n-radio-group v-model:value="portraitForm.gender" size="small">
            <n-radio-button value="female">女</n-radio-button>
            <n-radio-button value="male">男</n-radio-button>
          </n-radio-group>
        </div>
        <div class="flex items-center gap-10px mb-10px">
          <span class="w-56px flex-none text-13px text-ink-2">年龄</span>
          <n-select
            v-model:value="portraitForm.age"
            size="small"
            :options="(dhOptions?.ages ?? []).map((o) => ({ label: o.label, value: o.code }))"
            placeholder="请选择"
          />
        </div>
        <div class="flex items-center gap-10px mb-10px">
          <span class="w-56px flex-none text-13px text-ink-2">肤色</span>
          <n-select
            v-model:value="portraitForm.skin_tone"
            size="small"
            :options="(dhOptions?.skin_tones ?? []).map((o) => ({ label: o.label, value: o.code }))"
            placeholder="请选择"
          />
        </div>
        <div class="flex items-center gap-10px mb-10px">
          <span class="w-56px flex-none text-13px text-ink-2">职业</span>
          <n-select
            v-model:value="portraitForm.role"
            size="small"
            clearable
            :options="(dhOptions?.roles ?? []).map((o) => ({ label: o.label, value: o.code }))"
            placeholder="选填"
          />
        </div>
        <div class="flex items-start gap-10px mb-10px">
          <span class="w-56px flex-none text-13px leading-28px text-ink-2">外貌描述</span>
          <Textarea v-model:value="portraitForm.description" placeholder="补充外貌细节，如：短发、圆脸、爱笑（选填）" />
        </div>
        <div
          class="mt-4px h-36px flex items-center justify-center rounded-full border border-solid border-violet-line bg-white text-13px text-violet-ink cursor-pointer select-none transition-colors"
          :class="generating ? 'opacity-60 cursor-not-allowed' : 'hover:(bg-violet-soft border-violet)'"
          @click="generatePortrait"
        >
          <span>{{ generating ? '形象生成中…' : '生成形象' }}</span>
        </div>
      </template>

      <template v-else>
        <div class="grid grid-cols-4 gap-8px">
          <div
            v-for="(url, index) in portrait.image_urls"
            :key="url"
            class="overflow-hidden rounded-8px border-2 border-solid cursor-pointer transition-colors"
            :class="portraitId === portrait.id && imageIndex === index ? 'border-violet' : 'border-transparent'"
            @click="pickPortraitImage(index)"
          >
            <img :src="url" alt="" class="block w-full aspect-[9/16] object-cover" />
          </div>
        </div>
        <div class="ll-link block mt-10px text-center" @click="regeneratePortrait">不满意？重新生成</div>
      </template>
    </div>
  </div>
</template>
