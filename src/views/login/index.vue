<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { unionTokenLogin } from '@/api/methods'
import { sendSms, smsLogin, reportDevice, getAuthToken } from '@/api/union'

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
    localStorage.setItem('union_token', smsRes.token)
    localStorage.setItem('union_refreshToken', smsRes.refreshToken)
    const authRes = await getAuthToken(smsRes.token)
    const unionToken = authRes.tempToken

    const fusionRes = await unionTokenLogin({ token: unionToken })
    if (fusionRes.code === 0) {
      localStorage.setItem('fusion_accessToken', fusionRes.data.accessToken)
      localStorage.setItem('fusion_refreshToken', fusionRes.data.refreshToken)
      const redirect = router.currentRoute.value.query.redirect as string
      router.replace(redirect || '/')
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
  <div class="login-page">
    <div class="login-card">
      <div class="card-header">
        <div class="logo">Fusion AIGC</div>
        <p class="desc">使用联盟账号登录，获取 AI 创作能力</p>
      </div>

      <div class="card-body">
        <div class="input-row">
          <n-input
            v-model:value="phone"
            placeholder="请输入手机号"
            :maxlength="11"
            size="large"
            clearable
          />
        </div>

        <div class="input-row code-row">
          <n-input
            v-model:value="code"
            placeholder="验证码"
            :maxlength="6"
            size="large"
          />
          <n-button
            class="send-btn"
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
          class="login-btn"
          type="primary"
          size="large"
          block
          :disabled="!canLogin"
          :loading="loggingIn"
          @click="handleLogin"
        >
          登录
        </n-button>

        <p v-if="errorMessage" class="error-msg">{{ errorMessage }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.login-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: linear-gradient(135deg, #f5f6f8 0%, #e8ecf1 100%);
  padding: 24px;
}

.login-card {
  width: 100%;
  max-width: 400px;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.06);
  overflow: hidden;
}

.card-header {
  padding: 40px 36px 0;
  text-align: center;
}

.logo {
  font-size: 26px;
  font-weight: 700;
  color: #8e66f9;
  letter-spacing: 1px;
}

.desc {
  margin: 10px 0 0;
  font-size: 14px;
  color: #999;
}

.card-body {
  padding: 36px;
}

.input-row {
  margin-bottom: 16px;
}

.code-row {
  display: flex;
  gap: 12px;

  :deep(.n-input) {
    flex: 1;
  }
}

.send-btn {
  min-width: 110px;
  flex-shrink: 0;
}

.login-btn {
  --n-color: #8e66f9;
  --n-color-hover: #7b54e0;
  --n-color-pressed: #6a3fd9;
  --n-ripple-color: #8e66f9;
  height: 44px;
  font-size: 16px;
  border-radius: 8px;
}

.error-msg {
  margin: 14px 0 0;
  font-size: 13px;
  color: #d03050;
  text-align: center;
}
</style>
