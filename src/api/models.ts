/**
 * 模特库（creaft v1 兼容面 /api/v1/models）：公共模特模板 + 用户自建模特。
 *
 * <p>契约见 fusion-aigc contracts/user-api-compat-v1/manifest.json 的 models/templates、models/user-models；
 * 线上字段为驼峰（modelTemplateId / userModelId / imageUrl）。
 * get / post / patch 走 api/index.ts 实例（业务失败拦截器自动 toast）；
 * 批量删除的 id 在请求体里，走 tools.ts 的 deleteWithBody（不自动 toast，调用方提示）。
 */
import { get, patch, post } from './index.ts'
import { deleteWithBody } from './tools.ts'

/** 公共模特模板 */
export interface ModelTemplate {
  modelTemplateId: number
  title: string
  imageUrl: string
  description: string
  tags?: string[]
}

/** 按标签分组的模板 */
export interface ModelTemplateGroup {
  tag: string
  templates: ModelTemplate[]
}

/** 用户自建模特 */
export interface UserModel {
  userModelId: number
  userId?: number
  title: string
  imageUrl: string
  description: string
  isDel?: boolean
  createdAt?: string
  updatedAt?: string
}

/** 新建：三个字段都必填，imageUrl 须为已上传完成的 https 地址 */
export interface UserModelCreateReq {
  title: string
  imageUrl: string
  description: string
}

/** 修改：只改传了的字段，不能传空串 */
export type UserModelPatchReq = Partial<UserModelCreateReq>

const PREFIX = '/api/v1/models'

/** GET /api/v1/models/templates：公共模特模板，按标签分组，全量不分页 */
export function listModelTemplates() {
  return get<ModelTemplateGroup[]>(`${PREFIX}/templates`)
}

/** GET /api/v1/models/user-models：当前用户的自建模特，全量不分页（按 id 倒序） */
export function listUserModels() {
  return get<UserModel[]>(`${PREFIX}/user-models`)
}

/** POST /api/v1/models/user-models：新建自建模特 */
export function createUserModel(data: UserModelCreateReq) {
  return post<null>(`${PREFIX}/user-models`, data)
}

/** PATCH /api/v1/models/user-models/{userModelId}：局部更新 */
export function updateUserModel(userModelId: number, data: UserModelPatchReq) {
  return patch<null>(`${PREFIX}/user-models/${userModelId}`, data)
}

/** DELETE /api/v1/models/user-models，请求体 {userModelIds}：批量删除（非本人的 id 忽略） */
export function deleteUserModels(userModelIds: number[]) {
  return deleteWithBody(`${PREFIX}/user-models`, { userModelIds })
}
