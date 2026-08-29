import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useMessage } from 'naive-ui'
import { sameStyleRecipe } from '@/api/methods'
import type { ISameStyleRecipe } from '@/api/types'
import { SAME_STYLE_SUBMIT_PATH } from '@/utils/sameStyle'

const first = (v: unknown): string => {
  const raw = Array.isArray(v) ? v[0] : v
  return typeof raw === 'string' ? raw.trim() : ''
}

/**
 * 消费「做同款」深链：地址栏带 sameStyleSource + sameStyleId 时拉配方，交给页面回显。
 *
 * <p>跨页只传 id、由目标页自己再拉一次配方，而不是把整份配方塞进 query 或 store：
 * URL 短、可刷新、可直达，页面重载后回显仍然正确。
 *
 * <p>用 watch 而不是 setup 里读一次：非电商页 keep-alive 的 cacheKey 恒为 undefined，
 * 同一条 route record 只变 query 走的是 patch 而非 remount（见 useEntryCodeFromQuery
 * 的同款说明），setup 不会重跑，一次性读法在「已在 /picture 再做一次同款」时会失效。
 *
 * @param entryCodeOps 本页支持的创作场景，充当白名单
 * @param apply        把配方写进页面自己的 formData；entryCode 已校验过。
 *                     内部每次 await 之后应先 isCurrent() 再继续写，避免被后来的配方抢先后又盖回去
 */
export function useSameStyleRecipe(
  entryCodeOps: readonly { value: string }[],
  apply: (recipe: ISameStyleRecipe, entryCode: string, isCurrent: () => boolean) => void | Promise<void>,
) {
  const route = useRoute()
  const message = useMessage()
  const loading = ref(false)
  // 连点两条不同作品时，晚发早归的响应不能覆盖后发的
  let seq = 0

  // 必须是「getter 数组」而不是「返回数组的 getter」：后者每次求值都是新数组，
  // Object.is 恒为 false，于是任何一次导航都会重新拉配方、把用户改过的表单打回配方值——
  // 而回填本身会改 entryCode，触发页面的 syncToUrl 再写一次 query，正好构成这条回路。
  watch(
    [() => route.query.sameStyleId, () => route.query.sameStyleSource],
    ([rawId, rawSource]) => {
      const dataId = first(rawId)
      const sourceType = first(rawSource)
      if (!dataId || !sourceType) return

      const mySeq = ++seq
      loading.value = true
      sameStyleRecipe({ sourceType, dataId, platform: 'PC' })
        .then(async (res) => {
          if (mySeq !== seq) return
          const recipe = res.data
          const entryCode = recipe?.submit?.request?.entryCode
          // 电商/模板等入口的配方形状与本页表单对不上，回显进来只会更糟
          if (typeof entryCode !== 'string' || !entryCodeOps.some((o) => o.value === entryCode)) {
            message.warning('该内容暂不支持做同款')
            return
          }
          // 提交地址不可硬编码：本期只接统一提交口，别的协议直接不回显
          const submitPath = recipe.submit.route?.submitPath?.trim()
          if (submitPath && submitPath !== SAME_STYLE_SUBMIT_PATH) {
            message.warning('该内容暂不支持做同款')
            return
          }
          // apply 内部还要 await（模型表、nextTick），期间可能又来一条新配方；
          // 把「我还是最新的那次吗」交给它在每次让出后自查，否则旧配方的档位/素材会盖在新的上面
          await apply(recipe, entryCode, () => mySeq === seq)
        })
        .catch((err) => {
          if (mySeq !== seq) return
          // 未被推荐/已删除/被屏蔽，后端一律按 404 返回（防止枚举用户任务）
          if (err?.response?.status === 404) {
            message.warning('内容不存在或已下架')
            return
          }
          // 业务失败（code !== 0）拦截器已弹过后端文案，这里只补网络类错误
          if (err?.isAxiosError) message.warning('配方获取失败，请稍后重试')
        })
        .finally(() => {
          if (mySeq === seq) loading.value = false
        })
    },
    { immediate: true },
  )

  return { sameStyleLoading: loading }
}
