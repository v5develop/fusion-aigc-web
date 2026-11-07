<script setup lang="ts">
/**
 * 单字段标题输入弹窗：重命名 / 另存为（创建副本）共用。
 * 确定时回传 trim 后的值（可能为空串，由调用方决定语义）。
 */
import { nextTick, ref, watch } from 'vue'

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

const inputRef = ref<{ focus: () => void; select: () => void } | null>(null)

watch(show, (v) => {
  if (!v) return
  value.value = props.initial ?? ''
  // 打开即聚焦；有预填内容时全选，便于直接改写
  void nextTick(() => {
    inputRef.value?.focus()
    if (value.value) inputRef.value?.select()
  })
})

/** 输入法组词时的 Enter 只是选词，不能提交 */
function onKeydown(e: KeyboardEvent) {
  // Safari 等组词结束的那次 Enter 不带 isComposing，只能靠 keyCode 229 认
  if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return
  e.preventDefault()
  ok()
}

function ok() {
  if (props.loading) return
  emit('confirm', value.value.trim())
}
</script>

<template>
  <n-modal v-model:show="show" preset="card" :title="title" :auto-focus="false" style="width: 420px">
    <div>
      <div class="text-13px text-ink mb-6px">{{ label }}</div>
      <n-input
        ref="inputRef"
        v-model:value="value"
        :maxlength="100"
        show-count
        :placeholder="placeholder"
        @keydown="onKeydown"
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
