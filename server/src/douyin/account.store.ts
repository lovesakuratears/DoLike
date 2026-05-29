import type { DouyinAccount } from '@prisma/client'
import { getPrisma } from '../core/db.js'
import { generatePushToken } from '../core/crypto.js'
import type { CookieSource, DouyinAccountDTO } from './types.js'

export function toDTO(a: DouyinAccount): DouyinAccountDTO {
  return {
    id: a.id,
    secUid: a.secUid,
    nickname: a.nickname,
    avatarUrl: a.avatarUrl,
    cookieSource: a.cookieSource as CookieSource,
    isValid: a.isValid,
    lastCheckAt: a.lastCheckAt ? a.lastCheckAt.toISOString() : null,
    createdAt: a.createdAt.toISOString()
  }
}

export async function listAccounts(localUserId: number): Promise<DouyinAccount[]> {
  const prisma = getPrisma()
  return prisma.douyinAccount.findMany({
    where: { localUserId },
    orderBy: { createdAt: 'asc' }
  })
}

export async function findPrimaryAccountByLocalUserId(localUserId: number): Promise<DouyinAccount | null> {
  const prisma = getPrisma()
  return prisma.douyinAccount.findFirst({
    where: { localUserId },
    orderBy: { createdAt: 'asc' }
  })
}

export async function findById(localUserId: number, id: number): Promise<DouyinAccount | null> {
  const prisma = getPrisma()
  const a = await prisma.douyinAccount.findUnique({ where: { id } })
  if (!a || a.localUserId !== localUserId) return null
  return a
}

export async function findBySecUid(secUid: string): Promise<DouyinAccount | null> {
  const prisma = getPrisma()
  return prisma.douyinAccount.findUnique({ where: { secUid } })
}

export async function findByPushToken(token: string): Promise<DouyinAccount | null> {
  const prisma = getPrisma()
  return prisma.douyinAccount.findUnique({ where: { pushToken: token } })
}

export interface UpsertInput {
  localUserId: number
  secUid: string
  nickname: string
  avatarUrl?: string | null
  cookieEnc?: string | null
  cookieSource: CookieSource
  isValid: boolean
}

export async function upsertAccount(input: UpsertInput): Promise<DouyinAccount> {
  const prisma = getPrisma()
  const existing = await prisma.douyinAccount.findUnique({ where: { secUid: input.secUid } })
  if (existing && existing.localUserId !== input.localUserId) {
    // 同一抖音账号已被另一本地用户绑定，禁止串号
    throw new Error('该抖音账号已被其他本地用户绑定')
  }
  if (existing) {
    return prisma.douyinAccount.update({
      where: { id: existing.id },
      data: {
        nickname: input.nickname,
        avatarUrl: input.avatarUrl ?? existing.avatarUrl,
        cookieEnc: input.cookieEnc ?? existing.cookieEnc,
        cookieSource: input.cookieSource,
        isValid: input.isValid,
        lastCheckAt: input.isValid ? new Date() : existing.lastCheckAt
      }
    })
  }
  return prisma.douyinAccount.create({
    data: {
      localUserId: input.localUserId,
      secUid: input.secUid,
      nickname: input.nickname,
      avatarUrl: input.avatarUrl ?? null,
      cookieEnc: input.cookieEnc ?? null,
      cookieSource: input.cookieSource,
      isValid: input.isValid,
      lastCheckAt: input.isValid ? new Date() : null
    }
  })
}

export async function markValidity(id: number, isValid: boolean): Promise<void> {
  const prisma = getPrisma()
  await prisma.douyinAccount.update({
    where: { id },
    data: { isValid, lastCheckAt: new Date() }
  })
}

export async function deleteAccount(localUserId: number, id: number): Promise<void> {
  const prisma = getPrisma()
  const a = await prisma.douyinAccount.findUnique({ where: { id } })
  if (!a || a.localUserId !== localUserId) return
  await prisma.douyinAccount.delete({ where: { id } })
}

export async function issuePushToken(accountId: number): Promise<string> {
  const prisma = getPrisma()
  const token = generatePushToken()
  await prisma.douyinAccount.update({ where: { id: accountId }, data: { pushToken: token } })
  return token
}

export async function revokePushToken(accountId: number): Promise<void> {
  const prisma = getPrisma()
  await prisma.douyinAccount.update({ where: { id: accountId }, data: { pushToken: null } })
}
