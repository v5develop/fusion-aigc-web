import { ref } from 'vue'
import { defineStore } from 'pinia'
import { getUserInfo } from '@/api/methods.ts'

interface IUserInfo {
  availablePoints: number // 可用点数（不含冻结）
  avatar: string
}

export const useUserInfoStore = defineStore('useUserInfoStore', () => {
  const userInfo = ref<IUserInfo>()

  console.log(21111)
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
    })
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
    })
  }

  return { userInfo, updateUserInfo }
})
