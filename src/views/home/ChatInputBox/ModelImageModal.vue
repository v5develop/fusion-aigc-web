<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { publicTemplate } from '@/api/methods.ts'
import type { FileItem } from './types'
import { upload } from '@/api/oss-upload'
import { useMessage } from 'naive-ui'
import { ossThumbnail } from '@/utils/oss.ts'
import { ACCEPT_IMAGE } from '@/utils/utils'
import { useFileDropPaste } from '@/composables/useFileDropPaste'
import AssetPickerModal from '@/views/studio/components/AssetPickerModal/index.vue'

const show = defineModel<boolean>('show', { required: true })
const props = defineProps<{
  moduleCode?: string
  /** 已有图片 URL 集合，用于回显已选中状态 */
  existingUrls?: string[]
  /** 插槽上限（从资产库添加时最多选几张）；不传 = 1 */
  limit?: number
}>()
const emit = defineEmits<{
  select: [images: FileItem[], fromLibrary: boolean]
  update: [images: FileItem[]]
}>()

const activeTab = ref<'upload' | 'library'>('upload')

// ========== 本地上传 ==========

const fileInputRef = ref<HTMLInputElement | null>(null)
const uploadPanelRef = ref<HTMLElement | null>(null)

// 拖入 + ⌘/Ctrl+V（提示文案里本来就写了粘贴）：弹窗打开时这是唯一的上传区，粘贴不要求悬停
const { dragging } = useFileDropPaste(uploadPanelRef, {
  accept: 'image',
  multiple: true,
  globalPaste: true,
  onFiles: (files) => readFiles(files),
})
function onUploadClick() {
  fileInputRef.value?.click()
}
function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files
  if (!files?.length) return
  readFiles(Array.from(files))
  input.value = ''
}
const message = useMessage()

async function readFiles(files: File[]) {
  try {
    const urls = await upload(files)
    emitUploaded(files.map((file, i) => ({ url: urls[i] || '', name: file.name })))
  } catch {
    message.error('图片上传失败，请重试')
  }
}

/** 本地上传 / 资产库共用：按上传结果交回（fromLibrary = false，与模特库区分） */
function emitUploaded(items: FileItem[]) {
  emit('select', items, false)
  show.value = false
}

// ========== 从资产库添加 ==========

const assetShow = ref(false)

function onAssetSelect(urls: string[]) {
  const picked = urls.filter((u) => /^https?:\/\//i.test(u))
  if (!picked.length) return
  emitUploaded(
    picked.map((url) => {
      const path = url.split(/[?#]/)[0] ?? ''
      return { url, name: path.slice(path.lastIndexOf('/') + 1) || 'image' }
    }),
  )
}

// ========== 模特库 ==========

interface LibItem {
  id: string
  url: string
  name?: string
}
const filters = ref<{ label: string; value: string }[]>([])
const activeFilter = ref('')
const libList = ref<LibItem[]>([])
const selectedLib = ref<LibItem | null>(null)
const libLoading = ref(false)
const libPage = ref(1)
const libHasMore = ref(true)

function matchExisting() {
  if (!props.existingUrls?.length || libList.value.length === 0) return
  const urlSet = new Set(props.existingUrls)
  const match = libList.value.find((item) => urlSet.has(item.url))
  if (match) selectedLib.value = match
}

// 弹窗打开时预加载模特库，确保切换到库 Tab 时数据已就绪
watch(show, (v) => {
  if (!v) return
  if (props.existingUrls?.length) {
    selectedLib.value = null
    if (libList.value.length > 0) matchExisting()
  }
  // 预加载：无论当前在哪个 Tab，先把数据拉好
  if (props.moduleCode) {
    libPage.value = 1
    libHasMore.value = true
    libList.value = []
    fetchLib()
  }
})

watch(activeTab, (tab) => {
  if (tab === 'library' && props.moduleCode && libList.value.length === 0) {
    fetchLib()
  }
})

watch(activeFilter, () => {
  libPage.value = 1
  libHasMore.value = true
  libList.value = []
  selectedLib.value = null
  nextTick(() => fetchLib())
})

async function fetchLib() {
  if (libLoading.value || !props.moduleCode) return
  libLoading.value = true
  try {
    const res = await publicTemplate({
      moduleCode: props.moduleCode,
      slotCode: 'model',
      type: 'image',
      page: libPage.value,
      pageSize: 20,
    })
    if (res?.code === 0) {
      const list = (res.data?.list ?? []) as any[]
      if (list.length > 0) {
        libList.value.push(...list.map((item: any) => ({ id: item.id ?? item.url, url: item.url, name: item.name })))
        if (list.length < 20) libHasMore.value = false
        libPage.value++
        if (props.existingUrls?.length) matchExisting()
      } else {
        libHasMore.value = false
      }
    }
  } catch {
    // 网络异常静默处理，用户可切换 Tab 重试
  } finally {
    libLoading.value = false
  }
}

function selectLibItem(item: LibItem) {
  selectedLib.value = item
  emit('select', [{ url: item.url, name: item.name || 'model' }], true)
  show.value = false
}

function onLibScroll(e: Event) {
  const el = e.target as HTMLElement
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 50 && libHasMore.value) {
    fetchLib()
  }
}
</script>

<template>
  <NModal :show="show" :on-update:show="(v: boolean) => (show = v)" transform-origin="center" :closable="false">
    <div class="model-image-modal">
      <!-- Header -->
      <div class="modal-header">
        <span class="modal-tab" :class="{ active: activeTab === 'upload' }" @click="activeTab = 'upload'"
          >上传图片</span
        >
        <span class="modal-tab" :class="{ active: activeTab === 'library' }" @click="activeTab = 'library'"
          >模特库</span
        >
      </div>

      <!-- 白色内容区 -->
      <div class="modal-body">
        <!-- 本地上传 -->
        <div v-if="activeTab === 'upload'" ref="uploadPanelRef" class="upload-panel">
          <div class="upload-zone relative" :class="[{ dragging }, dragging && 'sx-drop']" @click="onUploadClick">
            <button
              type="button"
              class="absolute right-12px top-12px z-1 px-4px text-12px leading-18px text-violet bg-transparent border-none cursor-pointer rounded-sm hover:underline sx-focus"
              aria-label="从资产库添加图片"
              @click.stop="assetShow = true"
            >
              从资产库添加
            </button>
            <div class="upload-hint">拖拽文件，或截图后</div>
            <div class="upload-shortcut"><span class="key-icon">⌘</span> + V 上传素材</div>
            <div class="upload-format">PNG/JPG/JPEG</div>
            <button class="upload-btn" @click.stop="onUploadClick">本地上传</button>
          </div>
          <input
            ref="fileInputRef"
            type="file"
            :accept="ACCEPT_IMAGE"
            multiple
            style="display: none"
            @change="onFileChange"
          />
        </div>

        <!-- 模特库 -->
        <div v-if="activeTab === 'library'" class="library-panel">
          <div v-if="filters.length > 0" class="filter-bar">
            <span
              v-for="f in filters"
              :key="f.value"
              class="filter-chip"
              :class="{ active: activeFilter === f.value }"
              @click="activeFilter = f.value"
              >{{ f.label }}</span
            >
          </div>
          <div class="lib-grid" @scroll="onLibScroll">
            <div
              v-for="item in libList"
              :key="item.id"
              class="lib-thumb"
              :class="{ selected: selectedLib?.id === item.id }"
              @click="selectLibItem(item)"
            >
              <!-- 展示走缩略图消噪；选中/emit 仍用 item.url 原图（86px 方格） -->
              <img :src="ossThumbnail(item.url, 86)" alt="" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </NModal>
  <AssetPickerModal v-model:show="assetShow" :limit="Math.max(1, limit ?? 1)" @select="onAssetSelect" />
</template>

<style scoped lang="less">
.model-image-modal {
  width: 392px;
  height: 410px;
  background: var(--xq-page);
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  outline: none;
  overflow: hidden;
}

// ====== Header ======
.modal-header {
  height: 56px;
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 0 20px;
  flex-shrink: 0;
}

.modal-tab {
  font-family: 'PingFang SC', sans-serif;
  font-size: 14px;
  font-weight: 500;
  color: var(--xq-muted);
  cursor: pointer;
  line-height: 20px;

  &.active {
    color: var(--xq-ink);
  }
}

// ====== 白色内容区 ======
.modal-body {
  flex: 1;
  background: var(--xq-surface);
  border: 1px solid var(--xq-line-soft);
  border-radius: 16px 16px 0 0;
  padding: 12px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

// ====== 本地上传面板 ======
.upload-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.upload-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  flex: 1;
  margin: 12px;
  border: 1px dashed var(--xq-control);
  border-radius: 12px;
  justify-content: center;
  cursor: pointer;
  transition: border-color 0.2s;

  &.dragging {
    border-color: #8e66f9;
    // 深色：亮紫在深底上发荧光，换藤紫
    [data-theme='dark'] & {
      border-color: var(--xq-violet);
    }
    background: rgba(142, 102, 249, 0.04);
  }
}

.upload-hint {
  font-family: 'PingFang SC', sans-serif;
  font-size: 14px;
  font-weight: 500;
  color: var(--xq-ink);
  line-height: 20px;
}

.upload-shortcut {
  font-family: 'PingFang SC', sans-serif;
  font-size: 14px;
  font-weight: 500;
  color: var(--xq-ink);
  line-height: 20px;
  margin-top: 4px;

  .key-icon {
    display: inline-block;
    width: 18px;
    height: 18px;
    border: 1px solid var(--xq-control);
    border-radius: 3px;
    font-size: 11px;
    line-height: 18px;
    text-align: center;
    color: var(--xq-muted);
    margin-right: 2px;
  }
}

.upload-format {
  font-family: 'PingFang SC', sans-serif;
  font-size: 14px;
  font-weight: 400;
  color: var(--xq-muted);
  line-height: 20px;
  margin-top: 12px;
}

.upload-btn {
  width: 124px;
  height: 44px;
  border: none;
  border-radius: 274px;
  background: linear-gradient(0deg, #bba2ff 0%, #ccbaff 99%);
  color: #fff;
  font-family: 'PingFang SC', sans-serif;
  font-size: 16px;
  font-weight: 500;
  cursor: pointer;
  flex-shrink: 0;
  margin-top: 24px;

  &:disabled {
    cursor: not-allowed;
  }
}

// ====== 模特库面板 ======
.library-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.filter-bar {
  display: flex;
  gap: 4px;
  background: var(--xq-page);
  border-radius: 4px;
  padding: 2px;
  margin-bottom: 8px;
  flex-shrink: 0;
}

.filter-chip {
  flex: 1;
  height: 30px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'PingFang SC', sans-serif;
  font-size: 14px;
  font-weight: 500;
  color: var(--xq-muted);
  cursor: pointer;

  &.active {
    background: var(--xq-surface);
    color: var(--xq-ink-2);
  }
}

.lib-grid {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  overflow-y: auto;
  align-content: flex-start;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
}

.lib-thumb {
  width: 86px;
  height: 86px;
  border-radius: 8px;
  background: var(--xq-page);
  overflow: hidden;
  cursor: pointer;
  flex-shrink: 0;
  border: 2px solid transparent;
  box-sizing: border-box;
  transition: border-color 0.15s;

  &.selected {
    border-color: #8e66f9;
    // 深色：亮紫在深底上发荧光，换藤紫
    [data-theme='dark'] & {
      border-color: var(--xq-violet);
    }
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}
</style>
