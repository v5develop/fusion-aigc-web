<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import Container from '../../components/Container/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import PromptAssist from '../../components/PromptAssist/index.vue'
import ManySelect from '@/components/SelectGroup/index.vue'
import { countryOptions, languageOptions, platformOptions } from '@/views/e-commerce/childPages/constants.ts'
import Tab from '@/components/Tab/index.vue'
import Textarea from '@/components/Textarea/index.vue'

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
    title="复刻视频"
    rightTitle="复刻视频"
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

        <div class="module-title">参考视频</div>
        <ImageUpload v-model:imgList="formData.imgList" :limitNumber="3" btnName="上传参考视频" multiple>
          <span style="color: #9e9e9e; margin-top: 15px">视频过长时，将自动压缩至15秒，确保最佳效果。</span>
        </ImageUpload>

        <div class="module-title">目标市场与语言</div>
        <ManySelect
          v-model:data="formData"
          :list="[
            { field: 'platform', options: platformOptions },
            { field: 'country', options: countryOptions },
            { field: 'language', options: languageOptions, style: { 'grid-column-start': 'span 2' } },
          ]"
        />

        <div class="module-title">商品卖点&要求</div>
        <PromptAssist v-model:value="formData.prompt" />

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
            <ManySelect
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
