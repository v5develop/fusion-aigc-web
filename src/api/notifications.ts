/**
 * 站内通知接口（Java NotificationController，/api/v1/notifications/*）。
 *
 * <p>未读数按配置封顶，只用来显示角标，不要和分页 total 做加减。
 */
import { get, patch } from './index.ts'

export interface INotification {
  id: number
  title: string
  content: string
  /** SYSTEM / ACTIVITY / MAINTENANCE */
  notificationType: string
  /** ALL = 全体公告，USER = 定向通知 */
  targetScope: string
  /** yyyy-MM-dd HH:mm:ss */
  publishTime: string
  expireTime: string | null
  read: boolean
  readTime: string | null
  /** 可选站内跳转（如 /local-life/video-replicate?job=xxx）；旧后端没有 */
  link?: string | null
  bizType?: string | null
  bizId?: string | number | null
}

export interface INotificationList {
  page: { list: INotification[]; total: number }
  unreadCount: number
}

export interface INotificationQuery {
  page: number
  /** 上限 100 */
  pageSize: number
  notificationType?: string
  onlyUnread?: boolean
}

export function notificationList(params: INotificationQuery) {
  return get<INotificationList>('/api/v1/notifications', params)
}

export function notificationUnreadCount() {
  return get<number>('/api/v1/notifications/unread-count')
}

/** 标记已读（幂等）；必须显式传 id，空数组不代表全部。返回实际生效条数 */
export function notificationMarkRead(notificationIds: number[]) {
  return patch<number>('/api/v1/notifications/read-status', { notificationIds })
}
