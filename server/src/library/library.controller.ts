// /api/library — 视频库查询
//
// 路由（M2 范围）：
//   GET /api/library/videos?linkKind&length&q&sort&page&size&accountId
//   GET /api/library/content/:id

import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../auth/session.plugin.js'
import { fail, ok, AppError, ERR } from '../core/errors.js'
import {
  getContent,
  listVideos,
  listMixes,
  listMixVideos,
  hideContents,
  listFolders,
  createFolder,
  renameFolder,
  deleteFolders,
  listFolderVideos,
  addFolderItems,
  removeFolderItems,
  extractAudioFromVideo,
  listExtractedAudio,
  deleteExtractedAudio
} from './library.service.js'

const contentKindEnum = z.enum(['VIDEO', 'MUSIC', 'MIX_VIDEO', 'all'])
const linkKindEnum = z.enum(['POST', 'LIKE', 'FAVORITE', 'WATCH_LATER', 'all'])
const lengthEnum = z.enum(['long', 'short', 'all'])
const sortEnum = z.enum(['publish', 'archived', 'duration'])

const listQuery = z.object({
  contentKind: contentKindEnum.optional(),
  linkKind: linkKindEnum.optional(),
  length: lengthEnum.optional(),
  q: z.string().optional(),
  sort: sortEnum.optional(),
  page: z.coerce.number().int().positive().optional(),
  size: z.coerce.number().int().positive().max(100).optional(),
  accountId: z.coerce.number().int().positive().optional()
})

const idParam = z.object({ id: z.coerce.number().int().positive() })

const batchDeleteBody = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1).max(500)
})

const folderBody = z.object({
  name: z.string().trim().min(1).max(40)
})

const folderIdsBody = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1).max(200)
})

const folderParam = z.object({ folderId: z.coerce.number().int().positive() })

const folderItemsBody = z.object({
  contentIds: z.array(z.coerce.number().int().positive()).min(1).max(500)
})

const folderVideosQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  size: z.coerce.number().int().positive().max(100).optional()
})

const mixParam = z.object({ mixId: z.coerce.number().int().positive() })

export default async function libraryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/library/videos', async (req, reply) => {
    try {
      const user = requireAuth(req, reply)
      const q = listQuery.parse(req.query)
      const res = await listVideos({
        localUserId: user.id,
        contentKind: q.contentKind,
        linkKind: q.linkKind,
        length: q.length,
        q: q.q,
        sort: q.sort,
        page: q.page,
        size: q.size,
        accountId: q.accountId
      })
      return ok(res)
    } catch (e) {
      if (e instanceof z.ZodError) {
        return reply
          .status(400)
          .send(fail(ERR.VALIDATION_FAILED, e.errors[0]?.message ?? '参数错误'))
      }
      if (e instanceof AppError) return reply.status(e.httpStatus).send(fail(e.code, e.message))
      throw e
    }
  })

  app.get('/api/library/mixes', async (req, reply) => {
    try {
      const user = requireAuth(req, reply)
      const q = z.object({
        accountId: z.coerce.number().int().positive().optional()
      }).parse(req.query)
      return ok(await listMixes(user.id, q.accountId))
    } catch (e) {
      if (e instanceof z.ZodError) {
        return reply
          .status(400)
          .send(fail(ERR.VALIDATION_FAILED, e.errors[0]?.message ?? '参数错误'))
      }
      if (e instanceof AppError) return reply.status(e.httpStatus).send(fail(e.code, e.message))
      throw e
    }
  })

  app.get('/api/library/mixes/:mixId/videos', async (req, reply) => {
    try {
      const user = requireAuth(req, reply)
      const { mixId } = mixParam.parse(req.params)
      const q = folderVideosQuery.parse(req.query)
      const detail = await listMixVideos(user.id, mixId, q.page, q.size)
      if (!detail) return reply.status(404).send(fail(ERR.NOT_FOUND, '合集不存在'))
      return ok(detail)
    } catch (e) {
      if (e instanceof z.ZodError) {
        return reply.status(400).send(fail(ERR.VALIDATION_FAILED, e.errors[0]?.message ?? '参数错误'))
      }
      if (e instanceof AppError) return reply.status(e.httpStatus).send(fail(e.code, e.message))
      throw e
    }
  })

  app.get('/api/library/content/:id', async (req, reply) => {
    try {
      const user = requireAuth(req, reply)
      const { id } = idParam.parse(req.params)
      const item = await getContent(user.id, id)
      if (!item) return reply.status(404).send(fail(ERR.NOT_FOUND, '内容不存在'))
      return ok(item)
    } catch (e) {
      if (e instanceof z.ZodError) {
        return reply
          .status(400)
          .send(fail(ERR.VALIDATION_FAILED, e.errors[0]?.message ?? '参数错误'))
      }
      if (e instanceof AppError) return reply.status(e.httpStatus).send(fail(e.code, e.message))
      throw e
    }
  })

  app.post('/api/library/content/batch-delete', async (req, reply) => {
    try {
      const user = requireAuth(req, reply)
      const { ids } = batchDeleteBody.parse(req.body)
      const res = await hideContents(user.id, ids)
      return ok(res)
    } catch (e) {
      if (e instanceof z.ZodError) {
        return reply
          .status(400)
          .send(fail(ERR.VALIDATION_FAILED, e.errors[0]?.message ?? '参数错误'))
      }
      if (e instanceof AppError) return reply.status(e.httpStatus).send(fail(e.code, e.message))
      throw e
    }
  })

  app.get('/api/library/folders', async (req, reply) => {
    try {
      const user = requireAuth(req, reply)
      return ok(await listFolders(user.id))
    } catch (e) {
      if (e instanceof AppError) return reply.status(e.httpStatus).send(fail(e.code, e.message))
      throw e
    }
  })

  app.post('/api/library/folders', async (req, reply) => {
    try {
      const user = requireAuth(req, reply)
      const { name } = folderBody.parse(req.body)
      return ok(await createFolder(user.id, name))
    } catch (e) {
      if (e instanceof z.ZodError) {
        return reply.status(400).send(fail(ERR.VALIDATION_FAILED, e.errors[0]?.message ?? '参数错误'))
      }
      if (e instanceof AppError) return reply.status(e.httpStatus).send(fail(e.code, e.message))
      throw e
    }
  })

  app.patch('/api/library/folders/:folderId', async (req, reply) => {
    try {
      const user = requireAuth(req, reply)
      const { folderId } = folderParam.parse(req.params)
      const { name } = folderBody.parse(req.body)
      await renameFolder(user.id, folderId, name)
      return ok({ ok: true })
    } catch (e) {
      if (e instanceof z.ZodError) {
        return reply.status(400).send(fail(ERR.VALIDATION_FAILED, e.errors[0]?.message ?? '参数错误'))
      }
      if (e instanceof AppError) return reply.status(e.httpStatus).send(fail(e.code, e.message))
      throw e
    }
  })

  app.post('/api/library/folders/delete', async (req, reply) => {
    try {
      const user = requireAuth(req, reply)
      const { ids } = folderIdsBody.parse(req.body)
      return ok(await deleteFolders(user.id, ids))
    } catch (e) {
      if (e instanceof z.ZodError) {
        return reply.status(400).send(fail(ERR.VALIDATION_FAILED, e.errors[0]?.message ?? '参数错误'))
      }
      if (e instanceof AppError) return reply.status(e.httpStatus).send(fail(e.code, e.message))
      throw e
    }
  })

  app.get('/api/library/folders/:folderId/videos', async (req, reply) => {
    try {
      const user = requireAuth(req, reply)
      const { folderId } = folderParam.parse(req.params)
      const q = folderVideosQuery.parse(req.query)
      return ok(await listFolderVideos(user.id, folderId, q.page, q.size))
    } catch (e) {
      if (e instanceof z.ZodError) {
        return reply.status(400).send(fail(ERR.VALIDATION_FAILED, e.errors[0]?.message ?? '参数错误'))
      }
      if (e instanceof AppError) return reply.status(e.httpStatus).send(fail(e.code, e.message))
      throw e
    }
  })

  app.post('/api/library/folders/:folderId/items', async (req, reply) => {
    try {
      const user = requireAuth(req, reply)
      const { folderId } = folderParam.parse(req.params)
      const { contentIds } = folderItemsBody.parse(req.body)
      return ok(await addFolderItems(user.id, folderId, contentIds))
    } catch (e) {
      if (e instanceof z.ZodError) {
        return reply.status(400).send(fail(ERR.VALIDATION_FAILED, e.errors[0]?.message ?? '参数错误'))
      }
      if (e instanceof AppError) return reply.status(e.httpStatus).send(fail(e.code, e.message))
      throw e
    }
  })

  app.delete('/api/library/folders/:folderId/items', async (req, reply) => {
    try {
      const user = requireAuth(req, reply)
      const { folderId } = folderParam.parse(req.params)
      const { contentIds } = folderItemsBody.parse(req.body)
      return ok(await removeFolderItems(user.id, folderId, contentIds))
    } catch (e) {
      if (e instanceof z.ZodError) {
        return reply.status(400).send(fail(ERR.VALIDATION_FAILED, e.errors[0]?.message ?? '参数错误'))
      }
      if (e instanceof AppError) return reply.status(e.httpStatus).send(fail(e.code, e.message))
      throw e
    }
  })

  app.post('/api/library/extract-audio', async (req, reply) => {
    try {
      const user = requireAuth(req, reply)
      console.log('[extract-audio] body:', JSON.stringify(req.body))
      const body = z.object({
        awemeId: z.string().min(1),
        videoUrl: z.string().min(1),
        title: z.string().default(''),
        authorName: z.string().default(''),
        durationSec: z.coerce.number().int().default(0),
        accountId: z.coerce.number().int().positive().optional(),
        sourceCoverPath: z.string().nullable().optional()
      }).parse(req.body)
      console.log('[extract-audio] parsed:', JSON.stringify(body))
      const result = await extractAudioFromVideo(
        user.id,
        body.awemeId,
        body.videoUrl,
        body.title,
        body.authorName,
        body.durationSec,
        body.accountId,
        body.sourceCoverPath
      )
      return ok(result)
    } catch (e) {
      if (e instanceof z.ZodError) {
        return reply.status(400).send(fail(ERR.VALIDATION_FAILED, e.errors[0]?.message ?? '参数错误'))
      }
      if (e instanceof AppError) return reply.status(e.httpStatus).send(fail(e.code, e.message))
      if (e instanceof Error) return reply.status(400).send(fail(ERR.VALIDATION_FAILED, e.message))
      throw e
    }
  })

  app.get('/api/library/extracted-audio', async (req, reply) => {
    try {
      const user = requireAuth(req, reply)
      const q = z.object({
        page: z.coerce.number().int().positive().optional(),
        size: z.coerce.number().int().positive().max(100).optional()
      }).parse(req.query)
      const res = await listExtractedAudio(user.id, q.page, q.size)
      return ok(res)
    } catch (e) {
      if (e instanceof z.ZodError) {
        return reply.status(400).send(fail(ERR.VALIDATION_FAILED, e.errors[0]?.message ?? '参数错误'))
      }
      if (e instanceof AppError) return reply.status(e.httpStatus).send(fail(e.code, e.message))
      throw e
    }
  })

  app.post('/api/library/extracted-audio/delete', async (req, reply) => {
    try {
      const user = requireAuth(req, reply)
      const body = z.object({
        musicContentId: z.coerce.number().int().positive()
      }).parse(req.body)
      const res = await deleteExtractedAudio(user.id, body.musicContentId)
      return ok(res)
    } catch (e) {
      if (e instanceof z.ZodError) {
        return reply.status(400).send(fail(ERR.VALIDATION_FAILED, e.errors[0]?.message ?? '参数错误'))
      }
      if (e instanceof AppError) return reply.status(e.httpStatus).send(fail(e.code, e.message))
      throw e
    }
  })
}
