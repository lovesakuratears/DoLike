import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import { loadConfig } from './config.js'
import { createLogger } from './core/logger.js'
import { getPrisma, disconnectPrisma } from './core/db.js'
import sessionPlugin from './auth/session.plugin.js'
import authRoutes from './auth/auth.controller.js'
import douyinRoutes from './douyin/douyin.controller.js'
import bridgeRoutes from './douyin/bridge.controller.js'
import cloakWsRoutes from './douyin/cloak.ws.js'
import archiveRoutes from './archive/archive.controller.js'
import libraryRoutes from './library/library.controller.js'
import mediaRoutes from './media/media.controller.js'
import progressGateway, { broadcastProgress } from './ws/progress.gateway.js'
import logsGateway from './ws/logs.gateway.js'
import {
  initDownloadQueue,
  shutdownDownloadQueue
} from './download/queue.service.js'
import { disposeAllBrowserSessions } from './douyin/browser.session.js'
import { getParserEndpoint } from './download/mode.service.js'
import parserRoutes from './download/parser.controller.js'

const cfg = loadConfig()
const logger = createLogger(cfg)

// 让 worker / queue 知道 archiveRoot
process.env.ARCHIVE_ROOT = cfg.archiveRoot

const app = Fastify({ logger: logger })

await app.register(cors, {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true)
    // 本地开发：允许任何 127.0.0.1 / localhost 端口（同机访问，单用户场景）
    if (/^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) return cb(null, true)
    if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true)
    if (/^chrome-extension:\/\//.test(origin)) return cb(null, true)
    if (/^moz-extension:\/\//.test(origin)) return cb(null, true)
    cb(new Error('CORS: 拒绝跨域'), false)
  },
  credentials: true
})

await app.register(cookie)
await app.register(sessionPlugin)
await app.register(websocket)

app.get('/api/health', async () => ({ code: 0, data: { ok: true }, message: '' }))
await app.register(authRoutes)
await app.register(douyinRoutes)
await app.register(bridgeRoutes)
await app.register(cloakWsRoutes)
await app.register(archiveRoutes)
await app.register(libraryRoutes)
await app.register(mediaRoutes)
await app.register(parserRoutes)
await app.register(progressGateway)
await app.register(logsGateway)

try {
  await getPrisma().$queryRaw`SELECT 1`
  await initDownloadQueue({
    concurrency: 3,
    broadcast: ev => broadcastProgress(ev)
  })
  await app.listen({ port: cfg.port, host: cfg.host })
  logger.info(`server ready on http://${cfg.host}:${cfg.port}`)
  logger.info(`archive root: ${cfg.archiveRoot}`)
  logger.info(`media parser: ${getParserEndpoint() ? 'configured' : 'unconfigured'}`)
} catch (err) {
  logger.error(err, 'failed to start server')
  await disconnectPrisma()
  process.exit(1)
}

const shutdown = async (signal: string) => {
  logger.info(`received ${signal}, shutting down`)
  await shutdownDownloadQueue()
  await disposeAllBrowserSessions()
  await app.close()
  await disconnectPrisma()
  process.exit(0)
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
