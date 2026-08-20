<script setup lang="ts">
import { ref, provide, watch, reactive } from 'vue'
import { useMessage } from 'naive-ui'
import { assetAll, assetBatchDelete } from '@/api/methods.ts'
import { downloadImagesAsZip, zipNameByNow } from '@/utils/download'
import { tabOps1, tabOps2 } from './constants.ts'
import RecordList from './components/RecordList/index.vue'

const message = useMessage()
const assetRef = ref<HTMLDivElement | null>(null)
const loading = ref(false)
const formData = reactive({
  category: 'ecommerce',
  type: 'productSetImages', // 默认AI商品套图
})
const pagingData = reactive({
  page: 1,
  pageSize: 9,
  hasMore: true,
})
const records = ref<any[]>([])
provide('recordsData', records)

// ===== 管理模式 =====
const manageMode = ref(false)
// 已选资产 id 集合（删除按 id；下载时按 id 反查 resultUrl）
const selectedIds = ref(new Set<number>())
provide('assetManageMode', manageMode)
provide('assetSelectedIds', selectedIds)

const enterManage = () => {
  manageMode.value = true
}
const exitManage = () => {
  manageMode.value = false
  selectedIds.value = new Set()
}

// 当前已加载数据中被选中的资产
const getSelectedAssets = () => records.value.flatMap((r: any) => r.assets).filter((a: any) => selectedIds.value.has(a.id))

const batchDownloading = ref(false)
const batchDownload = async () => {
  const urls = getSelectedAssets()
    .map((a: any) => a.resultUrl)
    .filter(Boolean)
  if (!urls.length) return message.warning('请先选择素材')
  if (batchDownloading.value) return
  batchDownloading.value = true
  try {
    // 跨分组勾选，没有单一任务时间可依据 → 按下载时刻命名，多次下载不重名
    await downloadImagesAsZip(urls, zipNameByNow())
  } finally {
    batchDownloading.value = false
  }
}

// 删除二次确认弹窗（自建，按设计稿：紫色渐变/浅紫胶囊按钮，naive dialog 难以还原）
const showDeleteConfirm = ref(false)
const deleting = ref(false)

const batchDelete = () => {
  if (!selectedIds.value.size) return message.warning('请先选择素材')
  showDeleteConfirm.value = true
}

const confirmDelete = async () => {
  if (deleting.value) return
  const ids = Array.from(selectedIds.value)
  if (!ids.length) return (showDeleteConfirm.value = false)
  deleting.value = true
  try {
    const res = await assetBatchDelete({ ids })
    if (res.code !== 0) return
    // 本地移除已删素材，清掉空分组
    const idSet = new Set(ids)
    records.value = records.value
      .map((g: any) => ({ ...g, assets: g.assets.filter((a: any) => !idSet.has(a.id)) }))
      .filter((g: any) => g.assets.length)
    selectedIds.value = new Set()
    message.success('删除成功')
    showDeleteConfirm.value = false
  } finally {
    deleting.value = false
  }
}

const getData = (isReplace?: boolean) => {
  if (!pagingData.hasMore) return

  if (loading.value) return
  loading.value = true

  const params = {
    category: formData.category,
    type: formData.category === 'ecommerce' ? formData.type : '',
    ...pagingData,
  }
  assetAll(params)
    .then((res) => {
      if (res.code === 0) {
        pagingData.page++

        if (isReplace) records.value = res.data.records
        else records.value.push(...res.data.records)

        if (res.data.records.length < pagingData.pageSize) {
          pagingData.hasMore = false
        }
      }
    })
    .finally(() => (loading.value = false))
}
getData()

watch(formData, () => {
  pagingData.page = 1
  pagingData.hasMore = true
  selectedIds.value = new Set() // 切换分类清空已选
  assetRef.value!.scrollTop = 0
  getData(true)
})
</script>

<template>
  <div
    ref="assetRef"
    class="asset"
    v-loading="loading"
    v-observer-scroll="{
      callback: getData,
    }"
  >
    <div class="top-tab-cont">
      <div class="lv1-row">
        <div class="tab-lv1">
          <span
            class="item"
            :class="formData.category === item.value ? 'active' : ''"
            v-for="item in tabOps1"
            :key="item.label"
            @click="formData.category = item.value"
          >
            {{ item.label }}
          </span>
        </div>

        <div class="manage-cont">
          <template v-if="!manageMode">
            <button class="manage-btn" @click="enterManage">管理</button>
          </template>
          <template v-else>
            <button class="manage-btn" :disabled="batchDownloading" @click="batchDownload">
              {{ batchDownloading ? '下载中' : '批量下载' }}
            </button>
            <button class="manage-btn" @click="batchDelete">删除</button>
            <button class="manage-btn" @click="exitManage">收起</button>
          </template>
        </div>
      </div>

      <div v-if="formData.category === 'ecommerce'" class="tab-lv1 tab-lv2">
        <span
          class="item"
          :class="formData.type === item.value ? 'active' : ''"
          v-for="item in tabOps2"
          :key="item.label"
          @click="formData.type = item.value"
        >
          {{ item.label }}
        </span>
      </div>
    </div>

    <RecordList />

    <Teleport to="body">
      <Transition name="fade">
        <div v-if="showDeleteConfirm" class="confirm-mask" @click.self="showDeleteConfirm = false">
          <div class="confirm-modal">
            <div class="confirm-title">删除确认</div>
            <div class="confirm-text">确定删除选中的 {{ selectedIds.size }} 个素材吗？删除后不可恢复。</div>
            <div class="confirm-footer">
              <button class="btn-cancel" @click="showDeleteConfirm = false">取消</button>
              <button class="btn-agree" :disabled="deleting" @click="confirmDelete">删除</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped lang="less">
.asset {
  height: 100vh;
  padding: 0 48px 40px;
  overflow: auto;
  > .top-tab-cont {
    padding-top: 40px;
    position: sticky;
    top: 0;
    z-index: 1;
    background-color: #f5f6f8;
    > .lv1-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background-color: #f5f6f8;
      > .manage-cont {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-shrink: 0;
        > .manage-btn {
          height: 40px;
          padding: 0 16px;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          background: #edeeef; /* 中性灰按钮 */
          color: #3a3a3a; /* token: 中性色/正文文字 */
          font-size: 14px;
          line-height: 20px;
          white-space: nowrap;
          transition: opacity 0.15s ease;
          &:hover {
            opacity: 0.85;
          }
          &:disabled {
            opacity: 0.6;
            cursor: default;
          }
        }
      }
    }
    .tab-lv1 {
      display: flex;
      gap: 8px 16px;
      color: #1f1f1f;
      text-align: center;
      padding-bottom: 16px;
      background-color: #f5f6f8;
      > .item {
        padding: 10px 16px;
        cursor: pointer;
        border-radius: 8px;
        &:hover {
          background-color: white;
        }
        &.active {
          background-color: white;
        }
      }
    }
    > .tab-lv2 {
      width: 65%;
      flex-wrap: wrap;
      margin-bottom: 28px;
    }
  }
}

/* 删除二次确认弹窗（按设计稿：紫色渐变/浅紫胶囊按钮） */
.confirm-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.confirm-modal {
  width: 400px;
  box-sizing: border-box;
  padding: 24px;
  background: #ffffff;
  border-radius: 12px;
  box-shadow:
    0px 9px 28px 8px rgba(0, 0, 0, 0.05),
    0px 6px 16px 0px rgba(0, 0, 0, 0.08),
    0px 3px 6px -4px rgba(0, 0, 0, 0.12);
}

.confirm-title {
  font-size: 18px;
  font-weight: 600;
  color: #3a3a3a; /* token: 中性色/正文文字 */
  line-height: 26px;
}

.confirm-text {
  margin-top: 12px;
  font-size: 14px;
  color: #8f8f8f; /* token: 中性色/辅助文字 */
  line-height: 22px;
}

.confirm-footer {
  display: flex;
  gap: 16px;
  margin-top: 24px;

  > .btn-cancel,
  > .btn-agree {
    flex: 1;
    height: 44px;
    border: none;
    border-radius: 999px;
    font-size: 16px;
    font-weight: 500;
    cursor: pointer;
    transition: opacity 0.2s;

    &:hover {
      opacity: 0.85;
    }
    &:disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }
  }
  > .btn-cancel {
    background: #f0ebff; /* token: AI智慧紫/AI浅底色 */
    color: #8e66f9; /* token: AI智慧紫/AI强调色 */
  }
  > .btn-agree {
    background: linear-gradient(0deg, #bba2ff 0%, #ccbaff 99%); /* token: AI智慧紫/AI主渐变 */
    color: #ffffff;
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
