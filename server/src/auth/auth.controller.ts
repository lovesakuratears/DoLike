import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import {
  setupSchema,
  loginSchema,
  changePasswordSchema,
  setup,
  login,
  logout,
  changePassword,
  isSetup,
  SESSION_COOKIE
} from './auth.service.js'
import { ok, fail, AppError, ERR } from '../core/errors.js'
import { requireAuth } from './session.plugin.js'
import { hasUserKey } from '../core/keystore.js'

function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: false, // 127.0.0.1 走 http
    expires: expiresAt
  })
}

function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' })
}

function handleZodError(reply: FastifyReply, err: unknown): boolean {
  if (err instanceof z.ZodError) {
    const msg = err.errors[0]?.message ?? '参数错误'
    reply.status(400).send(fail(ERR.VALIDATION_FAILED, msg))
    return true
  }
  return false
}

function handleAppError(reply: FastifyReply, err: unknown): boolean {
  if (err instanceof AppError) {
    reply.status(err.httpStatus).send(fail(err.code, err.message))
    return true
  }
  return false
}

export default async function authRoutes(app: FastifyInstance) {
  // GET /api/auth/status
  app.get('/api/auth/status', async (req) => {
    const setupDone = await isSetup()
    const user = req.currentUser
    // keyReady：session 还有效但 server 进程重启后内存里的 cookie 加密 key 已丢，
    // portal 应据此提示用户重新输入密码（不强制踢登录，避免误伤）。
    return ok({
      hasUser: setupDone,
      loggedIn: !!user,
      keyReady: user ? hasUserKey(user.id) : false,
      user: user ? { id: user.id, username: user.username } : null
    })
  })

  // POST /api/auth/setup
  app.post('/api/auth/setup', async (req, reply) => {
    try {
      const input = setupSchema.parse(req.body)
      const { user, session } = await setup(input)
      setSessionCookie(reply, session.token, session.expiresAt)
      return ok({ id: user.id, username: user.username })
    } catch (err) {
      if (handleZodError(reply, err)) return
      if (handleAppError(reply, err)) return
      throw err
    }
  })

  // POST /api/auth/login
  app.post('/api/auth/login', async (req, reply) => {
    try {
      const input = loginSchema.parse(req.body)
      const { user, session } = await login(input)
      setSessionCookie(reply, session.token, session.expiresAt)
      return ok({ id: user.id, username: user.username })
    } catch (err) {
      if (handleZodError(reply, err)) return
      if (handleAppError(reply, err)) return
      throw err
    }
  })

  // POST /api/auth/logout
  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE]
    if (token) await logout(token)
    clearSessionCookie(reply)
    return ok({ ok: true })
  })

  // POST /api/auth/change-password
  app.post('/api/auth/change-password', async (req, reply) => {
    try {
      const user = requireAuth(req, reply)
      const input = changePasswordSchema.parse(req.body)
      await changePassword(user.id, input)
      clearSessionCookie(reply)
      return ok({ ok: true })
    } catch (err) {
      if (handleZodError(reply, err)) return
      if (handleAppError(reply, err)) return
      throw err
    }
  })
}
