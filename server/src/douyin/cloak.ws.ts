import type { FastifyInstance } from 'fastify'
import { peekSession } from './cloak.driver.js'
import type { CloakEvent } from './types.js'

// WS：/ws/douyin/cloak?session=xxx
// 服务端只向客户端推送事件，不接收客户端消息。
export default async function cloakWsRoutes(app: FastifyInstance) {
  app.get('/ws/douyin/cloak', { websocket: true }, (socket, req) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const sid = url.searchParams.get('session') || ''
    const sess = peekSession(sid)
    if (!sess) {
      socket.send(
        JSON.stringify({
          sessionId: sid,
          stage: 'failed',
          message: '会话不存在或已过期'
        } satisfies CloakEvent)
      )
      socket.close()
      return
    }

    const isTerminal = (s: string): boolean =>
      s === 'success' || s === 'failed' || s === 'timeout'

    // 完整重放最近一次事件（带 qrImage / message / accountId），
    // 没有 lastEvent 时回退到裸 stage。
    const initial: CloakEvent = sess.lastEvent ?? { sessionId: sess.id, stage: sess.stage }
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(initial))
    }

    if (isTerminal(initial.stage)) {
      socket.close()
      return
    }

    const onEvent = (ev: CloakEvent) => {
      if (socket.readyState !== socket.OPEN) return
      socket.send(JSON.stringify(ev))
      if (isTerminal(ev.stage)) {
        socket.close()
      }
    }
    sess.emitter.on('event', onEvent)
    socket.on('close', () => sess.emitter.off('event', onEvent))
  })
}
