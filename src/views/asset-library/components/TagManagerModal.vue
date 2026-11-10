<script setup lang="ts">
/**
 * 标签管理弹层：我的标签字典（名称 / 资产数 / 创建时间）+ 新建 + 重命名 + 删除。
 * 重命名后资产上的标签名随之变化；删除会解除与所有资产的关联（popconfirm 确认）。
 * 变更通过 changed 事件抛给页面刷新列表；删除时带上标签名，便于页面清掉同名筛选。
 */
import { ref, watch } from 'vue'
import { NButton, NInput, NModal, NPopconfirm, useMessage } from 'naive-ui'
import { assetLibTagCreate, assetLibTagDelete, assetLibTagRename, assetLibTags } from '@/api/asset-library.ts'
import type { IAssetLibTag } from '@/api/asset-library.ts'
import { formatTime } from '@/views/local-life/constants.ts'

const show = defineModel<boolean>('show', { required: true })

const emit = defineEmits<{ changed: [deletedName?: string] }>()

const message = useMessage()

const tags = ref<IAssetLibTag[]>([])
const loading = ref(false)
const newName = ref('')
const creating = ref(false)

const renamingId = ref<number | null>(null)
const renameDraft = ref('')

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
    newName.value = ''
    renamingId.value = null
    void loadTags()
  }
})

async function createTag() {
  const name = newName.value.trim()
  if (!name) return
  if (name.length > 20) {
    message.warning('标签名最多 20 字')
    return
  }
  creating.value = true
  try {
    await assetLibTagCreate(name)
    newName.value = ''
    // 服务端按名字排序，重拉保持有序（重名 4002 由请求层 toast）
    await loadTags()
  } finally {
    creating.value = false
  }
}

function startRename(t: IAssetLibTag) {
  renamingId.value = t.id
  renameDraft.value = t.name
}

async function saveRename() {
  const id = renamingId.value
  const name = renameDraft.value.trim()
  if (!id) return
  if (!name) {
    message.warning('标签名不能为空')
    return
  }
  if (name.length > 20) {
    message.warning('标签名最多 20 字')
    return
  }
  try {
    await assetLibTagRename(id, name)
    const item = tags.value.find((t) => t.id === id)
    if (item) item.name = name
    renamingId.value = null
    emit('changed')
  } catch {
    // 失败（重名等）toast 已由请求层弹出，行内编辑留着供修改重试
  }
}

async function removeTag(t: IAssetLibTag) {
  await assetLibTagDelete(t.id)
  tags.value = tags.value.filter((x) => x.id !== t.id)
  message.success(`已删除标签「${t.name}」`)
  emit('changed', t.name)
}
</script>

<template>
  <n-modal v-model:show="show" preset="card" title="标签管理" style="width: 520px">
    <div>
      <div class="flex gap-8px mb-12px">
        <n-input
          v-model:value="newName"
          class="flex-1"
          size="small"
          maxlength="20"
          show-count
          placeholder="新建标签（≤20 字，同一用户内不重名）"
          @keydown.enter="createTag"
        />
        <n-button size="small" type="primary" :loading="creating" @click="createTag">新建</n-button>
      </div>

      <div v-loading="loading" class="min-h-160px max-h-420px overflow-auto flex flex-col gap-8px">
        <div
          v-for="t in tags"
          :key="t.id"
          class="flex items-center gap-10px px-12px py-8px border border-solid border-line rounded-8px bg-white"
        >
          <template v-if="renamingId === t.id">
            <n-input
              v-model:value="renameDraft"
              class="flex-1"
              size="small"
              maxlength="20"
              show-count
              autofocus
              @keydown.enter="saveRename"
            />
            <span class="ll-link" @click="saveRename">保存</span>
            <span class="ll-link !text-placeholder" @click="renamingId = null">取消</span>
          </template>
          <template v-else>
            <span
              class="flex-1 min-w-0 text-13px text-ink whitespace-nowrap overflow-hidden text-ellipsis"
              :title="t.name"
              >{{ t.name }}</span
            >
            <span class="shrink-0 text-12px text-violet-ink bg-violet-soft rounded-4px px-8px py-2px"
              >{{ t.assetCount }} 个资产</span
            >
            <span class="shrink-0 text-12px text-placeholder">{{ formatTime(t.createdAt) }}</span>
            <span class="shrink-0 flex items-center gap-12px">
              <span class="ll-link" @click="startRename(t)">重命名</span>
              <n-popconfirm @positive-click="removeTag(t)">
                <template #trigger>
                  <span class="ll-danger-link">删除</span>
                </template>
                删除后将从所有资产上解除「{{ t.name }}」这个标签，确定删除？
              </n-popconfirm>
            </span>
          </template>
        </div>
        <div v-if="!loading && !tags.length" class="ll-empty">还没有标签，先在上方新建一个</div>
      </div>
    </div>
  </n-modal>
</template>
