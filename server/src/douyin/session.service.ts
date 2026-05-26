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
  listAccounts,
  markValidity,
  toDTO,
  upsertAccount
} from './account.store.js'
import type { CookieSource, DouyinAccountDTO, ProfileSelfMin } from './types.js'

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
  const r = await getProfileSelf(cookie)
  const ok = r.ok && !!r.data?.user?.sec_uid
  await markValidity(account.id, ok)
  return ok
}

export async function probeProfile(cookie: string): Promise<ProfileSelfMin> {
  const parsed = parseCookieString(cookie)
  if (parsed.missing.length > 0) {
    throw new AppError(
      ERR.DOUYIN_COOKIE_INCOMPLETE,
      `cookie 缺少字段：${parsed.missing.join(', ')}`,
      400
    )
  }
  const r = await getProfileSelf(cookie)
  if (!r.ok || !r.data?.user?.sec_uid) {
    throw new AppError(ERR.DOUYIN_COOKIE_INVALID, 'cookie 校验失败：抖音侧未识别为已登录用户', 401)
  }
  return extractMin(r.data)
}

export async function bindFromCookie(opts: {
  localUserId: number
  cookie: string
  source: CookieSource
}): Promise<DouyinAccount> {
  const profile = await probeProfile(opts.cookie)
  const enc = encryptCookieFor(opts.localUserId, opts.cookie.trim())
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
          nickname: opts.profile.nickname,
          avatarUrl: opts.profile.avatarUrl,
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
      nickname: opts.profile.nickname,
      avatarUrl: opts.profile.avatarUrl,
      cookieSource: 'bridge',
      isValid: true,
      lastCheckAt: new Date()
    }
  })
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
