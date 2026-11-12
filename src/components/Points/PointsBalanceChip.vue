<script setup lang="ts">
/**
 * 余额胶囊（原型 PointsBalanceChip）：「余额 N 点」；加载中骨架；失败显示「余额获取失败」，点击重试；未登录不显示。
 *
 * <p>余额以 userInfo store 的 availablePoints 为准（导航栏同一份），挂载时调一次 /api/v1/points/balance
 * 回写进去；提交后的刷新沿用各页面已有的 updateUserInfo，这里不轮询。
 * store 还没拿到用户信息时，先用本次查到的值顶上。
 */
import { computed, onMounted, ref } from 'vue'
import { NSkeleton } from 'naive-ui'
import { getPointsBalance } from '@/api/points'
import { useUserInfoStore } from '@/stores/user-info'
import { emitBillingBlock } from '@/utils/billing-guide'

withDefaults(defineProps<{ /** 余额旁出现「充值」：走宿主已有的点数引导弹框（BillingGuideHost），站内不做支付 */ recharge?: boolean }>(), {
  recharge: false,
})

const store = useUserInfoStore()

// 未登录不显示余额（与路由守卫同一判据：本地有没有 fusion token）
const isGuest = !localStorage.getItem('fusion_accessToken')

const fetched = ref<number | null>(null)
const loading = ref(false)
const failed = ref(false)

const availablePoints = computed<number | null>(() => store.userInfo?.availablePoints ?? fetched.value)
// 已经有余额（store 里有）时不拿失败盖掉它
const showError = computed(() => failed.value && availablePoints.value === null)
const showSkeleton = computed(() => loading.value && availablePoints.value === null)

async function refresh() {
  if (isGuest || loading.value) return
  loading.value = true
  failed.value = false
  try {
    const res = await getPointsBalance()
    const balance = res.code === 0 ? res.data?.balance : undefined
    if (typeof balance !== 'number') {
      failed.value = true
      return
    }
    fetched.value = balance
    if (store.userInfo) store.userInfo.availablePoints = balance
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void refresh()
})
</script>

<template>
  <button
    v-if="!isGuest && showError"
    type="button"
    class="flex shrink-0 cursor-pointer items-center rounded-full border-none bg-page px-2 py-0.5 text-12px leading-18px text-muted transition-colors hover:text-ink-2"
    aria-label="余额获取失败，点击重试"
    @click="refresh"
  >
    余额获取失败
  </button>
  <span
    v-else-if="!isGuest"
    class="flex shrink-0 items-center gap-1 rounded-full bg-page px-2 py-0.5 text-12px leading-18px text-muted"
  >
    <template v-if="availablePoints !== null">
      余额 <b class="font-mono font-semibold tabular-nums text-ink">{{ availablePoints }}</b> 点
    </template>
    <n-skeleton v-else-if="showSkeleton" :width="56" :height="12" />
    <button
      v-if="recharge && availablePoints !== null"
      type="button"
      class="ml-2px cursor-pointer border-none bg-transparent p-0 text-12px leading-18px text-violet hover:underline sx-focus"
      aria-label="充值点数"
      @click="emitBillingBlock(3003)"
    >
      充值
    </button>
  </span>
</template>
