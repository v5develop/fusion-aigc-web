<script setup lang="ts">
/**
 * AI图文笔记：构思（异步）→ 规划确认（可改标题/正文/话题，套图数量只能改少）→ 出图。
 * 刷新页面后从列表恢复：构思中/生成中的自动续轮询，待确认的点击进规划页。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import Workbench from '../components/Workbench/index.vue'
import ShopProfileSelect from '../components/ShopProfileSelect/index.vue'
import CopywritingPicker from '../components/CopywritingPicker/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import {
  llCopywritingAiWrite,
  llDigitalHumanList,
  llIdempotencyHeaders,
  llNoteDetail,
  llNoteGenerate,
  llNoteList,
  llNoteOptions,
  llNotePlan,
  llNoteRemove,
  llNoteReplan,
  llNoteUpdate,
} from '@/api/localLife.ts'
import type { ILNote, ILNoteOptions } from '@/api/localLifeTypes.ts'
import { useAgreement, useLLList, usePollingWhile } from '../hooks.ts'
import { NOTE_STATUS_MAP, formatTime, isNoteRunning } from '../constants.ts'

defineOptions({ name: 'local-life-note' })

const message = useMessage()
const { ensureAgreed } = useAgreement()

// ---------------- 构思表单 ----------------

const noteOptions = ref<ILNoteOptions | null>(null)
const form = reactive({
  note_type: '',
  topic: '',
  materials: [] as string[],
  digital_human_id: undefined as number | undefined,
  shop_profile_id: undefined as number | undefined,
  image_count: undefined as number | undefined,
  copywriting_id: undefined as number | undefined,
})

const typeOptions = computed(() => (noteOptions.value?.types ?? []).map((t) => ({ label: t.label, value: t.code })))
const activeType = computed(() => noteOptions.value?.types?.find((t) => t.code === form.note_type))
const imageCountOptions = computed(() => {
  const max = noteOptions.value?.default_images ?? 4
  return Array.from({ length: Math.max(1, max) }, (_, i) => ({ label: `${i + 1}张`, value: i + 1 }))
})
const showCopyPicker = ref(false)

onMounted(async () => {
  const res = await llNoteOptions()
  const data = res.data ?? null
  noteOptions.value = data
  if (data?.types?.length) form.note_type = data.types[0]?.code ?? ''
  if (data?.default_images) form.image_count = data.default_images
})

const aiWriting = ref(false)
async function aiWriteTopic() {
  aiWriting.value = true
  try {
    const res = await llCopywritingAiWrite({
      scene: 'note_topic',
      note_type: form.note_type || undefined,
      context: form.topic.trim() || undefined,
    })
    form.topic = res.data?.text ?? ''
  } finally {
    aiWriting.value = false
  }
}

function pickCopy(c: { id: number; body: string }) {
  form.topic = c.body.slice(0, noteOptions.value?.max_topic_len ?? 200)
  form.copywriting_id = c.id
  showCopyPicker.value = false
}

// ---------------- 右侧列表 ----------------

const view = ref<'list' | 'detail'>('list')
const listCtl = useLLList<ILNote>((params) => llNoteList(params), isNoteRunning)

onMounted(() => void listCtl.reload())

// 有待确认的笔记时列表项给个明显的「去确认」引导
const pendingCount = computed(() => listCtl.items.value.filter((n) => n.status === 1).length)

async function removeItem(item: ILNote) {
  await llNoteRemove(item.id)
  message.success('已删除')
  if (activeNote.value?.id === item.id) {
    view.value = 'list'
    activeNote.value = null
  }
  void listCtl.refresh()
}

// ---------------- 详情 / 规划 / 结果 ----------------

const activeNote = ref<ILNote | null>(null)
const detailLoading = ref(false)

// 编辑态（规划与成果共用一套字段）
const editForm = reactive({ title: '', content: '', tags: '' })
function fillEditForm(note: ILNote) {
  editForm.title = note.title
  editForm.content = note.content
  editForm.tags = (note.tags ?? []).join(' ')
}

// 生成套图数量（规划页）：只能改少
const genCount = ref<number | null>(null)
const genCountOptions = computed(() => {
  const planned = activeNote.value?.image_count ?? 1
  return Array.from({ length: planned }, (_, i) => ({ label: `${i + 1}张`, value: i + 1 }))
})

const { start: startNotePoll } = usePollingWhile(
  () => llNoteDetail(activeNote.value!.id),
  (data) => {
    if (!data) return true
    activeNote.value = data
    if (data.status === 0 || data.status === 3) return true
    void listCtl.refresh()
    if (data.status === 1) {
      fillEditForm(data)
      genCount.value = data.image_count
      message.success('构思完成，请确认内容')
    } else if (data.status === 4) {
      message.success('笔记已生成')
    }
    return false
  },
  3000,
)

async function openDetail(id: number, opts: { silent?: boolean } = {}) {
  view.value = 'detail'
  detailLoading.value = !opts.silent
  try {
    const res = await llNoteDetail(id)
    activeNote.value = res.data
    if (res.data?.status === 1) {
      fillEditForm(res.data)
      genCount.value = res.data.image_count
    }
    if (res.data && isNoteRunning(res.data)) startNotePoll()
  } finally {
    detailLoading.value = false
  }
}

// ---------------- 动作 ----------------

const submitting = ref(false)

async function submit() {
  if (submitting.value) return
  if (!form.note_type) return message.warning('请选择笔记类型')
  if (!form.topic.trim()) return message.warning('请输入主题')
  if (form.materials.length && form.materials.length > (noteOptions.value?.max_materials ?? 3)) {
    return message.warning(`素材最多 ${noteOptions.value?.max_materials} 张`)
  }

  if (!(await ensureAgreed())) return

  submitting.value = true
  try {
    const res = await llNotePlan(
      {
        note_type: form.note_type,
        topic: form.topic.trim(),
        material_urls: form.materials.length ? form.materials : undefined,
        digital_human_id: form.digital_human_id,
        shop_profile_id: form.shop_profile_id,
        image_count: form.image_count,
        copywriting_id: form.copywriting_id,
      },
      llIdempotencyHeaders(),
    )
    message.success('开始构思')
    form.topic = ''
    form.materials = []
    form.copywriting_id = undefined
    await listCtl.refresh()
    await openDetail(res.data.id, { silent: true })
  } finally {
    submitting.value = false
  }
}

const replanning = ref(false)
async function replan() {
  if (!activeNote.value || replanning.value) return
  replanning.value = true
  try {
    await llNoteReplan(activeNote.value.id, genCount.value ?? undefined, llIdempotencyHeaders())
    message.success('重新构思中')
    await openDetail(activeNote.value.id, { silent: true })
    void listCtl.refresh()
  } finally {
    replanning.value = false
  }
}

const generating = ref(false)
async function confirmGenerate() {
  if (!activeNote.value || generating.value) return
  if (!editForm.title.trim() && !editForm.content.trim()) return message.warning('标题和正文至少填一项')

  if (!(await ensureAgreed())) return

  generating.value = true
  try {
    await llNoteGenerate(
      activeNote.value.id,
      {
        title: editForm.title.trim() || undefined,
        content: editForm.content.trim() || undefined,
        tags: editForm.tags.trim() ? editForm.tags.trim().split(/\s+/) : undefined,
        image_count: genCount.value ?? undefined,
      },
      llIdempotencyHeaders(),
    )
    message.success('开始生成图片')
    await openDetail(activeNote.value.id, { silent: true })
    void listCtl.refresh()
  } finally {
    generating.value = false
  }
}

// 成品后的文字编辑
const editingResult = ref(false)
const savingResult = ref(false)
async function saveResult() {
  if (!activeNote.value || savingResult.value) return
  savingResult.value = true
  try {
    const res = await llNoteUpdate(activeNote.value.id, {
      title: editForm.title.trim(),
      content: editForm.content.trim(),
      tags: editForm.tags.trim() ? editForm.tags.trim().split(/\s+/) : [],
      image_urls: activeNote.value.image_urls ?? [],
    })
    activeNote.value = res.data
    editingResult.value = false
    message.success('已保存')
    void listCtl.refresh()
  } finally {
    savingResult.value = false
  }
}

// 我的数字人（选填关联）：取已完成的
const myDhOptions = ref<{ label: string; value: number }[]>([])
onMounted(async () => {
  const res = await llDigitalHumanList({ page_size: 50 })
  myDhOptions.value = (res.data?.list ?? [])
    .filter((d) => d.status === 2)
    .map((d) => ({ label: d.name || `数字人#${d.id}`, value: d.id }))
})

// 成品图预览
const imagePreviewShow = ref(false)
const previewUrl = ref('')
function openImage(url: string) {
  previewUrl.value = url
  imagePreviewShow.value = true
}

watch(view, (v) => {
  if (v === 'list') activeNote.value = null
})
</script>

<template>
  <Workbench title="图文笔记" :submit="submit" :loading="submitting" submit-text="开始构思">
    <template #default>
      <div class="mb-14px">
        <div class="ll-label">笔记类型</div>
        <n-select
          v-model:value="form.note_type"
          size="small"
          :options="typeOptions"
          @update:value="form.materials = []"
        />
        <div v-if="activeType?.material_hint" class="mt-4px text-11px leading-16px text-placeholder">
          {{ activeType.material_hint }}
        </div>
      </div>

      <div class="mb-14px">
        <div class="ll-label">
          主题
          <span class="flex gap-10px">
            <span class="ll-link" :class="{ 'opacity-60 !cursor-not-allowed': aiWriting }" @click="aiWriteTopic">{{
              aiWriting ? 'AI帮写中…' : '✨ AI帮写'
            }}</span>
            <span class="ll-link" @click="showCopyPicker = true">选择AI文案</span>
          </span>
        </div>
        <n-input
          v-model:value="form.topic"
          type="textarea"
          :rows="3"
          :maxlength="noteOptions?.max_topic_len || 500"
          show-count
          placeholder="这条笔记想写什么"
        />
      </div>

      <div class="mb-14px">
        <div class="ll-label">
          {{ activeType?.material_label ?? '素材图' }}（选填，最多{{ noteOptions?.max_materials ?? 3 }}张）
        </div>
        <ImageUpload
          v-model:imgList="form.materials"
          btnName="上传素材"
          :topRightTips="false"
          multiple
          :limitNumber="noteOptions?.max_materials ?? 3"
        />
      </div>

      <div class="mb-14px">
        <div class="ll-label">出镜数字人</div>
        <n-select
          v-model:value="form.digital_human_id"
          size="small"
          clearable
          :options="myDhOptions"
          placeholder="选填，用已生成的数字人出镜"
        />
      </div>

      <div class="mb-14px">
        <div class="ll-label">关联店铺档案</div>
        <ShopProfileSelect v-model:value="form.shop_profile_id" />
      </div>

      <div class="mb-14px">
        <div class="ll-label">套图数量</div>
        <n-select v-model:value="form.image_count" size="small" :options="imageCountOptions" />
      </div>
    </template>

    <template #right>
      <div class="h-full min-h-0 flex flex-col">
        <!-- 列表 -->
        <template v-if="view === 'list'">
          <div class="flex flex-none items-baseline gap-8px mb-14px text-16px font-600 leading-22px text-ink">
            我的笔记
            <span v-if="pendingCount" class="ll-chip ll-chip-warning self-center">{{ pendingCount }} 条待确认</span>
          </div>
          <div class="flex-1 min-h-0 overflow-auto" v-loading="listCtl.loading.value">
            <div
              v-for="item in listCtl.items.value"
              :key="item.id"
              class="ll-card flex gap-12px p-12px mb-10px cursor-pointer transition-[border-color,box-shadow] duration-[0.18s] ease-[ease] hover:(border-violet-line shadow-[0_4px_16px_rgba(31,35,41,0.08)])"
              @click="openDetail(item.id)"
            >
              <img
                v-if="item.image_urls?.length"
                class="w-64px h-64px flex-none rounded-8px object-cover"
                :src="item.image_urls[0]"
                alt=""
              />
              <div
                v-else
                class="w-64px h-64px flex-none flex items-center justify-center rounded-8px border border-solid border-line bg-surface2 text-24px"
              >
                📝
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-8px">
                  <span class="flex-1 truncate text-14px font-600 leading-20px text-ink">{{
                    item.title || item.topic
                  }}</span>
                  <span class="ll-chip" :class="`ll-chip-${NOTE_STATUS_MAP[item.status]?.type}`">{{
                    NOTE_STATUS_MAP[item.status]?.label
                  }}</span>
                </div>
                <div class="my-4px line-clamp-2 text-12px leading-18px text-ink-2">
                  {{ item.content || item.topic }}
                </div>
                <div class="text-11px leading-16px text-muted">
                  {{ item.note_type_label }} · {{ formatTime(item.create_time) }}
                </div>
              </div>
            </div>
            <div v-if="!listCtl.loading.value && !listCtl.items.value.length" class="ll-empty py-80px">
              还没有笔记，左侧开始构思吧
            </div>
            <div v-if="listCtl.hasMore.value" class="ll-link block text-center py-8px" @click="listCtl.loadMore()">
              加载更多
            </div>
          </div>
        </template>

        <!-- 详情 / 规划 / 成果 -->
        <template v-else>
          <div
            class="flex-none w-fit mb-12px text-13px text-ink-2 cursor-pointer hover:text-violet-ink"
            @click="view = 'list'"
          >
            ← 返回列表
          </div>
          <div v-if="activeNote" class="flex-1 min-h-0 overflow-auto" v-loading="detailLoading">
            <div class="flex items-center gap-10px">
              <span class="ll-chip" :class="`ll-chip-${NOTE_STATUS_MAP[activeNote.status]?.type}`">{{
                NOTE_STATUS_MAP[activeNote.status]?.label
              }}</span>
              <h2 class="m-0 flex-1 truncate text-16px font-600 leading-22px text-ink">
                {{ activeNote.title || activeNote.topic }}
              </h2>
              <n-popconfirm @positive-click="removeItem(activeNote!)">
                <template #trigger><span class="ll-danger-link flex-none text-12px">删除</span></template>
                确定删除这条笔记？
              </n-popconfirm>
            </div>
            <div class="mt-8px mb-14px text-12px text-muted">
              {{ activeNote.note_type_label }} · 套图 {{ activeNote.image_count }}张 ·
              {{ formatTime(activeNote.create_time) }}
            </div>

            <!-- 构思中 / 生成中 -->
            <div
              v-if="activeNote.status === 0 || activeNote.status === 3"
              class="ll-card flex items-center justify-center gap-10px p-40px text-13px text-ink-2"
            >
              <n-spin size="small" />
              <span>{{ activeNote.status === 0 ? 'AI 构思中，标题正文马上就来…' : '图片生成中，请稍候…' }}</span>
            </div>

            <!-- 构思失败 / 生成失败 -->
            <div
              v-else-if="activeNote.status === 2 || activeNote.status === 5"
              class="ll-card flex flex-col items-center justify-center gap-12px p-40px text-13px text-ink-2"
            >
              <p class="m-0 text-danger">
                {{ activeNote.fail_reason || (activeNote.status === 2 ? '构思失败' : '生成失败') }}
              </p>
              <n-button
                size="small"
                type="primary"
                :loading="replanning || generating"
                @click="activeNote.status === 2 ? replan() : confirmGenerate()"
              >
                {{ activeNote.status === 2 ? '重新构思' : '重试生成' }}
              </n-button>
            </div>

            <!-- 待确认：规划页 -->
            <template v-else-if="activeNote.status === 1">
              <div
                class="mb-14px rounded-8px border border-solid border-warning-line bg-warning-soft px-12px py-8px text-12px leading-18px text-warning"
              >
                以下是 AI 构思的内容，可以修改后确认生成；也可以换个思路重新构思。
              </div>
              <div class="ll-card p-16px">
                <div class="mb-14px">
                  <div class="ll-label">标题</div>
                  <n-input
                    v-model:value="editForm.title"
                    size="small"
                    maxlength="30"
                    show-count
                    placeholder="笔记标题"
                  />
                </div>
                <div class="mb-14px">
                  <div class="ll-label">正文</div>
                  <n-input
                    v-model:value="editForm.content"
                    type="textarea"
                    :rows="8"
                    placeholder="笔记正文，话题用 # 或空格分隔写在下面"
                  />
                </div>
                <div class="mb-14px">
                  <div class="ll-label">话题</div>
                  <n-input
                    v-model:value="editForm.tags"
                    size="small"
                    placeholder="用空格分隔，如：探店 咖啡 周末去哪儿"
                  />
                </div>
                <div class="mb-14px">
                  <div class="ll-label">套图数量（最多 {{ activeNote.image_count }} 张，只能改少）</div>
                  <n-select v-model:value="genCount" size="small" :options="genCountOptions" />
                </div>
                <div v-if="activeNote.material_urls?.length">
                  <div class="ll-label">参考素材</div>
                  <div class="flex flex-wrap gap-8px">
                    <img
                      v-for="url in activeNote.material_urls"
                      :key="url"
                      :src="url"
                      alt=""
                      class="w-64px h-64px rounded-8px object-cover"
                    />
                  </div>
                </div>
              </div>
              <div class="flex gap-8px mt-14px">
                <n-button size="small" :loading="replanning" @click="replan">重新构思</n-button>
                <n-button size="small" type="primary" :loading="generating" @click="confirmGenerate">确认生成</n-button>
              </div>
            </template>

            <!-- 已完成 -->
            <template v-else-if="activeNote.status === 4">
              <div class="ll-card p-16px">
                <template v-if="!editingResult">
                  <div class="mb-8px text-16px font-600 leading-22px text-ink">{{ activeNote.title }}</div>
                  <div class="mb-10px whitespace-pre-wrap text-13px leading-22px text-ink">
                    {{ activeNote.content }}
                  </div>
                  <div v-if="activeNote.tags?.length" class="flex flex-wrap gap-x-8px gap-y-4px mb-12px">
                    <span v-for="tag in activeNote.tags" :key="tag" class="text-12px text-violet-ink">#{{ tag }}</span>
                  </div>
                </template>
                <template v-else>
                  <div class="mb-14px">
                    <div class="ll-label">标题</div>
                    <n-input v-model:value="editForm.title" size="small" maxlength="30" show-count />
                  </div>
                  <div class="mb-14px">
                    <div class="ll-label">正文</div>
                    <n-input v-model:value="editForm.content" type="textarea" :rows="8" />
                  </div>
                  <div class="mb-14px">
                    <div class="ll-label">话题</div>
                    <n-input v-model:value="editForm.tags" size="small" placeholder="空格分隔" />
                  </div>
                </template>

                <div class="grid grid-cols-3 gap-10px mt-14px">
                  <div
                    v-for="(url, i) in activeNote.image_urls"
                    :key="url"
                    class="relative overflow-hidden rounded-8px cursor-pointer"
                    @click="openImage(url)"
                  >
                    <img :src="url" alt="" class="block w-full aspect-[3/4] object-cover" />
                    <span
                      class="absolute top-6px left-6px w-20px h-20px flex items-center justify-center rounded-full bg-black/50 text-11px text-white"
                      >{{ i + 1 }}</span
                    >
                  </div>
                </div>
              </div>
              <div class="flex gap-8px mt-14px">
                <template v-if="!editingResult">
                  <n-button
                    size="small"
                    @click="
                      editingResult = true
                      fillEditForm(activeNote)
                    "
                    >编辑文案</n-button
                  >
                  <n-button size="small" :loading="replanning" @click="replan">重新生成</n-button>
                </template>
                <template v-else>
                  <n-button size="small" type="primary" :loading="savingResult" @click="saveResult">保存</n-button>
                  <n-button size="small" @click="editingResult = false">取消</n-button>
                </template>
              </div>
            </template>
          </div>
        </template>
      </div>
    </template>
  </Workbench>

  <CopywritingPicker v-model:show="showCopyPicker" @select="pickCopy" />

  <n-modal v-model:show="imagePreviewShow" preset="card" class="!w-560px" title="笔记配图">
    <img v-if="previewUrl" :src="previewUrl" class="block w-full rounded-8px" alt="" />
  </n-modal>
</template>
