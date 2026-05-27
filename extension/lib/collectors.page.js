// 防重复注入
if (window.bootstrapCollectorsLoaded) {
  // noop
} else {
  window.bootstrapCollectorsLoaded = true

  ;(function bootstrapCollectors() {
    const globalApi = window.__DOLIKE__ || {}
    if (typeof globalApi.collectSelfProfile === 'function') return

    const ORIGIN = window.ORIGIN || 'https://www.douyin.com'
    const SEC_UID_RE = /\/user\/([A-Za-z0-9._-]{20,})/g
    const AWEME_ID_RE = /\/video\/(\d+)/g

    function pickText(selectors) {
      for (const sel of selectors) {
        const el = document.querySelector(sel)
        const text = el?.textContent?.trim()
        if (text) return text
      }
      return ''
    }

    function pickAttr(selectors, attr) {
      for (const sel of selectors) {
        const el = document.querySelector(sel)
        const value = el?.getAttribute?.(attr)?.trim()
        if (value) return value
      }
      return ''
    }

    function buildUrl(path, query) {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(query || {})) {
        if (v === undefined || v === null) continue
        qs.set(k, String(v))
      }
      return `${ORIGIN}${path}?${qs.toString()}`
    }

    async function dyGet(path, query) {
      const url = buildUrl(path, query)
      const r = await fetch(url, { credentials: 'include' })
      if (!r.ok) throw new Error(`douyin ${path} ${r.status}`)
      const json = await r.json()
      if (json && typeof json === 'object' && 'status_code' in json && json.status_code !== 0) {
        const msg = json.status_msg || `status_code=${json.status_code}`
        throw new Error(`douyin 接口风控：${msg}`)
      }
      return json
    }

    function findSecUidFromDocument() {
      const hrefs = []
      for (const a of Array.from(document.querySelectorAll('a[href*="/user/"]'))) {
        const href = a.getAttribute('href') || ''
        if (href) hrefs.push(href)
      }
      const html = `${document.documentElement.outerHTML}\n${hrefs.join('\n')}`
      const matches = [...html.matchAll(SEC_UID_RE)]
        .map(m => m[1])
        .filter(x => x && x !== 'self')
      return matches.find(x => x.startsWith('MS4w')) || matches[0] || ''
    }

    function collectScopedAwemeIds() {
      const selectors = [
        '#user_detail_element ul li a[href*="/video/"]',
        '#user_detail_element a[href*="/video/"]'
      ]
      const ids = []
      for (const sel of selectors) {
        for (const a of Array.from(document.querySelectorAll(sel))) {
          const href = a.getAttribute('href') || ''
          const m = /\/video\/(\d+)/.exec(href)
          if (m?.[1] && !ids.includes(m[1])) ids.push(m[1])
        }
        if (ids.length > 0) break
      }
      return ids
    }

    async function fetchAwemeDetail(awemeId) {
      const r = await dyGet('/aweme/v1/web/aweme/detail/', { aweme_id: awemeId })
      return r?.aweme_detail || null
    }

    async function hydrateAwemesByDetail(items, opts = {}) {
      const { pageDelayMs = 120 } = opts
      const out = []
      for (const item of Array.isArray(items) ? items : []) {
        const awemeId = item?.aweme_id
        if (!awemeId) continue
        try {
          const detail = await fetchAwemeDetail(awemeId)
          if (detail?.aweme_id) {
            // 保留列表接口附带的上下文信息（如 folderId / mixId）
            if (item.__folderId) detail.__folderId = item.__folderId
            if (item.__mixId) detail.__mixId = item.__mixId
            out.push(detail)
          } else {
            out.push(item)
          }
        } catch {
          out.push(item)
        }
        if (pageDelayMs > 0) {
          await new Promise(res => setTimeout(res, pageDelayMs))
        }
      }
      return out
    }

    async function fallbackVisibleAwemes() {
      const ids = collectScopedAwemeIds()
      const out = []
      for (const id of ids) {
        try {
          const detail = await fetchAwemeDetail(id)
          if (detail?.aweme_id) out.push(detail)
        } catch {
          // ignore single item
        }
      }
      return out
    }

    function readSelfFromDocument() {
      const secUid = findSecUidFromDocument()
      if (secUid) return { secUid }
      return null
    }

    async function collectSelfProfile() {
      const domNickname = pickText([
        '#user_detail_element h1 span',
        '#user_detail_element h1',
        '[data-e2e="user-name"]',
        '[data-e2e="user-info"] h1'
      ])
      const domAvatarUrl = pickAttr([
        '#user_detail_element img[alt*="头像"]',
        '#user_detail_element img',
        '[data-e2e="user-avatar"] img'
      ], 'src')

      try {
        const r = await dyGet('/aweme/v1/web/user/profile/self/', {})
        const user = r?.user || {}
        const secUid = user.sec_uid || user.secUid || ''
        const nickname = user.nickname || ''
        const avatar = user.avatar_larger || user.avatar_thumb || user.avatar_medium
        const avatarUrl = avatar?.url_list?.[0] || ''
        if (secUid) {
          return {
            secUid,
            nickname: nickname || domNickname || '抖音用户',
            avatarUrl: avatarUrl || domAvatarUrl
          }
        }
      } catch {
        // ignore
      }

      const fromDoc = readSelfFromDocument()
      if (fromDoc) {
        try {
          const r = await dyGet('/aweme/v1/web/user/profile/other/', {
            sec_user_id: fromDoc.secUid,
            publish_video_strategy_type: 2,
            personal_center_strategy: 1
          })
          const user = r?.user || {}
          const avatar = user.avatar_larger || user.avatar_thumb || user.avatar_medium
          return {
            secUid: fromDoc.secUid,
            nickname: user.nickname || domNickname || '抖音用户',
            avatarUrl: avatar?.url_list?.[0] || domAvatarUrl
          }
        } catch {
          return {
            secUid: fromDoc.secUid,
            nickname: domNickname || '抖音用户',
            avatarUrl: domAvatarUrl
          }
        }
      }

      throw new Error('未识别到真实 sec_uid —— 请进入你自己的抖音主页后再点“绑定插件”')
    }

    async function collectPostList(secUid, opts = {}) {
      const { pageDelayMs = 800, maxPages = 200 } = opts
      const out = []
      let cursor = 0
      for (let page = 0; page < maxPages; page++) {
        const r = await dyGet('/aweme/v1/web/aweme/post/', {
          sec_user_id: secUid,
          count: 18,
          max_cursor: cursor,
          locate_query: false,
          show_live_replay_strategy: 1
        })
        const items = Array.isArray(r?.aweme_list) ? r.aweme_list : []
        out.push(...items)
        if (!r?.has_more || items.length === 0) break
        cursor = Number(r?.max_cursor) || cursor + items.length
        await new Promise(res => setTimeout(res, pageDelayMs))
      }
      if (out.length === 0) return fallbackVisibleAwemes()
      return hydrateAwemesByDetail(out, { pageDelayMs: 120 })
    }

    async function collectLikeList(secUid, opts = {}) {
      const { pageDelayMs = 800, maxPages = 200 } = opts
      const out = []
      let cursor = 0
      for (let page = 0; page < maxPages; page++) {
        const r = await dyGet('/aweme/v1/web/aweme/favorite/', {
          sec_user_id: secUid,
          count: 18,
          max_cursor: cursor,
          min_cursor: 0
        })
        const items = Array.isArray(r?.aweme_list) ? r.aweme_list : []
        out.push(...items)
        if (!r?.has_more || items.length === 0) break
        cursor = Number(r?.max_cursor) || cursor + items.length
        await new Promise(res => setTimeout(res, pageDelayMs))
      }
      if (out.length === 0) return fallbackVisibleAwemes()
      return hydrateAwemesByDetail(out, { pageDelayMs: 120 })
    }

    async function collectCollectVideoList(opts = {}) {
      const { pageDelayMs = 800, maxPages = 200 } = opts
      const out = []
      let cursor = 0

      const requestPage = async (cur) => {
        const candidates = [
          {
            path: '/aweme/v1/web/aweme/listcollection/',
            query: { count: 18, cursor: cur }
          },
          {
            path: '/aweme/v1/web/aweme/collect/',
            query: { count: 18, cursor: cur }
          },
          {
            path: '/aweme/v1/web/aweme/collect/list/',
            query: { count: 18, cursor: cur }
          }
        ]
        for (const c of candidates) {
          try {
            const r = await dyGet(c.path, c.query)
            if (r && typeof r === 'object') return r
          } catch (e) {
            // 尝试下一条候选接口；全部失败再由外层降级
            void e
          }
        }
        throw new Error('收藏视频接口不可用（全部候选路径失败）')
      }

      for (let page = 0; page < maxPages; page++) {
        try {
          const r = await requestPage(cursor)
          const items = Array.isArray(r?.aweme_list) ? r.aweme_list : []
          out.push(...items)
          if (!r?.has_more || items.length === 0) break
          cursor = Number(r?.cursor) || cursor + items.length
          await new Promise(res => setTimeout(res, pageDelayMs))
        } catch {
          // 接口失效时退回可见列表，至少保证「推送当前看到的收藏」可用。
          return fallbackVisibleAwemes()
        }
      }
      if (out.length === 0) return fallbackVisibleAwemes()
      return hydrateAwemesByDetail(out, { pageDelayMs: 120 })
    }

    async function collectWatchLaterList(opts = {}) {
      const { pageDelayMs = 800, maxPages = 200 } = opts
      const out = []
      let offset = 0
      for (let page = 0; page < maxPages; page++) {
        const r = await dyGet('/aweme/v1/web/watchlater/list/', {
          offset,
          list_type: 0,
          operate_type: 0
        })
        const items = Array.isArray(r?.data) ? r.data : Array.isArray(r?.aweme_list) ? r.aweme_list : []
        out.push(...items)
        const hasMore = Boolean(r?.has_more || (typeof r?.cursor === 'number' && items.length > 0))
        if (!hasMore || items.length === 0) break
        offset = Number(r?.offset ?? r?.cursor ?? offset + items.length)
        await new Promise(res => setTimeout(res, pageDelayMs))
      }
      if (out.length === 0) return fallbackVisibleAwemes()
      return hydrateAwemesByDetail(out, { pageDelayMs: 120 })
    }

    async function collectCollectFolderVideoList(opts = {}) {
      const { pageDelayMs = 800, maxPages = 200 } = opts
      const folders = []
      const out = []
      let folderCursor = ''

      try {
        for (let page = 0; page < 50; page++) {
          const r = await dyGet('/aweme/v1/web/collects/list/', {
            count: 20,
            cursor: folderCursor
          })
          const list = Array.isArray(r?.collects_list) ? r.collects_list : []
          folders.push(...list)
          if (!r?.has_more || list.length === 0) break
          folderCursor = String(r?.cursor ?? '')
          await new Promise(res => setTimeout(res, pageDelayMs))
        }
      } catch {
        return fallbackVisibleAwemes()
      }

      if (folders.length === 0) return fallbackVisibleAwemes()

      for (const folder of folders) {
        const folderId = folder?.collects_id_str || String(folder?.collects_id || '')
        if (!folderId) continue
        let cursor = ''
        for (let page = 0; page < maxPages; page++) {
          try {
            const r = await dyGet('/aweme/v1/web/collects/video/list/', {
              collects_id: folderId,
              count: 20,
              cursor
            })
            const items = Array.isArray(r?.aweme_list) ? r.aweme_list : []
            for (const item of items) item.__folderId = folderId
            out.push(...items)
            if (!r?.has_more || items.length === 0) break
            cursor = String(r?.max_cursor ?? r?.cursor ?? '')
            await new Promise(res => setTimeout(res, pageDelayMs))
          } catch {
            // 某个收藏夹被风控时，跳过该收藏夹继续抓其它收藏夹；
            // 若全部失败，最终再退回当前页面可见视频兜底。
            break
          }
        }
      }

      if (out.length === 0) return fallbackVisibleAwemes()
      return hydrateAwemesByDetail(out, { pageDelayMs: 120 })
    }


    async function collectCollectMusicList(opts = {}) {
      const { pageDelayMs = 800, maxPages = 200 } = opts
      const out = []
      let cursor = 0

      for (let page = 0; page < maxPages; page++) {
        let r = null
        const candidates = [
          { path: '/aweme/v1/web/music/listcollection/', query: { count: 20, cursor } },
          { path: '/aweme/v1/web/music/collect/list/', query: { count: 20, cursor } },
          { path: '/aweme/v1/web/music/list/', query: { count: 20, cursor } }
        ]
        for (const c of candidates) {
          try {
            r = await dyGet(c.path, c.query)
            if (r && typeof r === 'object') break
          } catch (e) {
            void e
          }
        }
        if (!r) break

        const items = Array.isArray(r?.music_list) ? r.music_list
          : Array.isArray(r?.aweme_list) ? r.aweme_list
          : Array.isArray(r?.data) ? r.data
          : []
        if (items.length === 0) break
        out.push(...items)
        if (!r?.has_more) break
        cursor = Number(r?.cursor) || cursor + items.length
        await new Promise(res => setTimeout(res, pageDelayMs))
      }

      if (out.length === 0) return fallbackVisibleAwemes()
      return out
    }

    window.__DOLIKE__ = window.__DOLIKE__ || {}
    window.__DOLIKE__.collectSelfProfile = collectSelfProfile
    window.__DOLIKE__.collectPostList = collectPostList
    window.__DOLIKE__.collectLikeList = collectLikeList
    window.__DOLIKE__.collectCollectVideoList = collectCollectVideoList
    window.__DOLIKE__.collectWatchLaterList = collectWatchLaterList
    window.__DOLIKE__.collectCollectFolderVideoList = collectCollectFolderVideoList
    window.__DOLIKE__.collectCollectMusicList = collectCollectMusicList
  })()
}
