import { post, get } from './index.ts'
import * as types from './types'

export function getSts(data: types.IGetSts) {
  const { subDir = 'uploads', visibility = 'public', ...rest } = data
  return post('/api/v1/storage/direct/sts', {
    subDir,
    visibility,
    ...rest,
  })
}

export function uploadConfirm(data: { objectKey: string }) {
  return post('/api/v1/storage/direct/confirm', data)
}

export function login(data: { username: string; password: string }) {
  return post('/api/v1/auth/login', data)
}

export function ecommerceSubmit(data: any) {
  return post('/api/v1/creation/ecommerce/submit', data)
}

export function pollingTask(sessionId: string) {
  return get(`/api/v1/creation/session/${sessionId}`)
}

export function pollingSingleTask(taskId: string) {
  return get(`/api/v1/creation/query/${taskId}`)
}

export function assetAll(params: types.IAssetAll) {
  return get('/api/v1/asset/all', params)
}

export function faceRecognition(data: types.IFaceRecognition) {
  return post('/api/v1/creation/face-recognition/submit', data)
}

export function faceRecognitionStatusQuery(taskId: string) {
  return get(`/api/v1/creation/faceRecognition/${taskId}`)
}
