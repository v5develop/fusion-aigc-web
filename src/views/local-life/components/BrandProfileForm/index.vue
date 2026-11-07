<script setup lang="ts">
/**
 * 品牌档案新建 / 编辑弹窗（全案设计选档案时用；对应 Java /brand-profiles）。
 *
 * <p>字段全部来自 GET /brand-profiles/forms 的 jsonSchema（见 schema.ts）：必填项在前，行业表单可切换；
 * 套餐图 / 五连图等图组（x-group）简化表单不填，编辑时原样保留（PUT 是整份替换）。
 * 新建成功后优先用后端回的 brandProfileId（Java 2026-11-07 新增）；老后端不回 id 时按「提交前后列表差集」找，
 * 差集多于一个按提交的店名对；创建后读列表失败只提示「档案已创建，请在列表中选择」——绝不当成失败让用户再建一份。
 * 图片还在上传时禁用保存；上传中关闭要确认，关闭后才回来的上传结果丢弃。
 * 后端校验失败的文案原样显示在底部（全局拦截器也会 toast 一次）。
 */
import { computed, reactive, ref, watch } from 'vue'
import { NDynamicTags, NInput, NInputNumber, NModal, NSelect, NSpin, useDialog, useMessage } from 'naive-ui'
import {
  brandFormList,
  brandProfileCreate,
  brandProfileDetail,
  brandProfileList,
  brandProfileUpdate,
  type BrandFormItem,
} from '@/api/localLifeFull.ts'
import { toApiError } from '@/api/index.ts'
import ImageField from './ImageField.vue'
import {
  DEFAULT_MAX_IMAGES,
  checkField,
  cleanValue,
  emptyOf,
  enumOptions,
  hydrate,
  listFields,
  newRow,
  requiredGroupFields,
  valuesFromDetail,
  type FieldDef,
  type Node,
} from './schema.ts'

const props = defineProps<{ editId?: number | null }>()
const show = defineModel<boolean>('show', { default: false })
const emit = defineEmits<{ saved: [payload: { mode: 'create' | 'edit'; id: number | null }] }>()

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet'

const dialog = useDialog()
const message = useMessage()
const loading = ref(false)
/** 正在上传的图片位个数（ImageField 的 uploading 事件累计） */
const uploadingCount = ref(0)
const uploading = computed(() => uploadingCount.value > 0)
function onUploading(busy: boolean) {
  uploadingCount.value = Math.max(0, uploadingCount.value + (busy ? 1 : -1))
}
const loadError = ref('')
const submitting = ref(false)
const submitError = ref('')
const fieldErrors = reactive<Record<string, string>>({})
const forms = ref<BrandFormItem[]>([])
const formId = ref<number | null>(null)
const model = reactive<Record<string, any>>({})
/** 编辑时的原始取值：图组、隐藏项等本表单不渲染的键靠它原样带回 */
let original: Record<string, any> = {}
let editSchema: Node | null = null

const isEdit = computed(() => props.editId != null)
const form = computed(() => forms.value.find((f) => f.brandFormId === formId.value) ?? null)
const schema = computed<Node | null>(() => (isEdit.value ? editSchema : (form.value?.jsonSchema as Node | undefined) ?? null))
const fields = computed<FieldDef[]>(() => (schema.value ? listFields(schema.value.properties, schema.value.required) : []))
/** 新建时必填却不在简化表单里的图组：提前说明并拦下（编辑时原值整份带回，不受影响） */
const blockedGroups = computed(() => (isEdit.value ? [] : requiredGroupFields(schema.value)))
const blockedGroupText = computed(() =>
  blockedGroups.value.length
    ? `该行业档案的「${blockedGroups.value.map((g) => g.title).join('」「')}」为必填，简化表单暂不支持填写，请到完整档案编辑中创建`
    : '',
)
const saveDisabledReason = computed(() => {
  if (uploading.value) return '图片还在上传'
  if (blockedGroupText.value) return blockedGroupText.value
  return ''
})

function resetModel() {
  for (const k of Object.keys(model)) delete model[k]
  for (const k of Object.keys(fieldErrors)) delete fieldErrors[k]
  for (const f of fields.value) {
    model[f.key] = emptyOf(f)
    ensureRow(f)
  }
}
/** 必填的行列表（特色菜）至少给一行空位 */
function ensureRow(f: FieldDef) {
  if (f.kind === 'rows' && f.required && !model[f.key].length) model[f.key].push(newRow((f.node.items ?? {}) as Node))
}

async function open() {
  loading.value = true
  loadError.value = ''
  submitError.value = ''
  uploadingCount.value = 0
  original = {}
  editSchema = null
  try {
    if (isEdit.value) {
      const res = await brandProfileDetail(props.editId as number)
      editSchema = (res.data?.data ?? null) as Node | null
      formId.value = res.data?.brandFormId ?? null
      if (!editSchema) throw new Error('档案内容加载失败')
      original = valuesFromDetail(editSchema)
      resetModel()
      for (const f of fields.value) {
        model[f.key] = hydrate(f, original[f.key])
        ensureRow(f)
      }
    } else {
      const res = await brandFormList()
      forms.value = Array.isArray(res.data) ? res.data : []
      if (!forms.value.length) throw new Error('暂无可用的档案表单')
      formId.value = forms.value[0]!.brandFormId
      resetModel()
    }
  } catch (e) {
    loadError.value = toApiError(e)?.message || (e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
}
watch(show, (v) => v && void open())

function pickForm(id: number) {
  if (id === formId.value) return
  formId.value = id
  resetModel()
  submitError.value = ''
}

function subFields(f: FieldDef): FieldDef[] {
  const item = (f.node.items ?? {}) as Node
  return listFields(item.properties, item.required)
}
function addRow(f: FieldDef) {
  const max = f.node.maxItems as number | undefined
  if (max && model[f.key].length >= max) return
  model[f.key].push(newRow((f.node.items ?? {}) as Node))
}
function imageMax(f: FieldDef): number {
  if (f.kind === 'image') return 1
  return (f.node.maxItems as number | undefined) ?? DEFAULT_MAX_IMAGES
}
/** 单张图字段用 string，ImageField 用数组；这里转一下 */
function singleImage(key: string) {
  return computed({
    get: () => (model[key] ? [model[key] as string] : []),
    set: (v: string[]) => (model[key] = v[0] ?? ''),
  })
}
const singles: Record<string, ReturnType<typeof singleImage>> = {}
function single(key: string) {
  return (singles[key] ??= singleImage(key))
}

function validate(): boolean {
  for (const k of Object.keys(fieldErrors)) delete fieldErrors[k]
  let ok = true
  for (const f of fields.value) {
    const err = checkField(f, model[f.key])
    if (err) {
      fieldErrors[f.key] = err
      ok = false
    }
  }
  return ok
}

/** 关闭（取消 / 右上角 / Esc / 点遮罩）：图片还在上传时先确认，确认后关闭（迟到的上传结果由 ImageField 丢弃） */
function requestClose(): boolean {
  if (submitting.value) return false
  if (!uploading.value) {
    show.value = false
    return true
  }
  dialog.warning({
    title: '图片还在上传',
    content: '现在关闭，正在上传的图片和已填写的内容都不会保存。确定关闭吗？',
    positiveText: '关闭',
    negativeText: '继续编辑',
    onPositiveClick: () => {
      show.value = false
    },
  })
  return false
}

/** 新建后找新档案 id：后端回的优先；否则按前后列表差集，多个按店名对。找不到 null，列表读失败 'unknown' */
async function resolveCreatedId(
  returned: number | null | undefined,
  before: Set<number> | null,
  name: string,
): Promise<number | null | 'unknown'> {
  if (typeof returned === 'number' && returned > 0) return returned
  let after: { brandProfileId: number; title?: string | null }[]
  try {
    after = (await brandProfileList()).data ?? []
  } catch {
    return 'unknown'
  }
  let candidates = before ? after.filter((p) => !before.has(p.brandProfileId)) : after
  if (candidates.length !== 1 && name) {
    const byName = candidates.filter((p) => (p.title ?? '').trim() === name)
    if (byName.length) candidates = byName
    else if (!before) candidates = []
  }
  if (!candidates.length) return null
  // 同名多个（重名）取最新的那个
  return Math.max(...candidates.map((p) => p.brandProfileId))
}

async function submit() {
  if (submitting.value || loading.value) return
  if (saveDisabledReason.value) {
    submitError.value = saveDisabledReason.value
    return
  }
  submitError.value = ''
  if (!validate()) {
    submitError.value = '请先补全标红的必填项'
    return
  }
  const data: Record<string, any> = isEdit.value ? { ...original } : {}
  // 隐藏的「行业」类字段：新建时取表单名，编辑时沿用原值
  for (const [k, n] of Object.entries((schema.value?.properties ?? {}) as Node)) {
    if (n['x-hide'] && !(k in data)) {
      data[k] = k === 'category' ? form.value?.title : undefined
    }
  }
  for (const f of fields.value) {
    const v = cleanValue(f, model[f.key])
    if (v === undefined) delete data[f.key]
    else data[f.key] = v
  }
  for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k]
  submitting.value = true
  try {
    if (isEdit.value) {
      await brandProfileUpdate(props.editId as number, data)
      show.value = false
      emit('saved', { mode: 'edit', id: props.editId as number })
      return
    }
    // 老后端不回 id 时才用得上；读失败不拦创建
    let before: Set<number> | null = null
    try {
      before = new Set(((await brandProfileList()).data ?? []).map((p) => p.brandProfileId))
    } catch {
      before = null
    }
    const res = await brandProfileCreate(formId.value as number, data)
    // 到这里档案已建好：之后任何情况都不能显示成「保存失败」，否则用户会再建一份
    const name = String(data.name ?? data.shopName ?? '').trim()
    const id = await resolveCreatedId(res.data?.brandProfileId, before, name)
    show.value = false
    if (typeof id !== 'number') message.info('档案已创建，请在列表中选择')
    emit('saved', { mode: 'create', id: typeof id === 'number' ? id : null })
  } catch (e) {
    submitError.value = toApiError(e)?.message || (e instanceof Error ? e.message : '保存失败，请稍后重试')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <n-modal
    v-model:show="show"
    preset="card"
    :title="isEdit ? '编辑品牌档案' : '新建品牌档案'"
    class="max-w-[calc(100vw-48px)]"
    style="width: 640px"
    :mask-closable="!submitting && !uploading"
    :close-on-esc="!submitting && !uploading"
    :on-close="requestClose"
    @esc="uploading && requestClose()"
    @mask-click="uploading && requestClose()"
  >
    <n-spin :show="loading">
      <div class="min-h-160px flex flex-col gap-14px">
        <div v-if="loadError" class="sx-empty" role="alert">
          <span class="sx-empty-title !text-danger">{{ loadError }}</span>
          <button type="button" class="sx-btn !h-28px !px-10px !text-12px" @click="open">重试</button>
        </div>
        <template v-else-if="schema">
          <div v-if="!isEdit && forms.length > 1" class="flex flex-wrap items-center gap-8px" role="radiogroup" aria-label="行业">
            <span class="text-12px text-muted">行业</span>
            <button
              v-for="f in forms"
              :key="f.brandFormId"
              type="button"
              role="radio"
              :aria-checked="f.brandFormId === formId"
              :class="[
                'min-h-28px cursor-pointer rounded-full border border-solid px-12px text-13px [font-family:inherit]',
                f.brandFormId === formId
                  ? 'border-violet-line bg-violet-soft font-600 text-violet-ink'
                  : 'border-line bg-surface2 text-ink hover:(border-violet-line text-violet-ink)',
                focusRing,
              ]"
              @click="pickForm(f.brandFormId)"
            >
              {{ f.title }}
            </button>
          </div>

          <p
            v-if="blockedGroupText"
            class="m-0 rounded-md border border-solid border-warning-line bg-warning-soft px-10px py-6px text-12px leading-18px text-alert-warning"
            role="note"
          >
            {{ blockedGroupText }}
          </p>
          <div class="max-h-[60vh] flex flex-col gap-14px overflow-y-auto p-2px pr-6px">
            <section v-for="f in fields" :key="f.key" class="flex flex-col gap-6px">
              <label class="text-13px font-600 leading-20px text-ink" :for="`bpf-${f.key}`">
                {{ f.node.title || f.key }}<em v-if="f.required" class="ml-2px text-danger not-italic">*</em>
              </label>
              <p v-if="f.node['x-tip']" class="m-0 text-11px leading-16px text-muted">{{ f.node['x-tip'] }}</p>

              <n-input
                v-if="f.kind === 'text' || f.kind === 'textarea'"
                :input-props="{ id: `bpf-${f.key}` }"
                v-model:value="model[f.key]"
                :type="f.kind === 'textarea' ? 'textarea' : 'text'"
                :autosize="f.kind === 'textarea' ? { minRows: 2, maxRows: 5 } : undefined"
                :maxlength="f.node.maxLength"
                :show-count="!!f.node.maxLength && f.node.maxLength >= 100"
                :placeholder="f.node['x-placeholder'] || `请输入${f.node.title || ''}`"
                :status="fieldErrors[f.key] ? 'error' : undefined"
              />
              <n-input-number
                v-else-if="f.kind === 'number'"
                :input-props="{ id: `bpf-${f.key}` }"
                v-model:value="model[f.key]"
                class="w-full"
                :min="f.node.minimum"
                :max="f.node.maximum"
                :precision="f.node.type === 'integer' ? 0 : undefined"
                :placeholder="f.node['x-placeholder'] || `请输入${f.node.title || ''}`"
                :status="fieldErrors[f.key] ? 'error' : undefined"
                clearable
              />
              <n-select
                v-else-if="f.kind === 'select'"
                :input-props="{ id: `bpf-${f.key}` }"
                v-model:value="model[f.key]"
                :options="enumOptions(f.node)"
                :placeholder="f.node['x-placeholder'] || `请选择${f.node.title || ''}`"
                :status="fieldErrors[f.key] ? 'error' : undefined"
                clearable
              />
              <ImageField
                v-else-if="f.kind === 'image'"
                v-model="single(f.key).value"
                :max="1"
                :label="String(f.node.title)"
                @uploading="onUploading"
              />
              <ImageField
                v-else-if="f.kind === 'images'"
                v-model="model[f.key]"
                :max="imageMax(f)"
                :label="String(f.node.title)"
                @uploading="onUploading"
              />
              <n-dynamic-tags
                v-else-if="f.kind === 'tags'"
                v-model:value="model[f.key]"
                :max="f.node.maxItems"
              />

              <div v-else class="flex flex-col gap-10px">
                <div
                  v-for="(row, i) in model[f.key]"
                  :key="i"
                  class="flex flex-col gap-10px rounded-md border border-solid border-line-soft bg-surface2 p-12px"
                >
                  <div class="flex items-center justify-between gap-8px">
                    <b class="text-12px font-600 text-ink">{{ f.node.title }} {{ Number(i) + 1 }}</b>
                    <button
                      type="button"
                      :class="['sx-btn !h-28px !px-10px !text-12px', focusRing]"
                      :disabled="f.required && model[f.key].length <= 1"
                      @click="model[f.key].splice(Number(i), 1)"
                    >
                      删除
                    </button>
                  </div>
                  <div v-for="sf in subFields(f)" :key="sf.key" class="flex flex-col gap-4px">
                    <span class="text-12px leading-18px text-muted">
                      {{ sf.node.title || sf.key }}<em v-if="sf.required" class="ml-2px text-danger not-italic">*</em>
                    </span>
                    <n-input
                      v-if="sf.kind === 'text' || sf.kind === 'textarea'"
                      v-model:value="row[sf.key]"
                      :type="sf.kind === 'textarea' ? 'textarea' : 'text'"
                      :autosize="sf.kind === 'textarea' ? { minRows: 2, maxRows: 4 } : undefined"
                      :maxlength="sf.node.maxLength"
                      :placeholder="sf.node['x-placeholder'] || `请输入${sf.node.title || ''}`"
                    />
                    <n-input-number
                      v-else-if="sf.kind === 'number'"
                      v-model:value="row[sf.key]"
                      class="w-full"
                      :min="sf.node.minimum"
                      :max="sf.node.maximum"
                      :precision="sf.node.type === 'integer' ? 0 : undefined"
                      :placeholder="sf.node['x-placeholder'] || `请输入${sf.node.title || ''}`"
                      clearable
                    />
                    <n-select
                      v-else-if="sf.kind === 'select'"
                      v-model:value="row[sf.key]"
                      :options="enumOptions(sf.node)"
                      :placeholder="sf.node['x-placeholder'] || `请选择${sf.node.title || ''}`"
                      clearable
                    />
                    <ImageField
                      v-else-if="sf.kind === 'images' || sf.kind === 'image'"
                      v-model="row[sf.key]"
                      :max="imageMax(sf)"
                      :label="String(sf.node.title)"
                      @uploading="onUploading"
                    />
                    <n-dynamic-tags v-else-if="sf.kind === 'tags'" v-model:value="row[sf.key]" :max="sf.node.maxItems" />
                  </div>
                </div>
                <button
                  type="button"
                  :class="['sx-btn self-start !h-28px !px-12px !text-12px', focusRing]"
                  :disabled="!!f.node.maxItems && model[f.key].length >= f.node.maxItems"
                  @click="addRow(f)"
                >
                  + 添加{{ f.node.title }}
                </button>
              </div>

              <p v-if="fieldErrors[f.key]" class="m-0 text-12px leading-18px text-danger" role="alert">
                {{ fieldErrors[f.key] }}
              </p>
            </section>
          </div>

          <p v-if="submitError" class="m-0 text-12px leading-18px text-danger" role="alert">{{ submitError }}</p>
          <footer class="flex items-center justify-end gap-8px border-t border-t-solid border-line-soft pt-12px">
            <button type="button" class="sx-btn !h-32px !px-14px" :disabled="submitting" @click="requestClose">取消</button>
            <button
              type="button"
              :class="['sx-btn-primary !px-16px', saveDisabledReason ? 'cursor-not-allowed opacity-60' : '']"
              :disabled="submitting"
              :aria-disabled="!!saveDisabledReason || undefined"
              :title="saveDisabledReason || undefined"
              @click="submit"
            >
              {{ submitting ? '保存中…' : uploading ? '图片上传中…' : isEdit ? '保存修改' : '保存并选择' }}
            </button>
          </footer>
        </template>
      </div>
    </n-spin>
  </n-modal>
</template>
