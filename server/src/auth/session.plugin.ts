import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import fp from 'fastify-plugin'
import type { LocalUser } from '@prisma/client'
import { resolveSession, SESSION_COOKIE } from './auth.service.js'
import { AppError, ERR, fail } from '../core/errors.js'

declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: LocalUser
  }
}

/**
 * 注入 currentUser 到 request；不强制要求登录。
 * 路由层用 requireAuth() 守卫显式要求登录。
 *
 * 用 onRequest 而非 preHandler：/media/* 的 fastify-static 走 onRequest 鉴权，
 * 必须在它跑之前先 resolve session（lifecycle: onRequest → preParsing → ... → preHandler → handler）。
 */
async function sessionPlugin(app: FastifyInstance) {
  app.addHook('onRequest', async (req: FastifyRequest) => {
    const token = req.cookies[SESSION_COOKIE]
    const user = await resolveSession(token)
    if (user) req.currentUser = user
  })
}

export default fp(sessionPlugin, { name: 'session' })

export function requireAuth(req: FastifyRequest, reply: FastifyReply): LocalUser {
  if (!req.currentUser) {
    reply.status(401).send(fail(ERR.AUTH_NOT_LOGGED_IN, '请先登录'))
    throw new AppError(ERR.AUTH_NOT_LOGGED_IN, '请先登录', 401)
  }
  return req.currentUser
}
