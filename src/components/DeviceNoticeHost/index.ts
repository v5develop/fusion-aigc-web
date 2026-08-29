import { defineComponent, h, onMounted, onBeforeUnmount } from 'vue'
import { useMessage } from 'naive-ui'
import type { MessageReactive } from 'naive-ui'
import type { VNodeChild } from 'vue'

/**
 * DeviceNoticeHost - 桌面端「设备侧提示」的展示宿主（不渲染任何 DOM）
 *
 * <p>背景：站点在桌面端宿主内运行时，生成请求可能被派回<b>本机豆包</b>执行。这类失败的真实原因
 * （豆包掉登录 / 当日额度用完 / 豆包繁忙 / 生成超时）只有桌面端知道——走服务端往返只能拿到 401/5xx，
 * 站点没法翻译成有意义的文案。故桌面端把失败翻好后经 `window.ThirdServiceBridge.onDeviceNotice`
 * 直推过来，这里负责用全站一致的 message 展示。
 *
 * <p>本通道与 `src/api/index.ts` 里的 401/业务错误 toast <b>互补，不是替代</b>：
 * 本通道只覆盖「派到本机的供给失败」，其余一切仍由请求层兜底，两边都不能省。
 *
 * <p>为什么是组件而不是 utils 下的纯模块：要用 `useMessage()` 拿到 App.vue 里那个继承了 themeOverrides
 * 的 message 实例（`src/api/index.ts` 的 `createDiscreteApi` 是另一套独立挂载点、不带主题）。
 * 故本组件必须挂在 `<n-message-provider>` 内部。
 *
 * <p>为什么写成 .ts 而不是 .vue：它没有任何模板，`render: () => null` 才是它的真实形态；
 * 空模板的 SFC 过不了 vue/valid-template-root。
 */

/**
 * kind → 展示样式。文案一律原样展示，kind 只决定颜色与停留时长。
 *
 * <p>用 Map 而不是对象字面量：kind 是宿主传来的任意字符串，对象查表会穿到原型链上——
 * `kind: 'toString'` 会取到 Object.prototype.toString（真值，`??` 兜底不生效），
 * 接着 `message[undefined](...)` 抛错，把异常甩回宿主的派发循环里，反而连累后续提示。
 */
const NOTICE_STYLE = new Map<string, { type: 'error' | 'warning'; duration: number }>([
  ['quota-exhausted', { type: 'warning', duration: 5000 }],
  ['busy', { type: 'warning', duration: 4000 }],
  ['timeout', { type: 'warning', duration: 4000 }],
  ['failed', { type: 'error', duration: 4000 }],
])

/** 未知 kind 的兜底（词表会增长，新分类不能因为前端没认出来就不提示） */
const FALLBACK_STYLE = { type: 'error', duration: 4000 } as const

export default defineComponent({
  name: 'DeviceNoticeHost',
  setup() {
    const message = useMessage()

    /**
     * 当前那条常驻的掉登录提示，非空即代表屏幕上正挂着一条。
     *
     * <p>need-login 是 duration:0 的常驻提示（要留住「去登录」按钮给用户点），而桌面端按 kind 做的是
     * 60s 节流、不是只推一次——不拦一道的话，挂机久了会攒出一叠一模一样的红条。
     */
    let loginNotice: MessageReactive | null = null

    function destroyLoginNotice() {
      loginNotice?.destroy()
      loginNotice = null
    }

    function onRelogin() {
      window.ThirdServiceBridge?.requestDoubaoRelogin?.()
      // 桌面端会把主窗提到前台弹登录框，站点这边再留个常驻红条没有意义
      destroyLoginNotice()
    }

    /** 掉登录：常驻 + 可关闭，文案后跟一个「去登录」。naive 的 message 没有 action 槽，只能走 content 渲染函数 */
    function showNeedLogin(notice: DeviceNotice) {
      // 已经挂着一条就不再弹：常驻提示重复叠加没有信息增量，用户只会被越堆越高的红条挡住页面。
      // 注意这里是「拦住不建」而不是「先 destroy 再建」——naive 的 destroy() 走的是
      // messageRefs[key]?.hide()，而那个 ref 要等渲染刷新才登记，同一 tick 内建完就销毁是静默 no-op
      if (loginNotice) return

      // 旧版桌面端没有 requestDoubaoRelogin：点了没反应比不显示按钮更糟
      const canRelogin = typeof window.ThirdServiceBridge?.requestDoubaoRelogin === 'function'

      const created: MessageReactive = message.error(
        () => {
          const children: VNodeChild[] = [notice.message]
          if (canRelogin) {
            // 样式必须内联：这个 VNode 是在 NMessage 的渲染上下文里造的，拿不到本组件的 scopeId，
            // <style scoped> 的 class 不会命中
            children.push(
              h(
                'span',
                {
                  style: { marginLeft: '12px', color: '#8E66F9', cursor: 'pointer', whiteSpace: 'nowrap' },
                  onClick: onRelogin,
                },
                '去登录',
              ),
            )
          }
          return h('span', children)
        },
        {
          duration: 0,
          closable: true,
          // 用 onAfterLeave 而不是 onClose 清句柄：onClose 只在用户点 ✕ 时触发，
          // 程序化 destroy（点了「去登录」）走不到它，句柄会永远非空、此后再也弹不出掉登录提示。
          // 只认自己那条：离场动画期间若已经换上了新的一条，别把新句柄一起清掉
          onAfterLeave: () => {
            if (loginNotice === created) loginNotice = null
          },
        },
      )
      loginNotice = created
    }

    function handleNotice(notice: DeviceNotice) {
      // 不信任宿主传来的形状：没文案就没什么可展示的
      if (!notice?.message) return

      if (notice.kind === 'need-login') {
        showNeedLogin(notice)
        return
      }

      const { type, duration } = NOTICE_STYLE.get(notice.kind) ?? FALLBACK_STYLE
      // 不再做去重/节流：桌面端已按 kind 做了 60s 节流，前端再加一层只会互相干扰
      message[type](notice.message, { duration, closable: true })
    }

    let off: (() => void) | void

    onMounted(() => {
      // 宿主没有这个方法（浏览器直开 / 移动端 / 旧版桌面端）时整段是 no-op，零副作用
      off = window.ThirdServiceBridge?.onDeviceNotice?.(handleNotice)

      // 本地联调用：不起桌面端也能在 devtools 里试各种 kind 的展示效果。生产构建会被摇掉
      if (import.meta.env.DEV) window.__emitDeviceNotice = handleNotice
    })

    onBeforeUnmount(() => {
      off?.()
      off = undefined
      destroyLoginNotice()
      if (import.meta.env.DEV) delete window.__emitDeviceNotice
    })

    return () => null
  },
})
