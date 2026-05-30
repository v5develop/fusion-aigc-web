<script setup lang="ts">
const { data } = defineProps<{ data: any }>()
</script>

<template>
  <div class="row">
    <div class="title">商品图</div>

    <div class="cardList">
      <div class="card" v-for="(item, index) in data" :key="index" :style="{ '--card-bg': item.bgColor }">
        <div class="imageArea">
          <div class="imgBox"></div>
          <i class="arrow-icon">→</i>
          <div class="imgBox"></div>
        </div>
        <div class="content">
          <div class="cardTitle">{{ item.title }}</div>
          <div class="cardDesc">{{ item.desc }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.row {
  padding: 20px;

  .title {
    font-size: 18px;
    font-weight: bold;
    color: #333;
    margin-bottom: 20px;
  }

  .cardList {
    display: flex;
    gap: 20px;
    flex-wrap: wrap;
  }

  .card {
    width: 194px;
    height: 184px;
    background: var(--card-bg);
    border-radius: 16px;
    overflow: hidden;
    display: flex;
    flex-direction: column;

    .imageArea {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 12px;

      .imgBox {
        width: 78px;
        height: 88px;
        background: pink;
        border-radius: 12px;
      }

      .arrow-icon {
        color: #ccc;
        font-size: 16px;
        font-weight: bold;
      }
    }

    .content {
      background: #fff;
      padding: 12px;

      .cardTitle {
        font-size: 15px;
        font-weight: 600;
        color: #333;
        margin-bottom: 6px;
      }

      .cardDesc {
        font-size: 12px;
        color: #999;
        line-height: 1.5;
      }
    }
  }
}
</style>
