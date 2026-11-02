<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { unionTokenLogin } from '@/api/methods'
import { sendSms, smsLogin, reportDevice, getAuthToken } from '@/api/union'
import { adoptSession } from '@/utils/authSession'

const router = useRouter()

if (localStorage.getItem('fusion_accessToken')) {
  router.replace('/')
}

const phone = ref('')
const code = ref('')
const sending = ref(false)
const loggingIn = ref(false)
const countdown = ref(0)
const errorMessage = ref('')

const isPhoneValid = computed(() => /^1[3-9]\d{9}$/.test(phone.value))
const canSend = computed(() => isPhoneValid.value && !sending.value && countdown.value === 0)
const canLogin = computed(() => isPhoneValid.value && code.value.length >= 4 && !loggingIn.value)

let timer: ReturnType<typeof setInterval> | null = null

function startCountdown() {
  countdown.value = 60
  timer = setInterval(() => {
    countdown.value--
    if (countdown.value <= 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }, 1000)
}

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

async function handleSendSms() {
  if (!canSend.value) return
  sending.value = true
  errorMessage.value = ''
  try {
    await reportDevice()
    await sendSms(phone.value)
    startCountdown()
  } catch (err: any) {
    errorMessage.value = err?.message || err?.response?.data?.message || '发送验证码失败，请稍后重试'
  } finally {
    sending.value = false
  }
}

async function handleLogin() {
  if (!canLogin.value) return
  loggingIn.value = true
  errorMessage.value = ''
  try {
    await reportDevice()
    const smsRes = await smsLogin({ phone: phone.value, code: code.value })
    const authRes = await getAuthToken(smsRes.token)
    const unionToken = authRes.tempToken

    const fusionRes = await unionTokenLogin({ token: unionToken })
    if (fusionRes.code === 0) {
      // 走 adoptSession 而不是手写 setItem：换个手机号登录同样要清掉上一个账号的
      // 电商标签与会话缓存，这台机器上换号的语义和容器里换号是一样的
      const switched = adoptSession(fusionRes.data)
      // 联盟侧凭证必须落在 adoptSession <b>之后</b>：换号时它会按白名单清空 localStorage，
      // 先写就会被一起清掉，独立运行时的刷新链路（refreshViaUnion）随即失去 union_refreshToken
      localStorage.setItem('union_token', smsRes.token)
      localStorage.setItem('union_refreshToken', smsRes.refreshToken)
      const redirect = (router.currentRoute.value.query.redirect as string) || '/'

      if (switched) {
        // 换号必须整页重载，router.replace 不够。独立运行时是靠 `location.hash = '#/login'`
        // 跳到这个页面的（见 api/index.ts 的 logoutToLogin），页面从没重载过，
        // pinia 里上一个账号的 store 全都活着——只清 localStorage 的话，
        // useEcTabsStore 那个 deep watch 会把内存里的旧标签原样再写回去
        window.location.hash = '#' + redirect
        window.location.reload()
        return
      }
      router.replace(redirect)
    } else {
      errorMessage.value = fusionRes.msg || '登录失败'
    }
  } catch (err: any) {
    errorMessage.value = err?.message || err?.response?.data?.message || '登录失败，请稍后重试'
  } finally {
    loggingIn.value = false
  }
}
</script>

<template>
  <div class="login-page min-h-100vh flex flex-col md:flex-row bg-page text-ink">
    <!-- 品牌面板（桌面端） -->
    <aside
      class="relative hidden md:flex md:w-[44%] lg:w-[46%] flex-col justify-between overflow-hidden px-48px py-44px bg-gradient-to-br from-violet-soft via-#f8f4fa to-violet-soft-2 border-r border-violet-line"
    >
      <div
        class="pointer-events-none absolute -top-120px -right-100px w-360px h-360px rounded-full bg-violet/12 blur-[64px]"
        aria-hidden="true"
      />
      <div
        class="pointer-events-none absolute -bottom-140px -left-80px w-320px h-320px rounded-full bg-violet-line/50 blur-[64px]"
        aria-hidden="true"
      />

      <div class="relative flex items-center gap-12px">
        <span
          class="flex items-center justify-center w-40px h-40px rounded-10px bg-gradient-to-b from-violet-top to-violet-bottom border border-violet-border text-white text-18px font-700 shadow-[0_2px_4px_-1px_rgba(31,35,41,0.08),0_10px_18px_-10px_rgba(31,35,41,0.22)]"
          aria-hidden="true"
        >
          F
        </span>
        <span class="text-18px font-600 tracking-wide text-ink">Fusion AIGC</span>
      </div>

      <div class="relative max-w-420px">
        <h2 class="m-0 text-30px lg:text-34px leading-tight font-700 text-ink">一站式 AI 创作平台</h2>
        <p class="mt-14px mb-0 text-15px leading-relaxed text-ink-2">
          从灵感到成片，图片、视频与商拍内容在同一个工作台完成。
        </p>
        <ul class="mt-32px mb-0 p-0 list-none flex flex-col gap-14px">
          <li
            v-for="item in ['AI 图片与视频生成', '商拍换装与姿态复刻', '素材资产管理']"
            :key="item"
            class="flex items-center gap-12px text-14px text-ink"
          >
            <span
              class="flex items-center justify-center flex-shrink-0 w-24px h-24px rounded-8px bg-white border border-violet-line text-violet-ink"
              aria-hidden="true"
            >
              <svg viewBox="0 0 16 16" width="12" height="12" fill="none">
                <path
                  d="M3.5 8.5l3 3 6-7"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </span>
            {{ item }}
          </li>
        </ul>
      </div>

      <p class="relative m-0 text-12px text-muted">© Fusion AIGC</p>
    </aside>

    <!-- 品牌头（移动端） -->
    <header class="md:hidden flex items-center gap-10px px-20px pt-28px">
      <span
        class="flex items-center justify-center w-32px h-32px rounded-8px bg-gradient-to-b from-violet-top to-violet-bottom border border-violet-border text-white text-15px font-700"
        aria-hidden="true"
      >
        F
      </span>
      <span class="text-16px font-600 text-ink">Fusion AIGC</span>
    </header>

    <!-- 登录区 -->
    <main class="flex-1 flex items-start md:items-center justify-center px-16px py-24px md:p-48px">
      <div class="login-card ll-card w-full max-w-400px px-24px py-28px sm:px-36px sm:py-36px">
        <div class="card-header">
          <h1 class="m-0 text-24px leading-tight font-600 text-ink">欢迎登录</h1>
          <p class="mt-8px mb-0 text-14px text-muted">使用联盟账号登录，获取 AI 创作能力</p>
        </div>

        <div class="card-body mt-28px flex flex-col">
          <label for="login-phone" class="block mb-8px text-13px font-500 text-ink-2">手机号</label>
          <n-input
            v-model:value="phone"
            class="login-input"
            placeholder="请输入手机号"
            :maxlength="11"
            size="large"
            clearable
            :input-props="{ id: 'login-phone', autocomplete: 'tel', inputmode: 'numeric' }"
          />

          <label for="login-code" class="block mt-20px mb-8px text-13px font-500 text-ink-2"> 验证码 </label>
          <div class="flex gap-12px">
            <n-input
              v-model:value="code"
              class="login-input flex-1 min-w-0"
              placeholder="验证码"
              :maxlength="6"
              size="large"
              :input-props="{
                id: 'login-code',
                autocomplete: 'one-time-code',
                inputmode: 'numeric',
              }"
            />
            <n-button
              class="send-btn flex-shrink-0 min-w-112px"
              type="primary"
              size="large"
              ghost
              :disabled="!canSend"
              :loading="sending"
              @click="handleSendSms"
            >
              {{ countdown > 0 ? `${countdown}s` : '获取验证码' }}
            </n-button>
          </div>

          <n-button
            class="login-btn mt-28px"
            type="primary"
            size="large"
            block
            :disabled="!canLogin"
            :loading="loggingIn"
            @click="handleLogin"
          >
            登录
          </n-button>

          <p
            v-if="errorMessage"
            class="error-msg mt-16px mb-0 flex items-start gap-8px px-12px py-10px rounded-8px border border-danger-line bg-danger-soft text-13px leading-20px text-danger"
            role="alert"
          >
            <span
              class="flex items-center justify-center flex-shrink-0 w-16px h-16px mt-2px rounded-full bg-danger text-white text-11px font-700 leading-none"
              aria-hidden="true"
            >
              !
            </span>
            <span class="min-w-0 break-all">{{ errorMessage }}</span>
          </p>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped lang="less">
// naive-ui 把 --n-* 变量写在元素内联 style 上，类选择器覆盖必须 !important。
// 全局 baseColor 为 'red'，彩色按钮的 text-color 系列必须显式给出（见 CLAUDE.md）。
@violet: #875f9a;
@violet-hover: #9a6fae;
@violet-press: #5f3f6f;
@violet-ink: #6b487c;
@violet-soft: #f3edf8;
@violet-soft-2: #ede3f2;
@violet-line: #d9c7e3;
@focus-ring: 0 0 0 3px rgba(135, 95, 154, 0.16);

.login-input {
  --n-border-radius: 8px !important;
  --n-border-hover: 1px solid @violet !important;
  --n-border-focus: 1px solid @violet !important;
  --n-box-shadow-focus: @focus-ring !important;
  --n-caret-color: @violet !important;
  --n-loading-color: @violet !important;
}

.send-btn {
  --n-border-radius: 8px !important;
  --n-color: @violet-soft !important;
  --n-color-hover: @violet-soft-2 !important;
  --n-color-pressed: @violet-soft-2 !important;
  --n-color-focus: @violet-soft !important;
  --n-color-disabled: #f7f8f9 !important;
  --n-text-color: @violet-ink !important;
  --n-text-color-hover: @violet-press !important;
  --n-text-color-pressed: @violet-press !important;
  --n-text-color-focus: @violet-ink !important;
  --n-text-color-disabled: #6e7681 !important;
  --n-border: 1px solid @violet-line !important;
  --n-border-hover: 1px solid @violet !important;
  --n-border-pressed: 1px solid @violet-press !important;
  --n-border-focus: 1px solid @violet !important;
  --n-border-disabled: 1px solid #e5e7eb !important;
  --n-ripple-color: @violet !important;
}

.login-btn {
  --n-height: 44px !important;
  --n-font-size: 15px !important;
  --n-border-radius: 8px !important;
  --n-color: @violet !important;
  --n-color-hover: @violet-hover !important;
  --n-color-pressed: @violet-press !important;
  --n-color-focus: @violet-hover !important;
  --n-color-disabled: #cbb9d5 !important;
  --n-text-color: #fff !important;
  --n-text-color-hover: #fff !important;
  --n-text-color-pressed: #fff !important;
  --n-text-color-focus: #fff !important;
  --n-text-color-disabled: #fff !important;
  --n-border: 1px solid #6a487b !important;
  --n-border-hover: 1px solid @violet !important;
  --n-border-pressed: 1px solid @violet-press !important;
  --n-border-focus: 1px solid @violet !important;
  --n-border-disabled: 1px solid @violet-line !important;
  --n-ripple-color: @violet !important;
  font-weight: 600;
  letter-spacing: 2px;
}

.send-btn:focus-visible,
.login-btn:focus-visible {
  outline: none;
  box-shadow: @focus-ring;
}
</style>
