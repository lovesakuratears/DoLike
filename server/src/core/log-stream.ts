// 日志管道 —— 拦截 pino 的 NDJSON 输出，环形缓冲最近 N 条 + 推送给订阅者
//
// 给前端「日志」面板使用：WS 连上时先回放 buffer，之后实时推。
// 注意：cookie / token 等敏感字段在写日志时就不该出现；此处只做按行 JSON 转发。

import { Writable } from 'node:stream'

export interface LogRecord {
  level: number
  time: number
  msg?: string
  pid?: number
  hostname?: string
  [k: string]: unknown
}

const MAX_BUFFER = 500

const ring: LogRecord[] = []
const noisyRing: LogRecord[] = []
const listeners = new Set<(rec: LogRecord) => void>()
const noisyListeners = new Set<(rec: LogRecord) => void>()
const noisyReqIds = new Set<string>()

const NOISY_URL_PREFIXES = ['/api/archive/progress', '/api/download/tasks']

export function getRecent(): LogRecord[] {
  return ring.slice()
}

export function getRecentNoisy(): LogRecord[] {
  return noisyRing.slice()
}

export function subscribeLogs(fn: (rec: LogRecord) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function subscribeNoisyLogs(fn: (rec: LogRecord) => void): () => void {
  noisyListeners.add(fn)
  return () => noisyListeners.delete(fn)
}

function isNoisyAccessLog(rec: LogRecord): boolean {
  const msg = typeof rec.msg === 'string' ? rec.msg : ''
  const reqId = typeof rec.reqId === 'string' ? rec.reqId : ''
  if (msg === 'incoming request' || msg === 'request completed') {
    // 主日志不展示 Fastify 访问日志，统一进入 noisy 通道，避免轮询刷屏。
    if (msg === 'incoming request') {
      const req = rec.req as { url?: unknown } | undefined
      const url = typeof req?.url === 'string' ? req.url : ''
      const noisy = NOISY_URL_PREFIXES.some(prefix => url.startsWith(prefix))
      if (noisy && reqId) noisyReqIds.add(reqId)
    }
    if (msg === 'request completed' && reqId && noisyReqIds.has(reqId)) {
      noisyReqIds.delete(reqId)
    }
    return true
  }
  return false
}

function pushTo(target: LogRecord[], fns: Set<(rec: LogRecord) => void>, rec: LogRecord): void {
  target.push(rec)
  if (target.length > MAX_BUFFER) target.shift()
  for (const fn of fns) {
    try {
      fn(rec)
    } catch {
      /* listener 异常不影响其他 */
    }
  }
}

function push(rec: LogRecord): void {
  if (isNoisyAccessLog(rec)) {
    pushTo(noisyRing, noisyListeners, rec)
    return
  }
  ring.push(rec)
  if (ring.length > MAX_BUFFER) ring.shift()
  for (const fn of listeners) {
    try {
      fn(rec)
    } catch {
      /* listener 异常不影响其他 */
    }
  }
}

// 给 pino.multistream 用的 sink：每写入一段，按 \n 分行 + JSON.parse
export function createLogSink(): Writable {
  let leftover = ''
  return new Writable({
    write(chunk, _enc, cb) {
      const text = leftover + chunk.toString('utf8')
      const lines = text.split('\n')
      leftover = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const rec = JSON.parse(trimmed) as LogRecord
          push(rec)
        } catch {
          /* 非 JSON 行（理论上不会出现）忽略 */
        }
      }
      cb()
    }
  })
}
