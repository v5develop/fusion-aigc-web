import { execSync } from 'node:child_process'
import type { Plugin } from 'vite'

/**
 * 「新版本提示」的构建侧：每次构建生成一个 build id，一份塞进客户端（`__APP_BUILD_ID__`），
 * 一份写到站点根的 `version.json`。运行时 useAppVersion 拉 version.json，id 不同 = 服务器上已是新版。
 *
 * - dev（serve）不写文件、id 固定为 'dev'，运行时也不轮询；
 * - 可用环境变量 BUILD_ID 指定（CI 想用流水线号时）；否则 `<git 短哈希>-<时间戳>`，
 *   同一提交重复构建也会得到不同 id（时间戳），不会漏提示 / 也不会把「没变」当成新版——
 *   因为 id 只在构建时生成一次，同一份产物里页面与 version.json 必然一致。
 */
function resolveBuildId(): string {
  if (process.env.BUILD_ID) return process.env.BUILD_ID
  let sha = 'nogit'
  try {
    sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    // 不在 git 仓库里（源码包构建）：只用时间戳
  }
  return `${sha}-${Date.now().toString(36)}`
}

export function versionPlugin(): Plugin {
  let buildId = 'dev'
  let isBuild = false
  return {
    name: 'xq-version',
    config(_, { command }) {
      isBuild = command === 'build'
      buildId = isBuild ? resolveBuildId() : 'dev'
      return { define: { __APP_BUILD_ID__: JSON.stringify(buildId) } }
    },
    generateBundle() {
      if (!isBuild) return
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ buildId, builtAt: new Date().toISOString() }),
      })
    },
  }
}
