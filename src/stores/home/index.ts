import { ref } from 'vue'
import { defineStore } from 'pinia'

export const useHomeStore = defineStore('counter', () => {
  const data = {
    home: false, // true：图片和视频初始化读取这里的参数，false：不读
    picture: {
      entryCode: 'textToImage',
      prompt: '',
      ratio: '1024,1024',
      images: [],
    },
    video: {
      entryCode: 'textToVideo',
      modelCode: 'local-video',
      prompt: '',
      ratio: '720,1280',
      resolution: '720p',
      duration: 4,
      images: [],
    },
    ecommerce: {
      images: [],
      prompt: '',
    },
  }
  const global_formData = ref(data)

  const reset = () => {
    global_formData.value = data
  }

  return { global_formData, reset }
})
