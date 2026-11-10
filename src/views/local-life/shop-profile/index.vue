<script setup lang="ts">
/**
 * 店铺档案管理：AI文案、图文笔记、探店视频、带货短剧共用的数据底座。
 * 一个账号最多 20 条，字段上限按「汉字算 2 个字符」校验（与后端口径一致）。
 */
import { onMounted, reactive, ref } from 'vue'
import { useMessage, NConfigProvider } from 'naive-ui'
import { llFormSkin, llTheme } from '../theme.ts'
import Field from '../components/Field/index.vue'
import { llShopProfileCreate, llShopProfileList, llShopProfileRemove, llShopProfileSave } from '@/api/local-life.ts'
import type { ILShopProfile } from '@/api/local-life-types.ts'
import { charLen, formatTime } from '../constants.ts'

defineOptions({ name: 'local-life-shop-profile' })

const message = useMessage()

const list = ref<ILShopProfile[]>([])
const loading = ref(false)
const saving = ref(false)

async function load() {
  loading.value = true
  try {
    const res = await llShopProfileList()
    list.value = res.data?.list ?? []
  } finally {
    loading.value = false
  }
}

onMounted(load)

// ---------------- 编辑弹窗 ----------------

const form = reactive({
  name: '',
  address: '',
  products: '',
  sellingPoints: '',
  selfTitle: '',
  targetAudience: '',
})

type FormKey = keyof typeof form

interface FieldDef {
  key: FormKey
  label: string
  max: number
  placeholder: string
  type?: 'textarea'
  required?: boolean
}

// 上限与后端一致（汉字算 2）：名称 20 / 开店时间 10 / 地址 60 / 商品 180 / 卖点 220 / 称呼 15 / 客群 40
const FIELDS: FieldDef[] = [
  { key: 'name', label: '店铺名称', max: 20, placeholder: '必填，10 个汉字以内', required: true },
  { key: 'address', label: '店铺地址', max: 60, placeholder: '选填' },
  { key: 'products', label: '商品/服务', max: 180, placeholder: '提供什么商品或服务，选填', type: 'textarea' },
  { key: 'sellingPoints', label: '核心卖点', max: 220, placeholder: '3~5 条，换行分隔，选填', type: 'textarea' },
  { key: 'selfTitle', label: '如何称呼自己', max: 15, placeholder: '如「老板娘小林」，选填' },
  { key: 'targetAudience', label: '目标客群', max: 40, placeholder: '主要面向什么人群，选填' },
]

const showEditor = ref(false)
const editingId = ref<number | null>(null)
const openDate = ref<string | null>(null)

function clearForm() {
  ;(Object.keys(form) as FormKey[]).forEach((k) => (form[k] = ''))
}

function openCreate() {
  editingId.value = null
  clearForm()
  openDate.value = null
  showEditor.value = true
}

function openEdit(item: ILShopProfile) {
  editingId.value = item.id
  clearForm()
  ;(Object.keys(form) as FormKey[]).forEach((k) => (form[k] = (item as any)[k] ?? ''))
  openDate.value = item.openDate || null
  showEditor.value = true
}

async function save() {
  if (saving.value) return
  if (!form.name.trim()) return message.warning('请填写店铺名称')
  if (charLen(form.name) > 20) return message.warning('店铺名称最多 10 个汉字')

  saving.value = true
  try {
    const payload = {
      name: form.name.trim(),
      openDate: openDate.value ?? undefined,
      address: form.address.trim() || undefined,
      products: form.products.trim() || undefined,
      sellingPoints: form.sellingPoints.trim() || undefined,
      selfTitle: form.selfTitle.trim() || undefined,
      targetAudience: form.targetAudience.trim() || undefined,
    }
    if (editingId.value) {
      await llShopProfileSave(editingId.value, payload)
      message.success('已保存')
    } else {
      await llShopProfileCreate(payload)
      message.success('已创建')
    }
    showEditor.value = false
    void load()
  } finally {
    saving.value = false
  }
}

async function removeItem(item: ILShopProfile) {
  await llShopProfileRemove(item.id)
  message.success('已删除')
  void load()
}
</script>

<template>
  <n-config-provider :theme-overrides="llTheme" abstract>
    <div :class="['h-full overflow-y-auto bg-page text-ink', llFormSkin]">
      <div class="max-w-1180px box-border pt-14px pb-24px pl-16px pr-24px">
        <header class="flex items-center justify-between gap-16px">
          <div class="min-w-0">
            <h1 class="m-0 sx-title-page">店铺档案</h1>
            <p class="m-0 mt-2px text-12px leading-18px text-muted">
              一次录入，AI文案、图文笔记、探店视频、带货短剧都能关联引用（最多 20 条）
            </p>
          </div>
          <n-button type="primary" class="flex-none" @click="openCreate">+ 新建档案</n-button>
        </header>

        <div
          v-loading="loading"
          class="mt-16px grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-12px min-h-200px"
        >
          <div
            v-for="item in list"
            :key="item.id"
            class="bg-white rounded-lg border border-solid border-line shadow-card-v3 flex flex-col p-14px transition-[border-color,box-shadow] duration-mid ease-[ease] motion-reduce:transition-none hover:(border-violet-line shadow-raised-hover)"
          >
            <div class="flex items-center gap-8px mb-10px min-w-0">
              <span class="truncate sx-title-card">{{ item.name }}</span>
              <span v-if="item.selfTitle" class="sx-chip flex-shrink-0 ll-chip-running">{{ item.selfTitle }}</span>
            </div>
            <div v-if="item.address" class="mb-4px text-12px leading-20px text-ink-2 line-clamp-2">
              📍 {{ item.address }}
            </div>
            <div v-if="item.products" class="mb-4px text-12px leading-20px text-ink-2 line-clamp-2">
              🛍️ {{ item.products }}
            </div>
            <div v-if="item.sellingPoints" class="mb-4px flex flex-wrap gap-6px">
              <span
                v-for="(p, i) in item.sellingPoints.split('\n').filter(Boolean).slice(0, 3)"
                :key="i"
                class="sx-chip flex-shrink-0 text-ink-2 bg-surface2 border border-solid border-line"
                >{{ p }}</span
              >
            </div>
            <div v-if="item.targetAudience" class="mb-4px text-12px leading-20px text-ink-2 line-clamp-2">
              👥 {{ item.targetAudience }}
            </div>
            <div
              class="mt-auto pt-10px flex items-center justify-between border-t border-t-solid border-t-line-soft text-11px leading-16px text-placeholder tabular-nums"
            >
              <span>{{ formatTime(item.updateTime || item.createTime) }}</span>
              <div class="flex gap-12px">
                <span class="ll-link transition-colors duration-fast" @click="openEdit(item)">编辑</span>
                <n-popconfirm @positive-click="removeItem(item)">
                  <template #trigger
                    ><span class="ll-danger-link transition-colors duration-fast text-12px">删除</span></template
                  >
                  删除后已生成的历史内容不受影响，确定删除？
                </n-popconfirm>
              </div>
            </div>
          </div>

          <div
            v-if="!loading && !list.length"
            class="sx-empty col-span-full !min-h-280px !gap-10px bg-white shadow-card-v3"
          >
            <div class="text-40px leading-none" aria-hidden="true">🏪</div>
            <p class="m-0 sx-empty-title">还没有店铺档案</p>
            <n-button type="primary" ghost size="small" @click="openCreate">新建第一条档案</n-button>
          </div>
        </div>
      </div>

      <n-modal
        v-model:show="showEditor"
        preset="card"
        :title="editingId ? '编辑店铺档案' : '新建店铺档案'"
        style="width: 520px"
      >
        <div class="flex flex-col gap-16px">
          <Field v-for="field in FIELDS" :key="field.key" :label="field.label" :required="field.required">
            <template #extra>
              <span
                class="text-11px font-400 leading-16px tabular-nums"
                :class="charLen(form[field.key]) > field.max ? 'text-danger' : 'text-placeholder'"
              >
                {{ charLen(form[field.key]) }}/{{ field.max }}
              </span>
            </template>
            <n-input
              v-if="field.type === 'textarea'"
              v-model:value="form[field.key]"
              type="textarea"
              :rows="3"
              :placeholder="field.placeholder"
            />
            <n-input v-else v-model:value="form[field.key]" :placeholder="field.placeholder" />
          </Field>
          <Field label="开店时间">
            <n-date-picker
              v-model:formatted-value="openDate"
              type="date"
              value-format="yyyy-MM-dd"
              clearable
              placeholder="选填"
              class="w-full"
            />
          </Field>
        </div>
        <template #footer>
          <div class="flex justify-end gap-10px">
            <n-button @click="showEditor = false">取消</n-button>
            <n-button type="primary" :loading="saving" @click="save">保存</n-button>
          </div>
        </template>
      </n-modal>
    </div>
  </n-config-provider>
</template>
