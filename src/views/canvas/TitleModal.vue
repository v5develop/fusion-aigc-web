<script setup lang="ts">
/**
 * 单字段标题输入弹窗：新建空白画布 / 重命名 / 另存为 共用。
 * 确定时回传 trim 后的值（可能为空串，由调用方决定语义）。
 */
import { ref, watch } from 'vue'

const show = defineModel<boolean>('show', { required: true })

const props = defineProps<{
  /** 弹窗标题，如「新建空白画布」 */
  title: string
  /** 字段标签，如「画布标题」 */
  label: string
  placeholder?: string
  /** 打开时的初始值（另存为预填「原标题 - 副本」） */
  initial?: string
  loading?: boolean
}>()

const emit = defineEmits<{ confirm: [value: string] }>()

const value = ref('')

watch(show, (v) => {
  if (v) value.value = props.initial ?? ''
})

function ok() {
  if (props.loading) return
  emit('confirm', value.value.trim())
}
</script>

<template>
  <n-modal v-model:show="show" preset="card" :title="title" style="width: 420px">
    <div>
      <div class="text-13px text-ink mb-6px">{{ label }}</div>
      <n-input
        v-model:value="value"
        :maxlength="100"
        show-count
        :placeholder="placeholder"
        @keyup.enter="ok"
      />
    </div>
    <template #footer>
      <div class="flex justify-end gap-10px">
        <n-button @click="show = false">取消</n-button>
        <n-button type="primary" :loading="loading" @click="ok">确定</n-button>
      </div>
    </template>
  </n-modal>
</template>
