<script setup lang="ts">
import { inject, reactive, type Ref } from 'vue'
import { useMessage } from 'naive-ui'
import Card from '../Card/index.vue'
import { downloadImagesAsZip } from '@/utils/download'
import downloadIcon from '@/assets/icons/download-single.svg'

const message = useMessage()
// 圆形复选框选中态的对勾路径（取自设计稿 layer 939:035755，16x16 视口）
const CHECK_PATH =
  'M10.597762625,5.744140625C10.773764625,5.744140625,10.925955725,5.80756963,11.054908725,5.934618115C11.183100725,6.061571355,11.247386425,6.214334305,11.247386425,6.392906965C11.247386425,6.571479675,11.183100725,6.726242545,11.055004125,6.855195925L7.842982025,10.065598925C7.717742925,10.190552225,7.565551525,10.254076525,7.385836125,10.254076525C7.202977925,10.254076525,7.049643525,10.190552225,6.924500025,10.065503625L5.087725225,8.230348125C4.963248201,8.103299625,4.900390625,7.950536725,4.900390625,7.767963925C4.900390625,7.589486525,4.963914871,7.434628525,5.090677645,7.307675125C5.218011855,7.182721925,5.371250985,7.117197525,5.550014075,7.117197525C5.725824775,7.117197525,5.878016355,7.182721925,6.006969725,7.311675025L7.382026625,8.690541725L10.137093525,5.936522885C10.265284525,5.807569623,10.418999625,5.744140611,10.598239425,5.744140625L10.597857925,5.744140625L10.597762625,5.744140625Z'
const recordsData = inject<any[]>('recordsData')
// 管理模式开关 + 已选资产 id 集合（与 Card 共享）
const manageMode = inject<Ref<boolean> | undefined>('assetManageMode', undefined)
const selectedIds = inject<Ref<Set<number>> | undefined>('assetSelectedIds', undefined)

// 切换单个分组全部选中
const toggleGroupAll = (group: any) => {
  const { allChecked, allIds } = getGroupSelectState(group)

  if (allChecked) {
    // 本组已全选 → 取消本组所有素材
    allIds.forEach((id: number) => selectedIds?.value.delete(id))
  } else {
    // 未全选 → 勾选本组全部素材
    allIds.forEach((id: number) => selectedIds?.value.add(id))
  }
}

const getGroupSelectState = (group: any) => {
  const allIds = group.assets.map((item: any) => item.id)
  const checkedCount = allIds.filter((id: number) => selectedIds?.value.has(id)).length

  const total = allIds.length
  const allChecked = total > 0 && checkedCount === total
  const indeterminate = checkedCount > 0 && !allChecked

  return { allChecked, indeterminate, allIds }
}

// 组级下载：打包本组全部素材为 zip（按 sourceTaskId 记录 loading）
const downloadingKeys = reactive(new Set<string>())
const downloadGroup = async (group: any) => {
  const key = group.sourceTaskId
  if (downloadingKeys.has(key)) return
  const urls = group.assets.map((a: any) => a.resultUrl).filter(Boolean)
  if (!urls.length) return message.warning('该组暂无可下载素材')
  downloadingKeys.add(key)
  try {
    await downloadImagesAsZip(urls)
  } finally {
    downloadingKeys.delete(key)
  }
}
</script>

<template>
  <div class="record-list">
    <div class="record-item" v-for="item in recordsData" :key="item.taskId">
      <div class="title-cont">
        <div class="left-cont">
          <span v-if="manageMode" class="group-check" @click="toggleGroupAll(item)">
            <svg viewBox="0 0 16 16" width="18" height="18">
              <template v-if="getGroupSelectState(item).allChecked">
                <circle cx="8" cy="8" r="8" fill="#202020" />
                <path :d="CHECK_PATH" fill="#FFFFFF" />
              </template>
              <circle v-else cx="8" cy="8" r="7.33" fill="#FFFFFF" stroke="#D8D8D8" stroke-width="1.33" />
            </svg>
          </span>
          <span>{{ item.taskTime }}</span>
        </div>

        <button
          v-if="manageMode"
          class="group-download-btn"
          :disabled="downloadingKeys.has(item.sourceTaskId)"
          @click="downloadGroup(item)"
        >
          <img :src="downloadIcon" width="16" height="16" alt="下载" />
          <span>{{ downloadingKeys.has(item.sourceTaskId) ? '下载中' : '下载' }}</span>
        </button>
      </div>

      <div class="card-cont">
        <Card class="card-item" v-for="(jtem, j) in item.assets" :key="j" :data="jtem" />
      </div>
    </div>

    <div v-if="!recordsData?.length" class="empty-state">
      <i class="icon-ic_ds_empty" />
      <span>暂无数据</span>
    </div>
  </div>
</template>

<style scoped lang="less">
.record-list {
  > .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 80px 0;
    color: #999;
    > i {
      font-size: 48px;
      margin-bottom: 12px;
    }
    > span {
      font-size: 14px;
    }
  }

  > .record-item {
    margin-bottom: 50px;
    > .title-cont {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 16px;
      font-weight: 600;
      line-height: 22px;
      margin-bottom: 26px;
      > .left-cont {
        display: flex;
        align-items: center;
        gap: 8px;
        > .group-check {
          display: inline-flex;
          align-items: center;
          cursor: pointer;
          > svg {
            display: block;
          }
        }
      }

      > .group-download-btn {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        height: 40px;
        padding: 0 16px;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        /* token: AI智慧紫/AI主渐变 */
        background: linear-gradient(0deg, #bba2ff 0%, #ccbaff 99%);
        color: #fff;
        font-size: 14px;
        font-weight: 400;
        line-height: 20px;
        transition: opacity 0.15s ease;

        > img {
          display: block;
        }
        &:hover {
          opacity: 0.9;
        }
        &:disabled {
          opacity: 0.6;
          cursor: default;
        }
      }
    }

    > .card-cont {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 8px;
      font-size: 0;
      > .card-item {
        width: 100%;
        aspect-ratio: 1/1;
      }
    }
  }
}
</style>
