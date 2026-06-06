<script setup lang="ts">
import { ref, provide } from 'vue'
import RecordList from '@/views/asset/components/RecordList/index.vue'

const tab1Value = ref('电商')
const tab2Value = ref('AI商品套图')
const records = ref([
  {
    title: '粉色弹盖式时尚保温杯',
    date: '2026-05-24 13:26',
    images: [
      'https://i.pixiv.re/c/540x540_70/img-master/img/2022/10/13/23/12/07/101909818_p0_master1200.jpg',
      'https://i.pixiv.re/c/540x540_70/img-master/img/2023/09/17/10/00/06/111787785_p0_master1200.jpg',
      'http://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/6.png',
      'https://i.pixiv.re/c/540x540_70/img-master/img/2023/09/17/10/00/06/111787785_p0_master1200.jpg',
      'https://i.pixiv.re/c/540x540_70/img-master/img/2022/10/13/23/12/07/101909818_p0_master1200.jpg',
      'https://i.pixiv.re/c/540x540_70/img-master/img/2023/09/17/10/00/06/111787785_p0_master1200.jpg',
      'https://i.pixiv.re/c/540x540_70/img-master/img/2023/09/17/10/00/06/111787785_p0_master1200.jpg',
      'https://i.pixiv.re/c/540x540_70/img-master/img/2023/09/17/10/00/06/111787785_p0_master1200.jpg',
    ],
  },
  {
    title: '粉色弹盖式时尚保温杯',
    date: '2026-05-24 13:26',
    images: ['https://i.pixiv.re/c/540x540_70/img-master/img/2023/05/09/00/30/02/107956384_p0_master1200.jpg'],
  },
])
const recordsData = ref(
  records.value.map((item) => {
    return {
      ...item,
      selectList: item.images.map((jtem) => {
        return {
          url: jtem,
          selected: false,
        }
      }),
    }
  }),
)
provide('recordsData', recordsData)

const commerceTabs = [
  { label: 'AI商品套图' },
  { label: 'AI详情' },
  { label: '爆款图复刻' },
  { label: '手持商品' },
  { label: '视频复刻' },
  { label: '爆款视频' },
  { label: '模特替换' },
  { label: '商品替换' },
  { label: '人像换背景' },
  { label: 'AI穿搭套图' },
  { label: 'AI试衣' },
  { label: '服装去皱' },
  { label: '搭配图' },
  { label: 'AI试鞋' },
]
</script>

<template>
  <div class="asset">
    <div class="tab-lv1">
      <span
        class="item"
        :class="tab1Value === item.label ? 'active' : ''"
        v-for="item in [{ label: '图片' }, { label: '视频' }, { label: '电商' }]"
        :key="item.label"
        @click="tab1Value = item.label"
        >{{ item.label }}</span
      >
    </div>

    <div v-if="tab1Value === '电商'" class="tab-lv1 tab-lv2">
      <span
        class="item"
        :class="tab2Value === item.label ? 'active' : ''"
        v-for="item in commerceTabs"
        :key="item.label"
        @click="tab2Value = item.label"
        >{{ item.label }}</span
      >
    </div>

    <RecordList v-model:recordsData="recordsData" />
  </div>
</template>

<style scoped lang="less">
.asset {
  padding: 40px 48px;
  > .tab-lv1 {
    display: flex;
    gap: 8px 16px;
    color: #1f1f1f;
    text-align: center;
    margin-bottom: 16px;
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
</style>
