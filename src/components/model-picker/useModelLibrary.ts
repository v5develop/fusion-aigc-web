/**
 * 模特库数据层（模特选择器用）：公共模板 + 我的模特的读取、新建、修改、删除。
 *
 * <p>与 FixedModelPicker 同一套接口与口径（api/models.ts）：只收 http(s) 图；模板的 tag 取所在标签组、
 * 我的模特的 tag 取描述；我的模特按 id 倒序，新建的排第一；修改只传改了的字段（PATCH）；删除走请求体 userModelIds。
 * 业务失败由 api/index.ts 拦截器统一提示，调用方只需处理返回值。
 */
import { computed, ref } from 'vue'
import {
  createUserModel,
  deleteUserModels,
  listModelTemplates,
  listUserModels,
  updateUserModel,
  type ModelTemplateGroup,
  type UserModel,
  type UserModelPatchReq,
} from '@/api/models.ts'
import type { FixedModel } from '@/views/studio/components/FixedModelPicker/types.ts'

export type ModelPickerItem = FixedModel

export const MODEL_FIELD_MAX = 255

const isHttp = (url: string) => /^https?:\/\//i.test(url)

export function fromUserModel(u: UserModel): ModelPickerItem {
  return {
    id: `u-${u.userModelId}`,
    name: u.title,
    tag: u.description,
    image: u.imageUrl,
    source: 'custom',
    userModelId: u.userModelId,
    description: u.description,
  }
}

export function useModelLibrary() {
  const loading = ref(false)
  const loaded = ref(false)
  const templateGroups = ref<ModelTemplateGroup[]>([])
  const userModels = ref<UserModel[]>([])

  const presetModels = computed<ModelPickerItem[]>(() =>
    templateGroups.value.flatMap((g) =>
      (g.templates ?? [])
        .filter((t) => isHttp(t.imageUrl))
        .map((t) => ({
          id: `t-${t.modelTemplateId}`,
          name: t.title,
          tag: g.tag,
          image: t.imageUrl,
          source: 'preset' as const,
          description: t.description,
        })),
    ),
  )
  const customModels = computed(() => userModels.value.filter((u) => isHttp(u.imageUrl)).map(fromUserModel))

  async function loadUserModels() {
    const res = await listUserModels()
    userModels.value = Array.isArray(res.data) ? res.data : []
  }

  /** 两份都成功才记为已加载；有一份失败下次打开再拉 */
  async function load() {
    loading.value = true
    try {
      const [tpl, mine] = await Promise.allSettled([listModelTemplates(), loadUserModels()])
      if (tpl.status === 'fulfilled') templateGroups.value = Array.isArray(tpl.value.data) ? tpl.value.data : []
      loaded.value = tpl.status === 'fulfilled' && mine.status === 'fulfilled'
    } finally {
      loading.value = false
    }
  }

  /** 新建后重拉；返回新建的那条（列表按 id 倒序取第一条，服务端可能改写 imageUrl，不按地址找） */
  async function create(title: string, imageUrl: string, description: string): Promise<ModelPickerItem | null> {
    await createUserModel({ title, imageUrl, description })
    await loadUserModels()
    const created = userModels.value[0]
    return created && isHttp(created.imageUrl) ? fromUserModel(created) : null
  }

  /** 只传改了的字段；没改返回 false 不发请求 */
  async function update(userModelId: number, next: { title: string; description: string; imageUrl: string }) {
    const origin = userModels.value.find((u) => u.userModelId === userModelId)
    if (!origin) return false
    const data: UserModelPatchReq = {
      ...(next.title !== origin.title ? { title: next.title } : {}),
      ...(next.description !== origin.description ? { description: next.description } : {}),
      ...(next.imageUrl !== origin.imageUrl ? { imageUrl: next.imageUrl } : {}),
    }
    if (!Object.keys(data).length) return false
    await updateUserModel(userModelId, data)
    await loadUserModels()
    return true
  }

  async function remove(userModelId: number) {
    await deleteUserModels([userModelId])
    userModels.value = userModels.value.filter((u) => u.userModelId !== userModelId)
  }

  const findUserModel = (userModelId: number | undefined) =>
    userModels.value.find((u) => u.userModelId === userModelId) ?? null

  return { loading, loaded, presetModels, customModels, load, create, update, remove, findUserModel }
}
