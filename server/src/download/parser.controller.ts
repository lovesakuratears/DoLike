import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { ok, fail, AppError, ERR } from '../core/errors.js'
import { resolveNoWatermarkVideo } from './douyin-downloader.js'
import { requireAuth } from '../auth/session.plugin.js'
import { getPrisma } from '../core/db.js'
import { getDecryptedCookie } from '../douyin/session.service.js'
import { acquireBrowserSession, type BrowserSession } from '../douyin/browser.session.js'
import { fetchAwemeDetail, getProfileSelf } from '../douyin/dy-client.js'
import { getLogger } from '../core/logger.js'

const reqSchema = z.object({
  url: z.string().url(),
  awemeId: z.string().optional().nullable()
})

export default async function parserRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/parser/parse', async (req, reply: FastifyReply) => {
    try {
      const { url, awemeId: rawAwemeId } = reqSchema.parse(req.body)
      const result = await resolveNoWatermarkVideo(url, rawAwemeId)
      return ok({
        video_url: result.videoUrl,
        parser: 'local',
        strategy: result.strategy
      })
    } catch {
      reply.status(400).send(fail(ERR.VALIDATION_FAILED, 'url 参数无效'))
    }
  })

  // ★ 分享链接解析 —— 使用插件 Cookie 通过 BrowserSession 获取无水印下载链接
  // 标记: SHARE_LINK_RESOLVE
  // 复用插件线路：dyGetSigned → fetchAwemeDetail → play_addr
  const shareResolveSchema = z.object({
    shareUrl: z.string().min(10),
    accountId: z.number().int().positive()
  })

  app.post('/api/parser/resolve-share', async (req, reply) => {
    try {
      const user = requireAuth(req, reply)
      const { shareUrl, accountId } = shareResolveSchema.parse(req.body)
      const prisma = getPrisma()
      const acc = await prisma.douyinAccount.findUnique({ where: { id: accountId, localUserId: user.id } })
      if (!acc) {
        reply.status(404).send(fail(ERR.DOUYIN_ACCOUNT_NOT_FOUND, '账号不存在'))
        return
      }
      if (!acc.cookieEnc) {
        reply.status(400).send(fail(ERR.DOUYIN_BROWSER_UNAVAILABLE, '该账号未绑定 cookie'))
        return
      }

      const log = getLogger().child({ mod: 'share-resolve', accountId })
      log.info({ shareUrl }, 'resolving share link')

      // Step 1: 用本地解析器提取 awemeId 并获取无水印链接（复用插件线路代码）
      const localResult = await resolveNoWatermarkVideo(shareUrl, null)

      // Step 2: 如果有 cookie，通过 BrowserSession 走 dyGetSigned 获取更完整的详情
      if (acc.cookieEnc) {
        try {
          const cookie = getDecryptedCookie(user.id, acc)
          if (cookie) {
            const bs = await acquireBrowserSession(acc.id, acc.secUid, cookie)
            // 尝试从分享链接提取 awemeId
            const awemeIdMatch = /\/video\/(\d+)|\/note\/(\d+)/.exec(localResult.videoUrl)
            const awemeId = awemeIdMatch ? (awemeIdMatch[1] || awemeIdMatch[2]) : null
            if (awemeId) {
              const detail = await fetchAwemeDetail(user.id, acc, awemeId)
              if (detail.data?.aweme_detail) {
                const ad = detail.data.aweme_detail as any
                const playAddr = ad?.video?.play_addr?.url_list?.[0]
                  || ad?.video?.play_addr_h264?.url_list?.[0]
                if (playAddr) {
                  const noWatermark = playAddr.replace('/playwm/', '/play/')
                  return ok({
                    video_url: noWatermark,
                    strategy: 'plugin-browser-session',
                    awemeId,
                    title: ad?.desc || '',
                    authorName: ad?.author?.nickname || '',
                    duration: ad?.video?.duration || 0,
                    coverUrl: ad?.video?.cover?.url_list?.[0] || ''
                  })
                }
              }
            }
          }
        } catch (e) {
          log.warn({ err: e }, 'BrowserSession resolve failed, falling back to local')
        }
      }

      // Fallback: 返回本地解析结果
      return ok({
        video_url: localResult.videoUrl,
        strategy: localResult.strategy,
        source: 'local-parser'
      })
    } catch (err) {
      if (err instanceof z.ZodError) {
        reply.status(400).send(fail(ERR.VALIDATION_FAILED, '参数无效'))
        return
      }
      if (err instanceof AppError) {
        reply.status(err.httpStatus).send(fail(err.code, err.message))
        return
      }
      throw err
    }
  })
}
