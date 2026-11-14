<script setup lang="ts">
/**
 * 登录半屏（EXPERIENCE M-16 / F-05）：未登录点「做同款」（以及收藏、我的）时弹出，弹层不跳页。
 * 手机（≤640px）是底部半屏，桌面是居中小卡；登录能力沿用站内既有的短信验证码登录（api/union + unionTokenLogin，
 * 与 /login 页同一条链路），不新造登录方式。
 *
 * - 主按钮「登录」；次按钮「先看看」（Esc / 点遮罩 / 返回等同）：不登录，照常继续（onSkip）；
 * - 登录成功：落 token（adoptSession）；换了账号则整页重载（内存里的 store 还是上一个账号的，与 /login 页同理），
 *   现场（见 useLoginGate）在 sessionStorage 里，重载后由智能体页还原；没换号则通知上层就地还原。不自动发送。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { NDrawer, NDrawerContent, NModal } from 'naive-ui'
import { unionTokenLogin } from '@/api/methods'
import { getAuthToken, reportDevice, sendSms, smsLogin } from '@/api/union'
import { adoptSession } from '@/utils/auth-session'
import { useUserInfoStore } from '@/stores/user-info.ts'
import { closeLoginSheet, loginSheet, loginVersion } from './industry/useLoginGate.ts'

const emit = defineEmits<{ success: [] }>()

const show = computed(() => !!loginSheet.value)
const reason = computed(() => loginSheet.value?.reason ?? 'pick')
/** 文案：M-16 / F-05 */
const title = computed(() => (reason.value === 'pick' ? '登录后用你的照片做同款' : '登录后可以收藏模板、查看最近用过的'))
const sub = computed(() =>
  reason.value === 'pick' ? '你选的模板会保留，登录后再放图、再发送，不会自动生成' : '你在这个行业的收藏和我的模板，登录后都在这里',
)

const mq = typeof window !== 'undefined' ? window.matchMedia('(max-width: 640px)') : null
const phone = ref(mq?.matches ?? false)
const onMq = () => (phone.value = mq?.matches ?? false)
mq?.addEventListener('change', onMq)

const num = ref('')
const code = ref('')
const sending = ref(false)
const loggingIn = ref(false)
const countdown = ref(0)
const error = ref('')
let timer: ReturnType<typeof setInterval> | null = null

const phoneValid = computed(() => /^1[3-9]\d{9}$/.test(num.value))
const canSend = computed(() => phoneValid.value && !sending.value && countdown.value === 0)
const canLogin = computed(() => phoneValid.value && code.value.length >= 4 && !loggingIn.value)

onBeforeUnmount(() => {
  mq?.removeEventListener('change', onMq)
  if (timer) clearInterval(timer)
})

watch(show, (on) => {
  if (on) {
    error.value = ''
    code.value = ''
  }
})

function startCountdown() {
  countdown.value = 60
  if (timer) clearInterval(timer)
  timer = setInterval(() => {
    countdown.value--
    if (countdown.value <= 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }, 1000)
}

async function onSend() {
  if (!canSend.value) return
  sending.value = true
  error.value = ''
  try {
    await reportDevice()
    await sendSms(num.value)
    startCountdown()
  } catch (err: any) {
    error.value = err?.message || '发送验证码失败，请稍后重试'
  } finally {
    sending.value = false
  }
}

async function onLogin() {
  if (!canLogin.value) return
  loggingIn.value = true
  error.value = ''
  try {
    await reportDevice()
    const smsRes = await smsLogin({ phone: num.value, code: code.value })
    const authRes = await getAuthToken(smsRes.token)
    const fusionRes = await unionTokenLogin({ token: authRes.tempToken })
    if (fusionRes.code !== 0) {
      error.value = fusionRes.msg || '登录失败'
      return
    }
    const switched = adoptSession(fusionRes.data)
    // 联盟侧凭证必须落在 adoptSession 之后（换号时它会按白名单清 localStorage），同 /login 页
    localStorage.setItem('union_token', smsRes.token)
    localStorage.setItem('union_refreshToken', smsRes.refreshToken)
    if (switched) {
      window.location.reload() // 现场在 sessionStorage 里，重载后由智能体页还原
      return
    }
    closeLoginSheet()
    void useUserInfoStore().updateUserInfo() // 匿名期间没拉过用户信息 / 余额
    loginVersion.value++
    emit('success')
  } catch (err: any) {
    error.value = err?.message || '登录失败，请稍后重试'
  } finally {
    loggingIn.value = false
  }
}

/** 「先看看」/ Esc / 遮罩：关掉并执行不登录也继续的动作 */
function skip() {
  const cb = loginSheet.value?.onSkip
  closeLoginSheet()
  cb?.()
}

const drawerHeight = computed(() => Math.min(Math.round((typeof window !== 'undefined' ? window.innerHeight : 800) * 0.62), 460))
const FOCUS = 'focus-visible:(outline outline-2 outline-violet outline-offset-2)'
const INPUT =
  'box-border h-40px min-w-0 flex-1 rounded-10px border border-solid border-soft-line bg-surface px-12px text-14px text-ink outline-none placeholder:text-placeholder focus:(border-violet shadow-focus)'
</script>

<template>
  <component
    :is="phone ? NDrawer : NModal"
    v-bind="
      phone
        ? { show, placement: 'bottom', height: drawerHeight, autoFocus: true, trapFocus: true }
        : { show, autoFocus: true, trapFocus: true, transformOrigin: 'center' }
    "
    @update:show="(v: boolean) => !v && skip()"
  >
    <component :is="phone ? NDrawerContent : 'div'" v-bind="phone ? { nativeScrollbar: true, bodyContentStyle: { padding: 0 } } : {}">
      <form
        role="dialog"
        aria-labelledby="plaza-login-title"
        :aria-modal="true"
        data-testid="plaza-login-sheet"
        :class="[
          'relative flex flex-col gap-12px bg-surface p-20px text-left text-ink',
          phone ? 'h-full rounded-t-20px' : 'sx-squircle w-[min(400px,92vw)] rounded-20px border border-solid border-soft-line shadow-pop',
        ]"
        @submit.prevent="onLogin"
      >
        <span v-if="phone" class="mx-auto -mt-8px h-4px w-36px flex-none rounded-2px bg-line-strong" aria-hidden="true" />
        <h3 id="plaza-login-title" class="m-0 text-17px font-600 leading-26px">{{ title }}</h3>
        <p class="m-0 text-12px leading-18px text-muted">{{ sub }}</p>
        <label class="flex flex-col gap-4px">
          <span class="text-12px text-muted">手机号</span>
          <input v-model.trim="num" type="tel" inputmode="numeric" maxlength="11" autocomplete="tel" placeholder="请输入手机号" :class="INPUT" />
        </label>
        <div class="flex flex-col gap-4px">
          <span class="text-12px text-muted">验证码</span>
          <div class="flex gap-8px">
            <input v-model.trim="code" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="短信验证码" :class="INPUT" />
            <button type="button" class="sx-btn !h-40px flex-none" :disabled="!canSend" @click="onSend">
              {{ countdown > 0 ? `${countdown}s 后重发` : sending ? '发送中' : '获取验证码' }}
            </button>
          </div>
        </div>
        <p v-if="error" role="alert" class="m-0 text-12px leading-18px text-alert-danger">{{ error }}</p>
        <button type="submit" class="sx-btn-primary !h-44px !text-14px" :disabled="!canLogin">
          {{ loggingIn ? '登录中…' : '登录' }}
        </button>
        <button
          type="button"
          class="m-0 h-36px border-0 bg-transparent text-13px text-muted cursor-pointer hover:text-ink"
          :class="FOCUS"
          @click="skip"
        >
          先看看
        </button>
      </form>
    </component>
  </component>
</template>
