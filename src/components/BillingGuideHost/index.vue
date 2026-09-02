<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { onBillingBlock } from '@/utils/billingGuide'
import { hasBillingPage, openBillingPage } from '@/utils/billing'
import { registerOverlayCloser } from '@/utils/overlayGuard'
import { useUserInfoStore } from '@/stores/userInfo'
import warnIcon from '@/assets/icons/billing-warn.svg'

/**
 * BillingGuideHost - 「积分不足 / 请先订阅」引导弹框
 *
 * <p>背景：提交创作时后端可能返回 3003（点数余额不足）/ 3004（功能权限已过期）/
 * 46012（业务已过期）。这三类失败用户<b>可以自助解决</b>——去订阅套餐或买加油包就能继续，
 * 所以按《创作提交-失败错误码-前端接入说明》的要求，不能只弹一句报错，得给购买入口。
 *
 * <p>信号从 `api/index.ts` 的响应拦截器经 `utils/billingGuide` 这条模块级通道过来，
 * 请求层不直接碰组件——两者之间隔着 stores 的循环依赖，详见 `utils/billingGuide.ts`。
 *
 * <p>用 n-modal 手写卡片而不是 n-dialog：设计稿是「图标 + 标题 + 副文案 + 两个胶囊按钮」的
 * 居中卡片，没有标题栏、没有右上角 ✕，n-dialog 的固定结构套不上。
 */

interface GuideCopy {
  title: string
  desc: string
  /** 主按钮文案；没配充值页地址时整个按钮不渲染 */
  action: string
}

/**
 * code → 文案，取自设计稿。
 *
 * <p>用 Map 而不是对象字面量：查表的 key 来自后端响应，对象查表会穿到原型链上
 * （`code` 恰好等于 'toString' 之类时取到函数，`??` 兜底不生效）。同 DeviceNoticeHost。
 */
const GUIDE_COPY = new Map<number, GuideCopy>([
  [3003, { title: '积分不足', desc: '创作积分快用完啦～ 补点电继续玩转创作', action: '购买加油包' }],
  [3004, { title: '请先订阅', desc: '解锁订阅，AI创作随便玩～', action: '订阅套餐' }],
])
// 46012「业务已过期」与 3004 是同一件事的两个抛出点，共用文案
GUIDE_COPY.set(46012, GUIDE_COPY.get(3004)!)

/** 未知计费码的兜底：码表会增长，新码不能因为前端没认出来就什么都不提示 */
const FALLBACK_COPY = GUIDE_COPY.get(3003)!

const show = ref(false)
const copy = ref<GuideCopy>(FALLBACK_COPY)
const canBuy = hasBillingPage()

const { updateUserInfo } = useUserInfoStore()

/** 用户去买了：回到本页时刷新一次积分，让导航栏立刻显示新余额 */
let offFocus: (() => void) | null = null

function watchFocus() {
  if (offFocus) return
  const onFocus = () => void updateUserInfo()
  window.addEventListener('focus', onFocus)
  offFocus = () => window.removeEventListener('focus', onFocus)
}

function unwatchFocus() {
  offFocus?.()
  offFocus = null
}

function handleBlock(code: number) {
  // 已经开着就不再改文案：一次点击可能并发提交多张图，余额不足时每条响应都会发一次信号，
  // 让后到的信号改写正在看的这一个框只会让文案跳变
  if (show.value) return
  copy.value = GUIDE_COPY.get(code) ?? FALLBACK_COPY
  show.value = true
}

function close() {
  show.value = false
  unwatchFocus()
}

function onBuy() {
  openBillingPage()
  watchFocus()
  // 刻意不关框：点按钮只是打开了购买页，不等于买完了。用户可能在那边看一眼就切回来，
  // 框还在才有退路（再点一次）。同 DeviceNoticeHost 对「去登录」的处理
}

let offBlock: (() => void) | null = null
let offOverlay: (() => void) | null = null

onMounted(() => {
  offBlock = onBillingBlock(handleBlock)
  // modal 是 Teleport 到 body 的，不在 keep-alive 的缓存子树里：不注册的话
  // 切标签后遮罩会一直盖在新标签上并吃掉全部点击。详见 utils/overlayGuard.ts
  offOverlay = registerOverlayCloser(close)

  // 本地联调用：不用真造一次余额不足的提交，也能在 devtools 里试各个码的展示效果
  // （`__emitBillingBlock(3003)`）。生产构建会被摇掉。同 DeviceNoticeHost 的做法
  if (import.meta.env.DEV) window.__emitBillingBlock = handleBlock
})

onBeforeUnmount(() => {
  offBlock?.()
  offBlock = null
  offOverlay?.()
  offOverlay = null
  unwatchFocus()
  if (import.meta.env.DEV) delete window.__emitBillingBlock
})
</script>

<template>
  <n-modal v-model:show="show">
    <div class="billing-guide">
      <img class="icon" :src="warnIcon" alt="" width="60" height="60" />

      <div class="text">
        <h3 class="title">{{ copy.title }}</h3>
        <p class="desc">{{ copy.desc }}</p>
      </div>

      <div class="actions">
        <button class="btn ghost" @click="close">我再想想</button>
        <button v-if="canBuy" class="btn primary" @click="onBuy">{{ copy.action }}</button>
      </div>
    </div>
  </n-modal>
</template>

<style scoped lang="less">
// 尺寸与色值取自设计稿（MasterGo 1295:73386 / 1295:74882）：
// 414×264 白卡，32px 内边距，图标 60、标题 20/600、副文案 14/500、按钮 44 高胶囊
.billing-guide {
  box-sizing: border-box;
  width: 414px;
  padding: 32px;
  background: #fff;
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;

  > .icon {
    display: block;
  }

  > .text {
    margin-top: 20px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;

    > .title {
      margin: 0;
      font-size: 20px;
      font-weight: 600;
      line-height: 28px;
      color: #3a3a3a; // 中性色/正文文字
    }

    > .desc {
      margin: 0;
      font-size: 14px;
      font-weight: 500;
      line-height: 20px;
      text-align: center;
      color: #8f8f8f; // 中性色/辅助文字
    }
  }

  > .actions {
    margin-top: 20px;
    display: flex;
    gap: 16px;

    > .btn {
      height: 44px;
      padding: 11px 24px;
      border: none;
      border-radius: 22px;
      font-size: 16px;
      font-weight: 500;
      line-height: 22px;
      white-space: nowrap;
      cursor: pointer;
      transition: opacity 0.2s;

      &:hover {
        opacity: 0.85;
      }
    }

    > .ghost {
      background: #f0ebff; // AI智慧紫/AI浅底色
      color: #8e66f9; // AI智慧紫/AI强调色
    }

    > .primary {
      background: #8e66f9; // AI智慧紫/AI强调色
      color: #fff;
    }
  }
}
</style>
