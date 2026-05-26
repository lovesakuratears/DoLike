// /media/* —— archiveRoot/accounts 下的视频/封面静态分发
//
// @fastify/static 默认支持 HTTP Range；浏览器 <video> 标签靠它做拖动
// 鉴权：在 /media 前缀上挂 onRequest hook 走 requireAuth；浏览器 video 标签会自带 cookie（同源 127.0.0.1）

import type { FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import { join } from 'node:path'
import { loadConfig } from '../config.js'
import { fail, ERR } from '../core/errors.js'

const MEDIA_PREFIX = '/media/'

export default async function mediaRoutes(app: FastifyInstance): Promise<void> {
  const cfg = loadConfig()
  const root = join(cfg.archiveRoot, 'accounts')

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith(MEDIA_PREFIX)) return
    if (!req.currentUser) {
      reply.status(401).send(fail(ERR.AUTH_NOT_LOGGED_IN, '请先登录'))
    }
  })

  await app.register(fastifyStatic, {
    root,
    prefix: MEDIA_PREFIX,
    decorateReply: false,
    serve: true,
    acceptRanges: true,
    cacheControl: true,
    maxAge: 0
  })
}
