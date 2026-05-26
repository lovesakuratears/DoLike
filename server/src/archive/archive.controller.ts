// /api/archive — 触发抓取
//
// POST /api/archive/full          { accountId }
// POST /api/archive/incremental   { accountId }
// GET  /api/archive/progress      ?accountId

import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../auth/session.plugin.js'
import { AppError, ERR, fail, ok } from '../core/errors.js'
import {
  startFull,
  startIncremental,
  pauseArchive,
  resumeArchive,
  stopArchive,
  getArchiveStatus
} from './archive.service.js'
import { broadcastProgress } from '../ws/progress.gateway.js'
import { getPrisma } from '../core/db.js'
import {
  getQueueSnapshot,
  pauseQueue,
  resumeQueue,
  stopQueue,
  listDownloadTasks,
  resumeTask,
  deleteTask
} from '../download/queue.service.js'
import { getLogger } from '../core/logger.js'
import { getDownloadMode, setDownloadMode, getParserEndpoint, getParserState } from '../download/mode.service.js'

const triggerSchema = z.object({ accountId: z.coerce.number().int().positive() })
const taskIdParam = z.object({ id: z.coerce.number().int().positive() })
const modeSchema = z.object({ mode: z.enum(['enhanced', 'compatible']) })

interface RunState {
  accountId: number
  startedAt: number
  finishedAt: number | null
  full: boolean
  summary: { post: number; like: number; collectVideo: number } | null
  error: string | null
}

const runs = new Map<number, RunState>()

function runKey(accountId: number, full: boolean): string {
  return `${accountId}:${full ? 'F' : 'I'}`
}
const inFlight = new Set<string>()

async function spawnRun(localUserId: number, accountId: number, full: boolean): Promise<void> {
  const key = runKey(accountId, full)
  const log = getLogger().child({ mod: 'archive', accountId, full })
  if (inFlight.has(key)) {
    log.info('archive already in flight, skipping duplicate request')
    return
  }
  inFlight.add(key)
  const state: RunState = {
    accountId,
    startedAt: Date.now(),
    finishedAt: null,
    full,
    summary: null,
    error: null
  }
  runs.set(accountId, state)
  log.info('archive run spawned')
  ;(async () => {
    try {
      const fn = full ? startFull : startIncremental
      const summary = await fn(localUserId, accountId, ev => {
        broadcastProgress({ topic: 'archive.event', accountId, ...ev })
      })
      state.summary = summary
      log.info({ summary }, 'archive run completed')
      broadcastProgress({ type: 'archive.summary', accountId, ...summary })
    } catch (e) {
      state.error = e instanceof Error ? e.message : String(e)
      log.error({ err: e }, 'archive run failed')
      broadcastProgress({ type: 'archive.failed', accountId, message: state.error })
    } finally {
      state.finishedAt = Date.now()
      inFlight.delete(key)
    }
  })()
}

export default async function archiveRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/archive/full', async (req, reply) => {
    try {
      const user = requireAuth(req, reply)
      const { accountId } = triggerSchema.parse(req.body)
      void spawnRun(user.id, accountId, true)
      return ok({ accountId, full: true, queued: true })
    } catch (e) {
      return handleErr(reply, e)
    }
  })

  app.post('/api/archive/incremental', async (req, reply) => {
    try {
      const user = requireAuth(req, reply)
      const { accountId } = triggerSchema.parse(req.body)
      void spawnRun(user.id, accountId, false)
      return ok({ accountId, full: false, queued: true })
    } catch (e) {
      return handleErr(reply, e)
    }
  })

  app.get('/api/archive/progress', async (req, reply) => {
    try {
      const user = requireAuth(req, reply)
      const q = z
        .object({ accountId: z.coerce.number().int().positive().optional() })
        .parse(req.query)
      const prisma = getPrisma()
      const accountFilter = q.accountId ? { id: q.accountId, localUserId: user.id } : { localUserId: user.id }
      const accounts = await prisma.douyinAccount.findMany({
        where: accountFilter,
        select: { id: true }
      })
      const ids = accounts.map((a: { id: number }) => a.id)
      if (ids.length === 0) return ok({ accounts: [], queue: getQueueSnapshot(), archiveStatuses: {} })
      const tasks = await prisma.downloadTask.groupBy({
        by: ['status'],
        where: { content: { douyinAccountId: { in: ids } } },
        _count: { _all: true }
      })
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      const todayNew = await prisma.content.count({
        where: { douyinAccountId: { in: ids }, archivedAt: { gte: todayStart } }
      })
      const counts: Record<string, number> = { queued: 0, running: 0, done: 0, failed: 0, paused: 0 }
      for (const t of tasks) {
        counts[t.status] = t._count._all
      }
      const archiveStatuses: Record<number, string> = {}
      for (const id of ids) archiveStatuses[id] = getArchiveStatus(id)
      const lastRun = q.accountId ? runs.get(q.accountId) ?? null : null
      return ok({
        accounts: ids,
        ...counts,
        todayNewCount: todayNew,
        queue: getQueueSnapshot(),
        archiveStatuses,
        lastRun
      })
    } catch (e) {
      return handleErr(reply, e)
    }
  })

  // ---------------- 暂停 / 恢复 / 终止 ----------------

  app.post('/api/archive/pause', async (req, reply) => {
    try {
      requireAuth(req, reply)
      const { accountId } = triggerSchema.parse(req.body)
      const ok1 = pauseArchive(accountId)
      // 暂停 fetcher 的同时也暂停下载队列，否则已入队的 task 还会继续吃带宽。
      const qres = await pauseQueue()
      return ok({ accountId, archivePaused: ok1, queue: qres })
    } catch (e) {
      return handleErr(reply, e)
    }
  })

  app.post('/api/archive/resume', async (req, reply) => {
    try {
      requireAuth(req, reply)
      const { accountId } = triggerSchema.parse(req.body)
      const ok1 = resumeArchive(accountId)
      const qres = await resumeQueue()
      return ok({ accountId, archiveResumed: ok1, queue: qres })
    } catch (e) {
      return handleErr(reply, e)
    }
  })

  app.post('/api/archive/stop', async (req, reply) => {
    try {
      requireAuth(req, reply)
      const { accountId } = triggerSchema.parse(req.body)
      const ok1 = stopArchive(accountId)
      // 终止 = 拉停 fetcher + 把队里的下载也停掉（不删 .part，保留断点续传能力）
      const qres = await stopQueue()
      return ok({ accountId, archiveStopped: ok1, queue: qres })
    } catch (e) {
      return handleErr(reply, e)
    }
  })

  app.post('/api/download/pause', async (req, reply) => {
    try {
      requireAuth(req, reply)
      const qres = await pauseQueue()
      return ok({ queue: qres })
    } catch (e) {
      return handleErr(reply, e)
    }
  })

  app.post('/api/download/resume', async (req, reply) => {
    try {
      requireAuth(req, reply)
      const qres = await resumeQueue()
      return ok({ queue: qres })
    } catch (e) {
      return handleErr(reply, e)
    }
  })

  app.post('/api/download/stop', async (req, reply) => {
    try {
      requireAuth(req, reply)
      const qres = await stopQueue()
      return ok({ queue: qres })
    } catch (e) {
      return handleErr(reply, e)
    }
  })

  app.get('/api/download/mode', async (req, reply) => {
    try {
      const user = requireAuth(req, reply)
      const parser = getParserState()
      return ok({
        mode: getDownloadMode(user.id),
        enhancedConfigured: Boolean(getParserEndpoint()),
        parserStatus: parser.status,
        parserLastCheckedAt: parser.lastCheckedAt
      })
    } catch (e) {
      return handleErr(reply, e)
    }
  })

  app.post('/api/download/mode', async (req, reply) => {
    try {
      const user = requireAuth(req, reply)
      const { mode } = modeSchema.parse(req.body)
      const next = setDownloadMode(user.id, mode)
      const parser = getParserState()
      return ok({
        mode: next,
        enhancedConfigured: Boolean(getParserEndpoint()),
        parserStatus: parser.status,
        parserLastCheckedAt: parser.lastCheckedAt,
        message: next === 'enhanced' && !getParserEndpoint()
          ? '增强模式未配置解析服务，当前下载将回退为兼容模式'
          : ''
      })
    } catch (e) {
      return handleErr(reply, e)
    }
  })

  app.get('/api/download/tasks', async (req, reply) => {
    try {
      const user = requireAuth(req, reply)
      const tasks = await listDownloadTasks(user.id)
      return ok({ items: tasks, queue: getQueueSnapshot() })
    } catch (e) {
      return handleErr(reply, e)
    }
  })

  app.post('/api/download/tasks/:id/resume', async (req, reply) => {
    try {
      const user = requireAuth(req, reply)
      const { id } = taskIdParam.parse(req.params)
      await resumeTask(user.id, id)
      return ok({ ok: true })
    } catch (e) {
      return handleErr(reply, e)
    }
  })

  app.delete('/api/download/tasks/:id', async (req, reply) => {
    try {
      const user = requireAuth(req, reply)
      const { id } = taskIdParam.parse(req.params)
      await deleteTask(user.id, id)
      return ok({ ok: true })
    } catch (e) {
      return handleErr(reply, e)
    }
  })
}

function handleErr(reply: FastifyReply, e: unknown) {
  if (e instanceof z.ZodError) {
    return reply.status(400).send(fail(ERR.VALIDATION_FAILED, e.errors[0]?.message ?? '参数错误'))
  }
  if (e instanceof AppError) {
    return reply.status(e.httpStatus).send(fail(e.code, e.message))
  }
  throw e
}
