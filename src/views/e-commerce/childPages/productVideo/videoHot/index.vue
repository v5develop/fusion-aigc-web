<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import Container from '../../components/Container/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import PromptAssist from '../../components/PromptAssist/index.vue'
import SelectGroup from '@/components/SelectGroup/index.vue'
import { countryOptions, languageOptions, platformOptions } from '@/views/e-commerce/childPages/constants.ts'
import Tab from '@/components/Tab/index.vue'
import CheckboxGroup from '@/components/CheckboxGroup/index.vue'
import Textarea from '@/components/Textarea/index.vue'
import ManySelect from '@/components/SelectGroup/index.vue'

const formData = reactive({
  imgList: ref([]),
  platform: ref(0),
  country: ref(0),
  language: ref(0),
  ratio: ref(0),
  prompt: ref(''),
  checked: ref([]),
})
const tabValue = ref(0)
const switchValue = ref(true)
</script>

<template>
  <Container
    class="commerce"
    title="爆款视频"
    rightTitle="爆款视频"
    :rightDesc="`上传商品图，Al 即刻生成符合 <span style='color: #8e66f9'>多电商平台规范</span> 的商品详情页。`"
  >
    <template #default>
      <div class="default-content">
        <div class="module-title">商品图</div>
        <ImageUpload
          v-model:imgList="formData.imgList"
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
            { field: 'platform', options: platformOptions },
            { field: 'country', options: countryOptions },
            { field: 'language', options: languageOptions, style: { 'grid-column-start': 'span 2' } },
          ]"
        />

        <div class="module-title">商品卖点&要求</div>
        <PromptAssist v-model:value="formData.prompt" />

        <div class="module-title">视频类型</div>
        <Tab
          v-model:value="tabValue"
          :tabs="[
            { label: '视频类型', value: 0 },
            { label: '自定义脚本', value: 1 },
          ]"
          style="margin-bottom: 12px"
        />
        <CheckboxGroup
          v-model="formData.checked"
          :list="[
            {
              label: 'UGG 种草',
              value: 'ugg',
              desc: '用户视角真实分享体验 /TikTok-Reels高转化',
            },
            {
              label: '带货短剧',
              value: 'short_video_1',
              desc: '卖点框输入：古装、现代、家庭、搞笑',
            },
            {
              label: '产品演示',
              value: 'product_demo',
              desc: '多角度展示+使用演示/通用',
            },
            {
              label: '产品口播',
              value: 'product_talk',
              desc: '面对镜头讲解产品产品卖点/社媒投放首选',
            },
            {
              label: 'TVC广告',
              value: 'tvc_ad',
              desc: '品牌广告片质感/高级产品展示',
            },
            {
              label: '带货短剧',
              value: 'short_video_2',
              desc: '痛点场景-产品解决/功能型产品',
            },
            {
              label: '开箱种草',
              value: 'unboxing',
              desc: '第一视角拆包惊喜体验/新品礼盒类',
            },
            {
              label: '痛点解决',
              value: 'pain_solve',
              desc: '痛点场景 产品解决',
            },
          ]"
          :col="2"
          gap="8px"
          vertical
        />

        <!--        外面的模型只能选自己上传的达人，本地模型不做限制-->
        <div class="module-title">选择模型</div>
        <ManySelect v-model:data="formData" :list="[{ field: 'platform', options: platformOptions }]" :col="1" />

        <div class="module-title">
          定制专属模特
          <n-switch class="switch-pos" v-model:value="switchValue" />
        </div>
        <div class="model-diy-cont" v-show="switchValue">
          <Tab
            v-model:value="tabValue"
            :tabs="[
              { label: '定制达人', value: 0 },
              { label: '上传我的达人', value: 1 },
            ]"
            style="margin-bottom: 12px"
          />
          <div class="model-diy">
            <SelectGroup
              v-model:data="formData"
              :list="[
                { field: 'platform', options: platformOptions },
                { field: 'country', options: countryOptions },
                { field: 'language', options: languageOptions },
                { field: 'language', options: languageOptions },
              ]"
            />
            <div class="textarea-area">
              <div class="title">外貌细节补充</div>
              <Textarea v-model:value="formData.prompt" placeholder="例如：白皙肤色、长头发、微笑唇等" />
            </div>
            <div class="generate-btn">
              <i class="icon-ic_ds_ljsc"></i>
              <span>生成我的达人</span>
            </div>
          </div>

          <div></div>
        </div>
      </div>
    </template>
    <template #sample>
      <div class="sample-cont"></div>
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
          &:hover {
            background: #ebecef;
          }
        }
      }
    }
  }

  .sample-cont {
  }
}
</style>
