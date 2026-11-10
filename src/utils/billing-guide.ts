/**
 * 「计费拦截」信号通道：请求层发信号，`BillingGuideHost` 收信号弹引导框。
 *
 * <p>为什么要隔一层通道、而不是让 `api/index.ts` 直接调组件：
 * 弹框得用 `useDialog()` 才能拿到 App.vue 里带主题的实例，那是个组件；而
 * `api/index.ts → 组件 → stores → api/methods → api/index.ts` 是一条环
 * （`api/index.ts` 里 `logoutToLogin` 用动态 import 取 store 就是在绕同一条环）。
 * 本模块<b>不 import 任何东西</b>，两头都能静态引它，环自然闭不上。
 */

/**
 * 「用户可自助解决的计费失败」错误码。
 *
 * <p>这三个码的共同点是：不是参数错、也不是系统故障，用户去订阅/充值就能继续，
 * 所以要给入口而不是弹一句干巴巴的报错。取值见《创作提交-失败错误码-前端接入说明》：
 * 3003 点数余额不足 / 3004 功能权限已过期 / 46012 业务已过期。
 *
 * <p>⚠️ 后端目前把「点数批次余额不足」这类<b>内部账异常</b>也抛成 3003（文档待办 3）。
 * 那是系统故障，引导充值没用，但前端按 code 分不出来，只能一并按余额不足处理。
 */
export const BILLING_BLOCK_CODES = new Set([3003, 3004, 46012])

type BillingBlockListener = (code: number) => void

const listeners = new Set<BillingBlockListener>()

/** 订阅计费拦截信号，返回退订函数（组件卸载时调用） */
export function onBillingBlock(cb: BillingBlockListener): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/**
 * 广播一次计费拦截。
 *
 * <p>遍历前先复制一份：监听里退订自己（弹框宿主卸载）会改动集合，
 * 直接迭代原 Set 会漏掉后面的监听。单个监听抛错也不能连累其余监听。
 */
export function emitBillingBlock(code: number): void {
  for (const cb of [...listeners]) {
    try {
      cb(code)
    } catch (e) {
      console.error('[billing] 引导弹框监听异常', e)
    }
  }
}
