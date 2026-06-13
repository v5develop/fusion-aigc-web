<script setup lang="ts">
import { provide, reactive, ref } from 'vue'
import Container from '../../components/Container/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import PromptAssist from '../../components/PromptAssist/index.vue'
import SelectGroup from '@/components/SelectGroup/index.vue'
import { regionOps, languageOps, aspectRatioVideoOps } from '@/views/e-commerce/childPages/constants.ts'
import { durationOps, modelOps } from '../constants.ts'
import CheckboxGroup from '@/components/CheckboxGroup/index.vue'
import { ecommerceSubmit } from '@/api/methods.ts'
import Sample from '@/views/e-commerce/childPages/components/Sample/index.vue'
import RecordList from '@/views/asset/components/RecordList/index.vue'
import { useInitCheckTaskStatus } from '@/views/e-commerce/childPages/hooks.ts'
import CustomModel from './CustomModel/index.vue'
import { checkboxOps, videoList } from './constants.ts'

const { taskList, getSessionId, startPolling } = useInitCheckTaskStatus('video-hot')
provide('recordsData', taskList)

const loading = ref(false)
const formData = reactive({
  imageUrls: [],
  region: '中国',
  language: '中文',
  aspectRatio: '9:16',
  duration: 16,
  buyPoint: '',
  modelName: 'local',
  checked: [] as string[],
  personUrl: '',
})

const submit = () => {
  if (loading.value) return

  const sessionId = getSessionId()
  const params = {
    sessionId,
    type: 'hitVideo',
    imageUrls: formData.imageUrls,
    modelName: formData.modelName,
    params: {
      region: formData.region,
      language: formData.language,
      aspectRatio: formData.aspectRatio,
      buyPoint: formData.buyPoint,
      templateName: formData.checked[0],
      personUrl: formData.personUrl,
    },
  }
  loading.value = true
  ecommerceSubmit(params)
    .then((res) => {
      if (res.code === 0) {
        // 开始轮询
        startPolling(sessionId)
      }
    })
    .finally(() => (loading.value = false))
}
</script>

<template>
  <Container class="commerce" title="爆款视频" :submit="submit" :loading="loading">
    <template #default>
      <div class="default-content">
        <div class="module-title">商品图</div>
        <ImageUpload
          v-model:imgList="formData.imageUrls"
          :limitNumber="3"
          :exampleImages="[
            'https://i.pixiv.re/c/540x540_70/img-master/img/2023/10/24/06/00/01/112804798_p0_master1200.jpg',
            'https://i.pixiv.re/c/540x540_70/img-master/img/2023/10/24/06/00/01/112804798_p0_master1200.jpg',
          ]"
          multiple
          bottomTips
        />

        <div class="module-title">目标市场与语言</div>
        <SelectGroup
          v-model:data="formData"
          :list="[
            { field: 'region', options: regionOps },
            { field: 'language', options: languageOps },
            { field: 'aspectRatio', options: aspectRatioVideoOps },
            { field: 'duration', options: durationOps },
          ]"
        />

        <div class="module-title">商品卖点&要求</div>
        <PromptAssist v-model:value="formData.buyPoint" placeholder="输入商品核心点、适用人群、使用场景等信息" />

        <div class="module-title">视频类型</div>
        <CheckboxGroup
          v-model="formData.checked"
          :list="checkboxOps"
          :customHandle="(value) => (formData.checked = [value])"
          :col="2"
          gap="8px"
          vertical
        />

        <!--        外面的模型只能选自己上传的达人，本地模型不做限制-->
        <div class="module-title">选择模型</div>
        <SelectGroup v-model:data="formData" :list="[{ field: 'modelName', options: modelOps }]" :col="1" />

        <CustomModel v-model:personUrl="formData.personUrl" :modelName="formData.modelName" />
      </div>
    </template>

    <template #rightContent>
      <div v-if="taskList?.length">
        <div class="right-content-title">生成结果</div>
        <RecordList :showSelect="false" />
      </div>
      <Sample
        v-else
        title="爆款视频"
        :rightDesc="`上传商品图，Al 即刻生成符合 <span style='color: #8e66f9'>多电商平台规范</span> 的爆款视频。`"
      >
        <div class="video-cont">
          <div class="item" v-for="item in videoList" :key="item.title">
            <video class="video" controls :src="item.url"></video>
            <div class="title">{{ item.title }}</div>
            <div class="desc">{{ item.desc }}</div>
          </div>
        </div>
      </Sample>
    </template>
  </Container>
</template>

<style scoped lang="less">
@import '../../common.less';

.commerce {
  height: 100vh;
  .default-content {
  }

  .video-cont {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 10px 0;
    background-color: white;
    padding: 20px;
    border-radius: 10px;
    > .item {
      width: 24%;
      height: 354px;
      text-align: center;
      display: flex;
      flex-direction: column;
      gap: 5px;
      white-space: nowrap;
      > .video {
        flex: 1;
        border-radius: 10px;
      }
      > .title {
        font-size: 16px;
      }
      > .desc {
        font-size: 12px;
        color: #999999;
      }
    }
  }
}
</style>
