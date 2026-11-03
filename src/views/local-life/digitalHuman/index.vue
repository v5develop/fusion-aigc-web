<script setup lang="ts">
/**
 * AI数字人工作台：形象（上传/公共/AI定制）+ 系统音色 + 配音内容 → 口播视频。
 * 生成前必须已同意《AIGC功能使用约定》（后端 1007，前端先弹约定弹窗）。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import Workbench from '../components/Workbench/index.vue'
import PersonSource from '../components/PersonSource/index.vue'
import CopywritingPicker from '../components/CopywritingPicker/index.vue'
import FormCard from '../components/FormCard/index.vue'
import ChipGroup from '../components/ChipGroup/index.vue'
import PromptBox from '../components/PromptBox/index.vue'
import PromptActions from '../components/PromptActions/index.vue'
import SettingsBar from '../components/SettingsBar/index.vue'
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
const selectedVoice = computed(() => voices.value.find((v) => v.id === voiceId.value))

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
/** 配音内容卡头说明：随出片模型档变化（原「出片模型」下拉下面那句） */
const scriptHint = computed(() =>
  selectedModel.value?.value === 'lite' ? 'Lite 档更省点数，配音最长 25 秒' : '默认档，配音最长 30 秒',
)
/** 底部设置行读写的对象：model 直接映射到 scriptModel，提交仍读 scriptModel */
const modelSetting = reactive({
  get model() {
    return scriptModel.value
  },
  set model(value: string | undefined) {
    scriptModel.value = value
  },
})

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

      <FormCard title="音色" required :hint="selectedVoice ? `已选：${selectedVoice.name}` : ''">
        <ChipGroup
          v-model="activeCategory"
          :options="voiceCategories.map((c) => ({ label: c.label, value: c.code }))"
          label="音色分类"
          empty-label="全部"
          :empty-value="null"
        />
        <div
          v-loading="voicesLoading"
          class="max-h-232px min-h-60px overflow-auto flex flex-col gap-6px"
          role="radiogroup"
          aria-label="音色"
        >
          <div
            v-for="voice in voices"
            :key="voice.id"
            role="radio"
            :aria-checked="voiceId === voice.id"
            tabindex="0"
            class="flex items-center justify-between gap-8px min-h-44px box-border px-12px py-6px rounded-md border border-solid cursor-pointer sx-focus transition-[border-color,background,box-shadow] duration-mid ease-sx motion-reduce:transition-none"
            :class="
              voiceId === voice.id
                ? 'border-violet-line sx-grad-tint shadow-[0_1px_2px_rgba(31,35,41,0.05)]'
                : 'border-line bg-white hover:(border-violet-line shadow-raised)'
            "
            @click="voiceId = voice.id"
            @keydown.enter.prevent="voiceId = voice.id"
            @keydown.space.prevent="voiceId = voice.id"
          >
            <div class="min-w-0 flex flex-col gap-2px">
              <span
                class="truncate text-13px leading-18px"
                :class="voiceId === voice.id ? 'font-600 text-violet-ink' : 'font-500 text-ink'"
                >{{ voice.name }}</span
              >
              <span class="truncate text-11px leading-16px text-muted">{{ voice.style }}</span>
            </div>
            <button
              type="button"
              class="sx-btn !h-24px !px-8px !text-11px flex-none transition-[border-color,color] duration-fast"
              :class="{ '!text-violet-ink !border-violet-line': playingId === voice.id }"
              :aria-label="`${playingId === voice.id ? '停止' : '试听'}：${voice.name}`"
              @click.stop="preview(voice)"
            >
              {{ playingId === voice.id ? '停止' : '试听' }}
            </button>
          </div>
          <div
            v-if="!voicesLoading && !voices.length"
            class="rounded-md border border-dashed border-line-strong text-center text-11px leading-[1.65] text-muted py-16px"
          >
            该分类暂无音色
          </div>
        </div>
      </FormCard>

      <FormCard title="配音内容" required :hint="modelOptions.length ? scriptHint : ''">
        <PromptBox
          v-model="script"
          label="配音内容"
          :max-length="maxScriptLen"
          placeholder="数字人要说的话，50 字以内口播效果最佳"
        >
          <template #actions>
            <PromptActions :loading="aiWriting" @ai="aiWriteScript" @pick="showCopyPicker = true" />
          </template>
        </PromptBox>
      </FormCard>
    </template>

    <template #settings>
      <SettingsBar v-model:data="modelSetting" :model-options="modelOptions" />
    </template>

    <template #right>
      <div class="h-full min-h-0 flex flex-col">
        <h2 class="m-0 mb-14px flex-none text-16px font-600 leading-22px text-ink">我的数字人</h2>
        <div
          v-loading="listCtl.loading.value"
          class="flex-1 min-h-0 overflow-auto grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-14px content-start"
        >
          <div
            v-for="item in listCtl.items.value"
            :key="item.id"
            class="group bg-white rounded-lg border border-solid border-line shadow-card-v3 relative overflow-hidden"
          >
            <div class="relative cursor-pointer" @click="openPreview(item)">
              <img
                v-if="item.cover_url || item.image_url"
                :src="item.cover_url || item.image_url"
                alt=""
                class="block w-full aspect-[9/16] object-cover"
              />
              <div
                class="sx-chip flex-shrink-0 absolute top-6px left-6px"
                :class="`ll-chip-${DH_STATUS_MAP[item.status]?.type}`"
              >
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
          <div
            v-if="!listCtl.loading.value && !listCtl.items.value.length"
            class="col-span-full sx-empty !min-h-240px text-12px leading-[1.65] text-muted"
          >
            还没有数字人，左侧开始生成吧
          </div>
          <div
            v-if="listCtl.hasMore.value"
            class="col-span-full ll-link transition-colors duration-fast block text-center py-8px"
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
