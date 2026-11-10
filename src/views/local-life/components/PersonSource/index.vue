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
import FormCard from '../FormCard/index.vue'
import Field from '../Field/index.vue'
import SegTabs from '../SegTabs/index.vue'
import ChipGroup from '../ChipGroup/index.vue'
import {
  llCreatePortrait,
  llDhOptions,
  llIdempotencyHeaders,
  llPortraitDetail,
  llPublicDigitalHumans,
  llRegeneratePortrait,
} from '@/api/local-life.ts'
import type { ILDhOptions, ILPortrait, ILPortraitSource, ILPublicDigitalHuman } from '@/api/local-life-types.ts'
import { useAgreement, usePollingWhile } from '@/views/local-life/hooks.ts'

const props = defineProps<{
  enableAi?: boolean
  title?: string
  /** 不包卡：嵌在别的分组卡里（探店 / 短剧的「出镜人物」） */
  bare?: boolean
}>()

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

const GENDERS = [
  { value: 'female', label: '女' },
  { value: 'male', label: '男' },
]

/** 卡头说明：上传给张数上限（与 ImageUpload limitNumber=1 一致），另两种给选取方式 */
const cardHint = computed(
  () => ({ UPLOAD: '最多 1 张', PUBLIC: '选一位公共数字人', AI: '先生成，再选一张' })[source.value] ?? '',
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
  skinTone: '',
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
  if (!portraitForm.skinTone && data?.skinTones?.length) portraitForm.skinTone = data.skinTones[0]?.code ?? ''
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
      message.error(data.failReason || '形象生成失败')
    }
    return false
  },
)

async function generatePortrait() {
  if (generating.value) return
  if (!portraitForm.age) return message.warning('请选择年龄段')
  if (!portraitForm.skinTone) return message.warning('请选择肤色')

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
        skinTone: portraitForm.skinTone,
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
  portrait.value = { ...portrait.value, status: 0, imageUrls: [] }
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
  <component
    :is="bare ? 'div' : FormCard"
    v-bind="bare ? { class: 'flex flex-col gap-12px' } : { title: title ?? '人物形象', hint: cardHint }"
  >
    <!-- 来源切换：整宽分段控件，选中 = 白 → 柔紫渐变 + 紫描边 -->
    <SegTabs v-model="source" :options="tabs" :label="title ?? '人物形象'" />

    <!-- 上传照片 -->
    <div v-if="source === 'UPLOAD'">
      <ImageUpload fromAsset v-model:imgList="uploadList" btnName="上传人物照片" :topRightTips="false" :limitNumber="1">
        <span class="inline-block mt-8px text-11px leading-16px text-muted"
          >支持 jpg/png/webp，人脸清晰的正面照效果更佳</span
        >
      </ImageUpload>
    </div>

    <!-- 公共数字人 -->
    <div v-else-if="source === 'PUBLIC'" v-loading="publicLoading" class="min-h-80px">
      <div class="grid grid-cols-3 gap-8px max-h-260px overflow-auto" role="radiogroup" aria-label="公共数字人">
        <button
          v-for="item in publicList"
          :key="item.id"
          type="button"
          role="radio"
          :aria-checked="publicId === item.id"
          class="relative block p-0 overflow-hidden rounded-lg border border-solid sx-grad-upload text-left cursor-pointer sx-focus transition-[border-color,box-shadow] duration-mid ease-sx motion-reduce:transition-none"
          :class="
            publicId === item.id
              ? 'border-violet ring-1 ring-violet'
              : 'border-line hover:(border-violet-line shadow-raised)'
          "
          @click="publicId = item.id"
        >
          <img :src="item.imageUrl || item.avatarUrl" alt="" class="block w-full aspect-[3/4] object-cover" />
          <span class="block truncate px-6px pt-4px text-12px leading-17px text-ink">{{ item.name }}</span>
          <span class="block truncate px-6px pb-6px text-11px leading-16px text-muted">{{ item.roleLabel }}</span>
          <span
            v-if="publicId === item.id"
            class="absolute top-4px right-4px w-18px h-18px rounded-full sx-grad-primary shadow-btn text-white text-12px flex items-center justify-center"
            aria-hidden="true"
            >✓</span
          >
        </button>
        <div
          v-if="!publicLoading && !publicList.length"
          class="col-span-full rounded-md border border-dashed border-line-strong text-center text-11px leading-[1.65] text-muted py-20px"
        >
          暂无公共数字人
        </div>
      </div>
    </div>

    <!-- AI 定制形象（原型 StudioCustomHumanForm：每项一行「标签 + 胶囊」，纵向 gap 12） -->
    <div v-else class="flex flex-col gap-12px">
      <template v-if="!portrait || portrait.status !== 1">
        <Field label="性别">
          <ChipGroup v-model="portraitForm.gender" :options="GENDERS" label="性别" />
        </Field>
        <Field label="年龄">
          <ChipGroup
            v-model="portraitForm.age"
            :options="(dhOptions?.ages ?? []).map((o) => ({ label: o.label, value: o.code }))"
            label="年龄"
          />
        </Field>
        <Field label="肤色">
          <ChipGroup
            v-model="portraitForm.skinTone"
            :options="(dhOptions?.skinTones ?? []).map((o) => ({ label: o.label, value: o.code }))"
            label="肤色"
          />
        </Field>
        <Field label="职业">
          <ChipGroup
            v-model="portraitForm.role"
            :options="(dhOptions?.roles ?? []).map((o) => ({ label: o.label, value: o.code }))"
            label="职业"
            empty-label="不限"
          />
        </Field>
        <Field label="外貌描述">
          <Textarea v-model:value="portraitForm.description" placeholder="补充外貌细节，如：短发、圆脸、爱笑（选填）" />
        </Field>
        <button
          type="button"
          class="sx-btn-tint w-full !h-34px transition-[border-color,background,opacity] duration-fast ease-sx motion-reduce:transition-none disabled:(opacity-60 cursor-not-allowed)"
          :disabled="generating"
          :aria-busy="generating || undefined"
          @click="generatePortrait"
        >
          {{ generating ? '形象生成中…' : '生成形象' }}
        </button>
      </template>

      <template v-else>
        <div class="grid grid-cols-4 gap-8px" role="radiogroup" aria-label="定制形象">
          <button
            v-for="(url, index) in portrait.imageUrls"
            :key="url"
            type="button"
            role="radio"
            :aria-checked="portraitId === portrait.id && imageIndex === index"
            class="block p-0 overflow-hidden rounded-lg border border-solid bg-white cursor-pointer sx-focus transition-[border-color,box-shadow] duration-mid ease-sx motion-reduce:transition-none"
            :class="
              portraitId === portrait.id && imageIndex === index
                ? 'border-violet ring-1 ring-violet'
                : 'border-line hover:(border-violet-line shadow-raised)'
            "
            @click="pickPortraitImage(index)"
          >
            <img :src="url" alt="" class="block w-full aspect-[9/16] object-cover" />
          </button>
        </div>
        <button
          type="button"
          class="sx-btn-ghost !h-28px !px-8px !text-12px !text-violet-ink self-center transition-colors duration-fast"
          :disabled="generating"
          @click="regeneratePortrait"
        >
          不满意？重新生成
        </button>
      </template>
    </div>
  </component>
</template>
