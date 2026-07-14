<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { publicTemplate } from '@/api/methods.ts'
import type { FileItem } from './types'

const show = defineModel<boolean>('show', { required: true })
const props = defineProps<{
  moduleCode?: string
}>()
const emit = defineEmits<{
  select: [images: FileItem[]]
}>()

const activeTab = ref<'upload' | 'library'>('upload')

// ========== 本地上传 ==========

const dragging = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)

function onDragOver(e: DragEvent) {
  e.preventDefault()
  dragging.value = true
}
function onDragLeave() {
  dragging.value = false
}
function onDrop(e: DragEvent) {
  e.preventDefault()
  dragging.value = false
  const files = e.dataTransfer?.files
  if (!files?.length) return
  readFiles(Array.from(files))
}
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
function readFiles(files: File[]) {
  const items: FileItem[] = []
  let settled = 0
  files.forEach((file) => {
    const reader = new FileReader()
    reader.onload = () => {
      items.push({ url: reader.result as string, name: file.name })
      settled++
      if (settled === files.length) {
        emit('select', items)
        show.value = false
      }
    }
    reader.onerror = () => { settled++ }
    reader.readAsDataURL(file)
  })
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
    if (res.code === 0) {
      const list = (res.data?.list ?? []) as any[]
      libList.value.push(...list.map((item: any) => ({ id: item.id ?? item.url, url: item.url, name: item.name })))
      if (list.length < 20) libHasMore.value = false
      libPage.value++
    }
  } finally {
    libLoading.value = false
  }
}

function selectLibItem(item: LibItem) {
  selectedLib.value = item
}

function confirmLibrary() {
  if (!selectedLib.value) return
  // 将库图片 URL 转为 base64 以保证 FileItem 格式一致
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    emit('select', [{ url: canvas.toDataURL('image/png'), name: selectedLib.value!.name || 'model' }])
    show.value = false
  }
  img.onerror = () => {
    emit('select', [{ url: selectedLib.value!.url, name: selectedLib.value!.name || 'model' }])
    show.value = false
  }
  img.src = selectedLib.value.url
}

function onLibScroll(e: Event) {
  const el = e.target as HTMLElement
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 50 && libHasMore.value) {
    fetchLib()
  }
}
</script>

<template>
  <NModal
    :show="show"
    :on-update:show="(v: boolean) => (show = v)"
    transform-origin="center"
    :closable="false"
  >
    <div class="model-image-modal">
      <!-- Tab 栏 -->
      <div class="modal-header">
        <span
          class="modal-tab"
          :class="{ active: activeTab === 'upload' }"
          @click="activeTab = 'upload'"
        >上传图片</span>
        <span
          class="modal-tab"
          :class="{ active: activeTab === 'library' }"
          @click="activeTab = 'library'"
        >模特库</span>
      </div>

      <!-- 本地上传 -->
      <div v-if="activeTab === 'upload'" class="upload-panel">
        <div
          class="upload-zone"
          :class="{ dragging }"
          @dragover="onDragOver"
          @dragleave="onDragLeave"
          @drop="onDrop"
          @click="onUploadClick"
        >
          <div class="upload-hint">拖拽文件，或截图后</div>
          <div class="upload-shortcut"><span class="key-icon">⌘</span> + V 上传素材</div>
          <div class="upload-format">PNG/JPG/JPEG</div>
        </div>
        <button class="upload-btn" @click.stop="onUploadClick">本地上传</button>
        <input
          ref="fileInputRef"
          type="file"
          accept="image/*"
          multiple
          style="display: none"
          @change="onFileChange"
        />
      </div>

      <!-- 模特库 -->
      <div v-if="activeTab === 'library'" class="library-panel">
        <!-- 分类筛选 -->
        <div v-if="filters.length > 0" class="filter-bar">
          <span
            v-for="f in filters"
            :key="f.value"
            class="filter-chip"
            :class="{ active: activeFilter === f.value }"
            @click="activeFilter = f.value"
          >{{ f.label }}</span>
        </div>
        <!-- 图片网格 -->
        <div class="lib-grid" @scroll="onLibScroll">
          <div
            v-for="item in libList"
            :key="item.id"
            class="lib-thumb"
            :class="{ selected: selectedLib?.id === item.id }"
            @click="selectLibItem(item)"
          >
            <img :src="item.url" alt="" />
          </div>
        </div>
        <button
          class="upload-btn"
          style="margin-top: 12px"
          :disabled="!selectedLib"
          :style="{ opacity: selectedLib ? 1 : 0.4 }"
          @click="confirmLibrary"
        >确定</button>
      </div>
    </div>
  </NModal>
</template>

<style scoped lang="less">
.model-image-modal {
  width: 392px;
  height: 410px;
  background: #f5f6f8;
  border-radius: 16px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  outline: none;
}

.modal-header {
  display: flex;
  gap: 24px;
  margin-bottom: 20px;
}

.modal-tab {
  font-family: 'PingFang SC', sans-serif;
  font-size: 16px;
  font-weight: 500;
  color: #8f8f8f;
  cursor: pointer;
  line-height: 20px;

  &.active {
    color: #1f1f1f;
  }
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
  width: 100%;
  flex: 1;
  border: 1.5px dashed #d9d9d9;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: border-color 0.2s;

  &.dragging {
    border-color: #8e66f9;
    background: rgba(142, 102, 249, 0.04);
  }
}

.upload-hint {
  font-family: 'PingFang SC', sans-serif;
  font-size: 14px;
  font-weight: 500;
  color: #1f1f1f;
  line-height: 20px;
}

.upload-shortcut {
  font-family: 'PingFang SC', sans-serif;
  font-size: 14px;
  font-weight: 500;
  color: #1f1f1f;
  line-height: 20px;
  margin-top: 4px;

  .key-icon {
    display: inline-block;
    width: 20px;
    height: 20px;
    border: 1px solid #d9d9d9;
    border-radius: 4px;
    font-size: 12px;
    line-height: 20px;
    text-align: center;
    color: #8f8f8f;
  }
}

.upload-format {
  font-family: 'PingFang SC', sans-serif;
  font-size: 12px;
  color: #bfbfbf;
  line-height: 18px;
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
  margin-top: 16px;

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
  background: #f5f6f8;
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
  color: #8f8f8f;
  cursor: pointer;

  &.active {
    background: #fff;
    color: #3a3a3a;
  }
}

.lib-grid {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  overflow-y: auto;
  align-content: flex-start;

  &::-webkit-scrollbar {
    width: 4px;
  }
  &::-webkit-scrollbar-thumb {
    background: #d9d9d9;
    border-radius: 2px;
  }
}

.lib-thumb {
  width: 86px;
  height: 86px;
  border-radius: 8px;
  background: #f5f6f8;
  overflow: hidden;
  cursor: pointer;
  flex-shrink: 0;
  border: 2px solid transparent;
  box-sizing: border-box;
  transition: border-color 0.15s;

  &.selected {
    border-color: #8e66f9;
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}
</style>
