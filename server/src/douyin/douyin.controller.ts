import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../auth/session.plugin.js'
import { ok, fail, AppError, ERR } from '../core/errors.js'
import * as accountStore from './account.store.js'
import * as session from './session.service.js'
import { pasteCookie } from './manual.driver.js'
import { startCloakSession, getSession, cancelSession } from './cloak.driver.js'
import { preIssueToken, revokeToken } from './bridge.service.js'
import { getPrisma } from '../core/db.js'

const idParam = z.object({ id: z.coerce.number().int().positive() })

const manualSchema = z.object({
  cookie: z.string().min(20)
})

function handleZod(reply: FastifyReply, err: unknown): boolean {
  if (err instanceof z.ZodError) {
    const msg = err.errors[0]?.message ?? '参数错误'
    reply.status(400).send(fail(ERR.VALIDATION_FAILED, msg))
    return true
  }
  return false
}

function handleApp(reply: FastifyReply, err: unknown): boolean {
  if (err instanceof AppError) {
    reply.status(err.httpStatus).send(fail(err.code, err.message))
    return true
  }
  return false
}

export default async function douyinRoutes(app: FastifyInstance) {
  // 列表
  app.get('/api/douyin/accounts', async (req, reply) => {
    const user = requireAuth(req, reply)
    const list = await session.listAccountDTOs(user.id)
    return ok(list)
  })

  // 手动粘贴 cookie
  app.post('/api/douyin/accounts/manual', async (req, reply) => {
    try {
      const user = requireAuth(req, reply)
      const { cookie } = manualSchema.parse(req.body)
      const dto = await pasteCookie(user.id, cookie)
      return ok(dto)
    } catch (err) {
      if (handleZod(reply, err)) return
      if (handleApp(reply, err)) return
      throw err
    }
  })

  // ★ Cookie 校验 —— 测试 cookie 是否有效（不绑定账号，仅探测）
  // 标记: COOKIE_VALIDATE_ENDPOINT
  app.post('/api/douyin/accounts/cookie-validate', async (req, reply) => {
    try {
      const user = requireAuth(req, reply)
      const { cookie } = manualSchema.parse(req.body)
      const profile = await session.probeProfile(cookie)
      return ok({
        valid: true,
        secUid: profile.secUid,
        nickname: profile.nickname,
        avatarUrl: profile.avatarUrl
      })
    } catch (err) {
      if (handleZod(reply, err)) return
      if (handleApp(reply, err)) return
      throw err
    }
  })

  // ★ 查询账号归档模式 —— 根据已有 content 数量判断全量/增量
  // 标记: ARCHIVE_MODE_ENDPOINT
  app.get('/api/douyin/accounts/:id/archive-mode', async (req, reply) => {
    try {
      const user = requireAuth(req, reply)
      const { id } = idParam.parse(req.params)
      const prisma = getPrisma()
      const acc = await prisma.douyinAccount.findUnique({
        where: { id, localUserId: user.id }
      })
      if (!acc) {
        reply.status(404).send(fail(ERR.DOUYIN_ACCOUNT_NOT_FOUND, '账号不存在'))
        return
      }
      const contentCount = await prisma.content.count({
        where: { douyinAccountId: id }
      })
      // 没有任何内容 → 全量；有内容 → 增量
      const mode = contentCount === 0 ? 'full' : 'incremental'
      return ok({
        accountId: id,
        mode,
        contentCount,
        hasCookie: !!acc.cookieEnc,
        cookieSource: acc.cookieSource
      })
    } catch (err) {
      if (handleApp(reply, err)) return
      throw err
    }
  })

  // CloakBrowser 扫码：开新会话（WS 拿事件）
  app.post('/api/douyin/accounts/cloak/start', async (req, reply) => {
    try {
      const user = requireAuth(req, reply)
      const sess = startCloakSession(user.id)
      return ok({ sessionId: sess.id, wsPath: `/ws/douyin/cloak?session=${sess.id}` })
    } catch (err) {
      if (handleApp(reply, err)) return
      throw err
    }
  })

  // CloakBrowser 取消
  app.post('/api/douyin/accounts/cloak/:id/cancel', async (req, reply) => {
    try {
      requireAuth(req, reply)
      const { id } = z.object({ id: z.string().min(1) }).parse(req.params)
      const okFlag = cancelSession(id)
      return ok({ ok: okFlag })
    } catch (err) {
      if (handleZod(reply, err)) return
      if (handleApp(reply, err)) return
      throw err
    }
  })

  // 浏览器扩展：预签发 push_token
  app.post('/api/douyin/accounts/bridge/issue', async (req, reply) => {
    try {
      const user = requireAuth(req, reply)
      const r = await preIssueToken(user.id)
      return ok(r)
    } catch (err) {
      if (handleApp(reply, err)) return
      throw err
    }
  })

  // 撤销 push_token
  app.post('/api/douyin/accounts/:id/bridge/revoke', async (req, reply) => {
    try {
      const user = requireAuth(req, reply)
      const { id } = idParam.parse(req.params)
      const acc = await accountStore.findById(user.id, id)
      if (!acc) {
        reply.status(404).send(fail(ERR.DOUYIN_ACCOUNT_NOT_FOUND, '账号不存在'))
        return
      }
      await revokeToken(user.id, id)
      return ok({ ok: true })
    } catch (err) {
      if (handleZod(reply, err)) return
      if (handleApp(reply, err)) return
      throw err
    }
  })

  // 校验账号
  app.post('/api/douyin/accounts/:id/refresh', async (req, reply) => {
    try {
      const user = requireAuth(req, reply)
      const { id } = idParam.parse(req.params)
      const acc = await accountStore.findById(user.id, id)
      if (!acc) {
        reply.status(404).send(fail(ERR.DOUYIN_ACCOUNT_NOT_FOUND, '账号不存在'))
        return
      }
      const valid = await session.validate(user.id, acc)
      return ok({ isValid: valid })
    } catch (err) {
      if (handleZod(reply, err)) return
      if (handleApp(reply, err)) return
      throw err
    }
  })

  // 删除
  app.delete('/api/douyin/accounts/:id', async (req, reply) => {
    try {
      const user = requireAuth(req, reply)
      const { id } = idParam.parse(req.params)
      await accountStore.deleteAccount(user.id, id)
      return ok({ ok: true })
    } catch (err) {
      if (handleZod(reply, err)) return
      if (handleApp(reply, err)) return
      throw err
    }
  })
}
