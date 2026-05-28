// 下载队列（主线程）
//
// 单例：
//   - 启动时 rollback running→queued（崩溃恢复）
//   - 持续 pump：running.size < concurrency 时取出 queued 任务交给 worker
//   - 接 worker 消息：progress / done / error → 更新 DB + 转 progress.gateway
//
// 边界：
//   - 主线程独占 Prisma；worker 不碰 DB
//   - URL 过期前主动刷 video_detail
//
// 文件树：accounts/<secUid>/<bucket>/<YYYY>/<YYYY-MM>/<awemeId>/{video.mp4,cover.jpg}

import { Worker } from 'node:worker_threads'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import type { DownloadTask } from '@prisma/client'
import { getPrisma } from '../core/db.js'
import { awemeDir, awemeFile, bucketOf, relToAccounts } from '../archive/paths.js'
import type { DownloadKind, LinkKind } from '../archive/types.js'
import { getLogger } from '../core/logger.js'
import { AppError, ERR } from '../core/errors.js'
import { getDownloadMode } from './mode.service.js'
import { resolveVideoSource } from './source-resolver.js'

const log = () => getLogger().child({ mod: 'download' })

// ---------------- 类型 ----------------

interface WorkerOutProgress {
  type: 'progress'
  taskId: number
  bytesDone: number
  bytesTotal?: number
}
interface WorkerOutDone {
  type: 'done'
  taskId: number
  finalPath: string
  size: number
}
interface WorkerOutError {
  type: 'error'
  taskId: number
  message: string
  retryable: boolean
}
type WorkerOut = WorkerOutProgress | WorkerOutDone | WorkerOutError

export interface ProgressEvent {
  type: 'download.progress' | 'download.done' | 'download.failed'
  taskId: number
  contentId: number
  kind: DownloadKind
  bytesDone?: number
  bytesTotal?: number | null
  message?: string
}

export type ProgressBroadcaster = (ev: ProgressEvent) => void

// ---------------- 单例状态 ----------------

let inited = false
let concurrency = 3
let broadcaster: ProgressBroadcaster = () => {}
let workers: Worker[] = []
const runningTasks = new Map<number, { worker: Worker; contentId: number; kind: DownloadKind }>()
const taskMeta = new Map<number, { contentId: number; kind: DownloadKind }>()
let pumpTimer: NodeJS.Timeout | null = null
let pumpInFlight = false
let stopped = false
// 全局暂停标志：true 时 pump 不再 dispatch；正在 running 的 task 会被 abort，
// 等 worker 回 error('已取消')，handler 看到 paused=true 就把状态写 'paused' 而不是 retry。
let paused = false

// ---------------- 启停 ----------------

export interface InitQueueOpts {
  concurrency: number
  broadcast: ProgressBroadcaster
}

export async function initDownloadQueue(opts: InitQueueOpts): Promise<void> {
  if (inited) return
  inited = true
  concurrency = Math.max(1, opts.concurrency)
  broadcaster = opts.broadcast
  await rollbackRunningTasks()
  buildPool()
  log().info({ concurrency, workers: workers.length }, 'download queue ready')
  schedulePump()
}

export async function shutdownDownloadQueue(): Promise<void> {
  stopped = true
  if (pumpTimer) clearTimeout(pumpTimer)
  pumpTimer = null
  const pool = workers
  workers = []
  await Promise.all(pool.map(w => w.terminate().catch(() => undefined)))
}

async function rollbackRunningTasks(): Promise<void> {
  const prisma = getPrisma()
  await prisma.downloadTask.updateMany({
    where: { status: 'running' },
    data: { status: 'queued' }
  })
}

function buildPool(): void {
  const path = resolveWorkerEntry()
  for (let i = 0; i < concurrency; i++) {
    workers.push(spawnWorker(path.url, path.execArgv))
  }
}

function spawnWorker(workerUrl: URL, execArgv: string[]): Worker {
  const w = new Worker(workerUrl, { execArgv })
  w.on('message', (m: WorkerOut) => handleWorkerMessage(w, m).catch(err => {
    log().error({ err }, 'handle worker message failed')
  }))
  w.on('error', err => log().error({ err }, 'worker error'))
  w.on('exit', code => {
    if (stopped) return
    if (code !== 0) log().warn({ code }, 'worker exited, respawning')
    const idx = workers.indexOf(w)
    if (idx >= 0) workers[idx] = spawnWorker(workerUrl, execArgv)
  })
  return w
}

function resolveWorkerEntry(): { url: URL; execArgv: string[] } {
  // 优先用同目录 .js（构建产物）；否则用 .ts（dev with tsx）
  const here = dirname(fileURLToPath(import.meta.url))
  const jsPath = join(here, 'worker.entry.js')
  if (existsSync(jsPath)) {
    return { url: new URL('file://' + jsPath), execArgv: [] }
  }
  return {
    url: new URL('./worker.entry.ts', import.meta.url),
    execArgv: ['--import', 'tsx']
  }
}

function schedulePump(delay = 0): void {
  if (stopped) return
  if (pumpTimer) return
  pumpTimer = setTimeout(() => {
    pumpTimer = null
    void pump()
  }, delay)
  pumpTimer.unref?.()
}

async function pump(): Promise<void> {
  if (pumpInFlight || stopped || paused) return
  pumpInFlight = true
  try {
    const prisma = getPrisma()
    while (runningTasks.size < concurrency) {
      const next = await prisma.downloadTask.findFirst({
        where: { status: 'queued' },
        orderBy: { id: 'asc' }
      })
      if (!next) break
      await dispatchTask(next)
    }
  } catch (e) {
    log().error({ err: e }, 'pump failed')
  } finally {
    pumpInFlight = false
  }
}

async function dispatchTask(task: DownloadTask): Promise<void> {
  const idx = runningTasks.size % workers.length
  const worker = workers[idx]
  if (!worker) return
  const prisma = getPrisma()
  await prisma.downloadTask.update({
    where: { id: task.id },
    data: { status: 'running', attempts: { increment: 1 } }
  })
  // URL 过期检查（仅 video kind）—— M2 简化：不主动刷新，failed 时再补
  const content = await prisma.content.findUnique({
    where: { id: task.contentId },
    select: { kind: true }
  })
  const downloadKind = task.kind as DownloadKind
  runningTasks.set(task.id, {
    worker,
    contentId: task.contentId,
    kind: downloadKind
  })
  taskMeta.set(task.id, { contentId: task.contentId, kind: downloadKind })
  worker.postMessage({
    type: 'start',
    task: {
      id: task.id,
      url: task.url,
      targetPath: task.targetPath
    }
  })
  log().info({ taskId: task.id, contentId: task.contentId, kind: downloadKind, target: task.targetPath }, 'task dispatched')
  // 标 content 为 downloading（只首次）
  if (downloadKind === 'video' && content) {
    await prisma.content.update({
      where: { id: task.contentId },
      data: { status: 'downloading' }
    })
  }
}

async function handleWorkerMessage(_w: Worker, m: WorkerOut): Promise<void> {
  const meta = taskMeta.get(m.taskId)
  if (!meta) return
  const prisma = getPrisma()

  if (m.type === 'progress') {
    await prisma.downloadTask.update({
      where: { id: m.taskId },
      data: {
        bytesDone: BigInt(m.bytesDone),
        bytesTotal: m.bytesTotal != null ? BigInt(m.bytesTotal) : undefined
      }
    })
    broadcaster({
      type: 'download.progress',
      taskId: m.taskId,
      contentId: meta.contentId,
      kind: meta.kind,
      bytesDone: m.bytesDone,
      bytesTotal: m.bytesTotal ?? null
    })
    return
  }

  if (m.type === 'done') {
    log().info({ taskId: m.taskId, size: m.size, path: m.finalPath }, 'task done')
    await prisma.downloadTask.update({
      where: { id: m.taskId },
      data: {
        status: 'done',
        bytesDone: BigInt(m.size),
        bytesTotal: BigInt(m.size),
        finishedAt: new Date()
      }
    })
    // 更新 Content 的 mediaPath / mediaSize / coverPath
    const archiveRoot = process.env.ARCHIVE_ROOT
    const rel = archiveRoot ? relToAccounts(m.finalPath, archiveRoot) : m.finalPath
    if (meta.kind === 'video') {
      await prisma.content.update({
        where: { id: meta.contentId },
        data: { mediaPath: rel, mediaSize: BigInt(m.size), status: 'done' }
      })
    } else if (meta.kind === 'cover') {
      await prisma.content.update({
        where: { id: meta.contentId },
        data: { coverPath: rel }
      })
      const content = await prisma.content.findUnique({
        where: { id: meta.contentId },
        select: {
          douyinAccountId: true,
          links: {
            select: { mixId: true }
          }
        }
      })
      const mixIds = Array.from(new Set((content?.links ?? []).map((link) => link.mixId).filter(Boolean))) as string[]
      if (content && mixIds.length > 0) {
        await prisma.mix.updateMany({
          where: {
            douyinAccountId: content.douyinAccountId,
            mixId: { in: mixIds },
            coverPath: null
          },
          data: { coverPath: rel }
        })
      }
    } else if (meta.kind === 'audio') {
      await prisma.content.update({
        where: { id: meta.contentId },
        data: { mediaPath: rel, mediaSize: BigInt(m.size), status: 'done' }
      })
    }
    broadcaster({
      type: 'download.done',
      taskId: m.taskId,
      contentId: meta.contentId,
      kind: meta.kind
    })
    runningTasks.delete(m.taskId)
    taskMeta.delete(m.taskId)
    schedulePump()
    return
  }

  if (m.type === 'error') {
    log().warn({ taskId: m.taskId, message: m.message, retryable: m.retryable }, 'task error')
    const task = await prisma.downloadTask.findUnique({ where: { id: m.taskId } })
    if (!task) {
      runningTasks.delete(m.taskId)
      taskMeta.delete(m.taskId)
      schedulePump()
      return
    }
    // 全局 paused 期间被 abort 的 task → 状态写 'paused'，等 resumeQueue 时再回 queued。
    if (paused) {
      await prisma.downloadTask.update({
        where: { id: m.taskId },
        data: { status: 'paused', lastError: m.message, finishedAt: null }
      })
      broadcaster({
        type: 'download.failed',
        taskId: m.taskId,
        contentId: meta.contentId,
        kind: meta.kind,
        message: '已暂停'
      })
      runningTasks.delete(m.taskId)
      taskMeta.delete(m.taskId)
      return
    }
    const retryable = m.retryable && task.attempts < 3
    await prisma.downloadTask.update({
      where: { id: m.taskId },
      data: {
        status: retryable ? 'queued' : 'failed',
        lastError: m.message,
        finishedAt: retryable ? null : new Date()
      }
    })
    if (!retryable && meta.kind === 'video') {
      await prisma.content.update({
        where: { id: meta.contentId },
        data: { status: 'failed', errorMsg: m.message }
      })
    }
    broadcaster({
      type: retryable ? 'download.progress' : 'download.failed',
      taskId: m.taskId,
      contentId: meta.contentId,
      kind: meta.kind,
      message: m.message
    })
    runningTasks.delete(m.taskId)
    taskMeta.delete(m.taskId)
    schedulePump(retryable ? 2_000 : 0)
  }
}

// ---------------- 入队入口（archive.service 调） ----------------

export interface EnqueueOpts {
  localUserId: number
  contentId: number
  archiveRoot: string
  secUid: string
  linkKind: LinkKind
  folderId: string | null
  mixId: string | null
  awemeId: string
  publishAt: Date
  mediaKind?: 'video' | 'audio'
  videoUrl: string | null
  coverUrl: string | null
}

export async function enqueueDownloadsForContent(opts: EnqueueOpts): Promise<void> {
  const prisma = getPrisma()
  if (paused) {
    await resumeQueue()
  }
  const bucket = bucketOf(opts.linkKind, { folderId: opts.folderId, mixId: opts.mixId })
  const dir = awemeDir({
    archiveRoot: opts.archiveRoot,
    secUid: opts.secUid,
    bucket,
    publishAt: opts.publishAt,
    awemeId: opts.awemeId,
    folderId: opts.folderId,
    mixId: opts.mixId
  })

  let enqueued = 0
  const existed = await prisma.downloadTask.findMany({
    where: { contentId: opts.contentId },
    select: { kind: true, status: true }
  })
  const hasCoverTask = existed.some((t: { kind: string }) => t.kind === 'cover')
  const hasVideoTask = existed.some((t: { kind: string }) => t.kind === 'video')
  const hasAudioTask = existed.some((t: { kind: string }) => t.kind === 'audio')
  const hasTerminalFailure = existed.some((t: { status: string }) => t.status === 'failed')

  if (opts.coverUrl) {
    if (!hasCoverTask) {
      await prisma.downloadTask.create({
        data: {
          contentId: opts.contentId,
          kind: 'cover',
          url: opts.coverUrl,
          targetPath: awemeFile(dir, 'cover')
        }
      })
      enqueued++
    }
  }
  if (opts.videoUrl) {
    const mediaKind = opts.mediaKind ?? 'video'
    if (mediaKind === 'audio') {
      if (!hasAudioTask) {
        await prisma.downloadTask.create({
          data: {
            contentId: opts.contentId,
            kind: 'audio',
            url: opts.videoUrl,
            targetPath: awemeFile(dir, 'audio')
          }
        })
        enqueued++
      }
    } else {
      const mode = getDownloadMode(opts.localUserId)
      const resolved = await resolveVideoSource(opts.videoUrl, mode, opts.awemeId)
      if (!hasVideoTask) {
        await prisma.downloadTask.create({
          data: {
            contentId: opts.contentId,
            kind: 'video',
            url: resolved.url,
            targetPath: awemeFile(dir, 'video')
          }
        })
        log().info(
          { contentId: opts.contentId, mode, resolvedBy: resolved.resolvedBy, strategy: resolved.strategy },
          'video source resolved'
        )
        enqueued++
      }
    }
  } else {
    log().warn({ contentId: opts.contentId, awemeId: opts.awemeId, linkKind: opts.linkKind }, 'no videoUrl, skipping video task')
  }
  if (hasTerminalFailure && enqueued > 0) {
    await prisma.content.update({
      where: { id: opts.contentId },
      data: { status: 'pending', errorMsg: null }
    })
  }
  if (enqueued > 0) {
    log().info({ contentId: opts.contentId, awemeId: opts.awemeId, enqueued, dir }, 'tasks enqueued')
  }
  schedulePump()
}

export function getQueueSnapshot(): {
  running: number
  concurrency: number
  paused: boolean
} {
  return { running: runningTasks.size, concurrency, paused }
}

export function setConcurrency(n: number): void {
  concurrency = Math.max(1, n)
  // 启动新 worker；多余的让其自然 idle
  while (workers.length < concurrency) {
    const path = resolveWorkerEntry()
    workers.push(spawnWorker(path.url, path.execArgv))
  }
}

// ---------------- 暂停 / 恢复 / 终止 ----------------
//
// pauseQueue：
//   1) paused = true（pump 立刻不再 dispatch）
//   2) 把所有 status='queued' 改成 'paused'（防止 server 重启后 rollback 又开下）
//   3) 给当前 running 的 worker 发 abort —— 它们的 error 回来后 handler 会写 'paused'
//      .part 文件保留，下次 resume 时 worker 走 Range 续传
//
// resumeQueue：paused → queued，pump 启动
// stopQueue：等价 pauseQueue（"断点续传终止" = 停手不删 .part）。语义留作未来扩展（清 .part 等）。

export async function pauseQueue(): Promise<{ paused: number; aborted: number }> {
  if (paused) {
    return { paused: 0, aborted: 0 }
  }
  paused = true
  const prisma = getPrisma()
  // 队里的 queued 直接拍成 paused，避免 schedulePump 期间漏掉。
  const pausedRes = await prisma.downloadTask.updateMany({
    where: { status: 'queued' },
    data: { status: 'paused' }
  })
  // 正在跑的：发 abort；DB 状态等 worker error 回到 handler 由 paused 分支写。
  let aborted = 0
  for (const [taskId, { worker }] of runningTasks.entries()) {
    try {
      worker.postMessage({ type: 'abort', taskId })
      aborted++
    } catch (e) {
      log().warn({ err: e, taskId }, 'abort post failed')
    }
  }
  log().info({ pausedQueued: pausedRes.count, abortedRunning: aborted }, 'download queue paused')
  return { paused: pausedRes.count, aborted }
}

export async function resumeQueue(): Promise<{ resumed: number }> {
  if (!paused) return { resumed: 0 }
  paused = false
  const prisma = getPrisma()
  const r = await prisma.downloadTask.updateMany({
    where: { status: 'paused' },
    data: { status: 'queued', lastError: null }
  })
  log().info({ resumed: r.count }, 'download queue resumed')
  schedulePump()
  return { resumed: r.count }
}

export async function stopQueue(): Promise<{ paused: number; aborted: number }> {
  // 语义同 pauseQueue —— "断点续传终止" 不删 .part。
  return pauseQueue()
}

export function isQueuePaused(): boolean {
  return paused
}

export async function listDownloadTasks(localUserId: number): Promise<Array<{
  id: number
  contentId: number
  kind: string
  status: string
  bytesDone: string
  bytesTotal: string | null
  attempts: number
  lastError: string | null
  enqueuedAt: string
  finishedAt: string | null
  title: string
  authorName: string
}>> {
  const prisma = getPrisma()
  const rows = await prisma.downloadTask.findMany({
    where: {
      content: {
        douyinAccount: { localUserId }
      }
    },
    orderBy: { id: 'desc' },
    include: {
      content: {
        select: { title: true, authorName: true }
      }
    }
  })
  return rows.map(row => ({
    id: row.id,
    contentId: row.contentId,
    kind: row.kind,
    status: row.status,
    bytesDone: row.bytesDone.toString(),
    bytesTotal: row.bytesTotal != null ? row.bytesTotal.toString() : null,
    attempts: row.attempts,
    lastError: row.lastError,
    enqueuedAt: row.enqueuedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    title: row.content.title,
    authorName: row.content.authorName
  }))
}

export async function resumeTask(localUserId: number, taskId: number): Promise<void> {
  const prisma = getPrisma()
  const task = await prisma.downloadTask.findFirst({
    where: {
      id: taskId,
      content: { douyinAccount: { localUserId } }
    }
  })
  if (!task) throw new AppError(ERR.NOT_FOUND, '下载任务不存在', 404)
  await prisma.downloadTask.update({
    where: { id: taskId },
    data: {
      status: 'queued',
      lastError: null,
      finishedAt: null
    }
  })
  schedulePump()
}

export async function deleteTask(localUserId: number, taskId: number): Promise<void> {
  const prisma = getPrisma()
  const task = await prisma.downloadTask.findFirst({
    where: {
      id: taskId,
      content: { douyinAccount: { localUserId } }
    }
  })
  if (!task) throw new AppError(ERR.NOT_FOUND, '下载任务不存在', 404)
  if (runningTasks.has(taskId)) {
    const running = runningTasks.get(taskId)
    try {
      running?.worker.postMessage({ type: 'abort', taskId })
    } catch {
      // ignore
    }
  }
  await prisma.downloadTask.delete({ where: { id: taskId } })
}
