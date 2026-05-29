// /media/* —— archiveRoot/accounts 与 archiveRoot/extracted-audio 下的媒体分发
//
// @fastify/static 默认支持 HTTP Range；浏览器 <video> 标签靠它做拖动
// 鉴权：在 /media 前缀上挂 onRequest hook 走 requireAuth；浏览器 video 标签会自带 cookie（同源 127.0.0.1）

import type { FastifyInstance } from 'fastify'
import { join } from 'node:path'
import { createReadStream, existsSync } from 'node:fs'
import { loadConfig } from '../config.js'
import { fail, ERR } from '../core/errors.js'

const MEDIA_PREFIX = '/media/'

export default async function mediaRoutes(app: FastifyInstance): Promise<void> {
  const cfg = loadConfig()
  const accountsRoot = join(cfg.archiveRoot, 'accounts')
  const extractedAudioRoot = join(cfg.archiveRoot, 'extracted-audio')

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith(MEDIA_PREFIX)) return
    if (!req.currentUser) {
      reply.status(401).send(fail(ERR.AUTH_NOT_LOGGED_IN, '请先登录'))
    }
  })

  app.get('/media/*', async (req, reply) => {
    const relativePath = decodeURIComponent(String((req.params as { '*': string })['*'] || '')).replace(/^\/+/, '')
    if (!relativePath || relativePath.includes('..')) {
      return reply.status(400).send(fail(ERR.VALIDATION_FAILED, '非法媒体路径'))
    }

    const candidates = [
      join(accountsRoot, relativePath),
      join(extractedAudioRoot, relativePath)
    ]

    const target = candidates.find((p) => existsSync(p))
    if (!target) {
      return reply.status(404).send(fail(ERR.NOT_FOUND, '媒体文件不存在'))
    }

    return reply
      .header('Cache-Control', 'no-cache')
      .send(createReadStream(target))
  })
}
