<script setup lang="ts">
import { ref, provide, watch, reactive, computed } from 'vue'
import { useMessage } from 'naive-ui'
import { assetAll, assetBatchDelete, assetCategories, assetAspectRatios } from '@/api/methods.ts'
import type * as types from '@/api/types'
import { canSaveAsJpg, downloadImagesAsZip, zipNameByNow } from '@/utils/download'
import { saveImagesAsJpg } from '@/utils/batchDownload'
import RecordList from './components/RecordList/index.vue'

const message = useMessage()
const assetRef = ref<HTMLDivElement | null>(null)
const loading = ref(false)
/**
 * 分类不再硬编码。原先二级是写死的 14 个电商入口，运营新增一个入口就得改前端发版，
 * 而后端的聚合分类允许把「底层两个模型、用户眼里一件事」的入口并成一个 chip。
 *
 * category 存一级 categoryCode，assetCategory 存实际下发给后端的那一级：
 * 选中二级就传二级的 code，只选一级就传一级的 code（后端自动展开成其二级之并）。
 */
const categories = ref<types.IAssetCategory[]>([])
const aspectRatios = ref<string[]>([])
const formData = reactive({
  category: '',
  subCategory: '',
  aspectRatio: '',
})

const tabOps1 = computed(() => categories.value.map((c) => ({ label: c.categoryName, value: c.categoryCode })))

const tabOps2 = computed(() => {
  const root = categories.value.find((c) => c.categoryCode === formData.category)
  const children = root?.children ?? []
  if (!children.length) return []
  return [{ label: '全部', value: '' }, ...children.map((c) => ({ label: c.categoryName, value: c.categoryCode }))]
})

const loadFilters = async () => {
  const [cat, ratio] = await Promise.all([assetCategories().catch(() => null), assetAspectRatios().catch(() => null)])
  if (cat?.code === 0) {
    categories.value = cat.data ?? []
    // 默认选中第一个一级，而不是写死 'ecommerce'——分类由运营配，写死的值可能已经不存在了。
    // 用 ?.  而不是 length 判空：tsconfig 开了 noUncheckedIndexedAccess，
    // 下标访问的返回值一律带 undefined，length>0 这个前提编译器并不认
    const first = categories.value[0]?.categoryCode
    if (!formData.category && first) formData.category = first
  }
  if (ratio?.code === 0) aspectRatios.value = ratio.data ?? []
}
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
const getSelectedAssets = () =>
  records.value.flatMap((r: any) => r.assets).filter((a: any) => selectedIds.value.has(a.id))

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

// 批量「全部另存为 JPG」：选中里有静态图才出；跨分组按下载时刻命名
const batchJpgBusy = ref(false)
const selectedJpgCount = computed(() => getSelectedAssets().filter((a: any) => canSaveAsJpg(a.resultUrl)).length)
const batchSaveJpg = async () => {
  const name = zipNameByNow()
  const items = getSelectedAssets()
    .filter((a: any) => a.resultUrl)
    .map((a: any) => ({ src: a.resultUrl as string, name }))
  if (!items.length) return message.warning('请先选择素材')
  if (batchJpgBusy.value) return
  batchJpgBusy.value = true
  try {
    await saveImagesAsJpg(items, { zipName: name })
  } finally {
    batchJpgBusy.value = false
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

  const params: types.IAssetAll = {
    // 选到哪一级就传哪一级的 code：只选一级时后端自动展开成其二级之并，
    // 前端不用自己拼 entryCodes——运营改归属立刻生效，不用等发版
    assetCategory: formData.subCategory || formData.category,
    ...(formData.aspectRatio ? { aspectRatio: formData.aspectRatio } : {}),
    page: pagingData.page,
    pageSize: pagingData.pageSize,
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
// 先取分类：默认选中的一级来自后端，拿不到就无从筛起。
// 设上 formData.category 会触发下面的 watch 去拉第一页，所以这里不另外调 getData，
// 否则首屏会打两次请求。
loadFilters().then(() => {
  // 分类接口失败或返回空时兜底拉一次不带分类的列表，否则整页空白、
  // 用户会以为素材没了——而实际上只是分类没取到
  if (!formData.category) getData(true)
})

// 切一级清二级：二级 code 属于上一个一级，带过去会筛出空列表
watch(
  () => formData.category,
  () => (formData.subCategory = ''),
)

watch(formData, () => {
  if (!formData.category) return // 分类还没加载完，别用空条件打一次无意义的请求
  pagingData.page = 1
  pagingData.hasMore = true
  selectedIds.value = new Set() // 切换分类清空已选
  // 这次触发可能发生在挂载之前（分类是异步取的），用 ! 断言会直接抛
  if (assetRef.value) assetRef.value.scrollTop = 0
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
            :key="item.value"
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
            <button v-if="selectedJpgCount" class="manage-btn" :disabled="batchJpgBusy" @click="batchSaveJpg">
              {{ batchJpgBusy ? '转换中' : '另存为 JPG' }}
            </button>
            <button class="manage-btn" @click="batchDelete">删除</button>
            <button class="manage-btn" @click="exitManage">收起</button>
          </template>
        </div>
      </div>

      <div v-if="tabOps2.length" class="tab-lv1 tab-lv2">
        <span
          class="item"
          :class="formData.subCategory === item.value ? 'active' : ''"
          v-for="item in tabOps2"
          :key="item.value"
          @click="formData.subCategory = item.value"
        >
          {{ item.label }}
        </span>
      </div>

      <div v-if="aspectRatios.length" class="tab-lv1 tab-lv2">
        <span class="item" :class="formData.aspectRatio === '' ? 'active' : ''" @click="formData.aspectRatio = ''">
          全部比例
        </span>
        <span
          class="item"
          :class="formData.aspectRatio === r ? 'active' : ''"
          v-for="r in aspectRatios"
          :key="r"
          @click="formData.aspectRatio = r"
        >
          {{ r }}
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
    background-color: var(--xq-page);
    > .lv1-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background-color: var(--xq-page);
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
          background: var(--xq-sunken); /* 中性灰按钮 */
          color: var(--xq-ink-2); /* token: 中性色/正文文字 */
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
      color: var(--xq-ink);
      text-align: center;
      padding-bottom: 16px;
      background-color: var(--xq-page);
      > .item {
        padding: 10px 16px;
        cursor: pointer;
        border-radius: 8px;
        &:hover {
          background-color: var(--xq-surface);
        }
        &.active {
          background-color: var(--xq-surface);
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
  background: var(--xq-surface);
  border-radius: 12px;
  box-shadow:
    0px 9px 28px 8px rgba(0, 0, 0, 0.05),
    0px 6px 16px 0px rgba(0, 0, 0, 0.08),
    0px 3px 6px -4px rgba(0, 0, 0, 0.12);
}

.confirm-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--xq-ink-2); /* token: 中性色/正文文字 */
  line-height: 26px;
}

.confirm-text {
  margin-top: 12px;
  font-size: 14px;
  color: var(--xq-muted); /* token: 中性色/辅助文字 */
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
    background: var(--xq-violet-soft); /* token: AI智慧紫/AI浅底色 */
    color: #8e66f9; /* token: AI智慧紫/AI强调色 */
    // 深色：亮紫在深底上发荧光，换藤紫
    [data-theme='dark'] & {
      color: var(--xq-violet-fg);
    }
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
