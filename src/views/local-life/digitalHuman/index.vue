<script setup lang="ts">
/**
 * AI数字人工作台：形象（上传/公共/AI定制）+ 系统音色 + 配音内容 → 口播视频。
 * 生成前必须已同意《AIGC功能使用约定》（后端 1007，前端先弹约定弹窗）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import Workbench from '../components/Workbench/index.vue'
import PersonSource from '../components/PersonSource/index.vue'
import CopywritingPicker from '../components/CopywritingPicker/index.vue'
import {
  llCopywritingAiWrite,
  llCreateDigitalHuman,
  llDhOptions,
  llDigitalHumanList,
  llDigitalHumanRemove,
  llIdempotencyHeaders,
  llVoiceCategories,
  llVoices,
} from '@/api/localLife.ts'
import type {
  ILCreateDigitalHumanReq,
  ILDigitalHuman,
  ILDhOptions,
  ILPortraitSource,
  ILVoice,
} from '@/api/localLifeTypes.ts'
import { useAgreement, useLLList } from '../hooks.ts'
import { DH_STATUS_MAP, formatTime, isDhRunning } from '../constants.ts'

defineOptions({ name: 'local-life-digital-human' })

const message = useMessage()
const { ensureAgreed } = useAgreement()

// ---------------- 形象 ----------------

const portraitSource = ref<ILPortraitSource>('UPLOAD')
const personImage = ref('')
const personPublicId = ref<number | undefined>(undefined)
const personPortraitId = ref<number | undefined>(undefined)
const personImageIndex = ref(0)

// ---------------- 音色 ----------------

const voiceCategories = ref<{ code: string; label: string; value: string }[]>([])
const activeCategory = ref<string | null>(null)
const voices = ref<ILVoice[]>([])
const voicesLoading = ref(false)
const voiceId = ref<number | undefined>(undefined)

async function loadVoices() {
  voicesLoading.value = true
  try {
    const res = await llVoices(activeCategory.value ?? undefined)
    voices.value = res.data?.list ?? []
  } finally {
    voicesLoading.value = false
  }
}

watch(activeCategory, loadVoices)

// 试听：全局只放一个音频，切播自动互斥
const audioEl = ref<HTMLAudioElement | null>(null)
const playingId = ref<number | null>(null)

function preview(voice: ILVoice) {
  const el = audioEl.value
  if (!el) return
  if (playingId.value === voice.id) {
    el.pause()
    return
  }
  el.src = voice.preview_url
  el.play()
  playingId.value = voice.id
}

function onAudioEnd() {
  playingId.value = null
}

function onAudioPause() {
  playingId.value = null
}

// ---------------- 配音内容 ----------------

const dhOptions = ref<ILDhOptions | null>(null)
const script = ref('')
const scriptModel = ref<string | undefined>(undefined)
const copywritingId = ref<number | undefined>(undefined)
const showCopyPicker = ref(false)
const aiWriting = ref(false)

const modelOptions = computed(() => (dhOptions.value?.models ?? []).map((o) => ({ label: o.label, value: o.code })))
const selectedModel = computed(() => modelOptions.value.find((o) => o.value === scriptModel.value))
const maxScriptLen = computed(() => dhOptions.value?.max_script_len ?? 50)

async function aiWriteScript() {
  aiWriting.value = true
  try {
    const res = await llCopywritingAiWrite({ scene: 'dh_script', context: script.value.trim() || undefined })
    script.value = res.data?.text ?? ''
    copywritingId.value = undefined
  } finally {
    aiWriting.value = false
  }
}

function pickCopy(c: { id: number; body: string }) {
  script.value = c.body
  copywritingId.value = c.id
  showCopyPicker.value = false
}

// ---------------- 提交 ----------------

const submitting = ref(false)

async function submit() {
  if (submitting.value) return

  if (portraitSource.value === 'UPLOAD' && !personImage.value) return message.warning('请上传人物照片')
  if (portraitSource.value === 'PUBLIC' && !personPublicId.value) return message.warning('请选择一位公共数字人')
  if (portraitSource.value === 'AI' && !personPortraitId.value) return message.warning('请先生成并选择一张定制形象')
  if (!voiceId.value) return message.warning('请选择一个音色')
  if (!script.value.trim()) return message.warning('请输入配音内容')
  if (script.value.length > maxScriptLen.value) return message.warning(`配音内容最多 ${maxScriptLen.value} 字`)

  if (!(await ensureAgreed())) return

  submitting.value = true
  try {
    const body: ILCreateDigitalHumanReq = {
      portrait_source: portraitSource.value,
      voice_id: voiceId.value,
      script: script.value.trim(),
      model: scriptModel.value || undefined,
      copywriting_id: copywritingId.value,
    }
    if (portraitSource.value === 'UPLOAD') body.image_url = personImage.value
    if (portraitSource.value === 'PUBLIC') body.public_id = personPublicId.value
    if (portraitSource.value === 'AI') {
      body.portrait_id = personPortraitId.value
      body.image_index = personImageIndex.value
    }
    await llCreateDigitalHuman(body, llIdempotencyHeaders())
    message.success('已提交，数字人生成中')
    await listCtl.refresh()
  } finally {
    submitting.value = false
  }
}

// ---------------- 右侧：我的数字人 ----------------

const listCtl = useLLList<ILDigitalHuman>((params) => llDigitalHumanList(params), isDhRunning, 4000)
onMounted(async () => {
  void listCtl.reload()
  void loadVoices()
  const catRes = await llVoiceCategories()
  voiceCategories.value = catRes.data?.list ?? []
  const res = await llDhOptions()
  const data = res.data ?? null
  dhOptions.value = data
  // 出片模型默认档：后端下发第一项
  if (data?.models?.length) scriptModel.value = data.models[0]?.code
})

// 预览播放
const previewShow = ref(false)
const previewItem = ref<ILDigitalHuman | null>(null)

function openPreview(item: ILDigitalHuman) {
  if (item.status !== 2 || !item.video_url) return
  previewItem.value = item
  previewShow.value = true
}

async function removeItem(item: ILDigitalHuman) {
  await llDigitalHumanRemove(item.id)
  message.success('已删除')
  void listCtl.refresh()
}
</script>

<template>
  <Workbench title="AI数字人" :submit="submit" :loading="submitting" submit-text="生成数字人">
    <template #default>
      <PersonSource
        v-model:source="portraitSource"
        v-model:image-url="personImage"
        v-model:public-id="personPublicId"
        v-model:portrait-id="personPortraitId"
        v-model:image-index="personImageIndex"
        :enable-ai="true"
      />

      <div class="mb-14px">
        <div class="ll-label">音色</div>
        <div class="flex flex-wrap gap-6px mb-8px">
          <span class="ll-tag" :class="{ 'll-tag-active': !activeCategory }" @click="activeCategory = null">全部</span>
          <span
            v-for="cat in voiceCategories"
            :key="cat.code"
            class="ll-tag"
            :class="{ 'll-tag-active': activeCategory === cat.code }"
            @click="activeCategory = cat.code"
            >{{ cat.label }}</span
          >
        </div>
        <div v-loading="voicesLoading" class="max-h-220px overflow-auto flex flex-col gap-6px">
          <div
            v-for="voice in voices"
            :key="voice.id"
            class="flex items-center justify-between gap-8px px-12px py-8px rounded-8px border border-solid cursor-pointer transition-colors"
            :class="
              voiceId === voice.id
                ? 'border-violet-line bg-violet-soft'
                : 'border-line bg-white hover:border-violet-line'
            "
            @click="voiceId = voice.id"
          >
            <div class="min-w-0 flex flex-col gap-2px">
              <span class="truncate text-13px leading-18px text-ink">{{ voice.name }}</span>
              <span class="truncate text-11px leading-16px text-muted">{{ voice.style }}</span>
            </div>
            <span
              class="ll-link flex-none"
              :class="{ '!text-violet-press': playingId === voice.id }"
              @click.stop="preview(voice)"
              >{{ playingId === voice.id ? '停止' : '试听' }}</span
            >
          </div>
          <div v-if="!voicesLoading && !voices.length" class="ll-empty !text-12px py-16px">该分类暂无音色</div>
        </div>
      </div>

      <div class="mb-14px">
        <div class="ll-label">
          配音内容（{{ script.length }}/{{ maxScriptLen }}字）
          <span class="flex gap-10px">
            <span class="ll-link" :class="{ 'opacity-60 cursor-not-allowed': aiWriting }" @click="aiWriteScript">{{
              aiWriting ? 'AI帮写中…' : '✨ AI帮写'
            }}</span>
            <span class="ll-link" @click="showCopyPicker = true">选择AI文案</span>
          </span>
        </div>
        <n-input
          v-model:value="script"
          type="textarea"
          :rows="5"
          :maxlength="maxScriptLen"
          show-count
          placeholder="数字人要说的话，50 字以内口播效果最佳"
        />
      </div>

      <div v-if="modelOptions.length" class="mb-14px">
        <div class="ll-label">出片模型</div>
        <n-select v-model:value="scriptModel" size="small" :options="modelOptions" />
        <div class="mt-4px text-11px leading-16px text-placeholder">
          {{ selectedModel?.value === 'lite' ? 'Lite 档更省点数，配音最长 25 秒' : '默认档，配音最长 30 秒' }}
        </div>
      </div>
    </template>

    <template #right>
      <div class="h-full min-h-0 flex flex-col">
        <h2 class="m-0 mb-14px flex-none text-16px font-600 leading-22px text-ink">我的数字人</h2>
        <div
          v-loading="listCtl.loading.value"
          class="flex-1 min-h-0 overflow-auto grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-14px content-start"
        >
          <div v-for="item in listCtl.items.value" :key="item.id" class="group ll-card relative overflow-hidden">
            <div class="relative cursor-pointer" @click="openPreview(item)">
              <img
                v-if="item.cover_url || item.image_url"
                :src="item.cover_url || item.image_url"
                alt=""
                class="block w-full aspect-[9/16] object-cover"
              />
              <div class="ll-chip absolute top-6px left-6px" :class="`ll-chip-${DH_STATUS_MAP[item.status]?.type}`">
                {{ DH_STATUS_MAP[item.status]?.label }}
              </div>
              <div
                v-if="item.status === 2 && item.video_url"
                class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-36px h-36px rounded-full bg-black/50 text-white flex items-center justify-center text-14px"
              >
                ▶
              </div>
            </div>
            <div class="px-10px py-8px">
              <div class="truncate text-13px font-600 leading-18px text-ink">{{ item.name || '数字人' }}</div>
              <div class="mt-2px text-11px leading-16px text-muted">
                {{ item.voice_name }}<template v-if="item.duration"> · {{ item.duration }}s</template>
              </div>
              <div class="mt-2px text-11px leading-16px text-muted">{{ formatTime(item.create_time) }}</div>
            </div>
            <n-popconfirm @positive-click="removeItem(item)">
              <template #trigger
                ><span
                  class="absolute top-6px right-6px hidden group-hover:block px-8px py-2px rounded-full bg-black/35 text-11px text-white cursor-pointer"
                  >删除</span
                ></template
              >
              确定删除这个数字人？
            </n-popconfirm>
          </div>
          <div v-if="!listCtl.loading.value && !listCtl.items.value.length" class="col-span-full ll-empty py-80px">
            还没有数字人，左侧开始生成吧
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

  <audio ref="audioEl" @ended="onAudioEnd" @pause="onAudioPause" />

  <CopywritingPicker v-model:show="showCopyPicker" @select="pickCopy" />

  <n-modal v-model:show="previewShow" preset="card" :title="previewItem?.name || '数字人视频'" class="!w-420px">
    <video
      v-if="previewItem?.video_url"
      :src="previewItem.video_url"
      controls
      autoplay
      class="block w-full rounded-8px"
    />
  </n-modal>
</template>
