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
    <div class="shop-profile">
    <div class="head">
      <div>
        <h1>店铺档案</h1>
        <p>一次录入，AI文案、图文笔记、探店视频、带货短剧都能关联引用（最多 20 条）</p>
      </div>
      <n-button type="primary" @click="openCreate">+ 新建档案</n-button>
    </div>

    <div class="grid" v-loading="loading">
      <div v-for="item in list" :key="item.id" class="card">
        <div class="card-head">
          <span class="name">{{ item.name }}</span>
          <span v-if="item.self_title" class="self-title">{{ item.self_title }}</span>
        </div>
        <div v-if="item.address" class="line">📍 {{ item.address }}</div>
        <div v-if="item.products" class="line">🛍️ {{ item.products }}</div>
        <div v-if="item.selling_points" class="line points">
          <span v-for="(p, i) in item.selling_points.split('\n').filter(Boolean).slice(0, 3)" :key="i" class="tag">{{ p }}</span>
        </div>
        <div v-if="item.target_audience" class="line">👥 {{ item.target_audience }}</div>
        <div class="foot">
          <span>{{ formatTime(item.update_time || item.create_time) }}</span>
          <div class="ops">
            <span class="op" @click="openEdit(item)">编辑</span>
            <n-popconfirm @positive-click="removeItem(item)">
              <template #trigger><span class="op danger">删除</span></template>
              删除后已生成的历史内容不受影响，确定删除？
            </n-popconfirm>
          </div>
        </div>
      </div>

      <div v-if="!loading && !list.length" class="empty">
        <div class="emoji">🏪</div>
        <p>还没有店铺档案</p>
        <n-button type="primary" ghost size="small" @click="openCreate">新建第一条档案</n-button>
      </div>
    </div>

    <n-modal v-model:show="showEditor" preset="card" :title="editingId ? '编辑店铺档案' : '新建店铺档案'" style="width: 520px">
      <div class="editor">
        <div v-for="field in FIELDS" :key="field.key" class="field">
          <div class="label">
            {{ field.label }}
            <span class="count" :class="{ over: charLen(form[field.key]) > field.max }">
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
        <div class="field">
          <div class="label">开店时间</div>
          <n-date-picker v-model:formatted-value="openDate" type="date" value-format="yyyy-MM-dd" clearable placeholder="选填" style="width: 100%" />
        </div>
      </div>
      <template #footer>
        <div class="editor-foot">
          <n-button @click="showEditor = false">取消</n-button>
          <n-button type="primary" :loading="saving" @click="save">保存</n-button>
        </div>
      </template>
    </n-modal>
    </div>
  </n-config-provider>
</template>

<style scoped lang="less">
@import '@/assets/variables.less';

.shop-profile {
  height: 100%;
  overflow: auto;
  padding: 24px 32px;
  .scrollbar(@width: 8px, @trackColor: #f7f8f9, @thumbColor: rgba(0, 0, 0, 0.1), @thumbWidth: 4px, @hoverColor: rgba(0, 0, 0, 0.35));

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;

    h1 {
      font-size: 20px;
      color: #1f2329;
      margin: 0 0 4px;
    }

    p {
      font-size: 12px;
      color: #5f6673;
      margin: 0;
    }
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 14px;
    min-height: 200px;

    .card {
      background: #fff;
      border-radius: 12px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      transition: box-shadow 0.2s;

      &:hover {
        box-shadow: 0 4px 12px 0 rgba(0, 0, 0, 0.08);
      }

      .card-head {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 10px;

        .name {
          font-size: 16px;
          font-weight: 600;
          color: #1f2329;
        }

        .self-title {
          font-size: 12px;
          color: #875f9a;
          background: rgba(135, 95, 154, 0.08);
          border-radius: 10px;
          padding: 1px 8px;
        }
      }

      .line {
        font-size: 12px;
        color: #4b5563;
        line-height: 20px;
        margin-bottom: 4px;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;

        &.points {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;

          .tag {
            background: #f7f8f9;
            border-radius: 4px;
            padding: 1px 6px;
            font-size: 11px;
          }
        }
      }

      .foot {
        margin-top: auto;
        padding-top: 10px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 12px;
        color: #6e7681;

        .ops {
          display: flex;
          gap: 12px;

          .op {
            color: #875f9a;
            cursor: pointer;

            &.danger {
              color: #b4433e;
            }
          }
        }
      }
    }

    .empty {
      grid-column: 1 / -1;
      background: #fff;
      border-radius: 12px;
      text-align: center;
      padding: 60px 0;

      .emoji {
        font-size: 40px;
        margin-bottom: 10px;
      }

      p {
        color: #5f6673;
        font-size: 13px;
        margin: 0 0 14px;
      }
    }
  }

  .editor {
    .field {
      margin-bottom: 14px;

      .label {
        font-size: 13px;
        color: #1f2329;
        margin-bottom: 6px;
        display: flex;
        justify-content: space-between;

        .count {
          color: #6e7681;
          font-size: 12px;

          &.over {
            color: #b4433e;
          }
        }
      }
    }
  }

  .editor-foot {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
  }
}
</style>
