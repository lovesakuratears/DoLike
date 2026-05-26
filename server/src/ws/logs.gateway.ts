// 实时日志推送 —— /ws/logs
//
// 行为：
//   - 连接后立刻回放最近 N 条
//   - 之后每条新日志实时 push
//   - 必须已登录（cookie session）
//
// 协议：服务端单向 JSON push；不消费客户端消息
//   { type: 'log.replay', records: [...] }
//   { type: 'log.append', record: {...} }
//   { type: 'auth.failed', message: '未登录' }

import type { FastifyInstance } from 'fastify'
import type { WebSocket } from '@fastify/websocket'
import { resolveSession, SESSION_COOKIE } from '../auth/auth.service.js'
import { getRecent, getRecentNoisy, subscribeLogs, subscribeNoisyLogs } from '../core/log-stream.js'

export default async function logsGateway(app: FastifyInstance): Promise<void> {
  const setupWs = async (socket: WebSocket, req: { cookies?: Record<string, string | undefined> }, noisy = false) => {
    const token = req.cookies?.[SESSION_COOKIE]
    const user = await resolveSession(token)
    if (!user) {
      try {
        socket.send(JSON.stringify({ type: 'auth.failed', message: '未登录' }))
      } catch { /* ignore */ }
      socket.close()
      return
    }

    try {
      socket.send(JSON.stringify({ type: 'log.replay', records: noisy ? getRecentNoisy() : getRecent() }))
    } catch { /* socket 立即关闭的情况 */ }

    const subscribe = noisy ? subscribeNoisyLogs : subscribeLogs
    const unsubscribe = subscribe(rec => {
      if (socket.readyState !== socket.OPEN) return
      try {
        socket.send(JSON.stringify({ type: 'log.append', record: rec }))
      } catch { /* ignore */ }
    })

    socket.on('close', () => unsubscribe())
    socket.on('error', () => unsubscribe())
  }

  app.get('/ws/logs', { websocket: true }, async (socket: WebSocket, req) => {
    await setupWs(socket, req, false)
  })

  // 高频轮询日志（/api/archive/progress、/api/download/tasks）单独通道，避免主日志刷屏
  app.get('/ws/logs/noisy', { websocket: true }, async (socket: WebSocket, req) => {
    await setupWs(socket, req, true)
  })
}
