<script setup lang="ts">
import { useRouter } from 'vue-router'

const { data, title } = defineProps<{ data: any; title: string }>()

const router = useRouter()

function goChildPages(item: any) {
  router.push({ name: item.pathName })
}
</script>

<template>
  <div class="row">
    <div class="container">
      <div class="title">{{ title }}</div>

      <div class="cardList">
        <div class="card" v-for="(item, index) in data" :key="index" @click="goChildPages(item)">
                    <img class="imageArea" :src="item.url" alt="" />
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
  > .container {
    margin: 0 auto;
    > .title {
      font-size: 18px;
      font-weight: bold;
      color: #333;
      margin-bottom: 20px;
    }

    > .cardList {
      display: flex;
      gap: 20px;
      flex-wrap: wrap;
      > .card {
        width: 15%;
        min-width: 194px;
        max-width: 308px;
        border-radius: 12px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        background: #fff;
        cursor: pointer;
        transition: all 0.3s;
        &:hover {
          box-shadow: 0 5px 10px 0 rgba(0, 0, 0, 0.1);
        }
        .imageArea {
          width: 100%;
          aspect-ratio: 97/52;
          object-fit: cover;
        }
        .content {
          flex: 1;
          padding: 20px 12px;
          .cardTitle {
            font-weight: 600;
            margin-bottom: 4px;
          }
          .cardDesc {
            font-size: 12px;
            color: #8f8f8f;
            line-height: 16px;
          }
        }
      }
    }
  }
}
</style>
