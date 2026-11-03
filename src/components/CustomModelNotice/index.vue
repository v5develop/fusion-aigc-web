<script setup lang="ts">
import { useId } from 'vue'
/**
 * CustomModelNotice - 自定义模型须知弹窗
 *
 * 使用方式:
 * <CustomModelNotice v-model:data="visibleObj" />
 *
 * 点击"同意"后会自动保存 customModelNoticeConfirmed 到 localStorage
 */
const titleId = `custom-model-notice-${useId()}`
const data = defineModel<{ show: boolean; customModelNoticeConfirmed: boolean }>('data', { required: true })

/** 点击遮罩关闭 */
function onMaskClick() {
  data.value.show = false
}

/** 点击同意 */
function onAgree() {
  localStorage.setItem('customModelNoticeConfirmed', 'true')
  data.value = {
    show: false,
    customModelNoticeConfirmed: true,
  }
}
</script>

<template>
  <!-- 对话框（规范 §3 / §5）：遮罩 50% 黑；r12、line 描边、shadow-pop；标题 16/600；只做淡入淡出，不缩放 -->
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-mid ease-sx motion-reduce:transition-none"
      leave-active-class="transition-opacity duration-fast ease-sx motion-reduce:transition-none"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="data.show"
        class="fixed inset-0 z-1000 flex items-center justify-center p-16px box-border bg-black/50"
        @click.self="onMaskClick"
        @keydown.esc="onMaskClick"
      >
        <div
          role="dialog"
          aria-modal="true"
          :aria-labelledby="titleId"
          class="flex flex-col w-1000px max-w-full overflow-hidden rounded-dialog border border-solid border-line bg-white shadow-pop"
        >
          <div class="flex items-center justify-between gap-12px h-56px px-24px pt-12px box-border">
            <h2 :id="titleId" class="m-0 text-16px font-600 leading-22px text-ink">视频主体功能使用须知</h2>
            <button
              type="button"
              class="grid place-items-center w-26px h-26px p-0 rounded-sm border-none bg-transparent text-muted cursor-pointer hover:(bg-surface3 text-ink) sx-focus"
              aria-label="关闭"
              @click="onMaskClick"
            >
              <svg
                class="w-14px h-14px"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                aria-hidden="true"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <iframe
            class="block w-full h-[80vh] box-border px-24px py-12px border-none"
            title="视频主体功能使用须知"
            src="https://aigc.pengqiwl.com/agreements/ai-generate-terms-of-use.pdf"
          ></iframe>

          <div class="flex items-center justify-end gap-8px px-24px pt-12px pb-24px">
            <button type="button" class="sx-btn" @click="onMaskClick">取消</button>
            <button type="button" class="sx-btn-primary" @click="onAgree">同意</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
