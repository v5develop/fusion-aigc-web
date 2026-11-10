import axios from 'axios'

const unionApi = axios.create({
  baseURL: import.meta.env.VITE_UNION_API_BASE,
  timeout: 10000,
})

function unwrap<T>(res: any): T {
  const body = res.data
  if (body.code !== 1) {
    throw new Error(body.message || '请求失败')
  }
  return body.data
}

function getDeviceId(): string {
  const key = 'union_deviceId'
  let id = localStorage.getItem(key)
  if (!id) {
    id = 'web_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
    localStorage.setItem(key, id)
  }
  return id
}

function getOs(): string {
  const ua = navigator.userAgent
  if (/windows/i.test(ua)) return 'Windows'
  if (/mac/i.test(ua)) return 'macOS'
  if (/linux/i.test(ua)) return 'Linux'
  if (/android/i.test(ua)) return 'Android'
  if (/iphone|ipad/i.test(ua)) return 'iOS'
  return 'Unknown'
}

export async function reportDevice() {
  try {
    await unionApi.post('/api/v1/user/public/device/report', {
      deviceId: getDeviceId(),
      deviceName: navigator.userAgent.slice(0, 50),
      os: getOs(),
      osVersion: navigator.platform || '',
    })
  } catch {
    // 上报失败不阻塞登录流程
  }
}

export async function sendSms(phone: string) {
  return unionApi
    .post<{ expireIn: number }>('/api/v1/auth/sms/send', {
      phone,
      scene: 'login',
    })
    .then(unwrap<{ expireIn: number }>)
}

export async function smsLogin(data: { phone: string; code: string; inviteCode?: string }) {
  const body: Record<string, string> = {
    phone: data.phone,
    code: data.code,
    deviceId: getDeviceId(),
  }
  if (data.inviteCode) body.inviteCode = data.inviteCode
  return unionApi
    .post<{
      token: string
      refreshToken: string
      expiresIn: number
      isNewUser: boolean
    }>('/api/v1/auth/sms/login', body)
    .then(
      unwrap<{
        token: string
        refreshToken: string
        expiresIn: number
        isNewUser: boolean
      }>,
    )
}

export async function getAuthToken(accessToken: string) {
  return unionApi
    .get<{ tempToken: string }>('/api/v1/user/auth/token', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    .then(unwrap<{ tempToken: string }>)
}

export async function refreshToken(refreshToken: string) {
  return unionApi
    .post<{
      token: string
      refreshToken: string
      expiresIn: number
      isNewUser: boolean
    }>('/api/v1/auth/refresh', {
      refreshToken,
      deviceId: getDeviceId(),
    })
    .then(unwrap<{ token: string; refreshToken: string; expiresIn: number; isNewUser: boolean }>)
}
