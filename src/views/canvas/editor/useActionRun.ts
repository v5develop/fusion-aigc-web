/**
 * 计费图片动作（编辑 / 多视图 / 图层）的一次提交 + 轮询的状态：
 * 阶段、错误、已等待秒数、轮询中止、幂等键。
 *
 * <p>幂等键规则：结果未知（断网 / 超时 / 5xx）时保留原键，重试原样重发，服务端按键去重不会重复扣点；
 * 明确被拒（参数不合法、点数不足）或已拿到任务号后，下一次提交换新键。
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { createSafeUuid } from '@/utils/utils'

export type ActionPhase = 'idle' | 'submitting' | 'polling' | 'done' | 'error' | 'stopped'

export function useActionRun() {
  const phase = ref<ActionPhase>('idle')
  const error = ref('')
  const elapsed = ref(0)
  let timer: ReturnType<typeof setInterval> | null = null
  let controller: AbortController | null = null
  let pendingKey: string | null = null

  const busy = computed(() => phase.value === 'submitting' || phase.value === 'polling')

  function idempotencyKey(): string {
    if (!pendingKey) pendingKey = createSafeUuid()
    return pendingKey
  }

  /** 提交有了明确结果（成功拿到任务号，或被明确拒绝）：下次换新键 */
  function releaseKey(): void {
    pendingKey = null
  }

  function stopClock(): void {
    if (timer) clearInterval(timer)
    timer = null
  }

  function startClock(): void {
    stopClock()
    elapsed.value = 0
    timer = setInterval(() => {
      elapsed.value += 1
    }, 1000)
  }

  /** 新一轮轮询的中止信号（会先中止上一轮） */
  function signal(): AbortSignal {
    controller?.abort()
    controller = new AbortController()
    return controller.signal
  }

  function abort(): void {
    controller?.abort()
    controller = null
    stopClock()
  }

  function fail(message: string): void {
    stopClock()
    error.value = message
    phase.value = 'error'
  }

  onBeforeUnmount(abort)

  return { phase, error, elapsed, busy, idempotencyKey, releaseKey, startClock, stopClock, signal, abort, fail }
}
