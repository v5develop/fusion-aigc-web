<script setup lang="ts">
/**
 * 批量移除标签：从已选资产上摘掉所选标签。可选标签 = 已选资产身上的用户标签并集（用快照里的 tags，无需新接口）。
 * 走 POST /assets/batch-tag 的 remove_tag_ids（一次 ≤200 资产、≤20 标签，一个事务），入参是标签 id，提交时按名字查字典换成 id。
 */
import { computed, ref, watch } from 'vue'
import { NButton, NModal, useMessage } from 'naive-ui'
import { assetLibBatchTag, assetLibTags } from '@/api/asset-library.ts'
import type { IAssetLibAsset } from '@/api/asset-library.ts'

const props = defineProps<{ assets: IAssetLibAsset[] }>()
const show = defineModel<boolean>('show', { required: true })
const emit = defineEmits<{ success: [] }>()
const message = useMessage()

const picked = ref<string[]>([])
const submitting = ref(false)

const options = computed(() => {
  const count = new Map<string, number>()
  for (const a of props.assets) for (const t of a.tags) count.set(t, (count.get(t) ?? 0) + 1)
  return [...count].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n)
})

watch(show, (v) => {
  if (v) picked.value = []
})

function toggle(name: string) {
  const i = picked.value.indexOf(name)
  if (i >= 0) picked.value.splice(i, 1)
  else picked.value.push(name)
}

async function submit() {
  if (submitting.value || !picked.value.length) return
  if (props.assets.length > 200) return void message.warning('一次最多给 200 个资产移除标签')
  if (picked.value.length > 20) return void message.warning('一次最多移除 20 个标签')
  submitting.value = true
  try {
    // 接口按标签 id 移除：用标签字典把名字换成 id
    const dict = (await assetLibTags()).data?.items ?? []
    const ids = picked.value.map((n) => dict.find((t) => t.name === n)?.id).filter((v): v is number => v != null)
    if (!ids.length) return void message.warning('标签已不存在，请刷新后重试')
    const res = await assetLibBatchTag({ assetIds: props.assets.map((a) => a.id), removeTagIds: ids })
    message.success(`已从资产上移除 ${res.data?.removed ?? 0} 条标签`)
    emit('success')
    show.value = false
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <n-modal v-model:show="show" preset="card" title="批量移除标签" style="width: 480px">
    <p class="text-12px text-muted m-0 mb-10px">从选中的 {{ assets.length }} 个资产上摘掉所选标签，资产本身与其他标签不受影响。</p>
    <div class="flex flex-wrap gap-6px max-h-260px overflow-auto p-2px">
      <span
        v-for="o in options"
        :key="o.name"
        class="ll-tag"
        :class="{ 'll-tag-active': picked.includes(o.name) }"
        role="button"
        tabindex="0"
        :aria-pressed="picked.includes(o.name)"
        @click="toggle(o.name)"
        @keydown.enter.prevent="toggle(o.name)"
        @keydown.space.prevent="toggle(o.name)"
      >
        {{ o.name }}<i class="not-italic ml-4px text-placeholder">{{ o.n }}</i>
      </span>
      <div v-if="!options.length" class="ll-empty">选中的资产上没有标签</div>
    </div>
    <template #footer>
      <div class="flex items-center justify-between">
        <span class="text-12px text-placeholder">已选 {{ picked.length }} 个标签</span>
        <div class="flex gap-8px">
          <n-button size="small" @click="show = false">取消</n-button>
          <n-button size="small" type="primary" :loading="submitting" :disabled="!picked.length" @click="submit">移除</n-button>
        </div>
      </div>
    </template>
  </n-modal>
</template>
