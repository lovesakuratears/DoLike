// /media 路由
//   /media/*                —— 通过路径映射（archiveRoot/accounts + extracted-audio）
//   /media/by-id/:id        —— 通过 ExtractedAudio.id 或 Content.id 查找文件（避免文件名含 # 等特殊字符）

import type { FastifyInstance } from 'fastify'
import { join } from 'node:path'
import { createReadStream, existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { loadConfig } from '../config.js'
import { fail, ERR } from '../core/errors.js'
import { getPrisma } from '../core/db.js'
import { getLogger } from '../core/logger.js'

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

  // ── 通过 ID 查找并流式传输媒体文件 ──
  //   ?type=cover → 返回封面（coverPath），默认返回媒体文件（mediaPath）
  app.get('/media/by-id/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    const isCover = String((req.query as { type?: string }).type || '') === 'cover'
    if (!id || id <= 0) {
      return reply.status(400).send(fail(ERR.VALIDATION_FAILED, '无效的媒体 ID'))
    }

    const log = getLogger().child({ mod: 'media', id })

    // 1) 优先查 ExtractedAudio（音频）
    const prisma = getPrisma()
    const audio = await prisma.extractedAudio.findUnique({
      where: { id },
      select: { mediaPath: true, coverPath: true, localUserId: true }
    })
    if (audio) {
      const relPath = isCover ? audio.coverPath : audio.mediaPath
      if (relPath) {
        const filePath = join(extractedAudioRoot, relPath)
        try {
          await stat(filePath)
          log.info({ filePath, source: 'extracted-audio', isCover }, 'serving media by id')
          return reply
            .header('Cache-Control', 'no-cache')
            .send(createReadStream(filePath))
        } catch { /* file not found on disk; fall through */ }
      }
    }

    // 2) 再查 Content（视频/封面等）
    const content = await prisma.content.findUnique({
      where: { id },
      select: { mediaPath: true }
    })
    if (content?.mediaPath) {
      const filePath = join(accountsRoot, content.mediaPath)
      try {
        await stat(filePath)
        log.info({ filePath, source: 'content' }, 'serving media by id')
        return reply
          .header('Cache-Control', 'no-cache')
          .send(createReadStream(filePath))
      } catch { /* file not found */ }
    }

    return reply.status(404).send(fail(ERR.NOT_FOUND, '媒体文件不存在'))
  })

  // ── 通过路径映射（向后兼容） ──
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
