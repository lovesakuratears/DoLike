import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { ok, fail, ERR } from '../core/errors.js'
import { resolveNoWatermarkVideo } from './douyin-downloader.js'

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
}
