<script setup lang="ts">
/**
 * 「存为我的模板」小输入（EXPERIENCE R-05）：默认名「足浴 · 蓝V号 · 11-13」可改，≤40 字；确认后由上层调接口。
 * 保存失败时上层把 `busy` 置回 false 并保持打开，用户可直接重试。
 */
import { nextTick, ref, watch } from 'vue'
import { NModal } from 'naive-ui'

const props = defineProps<{ show: boolean; defaultName: string; busy?: boolean; error?: string }>()
const emit = defineEmits<{ close: []; confirm: [name: string] }>()

const name = ref('')
const input = ref<HTMLInputElement | null>(null)
watch(
  () => props.show,
  async (on) => {
    if (!on) return
    name.value = props.defaultName
    await nextTick()
    input.value?.focus()
    input.value?.select()
  },
)

function submit() {
  const n = name.value.trim()
  if (!n || props.busy) return
  emit('confirm', n.slice(0, 40))
}
</script>

<template>
  <NModal :show="show" :auto-focus="false" trap-focus @update:show="(v: boolean) => !v && emit('close')">
    <form
      role="dialog"
      aria-label="存为我的模板"
      class="sx-squircle flex w-[min(360px,92vw)] flex-col gap-12px rounded-20px border border-solid border-soft-line bg-surface p-18px text-ink shadow-pop"
      data-testid="plaza-save-mine"
      @submit.prevent="submit"
    >
      <h3 class="m-0 text-16px font-600 leading-24px">存为我的模板</h3>
      <p class="m-0 text-12px leading-18px text-muted">保存这次的模板、设置、版数和文字；只有你自己看得到，下次一键放回输入框。</p>
      <input
        ref="input"
        v-model="name"
        type="text"
        maxlength="40"
        placeholder="给它起个名字"
        aria-label="模板名称"
        class="box-border h-40px w-full rounded-10px border border-solid border-soft-line bg-surface px-12px text-14px text-ink outline-none focus:(border-violet shadow-focus)"
      />
      <p v-if="error" role="alert" class="m-0 text-12px leading-18px text-alert-danger">{{ error }}</p>
      <div class="flex justify-end gap-8px">
        <button type="button" class="sx-btn" @click="emit('close')">取消</button>
        <button type="submit" class="sx-btn-primary" :disabled="busy || !name.trim()">{{ busy ? '保存中…' : '保存' }}</button>
      </div>
    </form>
  </NModal>
</template>
