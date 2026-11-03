<script setup lang="ts">
/**
 * 店铺档案管理：AI文案、图文笔记、探店视频、带货短剧共用的数据底座。
 * 一个账号最多 20 条，字段上限按「汉字算 2 个字符」校验（与后端口径一致）。
 */
import { onMounted, reactive, ref } from 'vue'
import { useMessage, NConfigProvider } from 'naive-ui'
import { llTheme } from '../theme.ts'
import { llShopProfileCreate, llShopProfileList, llShopProfileRemove, llShopProfileSave } from '@/api/localLife.ts'
import type { ILShopProfile } from '@/api/localLifeTypes.ts'
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
  selling_points: '',
  self_title: '',
  target_audience: '',
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
  { key: 'selling_points', label: '核心卖点', max: 220, placeholder: '3~5 条，换行分隔，选填', type: 'textarea' },
  { key: 'self_title', label: '如何称呼自己', max: 15, placeholder: '如「老板娘小林」，选填' },
  { key: 'target_audience', label: '目标客群', max: 40, placeholder: '主要面向什么人群，选填' },
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
  openDate.value = item.open_date || null
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
      open_date: openDate.value ?? undefined,
      address: form.address.trim() || undefined,
      products: form.products.trim() || undefined,
      selling_points: form.selling_points.trim() || undefined,
      self_title: form.self_title.trim() || undefined,
      target_audience: form.target_audience.trim() || undefined,
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
    <div class="h-full overflow-y-auto bg-page text-ink">
      <div class="max-w-1180px box-border pt-14px pb-24px pl-16px pr-24px">
        <header class="flex items-center justify-between gap-16px">
          <div class="min-w-0">
            <h1 class="m-0 text-22px font-600 leading-30px text-ink">店铺档案</h1>
            <p class="m-0 mt-2px text-12px leading-18px text-muted">
              一次录入，AI文案、图文笔记、探店视频、带货短剧都能关联引用（最多 20 条）
            </p>
          </div>
          <n-button type="primary" class="flex-none" @click="openCreate">+ 新建档案</n-button>
        </header>

        <div
          v-loading="loading"
          class="mt-12px grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-10px min-h-200px"
        >
          <div
            v-for="item in list"
            :key="item.id"
            class="ll-card flex flex-col p-16px transition-[border-color,box-shadow] duration-[0.18s] ease-[ease] hover:(border-violet-line shadow-[0_4px_16px_rgba(31,35,41,0.08)])"
          >
            <div class="flex items-center gap-8px mb-10px min-w-0">
              <span class="truncate text-16px font-600 leading-22px text-ink">{{ item.name }}</span>
              <span v-if="item.self_title" class="ll-chip ll-chip-running">{{ item.self_title }}</span>
            </div>
            <div v-if="item.address" class="mb-4px text-12px leading-20px text-ink-2 line-clamp-2">
              📍 {{ item.address }}
            </div>
            <div v-if="item.products" class="mb-4px text-12px leading-20px text-ink-2 line-clamp-2">
              🛍️ {{ item.products }}
            </div>
            <div v-if="item.selling_points" class="mb-4px flex flex-wrap gap-6px">
              <span
                v-for="(p, i) in item.selling_points.split('\n').filter(Boolean).slice(0, 3)"
                :key="i"
                class="ll-chip text-ink-2 bg-surface2 border border-line"
                >{{ p }}</span
              >
            </div>
            <div v-if="item.target_audience" class="mb-4px text-12px leading-20px text-ink-2 line-clamp-2">
              👥 {{ item.target_audience }}
            </div>
            <div class="mt-auto pt-10px flex items-center justify-between text-12px text-placeholder">
              <span>{{ formatTime(item.update_time || item.create_time) }}</span>
              <div class="flex gap-12px">
                <span class="ll-link" @click="openEdit(item)">编辑</span>
                <n-popconfirm @positive-click="removeItem(item)">
                  <template #trigger><span class="ll-danger-link text-12px">删除</span></template>
                  删除后已生成的历史内容不受影响，确定删除？
                </n-popconfirm>
              </div>
            </div>
          </div>

          <div v-if="!loading && !list.length" class="ll-card col-span-full flex flex-col items-center py-60px">
            <div class="mb-10px text-40px leading-none" aria-hidden="true">🏪</div>
            <p class="ll-empty m-0 mb-14px">还没有店铺档案</p>
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
        <div>
          <div v-for="field in FIELDS" :key="field.key" class="mb-14px">
            <div class="ll-label">
              {{ field.label }}
              <span
                class="text-12px"
                :class="charLen(form[field.key]) > field.max ? 'text-danger' : 'text-placeholder'"
              >
                {{ charLen(form[field.key]) }}/{{ field.max }}
              </span>
            </div>
            <n-input
              v-if="field.type === 'textarea'"
              v-model:value="form[field.key]"
              type="textarea"
              :rows="3"
              :placeholder="field.placeholder"
            />
            <n-input v-else v-model:value="form[field.key]" :placeholder="field.placeholder" />
          </div>
          <div class="mb-14px">
            <div class="ll-label">开店时间</div>
            <n-date-picker
              v-model:formatted-value="openDate"
              type="date"
              value-format="yyyy-MM-dd"
              clearable
              placeholder="选填"
              class="w-full"
            />
          </div>
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
