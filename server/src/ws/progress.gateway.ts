// 下载 / 抓取进度 WS 推送
//
// 路由：GET /ws/progress
// 鉴权：必须已登录（cookie session）
// 协议：服务端单向 JSON push；客户端不需发送任何消息
//
// 事件：
//   { type: 'download.progress', taskId, contentId, kind, bytesDone, bytesTotal }
//   { type: 'download.done',     taskId, contentId, kind }
//   { type: 'download.failed',   taskId, contentId, kind, message }
//   { type: 'archive.summary',   accountId, post, like, collectVideo }

import type { FastifyInstance } from 'fastify'
import type { WebSocket } from '@fastify/websocket'
import { resolveSession, SESSION_COOKIE } from '../auth/auth.service.js'

const clients = new Set<WebSocket>()

export function broadcastProgress(ev: unknown): void {
  const data = JSON.stringify(ev)
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(data)
      } catch {
        /* 关闭中的 socket */
      }
    }
  }
}

export default async function progressGateway(app: FastifyInstance): Promise<void> {
  app.get('/ws/progress', { websocket: true }, async (socket: WebSocket, req) => {
    const token = req.cookies?.[SESSION_COOKIE]
    const user = await resolveSession(token)
    if (!user) {
      try {
        socket.send(JSON.stringify({ type: 'auth.failed', message: '未登录' }))
      } catch { /* ignore */ }
      socket.close()
      return
    }
    clients.add(socket)
    socket.on('close', () => clients.delete(socket))
    socket.on('error', () => clients.delete(socket))
    try {
      socket.send(JSON.stringify({ type: 'hello', userId: user.id }))
    } catch { /* ignore */ }
  })
}
