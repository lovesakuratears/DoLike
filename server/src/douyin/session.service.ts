// 抖音账号会话层 —— 三种 driver 的统一接入点。
// 提供：
// - validate(account)        通过 /user/profile/self/ 校验 cookie，更新 isValid + lastCheckAt
// - getDecryptedCookie       给 fetcher / 下载器使用
// - bindFromCookie           把任意来源的 cookie 字符串绑定为账号（用于 manual / cloak / bridge）

import { AppError, ERR } from '../core/errors.js'
import type { DouyinAccount } from '@prisma/client'
import { getPrisma } from '../core/db.js'
import { encryptCookieFor, decryptCookieFor } from './cookie-codec.js'
import { parseCookieString } from './cookie-parse.js'
import { getProfileSelf, type ProfileSelfRaw } from './dy-client.js'
import {
  findByPushToken,
  findPrimaryAccountByLocalUserId,
  listAccounts,
  markValidity,
  toDTO,
  upsertAccount
} from './account.store.js'
import type { CookieSource, DouyinAccountDTO, ProfileSelfMin } from './types.js'
import { getLogger } from '../core/logger.js'

export async function listAccountDTOs(localUserId: number): Promise<DouyinAccountDTO[]> {
  const xs = await listAccounts(localUserId)
  return xs.map(toDTO)
}

export function getDecryptedCookie(localUserId: number, account: DouyinAccount): string | null {
  if (!account.cookieEnc) return null
  return decryptCookieFor(localUserId, account.cookieEnc)
}

export async function validate(localUserId: number, account: DouyinAccount): Promise<boolean> {
  const cookie = getDecryptedCookie(localUserId, account)
  if (!cookie) {
    await markValidity(account.id, false)
    return false
  }
  // ★ 插件推送的 cookie：首次绑定跳过严格 API 校验
  // chrome.cookies 可能拿不全 HttpOnly 字段导致第一轮 API 调用失败，
  // 但用户已确认 cookie 在浏览器里能用。首次绑定信任浏览器状态。
  // 后续手动「校验 cookie」时再做真实 API 检测，避免过期 cookie 永久标记为有效。
  if (account.cookieSource === 'bridge') {
    // 首次绑定（lastCheckAt == null）：跳过 API 校验，信任浏览器 cookie
    if (!account.lastCheckAt) {
      getLogger().info({ accountId: account.id }, '[DoList] validate: first bind for bridge cookie, trusting browser state')
      await markValidity(account.id, true)
      return true
    }
    // 后续校验：实际走 API。如果 cookie 过期了，标记为无效让用户重新推送。
    getLogger().info({ accountId: account.id }, '[DoList] validate: re-checking bridge cookie via API')
    const r = await getProfileSelf(cookie)
    const ok = r.ok && !!r.data?.user?.sec_uid
    await markValidity(account.id, ok)
    return ok
  }
  const r = await getProfileSelf(cookie)
  const ok = r.ok && !!r.data?.user?.sec_uid
  await markValidity(account.id, ok)
  return ok
}

export async function probeProfile(cookie: string): Promise<ProfileSelfMin> {
  const parsed = parseCookieString(cookie)
  // ★ 宽松校验：至少需要 sessionid（登录态核心字段）
  // 允许 ttwid/passport_csrf_token 作为辅助兜底——chrome.cookies 在特定 MV3 配置
  // 下可能拿不到 HttpOnly 的 sessionid，但 ttwid（非 HttpOnly）总可以拿到。
  // 如果只有 ttwid 没有 sessionid，大概率 cookie 不完整，给出具体的行动指引。
  const hasSession = parsed.map.sessionid
  const hasTracking = parsed.map.ttwid
  if (!hasSession && !hasTracking) {
    throw new AppError(
      ERR.DOUYIN_COOKIE_INCOMPLETE,
      `cookie 缺少关键字段（sessionid/ttwid），请确认已在抖音页面登录后重新推送`,
      400
    )
  }
  const r = await getProfileSelf(cookie)
  // ★ 诊断日志：打印抖音 API 返回的关键字段
  const { getLogger } = await import('../core/logger.js')
  const logger = getLogger().child({ mod: 'cookie-probe' })

  if (!hasSession && hasTracking) {
    logger.warn({ cookieKeys: Object.keys(parsed.map) }, 'probeProfile: only ttwid found, no sessionid — cookie likely incomplete')
  }
  logger.info({
    ok: r.ok,
    status: r.status,
    hasUserData: !!r.data?.user,
    secUid: r.data?.user?.sec_uid || '(empty)',
    statusCode: r.data?.status_code,
    cookieKeys: Object.keys(parsed.map),
    cookieSnip: cookie.slice(0, 80) + '...'
  }, 'probeProfile: getProfileSelf result')
  // ★ 宽松校验：即使 API 返回失败，只要 cookie 有关键字段就尝试提取
  // 抖音可能因为签名问题返回 status_code=8，但 cookie 本身是有效的
  if (!r.ok || !r.data?.user?.sec_uid) {
    // 尝试从 cookie 中提取 sec_uid
    // ⚠️ 仅用 parsed.map.sec_uid —— 绝对不能用 sessionid/ttwid 冒充 sec_uid！
    // sessionid 是会话标识（形如 abc123...），而 sec_uid 是固定用户标识（形如 MS4wLjABAAAA...）
    const secUidFromCookie = parsed.map.sec_uid || ''
    const SEC_UID_PATTERN = /^[A-Za-z0-9_-]{30,}$/
    if (secUidFromCookie && SEC_UID_PATTERN.test(secUidFromCookie)) {
      logger.warn({ secUidFromCookie: secUidFromCookie.slice(0, 20) }, 'probeProfile: using sec_uid from cookie fallback')
      return {
        secUid: secUidFromCookie,
        nickname: parsed.map.nickname || '抖音用户',
        avatarUrl: null,
      }
    }
    const errMsg = !r.ok
      ? `HTTP ${r.status}，body=${r.raw.slice(0, 300)}`
      : `status_code=${r.data?.status_code ?? '?'}，sec_uid=${r.data?.user?.sec_uid || 'empty'}，user_keys=${r.data?.user ? Object.keys(r.data.user) : 'none'}，raw=${r.raw.slice(0, 300)}`
    throw new AppError(ERR.DOUYIN_COOKIE_INVALID, `cookie 校验失败：${errMsg}`, 401)
  }
  return extractMin(r.data)
}

export async function bindFromCookie(opts: {
  localUserId: number
  cookie: string
  source: CookieSource
  accountId?: number
  preserveProfile?: boolean
}): Promise<DouyinAccount> {
  const profile = await probeProfile(opts.cookie)
  const enc = encryptCookieFor(opts.localUserId, opts.cookie.trim())
  if (opts.accountId) {
    const prisma = getPrisma()
    const current = await prisma.douyinAccount.findUnique({ where: { id: opts.accountId } })
    if (!current || current.localUserId !== opts.localUserId) {
      throw new AppError(ERR.DOUYIN_ACCOUNT_NOT_FOUND, '抖音账号不存在', 404)
    }
    return prisma.douyinAccount.update({
      where: { id: current.id },
      data: {
        secUid: profile.secUid,
        nickname: opts.preserveProfile ? current.nickname : profile.nickname,
        avatarUrl: opts.preserveProfile ? current.avatarUrl : profile.avatarUrl,
        cookieEnc: enc,
        cookieSource: opts.source,
        isValid: true,
        lastCheckAt: new Date()
      }
    })
  }
  return upsertAccount({
    localUserId: opts.localUserId,
    secUid: profile.secUid,
    nickname: profile.nickname,
    avatarUrl: profile.avatarUrl,
    cookieEnc: enc,
    cookieSource: opts.source,
    isValid: true
  })
}

export async function bindFromBridgeWithoutCookie(opts: {
  accountId: number
  localUserId: number
  profile: ProfileSelfMin
  preserveProfile?: boolean
}): Promise<DouyinAccount> {
  const prisma = getPrisma()
  const tokenOwner = await prisma.douyinAccount.findUnique({ where: { id: opts.accountId } })
  if (!tokenOwner || tokenOwner.localUserId !== opts.localUserId) {
    throw new AppError(ERR.DOUYIN_ACCOUNT_NOT_FOUND, '桥接账号不存在', 404)
  }

  const existing = await prisma.douyinAccount.findUnique({ where: { secUid: opts.profile.secUid } })
  if (existing && existing.localUserId !== opts.localUserId) {
    throw new AppError(ERR.VALIDATION_FAILED, '该抖音账号已被其他本地用户绑定', 409)
  }

  if (existing && existing.id !== tokenOwner.id) {
    const transferred = await prisma.$transaction(async tx => {
      const updated = await tx.douyinAccount.update({
        where: { id: existing.id },
        data: {
          nickname: opts.preserveProfile ? existing.nickname : opts.profile.nickname,
          avatarUrl: opts.preserveProfile ? existing.avatarUrl : opts.profile.avatarUrl,
          cookieSource: 'bridge',
          isValid: true,
          lastCheckAt: new Date(),
          pushToken: tokenOwner.pushToken ?? existing.pushToken
        }
      })
      await tx.douyinAccount.delete({ where: { id: tokenOwner.id } })
      return updated
    })
    return transferred
  }

  return prisma.douyinAccount.update({
    where: { id: tokenOwner.id },
    data: {
      secUid: opts.profile.secUid,
      nickname: opts.preserveProfile ? tokenOwner.nickname : opts.profile.nickname,
      avatarUrl: opts.preserveProfile ? tokenOwner.avatarUrl : opts.profile.avatarUrl,
      cookieSource: 'bridge',
      isValid: true,
      lastCheckAt: new Date()
    }
  })
}

export async function resolveSingleUserAccount(localUserId: number, preferredAccountId?: number): Promise<DouyinAccount | null> {
  if (preferredAccountId) {
    const prisma = getPrisma()
    const current = await prisma.douyinAccount.findUnique({ where: { id: preferredAccountId } })
    if (current && current.localUserId === localUserId) return current
  }
  return findPrimaryAccountByLocalUserId(localUserId)
}

function extractMin(raw: ProfileSelfRaw): ProfileSelfMin {
  const u = raw.user!
  const avatar =
    u.avatar_300x300?.url_list?.[0] ?? u.avatar_thumb?.url_list?.[0] ?? null
  return {
    secUid: u.sec_uid!,
    nickname: u.nickname || '抖音用户',
    avatarUrl: avatar
  }
}

export { findByPushToken }
