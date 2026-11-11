<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { unionTokenLogin } from '@/api/methods'

const VITE_OSS_ASSET_URL = import.meta.env.VITE_OSS_ASSET_URL

/** 左侧品牌面板的能力卡片：文案只用产品里已有的功能名 */
const CAPABILITIES = [
  {
    title: 'AI 图片',
    desc: '文生图、图生图、高清放大、智能抠图等',
    icon: 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5',
  },
  {
    title: 'AI 视频',
    desc: '文生视频、图生视频、视频高清、视频翻译',
    icon: 'M6 4v16l14-8z',
  },
  {
    title: '商拍与电商',
    desc: '商拍换装、姿态复刻、商品套图、产品替换',
    icon: 'M6 7h12l-1 13H7L6 7zM9 7V5a3 3 0 0 1 6 0v2',
  },
  {
    title: '本地生活',
    desc: '门店全案、AI文案、AI数字人、图文笔记',
    icon: 'M4 9l2-5h12l2 5M4 9h16v1a2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-6 0 2.5 2.5 0 0 1-5 0V9zM5 13v7h14v-7',
  },
]
import { sendSms, smsLogin, reportDevice, getAuthToken } from '@/api/union'
import { adoptSession } from '@/utils/auth-session'

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
    <!-- 品牌面板（桌面端）：品牌块 + 标题 + 四个能力卡片 + 版权 -->
    <aside
      class="relative hidden md:flex md:w-[44%] lg:w-[46%] flex-col justify-between overflow-hidden px-48px py-44px bg-gradient-to-br from-violet-soft via-violet-tint to-violet-soft-2 border-r border-violet-line"
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
        <img
          :src="VITE_OSS_ASSET_URL + 'logo.png'"
          alt=""
          class="block w-40px h-40px rounded-10px object-cover shadow-[0_2px_4px_-1px_rgba(31,35,41,0.08),0_10px_18px_-10px_rgba(31,35,41,0.22)]"
        />
        <div class="flex flex-col">
          <b class="block text-20px font-600 leading-[1.2] tracking-[.01em] text-ink">小岐AI</b>
          <span class="mt-2px text-12px leading-[1.2] text-muted">一体化数字员工平台</span>
        </div>
      </div>

      <div class="relative">
        <h2 class="m-0 text-30px lg:text-34px leading-tight font-700 text-ink">一站式 AI 创作平台</h2>
        <p class="mt-14px mb-0 max-w-none lg:whitespace-nowrap text-15px leading-relaxed text-ink-2">
          从灵感到成片，图片、视频、商拍与本地生活内容在同一个工作台完成。
        </p>

        <ul class="mt-32px mb-0 p-0 list-none grid grid-cols-2 gap-12px w-full">
          <li
            v-for="card in CAPABILITIES"
            :key="card.title"
            class="group relative flex flex-col gap-12px p-18px rounded-14px overflow-hidden border border-white/80 bg-gradient-to-br from-white via-violet-soft to-violet-soft-2 backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_2px_rgba(31,35,41,0.05),0_18px_32px_-18px_rgba(95,63,111,0.35)] transition-[transform,box-shadow] duration-200 ease-out hover:(-translate-y-2px shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_2px_4px_rgba(31,35,41,0.06),0_24px_40px_-18px_rgba(95,63,111,0.45)]) motion-reduce:transition-none motion-reduce:hover:transform-none"
          >
            <span
              class="pointer-events-none absolute -top-40px -right-40px w-120px h-120px rounded-full bg-violet/20 blur-[36px] transition-opacity duration-200 group-hover:opacity-100"
              aria-hidden="true"
            />
            <span
              class="flex items-center justify-center w-36px h-36px rounded-10px bg-gradient-to-b from-violet-top to-violet-bottom border border-violet-border text-on-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_6px_14px_-6px_rgba(95,63,111,0.55)]"
              aria-hidden="true"
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path :d="card.icon" />
              </svg>
            </span>
            <div>
              <div class="text-14px font-600 text-ink">{{ card.title }}</div>
              <div class="mt-4px text-12px leading-relaxed text-muted">{{ card.desc }}</div>
            </div>
          </li>
        </ul>
      </div>

      <p class="relative m-0 text-12px text-muted">© 小岐AI</p>
    </aside>

    <!-- 品牌头（移动端） -->
    <header class="md:hidden flex items-center gap-10px px-20px pt-28px">
      <img :src="VITE_OSS_ASSET_URL + 'logo.png'" alt="" class="block w-32px h-32px rounded-8px object-cover" />
      <b class="text-16px font-600 text-ink">小岐AI</b>
    </header>

    <!-- 登录区 -->
    <main class="flex-1 flex items-start md:items-center justify-center px-16px py-24px md:p-48px">
      <div
        class="login-card sx-squircle relative w-full max-w-400px overflow-hidden rounded-18px border border-white/90 bg-gradient-to-b from-white via-white to-violet-soft/60 px-24px py-28px sm:px-36px sm:py-36px shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_1px_2px_rgba(31,35,41,0.05),0_30px_60px_-30px_rgba(95,63,111,0.35)] backdrop-blur-sm"
      >
        <span
          class="pointer-events-none absolute -top-80px -right-60px w-220px h-220px rounded-full bg-violet/15 blur-[56px]"
          aria-hidden="true"
        />
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
              class="flex items-center justify-center flex-shrink-0 w-16px h-16px mt-2px rounded-full bg-danger text-on-accent text-11px font-700 leading-none"
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
// 颜色走主题令牌（src/theme/tokens.ts），浅色值与原先一致，深色自动切换
@violet: var(--xq-violet);
@violet-hover: var(--xq-violet-hover-top);
@violet-press: var(--xq-violet-press);
@violet-ink: var(--xq-violet-ink);
@violet-soft: var(--xq-violet-soft);
@violet-soft-2: var(--xq-violet-soft-2);
@violet-line: var(--xq-violet-line);
@focus-ring: var(--xq-shadow-focus);

.login-input {
  --n-border-radius: 15px !important;
  --n-border-hover: 1px solid @violet !important;
  --n-border-focus: 1px solid @violet !important;
  --n-box-shadow-focus: @focus-ring !important;
  --n-caret-color: @violet !important;
  --n-loading-color: @violet !important;
}

.send-btn {
  --n-border-radius: 14px !important;
  --n-color: @violet-soft !important;
  --n-color-hover: @violet-soft-2 !important;
  --n-color-pressed: @violet-soft-2 !important;
  --n-color-focus: @violet-soft !important;
  --n-color-disabled: var(--xq-surface2) !important;
  --n-text-color: @violet-ink !important;
  --n-text-color-hover: var(--xq-violet-press-fg) !important;
  --n-text-color-pressed: var(--xq-violet-press-fg) !important;
  --n-text-color-focus: @violet-ink !important;
  --n-text-color-disabled: var(--xq-placeholder) !important;
  --n-border: 1px solid @violet-line !important;
  --n-border-hover: 1px solid @violet !important;
  --n-border-pressed: 1px solid @violet-press !important;
  --n-border-focus: 1px solid @violet !important;
  --n-border-disabled: 1px solid var(--xq-line) !important;
  --n-ripple-color: @violet !important;
}

.login-btn {
  --n-height: 44px !important;
  --n-font-size: 15px !important;
  --n-border-radius: 14px !important;
  --n-color: @violet !important;
  --n-color-hover: @violet-hover !important;
  --n-color-pressed: @violet-press !important;
  --n-color-focus: @violet-hover !important;
  --n-color-disabled: var(--xq-violet-disabled) !important;
  --n-text-color: #fff !important;
  --n-text-color-hover: #fff !important;
  --n-text-color-pressed: #fff !important;
  --n-text-color-focus: #fff !important;
  --n-text-color-disabled: #fff !important;
  --n-border: 1px solid var(--xq-violet-border) !important;
  --n-border-hover: 1px solid @violet !important;
  --n-border-pressed: 1px solid @violet-press !important;
  --n-border-focus: 1px solid @violet !important;
  --n-border-disabled: 1px solid @violet-line !important;
  --n-ripple-color: @violet !important;
  font-weight: 600;
  letter-spacing: 2px;
}
/* 深色：主色 violet 提亮后白字不足 4.5，登录主按钮改用品牌渐变的深端，保证白字可读 */
[data-theme='dark'] .login-btn {
  --n-color: var(--xq-violet-bottom) !important;
  --n-color-hover: var(--xq-violet-top) !important;
  --n-color-focus: var(--xq-violet-top) !important;
}

.send-btn:focus-visible,
.login-btn:focus-visible {
  outline: 2px solid @violet;
  outline-offset: 2px;
  box-shadow: none;
}
</style>
