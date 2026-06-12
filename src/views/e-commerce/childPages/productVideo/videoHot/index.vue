<script setup lang="ts">
import { provide, reactive, ref, computed, watch } from 'vue'
import Container from '../../components/Container/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import PromptAssist from '../../components/PromptAssist/index.vue'
import SelectGroup from '@/components/SelectGroup/index.vue'
import { regionOps, languageOps, aspectRatioVideoOps } from '@/views/e-commerce/childPages/constants.ts'
import { durationOps, genderOps, ageOps, appearanceOps, bodyOps, modelOps } from '../constants.ts'
import Tab from '@/components/Tab/index.vue'
import CheckboxGroup from '@/components/CheckboxGroup/index.vue'
import Textarea from '@/components/Textarea/index.vue'
import { ecommerceSubmit, pollingSingleTask, assetAll } from '@/api/methods.ts'
import Sample from '@/views/e-commerce/childPages/components/Sample/index.vue'
import RecordList from '@/views/asset/components/RecordList/index.vue'
import { useInitCheckTaskStatus } from '@/views/e-commerce/childPages/hooks.ts'
import { usePolling } from '@/utils/hooks/usePolling.ts'

const { result: taskList = [], getSessionId, startPolling } = useInitCheckTaskStatus('video-hot')
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
})
const modelPollingType = computed(() => {
  if (['seedance2.0', 'seedance2.0-fast'].includes(formData.modelName)) return 'realpersonmodel'
  // 本地模型
  return 'customizedmodel'
})
const { switchValue, diyModelData, modelTabValue, generateModel, modelPolling, getModelData, diyLoading, pagingData } =
  useModel()
const { start: startModelPolling, stop: stopModelPolling } = usePolling((taskId) => modelPolling(taskId!), 2000, {
  onError: () => localStorage.removeItem('modelTaskId'),
})

const localModelTaskId = localStorage.getItem('modelTaskId')
if (localModelTaskId) {
  diyLoading.value = true
  startModelPolling(localModelTaskId)
}

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
function useModel() {
  const switchValue = ref(true)
  const diyModelData = reactive({
    images: [] as any[],
    sex: null,
    age: null,
    appearance: null,
    body: null,
    userInput: '',
  })
  const modelTabValue = ref<'diy' | 'myModel'>('myModel')
  const diyLoading = ref(false)
  const pagingData = reactive({
    page: 1,
    size: 15,
    loadMore: true,
    loading: false,
  })

  const generateModel = () => {
    if (diyLoading.value) return

    const params = {
      type: 'aiExpert',
      params: diyModelData,
    }
    diyLoading.value = true
    ecommerceSubmit(params)
      .then((res) => {
        if (res.code === 0) {
          // 开始轮询
          const modelTaskId = res.data.taskId
          localStorage.setItem('modelTaskId', modelTaskId)
          startModelPolling(modelTaskId)
        }
      })
      .finally(() => (diyLoading.value = false))
  }

  // 轮询达人生成
  const modelPolling = (taskId: string) => {
    return pollingSingleTask(taskId).then((res) => {
      if (res.code === 0) {
        if (res.data.status === 2) {
          stopModelPolling()
          localStorage.removeItem('modelTaskId')
          getModelData()
        }
      }
    })
  }

  // 获取达人列表
  const getModelData = () => {
    if (pagingData.loading) return
    pagingData.loading = true
    assetAll({ type: modelPollingType.value, ...pagingData })
      .then((res) => {
        if (res.code === 0) {
          const data = res.data
          diyModelData.images = data.records
          if (data.records.length < pagingData.size) {
            pagingData.loadMore = false
          }
        }
      })
      .finally(() => (loading.value = false))
  }
  watch([modelPollingType, () => pagingData.page], getModelData)

  return { diyModelData, switchValue, modelTabValue, generateModel, modelPolling, getModelData, diyLoading, pagingData }
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
          :list="[
            {
              label: 'UGG 种草',
              value: 'ugc_product_seeding_video',
              desc: '用户视角真实分享体验/TikTok-Reels高转化',
            },
            {
              label: '带货短剧',
              value: 'ecommerce_drama_short',
              desc: '卖点框输入：古装、现代、家庭、搞笑',
            },
            {
              label: '产品演示',
              value: 'product_demo',
              desc: '多角度展示+使用演示/通用',
            },
            {
              label: '产品口播',
              value: 'product_voiceover',
              desc: '面对镜头讲解产品产品卖点/社媒投放首选',
            },
            {
              label: 'TVC广告',
              value: 'tvc_ad',
              desc: '品牌广告片质感/高级产品展示',
            },
            {
              label: '开箱种草',
              value: 'unboxing_product_seeding_video',
              desc: '第一视角拆包惊喜体验/新品礼盒类',
            },
            {
              label: '痛点解决',
              value: 'pain_point_solution',
              desc: '痛点场景→产品解决/功能型产品',
            },
            {
              label: '反应展示',
              value: 'reaction_showcase',
              desc: '首次使用惊喜反应/美妆食品科技',
            },
          ]"
          :customHandle="(value) => (formData.checked = [value])"
          :col="2"
          gap="8px"
          vertical
        />

        <!--        外面的模型只能选自己上传的达人，本地模型不做限制-->
        <div class="module-title">选择模型</div>
        <SelectGroup v-model:data="formData" :list="[{ field: 'modelName', options: modelOps }]" :col="1" />

        <div class="module-title">
          定制专属模特
          <n-switch class="switch-pos" v-model:value="switchValue" />
        </div>
        <div class="model-diy-cont" v-show="switchValue">
          <Tab
            v-model:value="modelTabValue"
            :tabs="[
              { label: '定制达人', value: 'diy' },
              { label: '上传我的达人', value: 'myModel' },
            ]"
            style="margin-bottom: 12px"
          />
          <div v-if="modelTabValue === 'diy'" class="model-diy">
            <SelectGroup
              v-model:data="diyModelData"
              :list="[
                {
                  field: 'sex',
                  options: genderOps,
                  placeholder: '性别',
                },
                {
                  field: 'age',
                  options: ageOps,
                  placeholder: '年龄段',
                },
                {
                  field: 'appearance',
                  options: appearanceOps,
                  placeholder: '外观特征',
                },
                {
                  field: 'body',
                  options: bodyOps,
                  placeholder: '体型',
                },
              ]"
              gap="4px"
            />
            <div class="textarea-area">
              <div class="title">外貌细节补充</div>
              <Textarea v-model:value="diyModelData.userInput" placeholder="例如：白皙肤色、长头发、微笑唇等" />
            </div>
            <div v-loading="diyLoading" class="generate-btn" @click="generateModel">
              <i class="icon-ic_ds_ljsc"></i>
              <span>生成我的达人</span>
            </div>
          </div>

          <div
            v-else
            class="my-model"
            v-observer-scroll="{
              callback() {
                if (pagingData.loadMore) pagingData.page += 1
              },
            }"
          >
            <ImageUpload class="item" v-model:imgList="formData.imageUrls" type="card" />
            <n-image
              class="item"
              v-for="item in diyModelData.images"
              :key="item.id"
              :src="item.items[0].imageUrl"
              width="100%"
              height="86px"
              object-fit="cover"
              style="border-radius: 8px"
            />
            <n-image
              class="item"
              v-for="item in diyModelData.images"
              :key="item.id"
              :src="item.items[0].imageUrl"
              width="100%"
              height="86px"
              object-fit="cover"
              style="border-radius: 8px"
            />
            <n-image
              class="item"
              v-for="item in diyModelData.images"
              :key="item.id"
              :src="item.items[0].imageUrl"
              width="100%"
              height="86px"
              object-fit="cover"
              style="border-radius: 8px"
            />
            <n-image
              class="item"
              v-for="item in diyModelData.images"
              :key="item.id"
              :src="item.items[0].imageUrl"
              width="100%"
              height="86px"
              object-fit="cover"
              style="border-radius: 8px"
            />
            <n-image
              class="item"
              v-for="item in diyModelData.images"
              :key="item.id"
              :src="item.items[0].imageUrl"
              width="100%"
              height="86px"
              object-fit="cover"
              style="border-radius: 8px"
            />
            <n-image
              class="item"
              v-for="item in diyModelData.images"
              :key="item.id"
              :src="item.items[0].imageUrl"
              width="100%"
              height="86px"
              object-fit="cover"
              style="border-radius: 8px"
            />
            <n-image
              class="item"
              v-for="item in diyModelData.images"
              :key="item.id"
              :src="item.items[0].imageUrl"
              width="100%"
              height="86px"
              object-fit="cover"
              style="border-radius: 8px"
            />
            <n-image
              class="item"
              v-for="item in diyModelData.images"
              :key="item.id"
              :src="item.items[0].imageUrl"
              width="100%"
              height="86px"
              object-fit="cover"
              style="border-radius: 8px"
            />
            <n-image
              class="item"
              v-for="item in diyModelData.images"
              :key="item.id"
              :src="item.items[0].imageUrl"
              width="100%"
              height="86px"
              object-fit="cover"
              style="border-radius: 8px"
            />
            <n-image
              class="item"
              v-for="item in diyModelData.images"
              :key="item.id"
              :src="item.items[0].imageUrl"
              width="100%"
              height="86px"
              object-fit="cover"
              style="border-radius: 8px"
            />
            <n-image
              class="item"
              v-for="item in diyModelData.images"
              :key="item.id"
              :src="item.items[0].imageUrl"
              width="100%"
              height="86px"
              object-fit="cover"
              style="border-radius: 8px"
            />
            <n-image
              class="item"
              v-for="item in diyModelData.images"
              :key="item.id"
              :src="item.items[0].imageUrl"
              width="100%"
              height="86px"
              object-fit="cover"
              style="border-radius: 8px"
            />
            <n-image
              class="item"
              v-for="item in diyModelData.images"
              :key="item.id"
              :src="item.items[0].imageUrl"
              width="100%"
              height="86px"
              object-fit="cover"
              style="border-radius: 8px"
            />
            <n-image
              class="item"
              v-for="item in diyModelData.images"
              :key="item.id"
              :src="item.items[0].imageUrl"
              width="100%"
              height="86px"
              object-fit="cover"
              style="border-radius: 8px"
            />
          </div>
        </div>
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
        image="e-commerce/product-kit-sample.webp"
      />
    </template>
  </Container>
</template>

<style scoped lang="less">
@import '../../common.less';

.commerce {
  height: 100vh;
  .default-content {
    > .checkbox-cont {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      > .item {
        flex: 1;
        min-width: 40%;
      }
    }
    .switch-pos {
      position: absolute;
      right: 0;
      top: 50%;
      transform: translateY(-50%);
    }
    .model-diy-cont {
      > .model-diy {
        > .textarea-area {
          font-size: 0;
          > .title {
            font-size: 14px;
            line-height: 20px;
            color: #9e9e9e;
            margin: 12px 0 8px;
          }
        }
        > .generate-btn {
          height: 32px;
          margin: 12px 0;
          border-radius: 8px;
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 8px;
          background: #f5f6f8;
          cursor: pointer;
          position: relative;
          &:hover {
            background: #ebecef;
          }
        }
      }

      > .my-model {
        max-height: 500px;
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 4px;
        overflow: auto;
      }
    }
  }

  .sample-cont {
  }
}
</style>
