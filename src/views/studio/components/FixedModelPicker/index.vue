<script setup lang="ts">
/**
 * 固定模特选择（模特库 + 上传我的模特），对齐原型 FixedModelPicker。
 *
 * <p>数据：GET /api/v1/models/templates（公共模板，按标签分组）+ GET /api/v1/models/user-models（我的模特）。
 * 「上传我的模特」同原型：选一张图 → 直传（useStudioUploader，同叠片入口）→ 以文件名作名称新建 → 直接选中。
 * 我的模特卡片可编辑（PATCH，局部更新）与删除（DELETE，请求体 userModelIds）。
 * 选中结果经 v-model 交回页面，由页面决定怎么进提交体（商拍换装：并入 model_image_urls）。
 */
import { computed, ref } from 'vue'
import { useMessage } from 'naive-ui'
import { ACCEPT_IMAGE } from '@/utils/utils.ts'
import {
  createUserModel,
  deleteUserModels,
  listModelTemplates,
  listUserModels,
  updateUserModel,
  type ModelTemplateGroup,
  type UserModel,
} from '@/api/models.ts'
import StudioImageUpload from '../StudioImageUpload/index.vue'
import AssetPickerModal from '../AssetPickerModal/index.vue'
import { useStudioUploader } from '../StudioImageUpload/useStudioUploader.ts'
import type { FixedModel } from './types.ts'
import { useFileDropPaste } from '@/composables/useFileDropPaste'

const { disabled = false } = defineProps<{ disabled?: boolean }>()
const model = defineModel<FixedModel | null>({ default: null })

const message = useMessage()
const { uploading, uploadFiles } = useStudioUploader()

/** 原型自定义模特的标签文案；新建时作为必填的描述 */
const CUSTOM_TAG = '自定义 · 单人正脸'
const FIELD_MAX = 255

const show = ref(false)
const loading = ref(false)
const creating = ref(false)
const templateGroups = ref<ModelTemplateGroup[]>([])
const userModels = ref<UserModel[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
let loaded = false

const isHttp = (url: string) => /^https?:\/\//i.test(url)

function fromUser(u: UserModel): FixedModel {
  return {
    id: `u-${u.userModelId}`,
    name: u.title,
    tag: u.description,
    image: u.imageUrl,
    source: 'custom',
    userModelId: u.userModelId,
    description: u.description,
  }
}

const presetModels = computed<FixedModel[]>(() =>
  templateGroups.value.flatMap((g) =>
    (g.templates ?? [])
      .filter((t) => isHttp(t.imageUrl))
      .map((t) => ({
        id: `t-${t.modelTemplateId}`,
        name: t.title,
        tag: g.tag,
        image: t.imageUrl,
        source: 'preset' as const,
        description: t.description,
      })),
  ),
)
const customModels = computed(() => userModels.value.filter((u) => isHttp(u.imageUrl)).map(fromUser))
const models = computed(() => [...presetModels.value, ...customModels.value])

async function loadUserModels() {
  const res = await listUserModels()
  userModels.value = Array.isArray(res.data) ? res.data : []
}

async function load() {
  loading.value = true
  try {
    const [tpl, mine] = await Promise.allSettled([listModelTemplates(), loadUserModels()])
    if (tpl.status === 'fulfilled') templateGroups.value = Array.isArray(tpl.value.data) ? tpl.value.data : []
    loaded = tpl.status === 'fulfilled' && mine.status === 'fulfilled'
  } finally {
    loading.value = false
  }
}

function open() {
  show.value = true
  if (!loaded) void load()
}

function choose(next: FixedModel | null) {
  model.value = next
  show.value = false
}

// ---------------- 上传我的模特（原型：选图即建、即选中） ----------------

function pickFile() {
  if (uploading.value || creating.value) return
  fileInput.value?.click()
}

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) await createFromFile(file)
}

/** 以文件名作名称（去扩展名，空则「我的模特」） */
const titleOf = (fileName: string) => (fileName.replace(/\.[^.]+$/, '') || '我的模特').slice(0, FIELD_MAX)

/** 选文件 / 拖入 / 粘贴共用：直传 → 新建 → 选中 */
async function createFromFile(file: File) {
  const title = titleOf(file.name)
  await uploadFiles([file], 1, 1, (imageUrl) => createFromUrl(title, imageUrl))
}

/** 直传 / 资产库共用：新建 → 选中 */
async function createFromUrl(title: string, imageUrl: string) {
  creating.value = true
  try {
    await createUserModel({ title, imageUrl, description: CUSTOM_TAG })
    await loadUserModels()
    // 列表按 id 倒序，新建的在最前；服务端可能改写 imageUrl，故不按地址找
    const created = userModels.value[0]
    if (created && isHttp(created.imageUrl)) choose(fromUser(created))
  } catch {
    // 业务失败拦截器已提示
  } finally {
    creating.value = false
  }
}

// ---------------- 从资产库添加（与上传同一条：新建 → 选中） ----------------

const assetShow = ref(false)

function openAssetPicker() {
  if (busy.value) return
  assetShow.value = true
}

async function addAssetUrls(picked: string[]) {
  const imageUrl = picked.find(isHttp)
  if (!imageUrl) return
  // 资产没有本地文件名：取地址最后一段当文件名
  const path = imageUrl.split(/[?#]/)[0] ?? ''
  await createFromUrl(titleOf(path.slice(path.lastIndexOf('/') + 1)), imageUrl)
}

// ---------------- 编辑 / 删除我的模特 ----------------

const editShow = ref(false)
const editSaving = ref(false)
const editForm = ref<{ id: number; title: string; description: string; images: string[] }>({
  id: 0,
  title: '',
  description: '',
  images: [],
})
const editOrigin = ref<UserModel | null>(null)

function openEdit(item: FixedModel) {
  const origin = userModels.value.find((u) => u.userModelId === item.userModelId)
  if (!origin) return
  editOrigin.value = origin
  editForm.value = {
    id: origin.userModelId,
    title: origin.title,
    description: origin.description,
    images: [origin.imageUrl],
  }
  editShow.value = true
}

async function saveEdit() {
  const origin = editOrigin.value
  if (!origin || editSaving.value) return
  const title = editForm.value.title.trim()
  const description = editForm.value.description.trim()
  const imageUrl = editForm.value.images[0] ?? ''
  if (!title) return message.warning('请填写模特名称')
  if (!description) return message.warning('请填写模特描述')
  if (!imageUrl) return message.warning('请上传模特图')
  // PATCH 只改传了的字段
  const data = {
    ...(title !== origin.title ? { title } : {}),
    ...(description !== origin.description ? { description } : {}),
    ...(imageUrl !== origin.imageUrl ? { imageUrl } : {}),
  }
  if (!Object.keys(data).length) {
    editShow.value = false
    return
  }
  editSaving.value = true
  try {
    await updateUserModel(origin.userModelId, data)
    await loadUserModels()
    const fresh = userModels.value.find((u) => u.userModelId === origin.userModelId)
    if (fresh && model.value?.userModelId === origin.userModelId) model.value = fromUser(fresh)
    editShow.value = false
  } catch {
    // 业务失败拦截器已提示
  } finally {
    editSaving.value = false
  }
}

const deleting = ref<number | null>(null)

async function removeUserModel(item: FixedModel) {
  const id = item.userModelId
  if (id == null || deleting.value != null) return
  deleting.value = id
  try {
    await deleteUserModels([id])
    userModels.value = userModels.value.filter((u) => u.userModelId !== id)
    if (model.value?.userModelId === id) model.value = null
  } catch (err) {
    message.error(err instanceof Error ? err.message : '删除失败，请重试')
  } finally {
    deleting.value = null
  }
}

const busy = computed(() => uploading.value || creating.value)

// 拖入 / 粘贴到「上传我的模特」格：与选文件同一条路径
const uploadTileEl = ref<HTMLElement | null>(null)
const { dragging } = useFileDropPaste(uploadTileEl, {
  accept: 'image',
  disabled: busy,
  onFiles: ([file]) => {
    if (file) createFromFile(file)
  },
})
</script>

<template>
  <!-- 原型 v3 .fixed-model-row：内边距 9 10、gap 10、1px line、r8、surface-2 底；头像 36 / r8 / 1px line -->
  <div class="flex items-center gap-10px px-10px py-9px border border-solid border-line rounded-8px bg-surface2">
    <img
      v-if="model"
      class="shrink-0 block w-36px h-36px box-border border border-solid border-line rounded-8px object-cover"
      :src="model.image"
      :alt="model.name"
    />
    <span
      v-else
      class="shrink-0 flex items-center justify-center w-36px h-36px box-border border border-solid border-line rounded-8px bg-white text-placeholder"
      aria-hidden="true"
    >
      <svg class="w-16px h-16px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" stroke-linecap="round" />
      </svg>
    </span>
    <div class="min-w-0 flex-1">
      <div class="overflow-hidden text-13px font-600 text-ink whitespace-nowrap text-ellipsis">
        {{ model ? model.name : '未指定固定模特' }}
      </div>
      <div class="mt-1px overflow-hidden text-11px text-muted whitespace-nowrap text-ellipsis">
        {{ model ? model.tag : '指定后，多张图保持同一张脸' }}
      </div>
    </div>
    <n-button size="small" :disabled="disabled" @click="open">
      {{ model ? '更换' : '选择' }}
    </n-button>
  </div>

  <n-modal
    v-model:show="show"
    preset="card"
    title="选择固定模特"
    :style="{ width: '680px', maxWidth: 'calc(100vw - 48px)' }"
  >
    <div class="max-h-[min(60vh,560px)] min-h-200px overflow-y-auto" v-loading="loading">
      <div class="grid grid-cols-4 gap-10px">
        <div
          v-for="item in models"
          :key="item.id"
          class="group relative flex sx-focus flex-col items-start gap-2px pb-9px overflow-hidden border border-solid rounded-12px bg-white text-left cursor-pointer"
          :class="model?.id === item.id ? 'border-2 border-violet shadow-focus' : 'border-line hover:border-violet'"
          role="button"
          tabindex="0"
          :aria-pressed="model?.id === item.id"
          :aria-label="item.name"
          @click="choose(item)"
          @keydown.enter.prevent="choose(item)"
        >
          <img class="block w-full h-150px mb-7px object-cover" :src="item.image" :alt="item.name" />
          <span class="max-w-full px-9px overflow-hidden text-12px font-600 text-ink whitespace-nowrap text-ellipsis">{{
            item.name
          }}</span>
          <span class="max-w-full px-9px overflow-hidden text-10px text-ink-2 whitespace-nowrap text-ellipsis">{{
            item.tag
          }}</span>
          <div
            v-if="item.source === 'custom'"
            class="absolute top-6px right-6px flex gap-4px opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
            @click.stop
            @keydown.stop
          >
            <n-button size="tiny" secondary @click="openEdit(item)">编辑</n-button>
            <n-popconfirm @positive-click="removeUserModel(item)">
              <template #trigger>
                <n-button size="tiny" secondary type="error" :loading="deleting === item.userModelId">删除</n-button>
              </template>
              删除自建模特「{{ item.name }}」？
            </n-popconfirm>
          </div>
        </div>

        <div class="relative flex flex-col">
          <button
            ref="uploadTileEl"
            type="button"
            class="flex-1 flex flex-col items-center justify-center gap-6px min-h-205px p-12px border border-dashed border-line rounded-12px bg-surface2 text-violet text-center cursor-pointer disabled:cursor-wait disabled:opacity-60 sx-focus"
            :class="dragging && 'sx-drop'"
            :disabled="busy"
            @click="pickFile"
          >
            <svg
              class="w-24px h-24px"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <path d="M7 18a5 5 0 0 1-.6-9.97A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9" stroke-linecap="round" />
              <path d="M12 12v8M9 15l3-3 3 3" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <span class="text-12px font-600 text-ink">{{ busy ? '上传中…' : '上传我的模特' }}</span>
            <span class="text-10px text-ink-2">单人、正脸、清晰的图片效果最好</span>
          </button>
          <!-- 从资产库添加：整格上传按钮的兄弟节点（按钮里不能再套按钮），右上角内缩 12 -->
          <button
            type="button"
            class="absolute right-12px top-12px z-1 px-4px text-12px leading-18px text-violet bg-transparent border-none cursor-pointer rounded-sm hover:underline disabled:(opacity-45 cursor-not-allowed) sx-focus"
            aria-label="从资产库添加模特图"
            :disabled="busy"
            @click="openAssetPicker"
          >
            从资产库添加
          </button>
        </div>
      </div>
    </div>

    <input ref="fileInput" type="file" :accept="ACCEPT_IMAGE" hidden @change="onFile" />
    <AssetPickerModal v-model:show="assetShow" :limit="1" @select="addAssetUrls" />

    <template #footer>
      <div class="flex items-center gap-2">
        <n-button type="primary" :disabled="!model" @click="choose(model)">固定这个模特</n-button>
        <n-button @click="choose(null)">不使用固定模特</n-button>
        <span class="flex-1" />
        <n-button quaternary @click="show = false">取消</n-button>
      </div>
    </template>
  </n-modal>

  <n-modal
    v-model:show="editShow"
    preset="card"
    title="修改自建模特"
    :style="{ width: '420px', maxWidth: 'calc(100vw - 48px)' }"
  >
    <div class="flex flex-col gap-12px">
      <StudioImageUpload v-model="editForm.images" :max="1" :multiple="false" label="模特图" cloud />
      <n-input v-model:value="editForm.title" :maxlength="FIELD_MAX" placeholder="模特名称" />
      <n-input v-model:value="editForm.description" :maxlength="FIELD_MAX" placeholder="模特描述" />
    </div>
    <template #footer>
      <div class="flex items-center justify-end gap-2">
        <n-button quaternary @click="editShow = false">取消</n-button>
        <n-button type="primary" :loading="editSaving" @click="saveEdit">保存</n-button>
      </div>
    </template>
  </n-modal>
</template>
