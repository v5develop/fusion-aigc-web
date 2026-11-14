<script setup lang="ts">
/**
 * 批量打标签弹层：给选中的 N 个资产追加标签。
 * 标签从我的字典点选（含资产数），行内可新建并自动选中；
 * 一次 ≤100 资产、≤10 标签，服务端返回新增关联条数（added）。
 */
import { computed, ref, watch } from 'vue'
import { NButton, NInput, NModal, useMessage } from 'naive-ui'
import { assetLibBatchTag, assetLibTagCreate, assetLibTags } from '@/api/asset-library.ts'
import type { IAssetLibTag } from '@/api/asset-library.ts'

const props = defineProps<{ assetIds: number[] }>()

const show = defineModel<boolean>('show', { required: true })

const emit = defineEmits<{ success: [] }>()

const message = useMessage()

const tags = ref<IAssetLibTag[]>([])
const loading = ref(false)
const selectedIds = ref<number[]>([])
const newTagName = ref('')
const creating = ref(false)
const submitting = ref(false)

async function loadTags() {
  loading.value = true
  try {
    const res = await assetLibTags()
    tags.value = res.data?.items ?? []
  } finally {
    loading.value = false
  }
}

watch(show, (v) => {
  if (v) {
    selectedIds.value = []
    newTagName.value = ''
    void loadTags()
  }
})

function toggle(id: number) {
  const i = selectedIds.value.indexOf(id)
  if (i >= 0) {
    selectedIds.value.splice(i, 1)
    return
  }
  if (selectedIds.value.length >= 10) {
    message.warning('一次最多选 10 个标签')
    return
  }
  selectedIds.value.push(id)
}

async function createTag() {
  const name = newTagName.value.trim()
  if (!name) return
  if (name.length > 32) {
    message.warning('标签名最多 32 字')
    return
  }
  creating.value = true
  try {
    const res = await assetLibTagCreate(name)
    const t = res.data
    if (t?.id) {
      tags.value.push(t)
      if (!selectedIds.value.includes(t.id)) selectedIds.value.push(t.id)
    }
    newTagName.value = ''
  } finally {
    creating.value = false
  }
}

const selectedNames = computed(() => tags.value.filter((t) => selectedIds.value.includes(t.id)).map((t) => t.name))

async function submit() {
  if (submitting.value) return
  if (!selectedIds.value.length) {
    message.warning('请先选择标签')
    return
  }
  if (props.assetIds.length > 100) {
    message.warning('一次最多给 100 个资产打标签')
    return
  }
  submitting.value = true
  try {
    const res = await assetLibBatchTag({ assetIds: props.assetIds, tagIds: selectedIds.value })
    message.success(`已为 ${props.assetIds.length} 个资产新增 ${res.data?.added ?? 0} 条标签`)
    emit('success')
    show.value = false
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <n-modal v-model:show="show" preset="card" title="批量打标签" style="width: 480px">
    <div>
      <p class="text-12px text-muted m-0 mb-10px">
        将给选中的 {{ assetIds.length }} 个资产<b>追加</b>所选标签；资产已有的标签不会被动到。
      </p>

      <div class="flex flex-wrap gap-6px min-h-26px mb-10px">
        <span v-for="n in selectedNames" :key="n" class="ll-chip ll-chip-running">{{ n }}</span>
        <span v-if="!selectedNames.length" class="text-12px text-placeholder">还未选择标签</span>
      </div>

      <div v-loading="loading" class="flex flex-wrap gap-6px max-h-260px overflow-auto p-2px mb-12px">
        <span
          v-for="t in tags"
          :key="t.id"
          class="ll-tag"
          :class="{ 'll-tag-active': selectedIds.includes(t.id) }"
          @click="toggle(t.id)"
        >
          {{ t.name }}
          <i class="not-italic ml-4px" :class="selectedIds.includes(t.id) ? 'text-violet-ink' : 'text-placeholder'">{{
            t.assetCount
          }}</i>
        </span>
        <div v-if="!loading && !tags.length" class="ll-empty">还没有标签，在下方新建一个</div>
      </div>

      <div class="flex gap-8px">
        <n-input
          v-model:value="newTagName"
          class="flex-1"
          size="small"
          maxlength="32"
          placeholder="新建标签（≤32 字）"
          @keydown.enter="createTag"
        />
        <n-button size="small" :loading="creating" @click="createTag">新建</n-button>
      </div>
    </div>

    <template #footer>
      <div class="flex items-center justify-between">
        <span class="text-12px text-placeholder">已选 {{ selectedIds.length }}/10 个标签</span>
        <div class="flex gap-8px">
          <n-button size="small" @click="show = false">取消</n-button>
          <n-button size="small" type="primary" :loading="submitting" @click="submit">打标签</n-button>
        </div>
      </div>
    </template>
  </n-modal>
</template>
