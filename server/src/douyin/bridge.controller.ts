import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { handlePush, handshakeByToken, pushPayloadSchema } from './bridge.service.js'
import { findByPushToken } from './account.store.js'
import { dyGetSigned } from './dy-client.js'
import { getLogger } from '../core/logger.js'
import { ok, fail, AppError, ERR } from '../core/errors.js'

const PUSH_HEADER = 'x-push-token'

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

export default async function bridgeRoutes(app: FastifyInstance) {
  app.get('/api/bridge/handshake', async (req, reply) => {
    try {
      const token = String(req.headers[PUSH_HEADER] || '').trim()
      if (!token.startsWith('pt_')) {
        reply.status(401).send(fail(ERR.DOUYIN_BRIDGE_TOKEN_INVALID, '缺少有效 API Key'))
        return
      }
      const dto = await handshakeByToken(token)
      return ok(dto)
    } catch (err) {
      if (handleApp(reply, err)) return
      throw err
    }
  })

  // 浏览器扩展推送入口 —— 不走 session cookie，靠 X-Push-Token 鉴权
  app.post('/api/bridge/push', async (req, reply) => {
    try {
      const token = String(req.headers[PUSH_HEADER] || '').trim()
      if (!token.startsWith('pt_')) {
        reply.status(401).send(fail(ERR.DOUYIN_BRIDGE_TOKEN_INVALID, '缺少有效推送 token'))
        return
      }
      const payload = pushPayloadSchema.parse(req.body)
      const dto = await handlePush(token, payload)
      return ok(dto)
    } catch (err) {
      if (handleZod(reply, err)) return
      if (handleApp(reply, err)) return
      throw err
    }
  })

  // 签名代理 —— 扩展发未签名 URL，后端用存储的 cookie 签名后请求抖音 API
  const signedProxySchema = z.object({
    path: z.string().min(1),
    query: z.record(z.union([z.string(), z.number(), z.undefined()])).default({}),
  })

  app.post('/api/bridge/proxy', async (req, reply) => {
    try {
      const token = String(req.headers[PUSH_HEADER] || '').trim()
      if (!token.startsWith('pt_')) {
        reply.status(401).send(fail(ERR.DOUYIN_BRIDGE_TOKEN_INVALID, '缺少有效推送 token'))
        return
      }
      const acc = await findByPushToken(token)
      if (!acc) {
        reply.status(401).send(fail(ERR.DOUYIN_BRIDGE_TOKEN_INVALID, '推送 token 无效'))
        return
      }
      if (!acc.cookieEnc) {
        reply.status(400).send(fail(
          ERR.DOUYIN_BROWSER_UNAVAILABLE,
          '该账号未绑定 cookie，请先通过「扫码登录」或「插件推送 cookie」完成绑定',
        ))
        return
      }
      const payload = signedProxySchema.parse(req.body)
      const log = getLogger().child({ mod: 'bridge-proxy', accountId: acc.id, path: payload.path })
      log.info('proxy request received')
      const r = await dyGetSigned(acc.localUserId, acc, payload.path, payload.query)
      log.info({ status: r.status, ok: r.ok }, 'proxy request done')
      return ok({ status: r.status, data: r.data })
    } catch (err) {
      if (handleZod(reply, err)) return
      if (handleApp(reply, err)) return
      throw err
    }
  })
}
