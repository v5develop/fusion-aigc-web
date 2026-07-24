import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { PromptSlot } from '@/views/home/ChatInputBox/types'

interface FileItem {
  url: string
  thumbnail?: string
  name?: string
}

interface FormData {
  home: boolean
  picture: {
    entryCode: string
    modelCode: string
    prompt: string
    ratio: string
    num: number
    images: FileItem[]
  }
  video: {
    entryCode: string
    modelCode: string
    prompt: string
    ratio: string
    resolution: string
    duration: number
    images: FileItem[]
    video: FileItem[]
  }
  ecommerce: {
    images: FileItem[]
    prompt: string
    slots: PromptSlot[]
    templateCode: string
    params: Record<string, any>
  }
}

export const useHomeStore = defineStore('counter', () => {
  const data: FormData = {
    home: false,
    picture: {
      entryCode: 'textToImage',
      modelCode: 'xiaoqi-image-1.0-flash',
      prompt: '',
      ratio: '1024,1024',
      num: 1,
      images: [],
    },
    video: {
      entryCode: 'textToVideo',
      modelCode: 'xiaoqi-video-1.0-lite',
      prompt: '',
      ratio: '720,1280',
      resolution: '720p',
      duration: 4,
      images: [],
      video: [],
    },
    ecommerce: {
      images: [],
      prompt: '',
      slots: [],
      templateCode: '',
      params: {},
    },
  }
  const global_formData = ref(data)

  const reset = () => {
    global_formData.value = data
  }

  return { global_formData, reset }
})
