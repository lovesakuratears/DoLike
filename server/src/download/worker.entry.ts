// 下载 worker —— 跑在 worker_threads 子线程
//
// 职责（边界严格）：
//   ✅ HTTP I/O（含 Range 续传）
//   ✅ 写 .part 文件 → rename 成最终文件
//   ✅ 每 200ms 上报 progress
//   ❌ 不碰 Prisma / DB（避免多 writer 并发坑）
//   ❌ 不解析业务字段
//
// 协议：
//   主线程 → worker：postMessage({ type:'start', task: { id, url, targetPath, headers? } })
//                     postMessage({ type:'abort', taskId })
//   worker → 主线程：postMessage({ type:'progress', taskId, bytesDone, bytesTotal })
//                     postMessage({ type:'done', taskId, finalPath, size })
//                     postMessage({ type:'error', taskId, message, retryable })

import { parentPort } from 'node:worker_threads'
import { createWriteStream, promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { request } from 'undici'
import { rangeHeaderFor, statPart } from './range.js'

interface StartMsg {
  type: 'start'
  task: {
    id: number
    url: string
    targetPath: string  // final path; .part is targetPath + '.part'
    headers?: Record<string, string>
  }
}

interface AbortMsg {
  type: 'abort'
  taskId: number
}

type InMsg = StartMsg | AbortMsg

interface OutMsg {
  type: 'progress' | 'done' | 'error'
  taskId: number
  bytesDone?: number
  bytesTotal?: number
  finalPath?: string
  size?: number
  message?: string
  retryable?: boolean
}

interface RequestResult {
  statusCode: number
  headers: Record<string, string | string[] | undefined>
  body: NodeJS.ReadableStream
}

const aborters = new Map<number, AbortController>()

if (!parentPort) {
  throw new Error('worker.entry: must be loaded as worker_threads worker')
}

parentPort.on('message', (msg: InMsg) => {
  if (msg.type === 'start') {
    runTask(msg.task).catch(e => {
      post({
        type: 'error',
        taskId: msg.task.id,
        message: e instanceof Error ? e.message : String(e),
        retryable: true
      })
    })
  } else if (msg.type === 'abort') {
    const ac = aborters.get(msg.taskId)
    if (ac) ac.abort()
  }
})

function post(m: OutMsg): void {
  parentPort!.postMessage(m)
}

async function runTask(task: StartMsg['task']): Promise<void> {
  const ac = new AbortController()
  aborters.set(task.id, ac)
  const partPath = task.targetPath + '.part'
  await fs.mkdir(dirname(task.targetPath), { recursive: true })

  const part = await statPart(partPath)
  const headers: Record<string, string> = {
    'user-agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    referer: 'https://www.douyin.com/',
    ...(task.headers ?? {})
  }
  const rh = rangeHeaderFor(part.size)
  if (rh) headers['range'] = rh

  let res: RequestResult
  try {
    res = await requestWithRedirects(task.url, headers, ac.signal)
  } catch (e) {
    aborters.delete(task.id)
    post({
      type: 'error',
      taskId: task.id,
      message: `连接失败：${(e as Error).message}`,
      retryable: true
    })
    return
  }

  // 200 = 不支持 Range；206 = 续传 OK
  if (res.statusCode === 416) {
    // 已下载完整 —— 直接 rename
    try {
      await fs.rename(partPath, task.targetPath)
      const st = await fs.stat(task.targetPath)
      post({ type: 'done', taskId: task.id, finalPath: task.targetPath, size: Number(st.size) })
    } catch (e) {
      post({
        type: 'error',
        taskId: task.id,
        message: `重命名失败：${(e as Error).message}`,
        retryable: false
      })
    }
    aborters.delete(task.id)
    return
  }

  if (res.statusCode === 404 || res.statusCode === 403 || res.statusCode === 410) {
    aborters.delete(task.id)
    post({
      type: 'error',
      taskId: task.id,
      message: `HTTP ${res.statusCode}（链接已失效）`,
      retryable: false
    })
    return
  }

  if (res.statusCode < 200 || res.statusCode >= 300) {
    aborters.delete(task.id)
    post({
      type: 'error',
      taskId: task.id,
      message: `HTTP ${res.statusCode}`,
      retryable: true
    })
    return
  }

  // 解析总大小
  const isResumed = res.statusCode === 206
  let totalSize: number | undefined
  const contentLength = res.headers['content-length']
  const contentRange = res.headers['content-range']
  if (isResumed && typeof contentRange === 'string') {
    const m = /\/(\d+)$/.exec(contentRange)
    if (m && m[1]) totalSize = Number(m[1])
  } else if (typeof contentLength === 'string') {
    totalSize = Number(contentLength) + (isResumed ? part.size : 0)
  }

  // 服务器不支持 Range：从头下，先清掉 part
  if (!isResumed && part.size > 0) {
    try {
      await fs.unlink(partPath)
    } catch {
      /* ignore */
    }
  }

  // 写入 .part —— append 模式仅在 206 时使用
  const flags = isResumed && part.size > 0 ? 'a' : 'w'
  const sink = createWriteStream(partPath, { flags })

  let bytesDone = isResumed ? part.size : 0
  let lastReport = 0
  res.body.on('data', (chunk: Buffer) => {
    bytesDone += chunk.length
    const now = Date.now()
    if (now - lastReport >= 200) {
      lastReport = now
      post({ type: 'progress', taskId: task.id, bytesDone, bytesTotal: totalSize })
    }
  })

  try {
    await pipeline(res.body, sink)
    await fs.rename(partPath, task.targetPath)
    const st = await fs.stat(task.targetPath)
    post({
      type: 'done',
      taskId: task.id,
      finalPath: task.targetPath,
      size: Number(st.size)
    })
  } catch (e) {
    if (ac.signal.aborted) {
      post({ type: 'error', taskId: task.id, message: '已取消', retryable: true })
    } else {
      post({
        type: 'error',
        taskId: task.id,
        message: `写入失败：${(e as Error).message}`,
        retryable: true
      })
    }
  } finally {
    aborters.delete(task.id)
  }
}

async function requestWithRedirects(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  redirects = 0
): Promise<RequestResult> {
  const res = await request(url, {
    method: 'GET',
    headers,
    signal,
    headersTimeout: 15_000,
    bodyTimeout: 0
  })

  if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
    const location = res.headers.location
    if (!location) {
      throw new Error(`HTTP ${res.statusCode}`)
    }
    if (redirects >= 5) {
      throw new Error(`重定向过多：${res.statusCode}`)
    }
    const nextUrl = new URL(location, url).toString()
    return requestWithRedirects(nextUrl, headers, signal, redirects + 1)
  }

  return res as unknown as RequestResult
}
