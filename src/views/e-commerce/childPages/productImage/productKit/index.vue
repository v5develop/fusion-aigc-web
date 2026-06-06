<script setup lang="ts">
import { provide, reactive, ref, watch } from 'vue'
import Container from '../../components/Container/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import SelectContent from '../../components/SelectContent/index.vue'
import PromptAssist from '../../components/PromptAssist/index.vue'
import Checkbox from '../../components/Checkbox/index.vue'
import Sample from '../../components/Sample/index.vue'
import RecordList from '@/views/asset/components/RecordList/index.vue'

const formData = reactive({
  imgList: ref([]),
  platform: ref(0),
  country: ref(0),
  language: ref(0),
  ratio: ref(0),
  prompt: ref(''),
  checked1: ref(false),
  checked2: ref(false),
  checked3: ref(false),
  checked4: ref(false),
})

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
provide('recordsData', records)
</script>

<template>
  <Container class="commerce" title="商品套图">
    <template #default>
      <div class="default-content">
        <div class="module-title">商品图</div>
        <ImageUpload
          v-model:imgList="formData.imgList"
          :limitNumber="3"
          :exampleImages="[
            'https://i.pixiv.re/c/540x540_70/img-master/img/2023/09/04/13/00/01/111437433_p0_master1200.jpg',
          ]"
          multiple
          bottomTips
        />

        <div class="module-title">生成设置</div>
        <SelectContent
          v-model:platform="formData.platform"
          v-model:country="formData.country"
          v-model:language="formData.language"
          v-model:ratio="formData.ratio"
        />

        <div class="module-title">商品卖点&要求</div>
        <PromptAssist
          v-model:value="formData.prompt"
          placeholder="请输入商品信息包括:商品名称、商品描述、商品尺寸、目标受众、商品卖点。您也可以在上传多视角商品图后点击【A帮写】一键分析"
        />

        <div class="module-title">套图结构配置</div>
        <div class="checkbox-cont">
          <Checkbox
            class="item"
            v-model:checked="formData.checked1"
            title="智能匹配"
            desc="AI智能分析商品图，匹配最佳的套图"
          />
          <Checkbox
            class="item"
            v-model:checked="formData.checked2"
            title="自定义配置"
            desc="可自由调整图片数量，至少选择7张"
          />
        </div>
      </div>
    </template>

    <template #rightContent>
      <Sample
        v-if="!records.length"
        title="AI商品套图"
        :rightDesc="`上传商品图，Al 即刻生成符合 <span style='color: #8e66f9'>多电商平台规范</span> 的高转化率商品套图。`"
      />

      <div v-else>
        <div class="right-content-title">生成结果</div>
        <RecordList :showSelect="false" />
      </div>
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
      flex-direction: column;
      gap: 12px;
    }
  }
}
</style>
