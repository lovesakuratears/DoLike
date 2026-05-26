import argon2 from 'argon2'
import { z } from 'zod'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getPrisma } from '../core/db.js'
import { generateSessionToken } from '../core/crypto.js'
import { setUserKeyFromPassword, clearUserKey } from '../core/keystore.js'
import { AppError, ERR } from '../core/errors.js'
import type { LocalUser, LocalSession } from '@prisma/client'

export const SESSION_COOKIE = 'dolike_session'
const SESSION_TTL_DAYS_REMEMBER = 30
const SESSION_TTL_DAYS_DEFAULT = 7

export const usernameSchema = z
  .string()
  .min(3, '用户名至少 3 个字符')
  .max(20, '用户名最多 20 个字符')
  .regex(/^[A-Za-z0-9_]+$/, '用户名仅支持字母、数字、下划线')

export const passwordSchema = z.string().min(8, '密码至少 8 个字符').max(128, '密码最多 128 个字符')

export const setupSchema = z.object({
  username: usernameSchema,
  password: passwordSchema
})

export const loginSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  remember: z.boolean().optional().default(false)
})

export const changePasswordSchema = z.object({
  oldPassword: passwordSchema,
  newPassword: passwordSchema
})

export type SetupInput = z.infer<typeof setupSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>

function ttlMs(remember: boolean): number {
  const days = remember ? SESSION_TTL_DAYS_REMEMBER : SESSION_TTL_DAYS_DEFAULT
  return days * 24 * 60 * 60 * 1000
}

async function hashPassword(pw: string): Promise<string> {
  return argon2.hash(pw, { type: argon2.argon2id })
}

async function verifyPassword(hash: string, pw: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, pw)
  } catch {
    return false
  }
}

export async function isSetup(): Promise<boolean> {
  const prisma = getPrisma()
  const c = await prisma.localUser.count()
  return c > 0
}

export async function setup(input: SetupInput): Promise<{ user: LocalUser; session: LocalSession }> {
  if (await isSetup()) {
    throw new AppError(ERR.AUTH_ALREADY_SETUP, '已存在本地账号，请使用登录入口', 409)
  }
  const prisma = getPrisma()
  const passwordHash = await hashPassword(input.password)
  const user = await prisma.localUser.create({
    data: {
      username: input.username,
      passwordHash,
      setting: {
        create: {
          archiveRoot: join(homedir(), '.dolike-archive')
        }
      }
    }
  })
  const session = await issueSession(user.id, true)
  setUserKeyFromPassword(user.id, input.password)
  return { user, session }
}

export async function login(input: LoginInput): Promise<{ user: LocalUser; session: LocalSession }> {
  const prisma = getPrisma()
  const user = await prisma.localUser.findUnique({ where: { username: input.username } })
  if (!user) {
    throw new AppError(ERR.AUTH_INVALID_CREDENTIALS, '用户名或密码错误', 401)
  }
  const okPw = await verifyPassword(user.passwordHash, input.password)
  if (!okPw) {
    throw new AppError(ERR.AUTH_INVALID_CREDENTIALS, '用户名或密码错误', 401)
  }
  const session = await issueSession(user.id, input.remember)
  setUserKeyFromPassword(user.id, input.password)
  return { user, session }
}

export async function logout(token: string): Promise<void> {
  const prisma = getPrisma()
  const sess = await prisma.localSession.findUnique({ where: { token } })
  await prisma.localSession.deleteMany({ where: { token } })
  if (sess) {
    // 检查该 user 是否还有其它有效 session；没有则清空内存中的 key
    const remaining = await prisma.localSession.count({
      where: { userId: sess.userId, expiresAt: { gt: new Date() } }
    })
    if (remaining === 0) clearUserKey(sess.userId)
  }
}

export async function changePassword(userId: number, input: ChangePasswordInput): Promise<void> {
  const prisma = getPrisma()
  const user = await prisma.localUser.findUnique({ where: { id: userId } })
  if (!user) throw new AppError(ERR.AUTH_NOT_LOGGED_IN, '未登录', 401)
  if (!(await verifyPassword(user.passwordHash, input.oldPassword))) {
    throw new AppError(ERR.AUTH_OLD_PASSWORD_WRONG, '原密码错误', 400)
  }
  const newHash = await hashPassword(input.newPassword)
  await prisma.$transaction([
    prisma.localUser.update({ where: { id: userId }, data: { passwordHash: newHash } }),
    // 改密后吊销所有 session，强制重登
    prisma.localSession.deleteMany({ where: { userId } })
  ])
  // 改密后：旧密码派生的 key 已无法解出新存量 cookie。
  // M1.3.x 会在这里加：用 oldKey 解所有 DouyinAccount.cookieEnc → 用 newKey 重新加密 → 写回。
  // 当前 cookie 还很少（M1.3 骨架），先简单清空 key，强制用户重新登录后用新密码派生 key；
  // 历史 cookie 会变成"无法解密"，下次校验时被标 invalid，提示用户重新粘贴/扫码。
  clearUserKey(userId)
  setUserKeyFromPassword(userId, input.newPassword)
}

export async function issueSession(userId: number, remember: boolean): Promise<LocalSession> {
  const prisma = getPrisma()
  const token = generateSessionToken()
  const expiresAt = new Date(Date.now() + ttlMs(remember))
  return prisma.localSession.create({ data: { token, userId, expiresAt } })
}

export async function resolveSession(token: string | undefined | null): Promise<LocalUser | null> {
  if (!token) return null
  const prisma = getPrisma()
  const session = await prisma.localSession.findUnique({
    where: { token },
    include: { user: true }
  })
  if (!session) return null
  if (session.expiresAt < new Date()) {
    await prisma.localSession.delete({ where: { token } }).catch(() => {})
    return null
  }
  return session.user
}

export async function purgeExpiredSessions(): Promise<number> {
  const prisma = getPrisma()
  const r = await prisma.localSession.deleteMany({
    where: { expiresAt: { lt: new Date() } }
  })
  return r.count
}
