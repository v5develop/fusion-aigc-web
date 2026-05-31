<script setup lang="ts">
const { data, title } = defineProps<{ data: any; title: string }>();
</script>

<template>
  <div class="row">
    <div class="container">
      <div class="title">{{ title }}</div>

      <div class="cardList">
        <div class="card" v-for="(item, index) in data" :key="index">
          <div class="imageArea" :style="{ background: item.bgColor }">
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
  </div>
</template>

<style scoped lang="less">
.row {
  >.container{
    max-width: 2028px;
    margin: 0 auto;
    >.title {
      font-size: 18px;
      font-weight: bold;
      color: #333;
      margin-bottom: 20px;
    }

    >.cardList {
      display: flex;
      gap: 20px;
      flex-wrap: wrap;
      >.card {
        width: 194px;
        height: 184px;
        border-radius: 12px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        background: #fff;
        cursor: pointer;
        transition: all 0.3s;
        &:hover{
          box-shadow:  0 5px 10px 0 rgba(0,0,0,0.1);
        }
        .imageArea {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px;
          position: relative;
          .imgBox {
            width: 80px;
            height: 80px;
            background-color: white;
            border-radius: 8px;
          }
          .arrow-icon {
            color: #999;
            font-size: 16px;
            position: absolute;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
          }
        }
        .content {
          padding: 12px;
          .cardTitle {
            font-weight: 600;
            margin-bottom: 4px;
          }
          .cardDesc {
            font-size: 12px;
            color: #8F8F8F;
            line-height: 16px;
          }
        }
      }
    }

  }
}
</style>
