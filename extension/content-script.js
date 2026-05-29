// content-script —— 注入到 douyin.com，主要负责在「我的主页」浮一个"一键归档"按钮
//
// 真正的抓取走 background.js + chrome.scripting MAIN world；content-script 只是入口。

const SELF_USER_RE = /^\/user\/[^/]+/
const BTN_ID = 'dolike-archive-fab'
const MENU_ID = 'dolike-archive-menu'

function ensureFab() {
  if (document.getElementById(BTN_ID)) return
  if (!SELF_USER_RE.test(location.pathname)) return

  const btn = document.createElement('button')
  btn.id = BTN_ID
  btn.textContent = 'DoLike 归档'
  Object.assign(btn.style, {
    position: 'fixed',
    right: '24px',
    bottom: '24px',
    zIndex: '99999',
    padding: '10px 16px',
    background: '#000',
    color: '#fff',
    border: '0',
    borderRadius: '999px',
    cursor: 'pointer',
    fontSize: '14px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.25)'
  })

  btn.addEventListener('click', () => toggleMenu(btn))
  document.body.appendChild(btn)
}

function sendAction(payload, successText) {
  if (!chrome?.runtime?.id || typeof chrome.runtime.sendMessage !== 'function') {
    flash('扩展上下文已失效，请重新加载 DoLike 扩展', '#d24a52')
    return
  }
  console.log('[DoList] sendAction:', payload.type, payload.linkKind || '')
  flash('处理中…', '#444')
  let settled = false
  const timer = setTimeout(() => {
    if (settled) return
    settled = true
    flash(`${payload.type === 'init' ? '绑定' : '推送'}超时：后台 Service Worker 未响应，请检查扩展日志', '#d24a52`)
  }, 12000)
  chrome.runtime.sendMessage(payload, resp => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    if (chrome.runtime.lastError) {
      flash(`扩展通信失败：${chrome.runtime.lastError.message}`, '#d24a52')
      return
    }
    if (resp?.ok) {
      if (payload.type === 'init') {
        const nickname = resp?.data?.profile?.nickname || resp?.data?.dto?.nickname || '抖音用户'
        flash(`绑定成功：${nickname}`, '#22a06b')
        return
      }
      if (payload.type === 'pushCookie') {
        const nickname = resp?.data?.dto?.nickname || resp?.data?.profile?.nickname || '抖音用户'
        flash(`Cookie 已推送：${nickname}`, '#22a06b')
        return
      }
      flash(`${successText} ${resp.data?.pushed ?? 0} 条`, '#22a06b')
    } else {
      flash(resp?.error || '推送失败', '#d24a52')
    }
  })
}

function toggleMenu(btn) {
  const old = document.getElementById(MENU_ID)
  if (old) {
    old.remove()
    return
  }
  const menu = document.createElement('div')
  menu.id = MENU_ID
  Object.assign(menu.style, {
    position: 'fixed',
    right: '24px',
    bottom: '76px',
    zIndex: '99999',
    width: '180px',
    background: '#fff',
    borderRadius: '12px',
    boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
    border: '1px solid rgba(0,0,0,0.08)',
    overflow: 'hidden'
  })

  const actions = [
    ['绑定插件', () => sendAction({ type: 'init' }, '绑定完成')],
    ['推送 Cookie', () => sendAction({ type: 'pushCookie' }, 'Cookie 已推送')],
    ['推送作品', () => sendAction({ type: 'push', linkKind: 'POST' }, '已推送作品')],
    ['推送喜欢', () => sendAction({ type: 'push', linkKind: 'LIKE' }, '已推送喜欢')],
    ['推送收藏', () => sendAction({ type: 'push', linkKind: 'FAVORITE' }, '已推送收藏')],
    ['推送稍后再看', () => sendAction({ type: 'push', linkKind: 'WATCH_LATER' }, '已推送稍后再看')],
    ['推送收藏夹视频', () => sendAction({ type: 'push', linkKind: 'COLLECT_FOLDER' }, '已推送收藏夹视频')]
  ]

  for (const [text, handler] of actions) {
    const item = document.createElement('button')
    item.textContent = text
    Object.assign(item.style, {
      display: 'block',
      width: '100%',
      padding: '11px 14px',
      textAlign: 'left',
      background: '#fff',
      border: '0',
      borderBottom: '1px solid rgba(0,0,0,0.06)',
      cursor: 'pointer',
      fontSize: '13px'
    })
    item.addEventListener('click', () => {
      menu.remove()
      handler()
    })
    item.addEventListener('mouseenter', () => { item.style.background = '#f5f5f5' })
    item.addEventListener('mouseleave', () => { item.style.background = '#fff' })
    menu.appendChild(item)
  }

  document.body.appendChild(menu)
  const close = ev => {
    if (menu.contains(ev.target) || btn.contains(ev.target)) return
    menu.remove()
    document.removeEventListener('mousedown', close, true)
  }
  document.addEventListener('mousedown', close, true)
}

function flash(text, bg) {
  const el = document.createElement('div')
  el.textContent = text
  Object.assign(el.style, {
    position: 'fixed',
    right: '24px',
    bottom: '80px',
    zIndex: '99999',
    padding: '10px 14px',
    background: bg,
    color: '#fff',
    borderRadius: '8px',
    fontSize: '13px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
    maxWidth: '300px'
  })
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 4000)
}

// 抖音是 SPA，URL 变化时再次检查
let lastPath = location.pathname
setInterval(() => {
  if (location.pathname !== lastPath) {
    lastPath = location.pathname
    const old = document.getElementById(BTN_ID)
    if (old) old.remove()
    const menu = document.getElementById(MENU_ID)
    if (menu) menu.remove()
    ensureFab()
  }
}, 1500)

ensureFab()
