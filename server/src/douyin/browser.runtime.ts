// 浏览器运行时 —— 统一封装 CloakBrowser launch / launchContext
//
// 设计：
// - 不直接 import playwright-core；通过 Awaited<ReturnType<typeof launchContext>> 派生类型
// - 仅暴露 launchEphemeralContext / closeContext，由上层（cloak.driver / browser.session）持有生命周期
// - 不复用持久化 profile，避免抖音 cookie 明文落盘（与 SKILL §7 红线一致）
// - 启动失败统一抛 AppError(DOUYIN_BROWSER_UNAVAILABLE)，调用方判断后回退方案 C

import { launchContext } from 'cloakbrowser'
import { AppError, ERR } from '../core/errors.js'

// 派生类型：避免直接 import playwright-core
export type RuntimeBrowserContext = Awaited<ReturnType<typeof launchContext>>
export type RuntimePage = Awaited<ReturnType<RuntimeBrowserContext['newPage']>>
export type RuntimeCookie = Awaited<ReturnType<RuntimeBrowserContext['cookies']>>[number]

const DEFAULT_VIEWPORT = { width: 1366, height: 820 }

const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export interface EphemeralLaunchOptions {
  headless?: boolean
  userAgent?: string
  locale?: string
  timezone?: string
}

export async function launchEphemeralContext(
  opts: EphemeralLaunchOptions = {}
): Promise<RuntimeBrowserContext> {
  try {
    const ctx = await launchContext({
      headless: opts.headless ?? true,
      userAgent: opts.userAgent ?? DEFAULT_UA,
      locale: opts.locale ?? 'zh-CN',
      timezone: opts.timezone ?? 'Asia/Shanghai',
      viewport: DEFAULT_VIEWPORT
    })
    return ctx
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new AppError(
      ERR.DOUYIN_BROWSER_UNAVAILABLE,
      `无头浏览器启动失败：${msg}（CloakBrowser 首次启动会自动下载 ~200MB patched Chromium 到 ~/.cloakbrowser/；如果失败请检查到 cdn.cloakbrowser 的网络可达性）`,
      503
    )
  }
}

export async function closeContext(ctx: RuntimeBrowserContext | null | undefined): Promise<void> {
  if (!ctx) return
  try {
    await ctx.close()
  } catch {
    /* 浏览器已意外退出时忽略 */
  }
}

// 抖音 cookie 字符串 → Playwright cookies[] 输入
export interface DyCookieEntry {
  name: string
  value: string
  domain: string
  path: string
}

export function parseCookieToEntries(cookie: string): DyCookieEntry[] {
  const out: DyCookieEntry[] = []
  for (const pair of cookie.split(';')) {
    const [k, ...rest] = pair.split('=')
    const name = k?.trim()
    if (!name) continue
    const value = rest.join('=').trim()
    out.push({ name, value, domain: '.douyin.com', path: '/' })
  }
  return out
}
