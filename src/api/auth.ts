import { post, put } from './index.ts'
import { clearRecentAssets } from '@/utils/asset-recent.ts'

/**
 * 账号相关接口（后端 AuthController）：登出、个人资料、修改密码。
 * 请求头由 axios 实例统一注入 token，这里只管路径与参数。
 */

/** PUT /api/v1/auth/profile 的请求体（字段均可选，服务端只改传了的字段） */
export interface IProfileUpdate {
  nickname?: string
  email?: string
  phone?: string
}

/** PUT /api/v1/auth/change-password 的请求体。新密码 6–32 个字符（服务端校验） */
export interface IChangePassword {
  oldPassword: string
  newPassword: string
}

/** POST /api/v1/auth/logout：服务端吊销当前 token */
export function logoutRequest() {
  return post('/api/v1/auth/logout', {})
}

/** PUT /api/v1/auth/profile */
export function updateProfile(data: IProfileUpdate) {
  return put('/api/v1/auth/profile', data)
}

/** POST /api/v1/auth/avatar 的响应：新头像的公网地址 */
export interface IAvatarUploadResult {
  avatar: string
}

/**
 * POST /api/v1/auth/avatar（multipart，part 名 file；PNG / JPEG / WebP ≤ 5 MB，服务端含内容审核）。
 * 不手填 Content-Type：交给浏览器带上 boundary。
 */
export function uploadAvatar(file: Blob, filename = 'avatar.png') {
  const body = new FormData()
  body.append('file', file, filename)
  return post<IAvatarUploadResult>('/api/v1/auth/avatar', body, undefined, 30000)
}

/** PUT /api/v1/auth/change-password */
export function changePassword(data: IChangePassword) {
  return put('/api/v1/auth/change-password', data)
}

/** 本地保存的登录凭证键（与 api/index.ts 的 logoutToLogin 保持一致） */
const CREDENTIAL_KEYS = ['fusion_accessToken', 'fusion_refreshToken', 'union_token', 'union_refreshToken']

/**
 * 用户主动退出账号。
 *
 * 先通知服务端吊销 token（失败也继续，本地凭证照样清掉，避免卡在「退不掉」）；
 * 再清本地凭证、复位内存里的用户信息（积分与头像），最后回到登录页。
 * 与过期登出一样，不清业务缓存：换人登录时由 authSession 的身份指纹比对决定是否清理。
 */
export async function signOut(): Promise<void> {
  try {
    await logoutRequest()
  } catch {
    // 网络失败或 token 已失效：服务端无法吊销也无妨，下面照常清本地
  }
  // 清当前账号的「最近」：key 按账号 id 算（登出不清 id）
  clearRecentAssets()
  for (const key of CREDENTIAL_KEYS) localStorage.removeItem(key)
  // 动态 import 避免 stores ↔ api 的循环依赖（同 api/index.ts 中的处理）
  await import('@/stores/user-info').then(({ useUserInfoStore }) => useUserInfoStore().reset()).catch(() => {})
  window.location.hash = '#/login'
}
