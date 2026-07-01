import { ref } from 'vue'
import { defineStore } from 'pinia'
import { getUserInfo } from '@/api/methods.ts'

interface IUserInfo {
  availablePoints: number // 可用点数（不含冻结）
  avatar: string
}

export const useUserInfoStore = defineStore('useUserInfoStore', () => {
  const userInfo = ref<IUserInfo>()

  const fetchUserInfo = () => {
    if (userInfo.value) return

    getUserInfo().then((res) => {
      if (res.code === 0) {
        const data = res.data

        userInfo.value = {
          availablePoints: data.availablePoints, // 可用点数（不含冻结）
          avatar: data.avatar,
        }
      }
    }).catch(() => {})
  }
  fetchUserInfo()

  const updateUserInfo = () => {
    getUserInfo().then((res) => {
      if (res.code === 0) {
        const data = res.data

        userInfo.value = {
          availablePoints: data.availablePoints,
          avatar: data.avatar,
        }
      }
    }).catch(() => {})
  }

  return { userInfo, updateUserInfo }
})
