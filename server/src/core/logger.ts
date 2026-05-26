import pino from 'pino'
import pretty from 'pino-pretty'
import type { AppConfig } from '../config.js'
import { createLogSink } from './log-stream.js'

// 用 multistream 把日志同时写到：
//   - 控制台（pretty 或裸 JSON）
//   - 内置 sink（ring buffer + WS 订阅者）—— 永远是 JSON，便于前端解析
//
// 这样开发时控制台仍然好看，前端「日志」面板拿到结构化数据。
export function createLogger(cfg: AppConfig) {
  const sink = createLogSink()
  let consoleStream: NodeJS.WritableStream
  if (cfg.logPretty) {
    const prettyStream = pretty({
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname'
    })
    prettyStream.pipe(process.stdout)
    consoleStream = prettyStream
  } else {
    consoleStream = process.stdout
  }
  const instance = pino(
    {
      level: cfg.logLevel,
      serializers: { err: pino.stdSerializers.err }
    },
    pino.multistream([{ stream: consoleStream }, { stream: sink }])
  )
  singleton = instance
  return instance
}

export type Logger = ReturnType<typeof createLogger>

// 给非 Fastify 上下文（cloak.driver、archive worker 启动器 等）用的全局取数口。
// 必须在 createLogger 之后调用；否则返回一个 fallback pino 实例。
let singleton: Logger | null = null
let fallback: Logger | null = null
export function getLogger(): Logger {
  if (singleton) return singleton
  if (!fallback) fallback = pino({ level: 'info' }) as Logger
  return fallback
}
