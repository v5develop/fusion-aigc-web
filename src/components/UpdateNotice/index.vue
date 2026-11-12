<script setup lang="ts">
/**
 * 新版本提示卡（独立版）：不依赖侧栏，放在没有 Navigation 的壳里（分享页、全屏页、App 根）用。
 * 有侧栏的页面直接把 useAppVersion().updateNotice 传给 Navigation 即可，不要同时挂两份。
 *
 *   <UpdateNotice />
 */
import { useAppVersion } from '@/composables/useAppVersion'

const { updateNotice, snooze, reload } = useAppVersion()
</script>

<template>
  <Transition name="xq-update-notice">
    <div
      v-if="updateNotice"
      role="status"
      class="fixed bottom-16px left-16px z-1000 flex w-240px flex-col gap-6px rounded-lg border border-solid border-violet-border px-12px py-10px text-12px leading-18px text-white sx-grad-primary shadow-pop"
    >
      <b class="font-600">{{ updateNotice }}</b>
      <span class="opacity-82">刷新页面即可使用最新版</span>
      <div class="mt-2px flex justify-end gap-6px">
        <button
          type="button"
          class="h-24px cursor-pointer rounded-sm border border-solid border-white/42 bg-transparent px-8px text-12px font-500 leading-20px text-white hover:(border-white/64 bg-white/12) focus-visible:(outline outline-2 outline-solid outline-white outline-offset-1)"
          @click="snooze"
        >
          稍后
        </button>
        <button
          type="button"
          class="h-24px cursor-pointer rounded-sm border border-solid border-white bg-white px-8px text-12px font-600 leading-20px text-violet-ink hover:(border-violet-tint bg-violet-tint) focus-visible:(outline outline-2 outline-solid outline-white outline-offset-1)"
          @click="reload"
        >
          立即更新
        </button>
      </div>
    </div>
  </Transition>
</template>

<style scoped lang="less">
.xq-update-notice-enter-active,
.xq-update-notice-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.xq-update-notice-enter-from,
.xq-update-notice-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
@media (prefers-reduced-motion: reduce) {
  .xq-update-notice-enter-active,
  .xq-update-notice-leave-active {
    transition: none;
  }
}
</style>
