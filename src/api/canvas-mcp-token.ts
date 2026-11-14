/**
 * 画布 MCP 访问令牌（Go 网关 /api/v1/canvas/mcp-tokens，fusion_aigc_go docs/design/canvas-agent-tools.md §13）。
 *
 * <p>外部 MCP 客户端（Claude Desktop / Cursor …）专用的长期令牌：明文只在创建时返回一次（服务端只存哈希），
 * 每人最多 10 个生效中的令牌，可吊销（即时生效）。管理接口只认登录令牌。
 */
import { del, get, post } from './index.ts'

const PREFIX = '/api/v1/canvas/mcp-tokens'

/** 权限范围：画布读写 / 画布读写 + 生成（会冻结点数） */
export type McpTokenScope = 'canvas_rw' | 'canvas_rw_generate'

export const MCP_TOKEN_TTL_DAYS = [7, 30, 90] as const
export type McpTokenTtlDays = (typeof MCP_TOKEN_TTL_DAYS)[number]

export interface IMcpToken {
  id: string
  name: string
  /** 明文前 12 位（mcp_xxxxxxxx），便于识别 */
  tokenPrefix: string
  scope: McpTokenScope
  expiresAt: number
  /** 0 = 从未使用 */
  lastUsedAt: number
  lastUsedIp: string
  createdAt: number
  expired: boolean
}

export interface IMcpTokenList {
  tokens: IMcpToken[]
  activeCount: number
  maxActive: number
  /** MCP 入口路径（/api/v1/canvas/mcp） */
  mcpPath: string
}

export interface IMcpTokenCreated {
  token: IMcpToken
  /** 明文，只此一次 */
  plainToken: string
  mcpPath: string
}

export function mcpTokenList() {
  return get<IMcpTokenList>(PREFIX)
}

export function mcpTokenCreate(data: { name: string; expiresInDays: McpTokenTtlDays; scope: McpTokenScope }) {
  return post<IMcpTokenCreated>(PREFIX, data)
}

export function mcpTokenRevoke(id: string) {
  return del(`${PREFIX}/${encodeURIComponent(id)}`)
}

/** MCP 入口的绝对地址（客户端配置里的 url）：接口基址为相对路径或未配置时取当前站点 */
export function mcpEndpointUrl(path = '/api/v1/canvas/mcp'): string {
  // 与 axios 实例同口径：baseURL + 路径（不用 new URL(path, base)，那样会丢掉基址里的路径前缀）
  const base = (import.meta.env.VITE_FUSION_API_BASE || '').replace(/\/+$/, '')
  return /^https?:\/\//.test(base) ? base + path : window.location.origin + base + path
}

/** MCP 客户端配置示例（Streamable HTTP + Authorization 头） */
export function mcpClientConfig(token: string, url = mcpEndpointUrl()): string {
  return JSON.stringify(
    {
      mcpServers: {
        'fusion-canvas': {
          type: 'http',
          url,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  )
}
