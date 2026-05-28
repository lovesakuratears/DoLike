// 防重复注入
if (window.bootstrapCollectorsLoaded) {
  // noop
} else {
  window.bootstrapCollectorsLoaded = true

  ;(function bootstrapCollectors() {
    const globalApi = window.__DOLIKE__ || {}
    console.log('[DoList] bootstrapCollectors: loaded, api keys:', Object.keys(globalApi))
    if (typeof globalApi.collectSelfProfile === 'function') return

    const ORIGIN = window.ORIGIN || 'https://www.douyin.com'
    const SEC_UID_RE = /\/user\/([A-Za-z0-9._-]{20,})/g
    const AWEME_ID_RE = /\/video\/(\d+)/g

    // 提取页面 cookie 中的 msToken（音乐 API 必需）
    function getMsToken() {
      const match = document.cookie.match(/(?:^|;\s*)msToken=([^;]+)/)
      return match ? match[1].trim() : ''
    }

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
      // 音乐 API 需要 msToken
      if (!qs.has('msToken')) {
        const msToken = getMsToken()
        if (msToken) qs.set('msToken', msToken)
      }
      return `${ORIGIN}${path}?${qs.toString()}`
    }

    function trySignUrl(url) {
      // 探测页面签名能力并缓存
      if (window.__DOLIKE_SIGNER__) {
        try {
          const signed = window.__DOLIKE_SIGNER__(url)
          if (signed) return signed
        } catch(e) {}
      }
      // 方法1: window.byted_acrawler.sign (旧版抖音)
      if (window.byted_acrawler && typeof window.byted_acrawler.sign === 'function') {
        try {
          const result = window.byted_acrawler.sign({ url })
          if (result && result.url) return result.url
          if (typeof result === 'string') return result
        } catch(e) {}
      }
      // 方法2: window.abogus.generate (新版)
      if (window.abogus) {
        try {
          if (typeof window.abogus.generate === 'function') {
            const signed = window.abogus.generate(url)
            if (signed) return signed
          }
          if (typeof window.abogus === 'function') {
            const signed = window.abogus(url)
            if (signed) return signed
          }
        } catch(e) {}
      }
      // 方法3: window.XBogus
      if (window.XBogus && typeof window.XBogus.build === 'function') {
        try {
          const signed = window.XBogus.build(url)
          if (signed) return signed
        } catch(e) {}
      }
      // 方法4: 搜索 webpack 模块里的签名函数
      try {
        // 抖音页面通常把签名器挂在 webpack 模块里
        for (const chunk of (window.webpackChunkdouyin_web || window.webpackChunk || [])) {
          if (!chunk || !chunk[1]) continue
          for (const [id, mod] of Object.entries(chunk[1])) {
            if (typeof mod === 'function') {
              const src = mod.toString()
              if (src.includes('a_bogus') && src.includes('sign')) {
                try {
                  const result = mod(null, url)
                  if (result && typeof result === 'string') {
                    window.__DOLIKE_SIGNER__ = (u) => mod(null, u)
                    console.log('[DoList] found webpack signer in chunk', id)
                    return result
                  }
                } catch(e) {}
              }
            }
          }
        }
      } catch(e) {}
      return null
    }

    function dyXhr(path, query, signedUrl) {
      const url = signedUrl || buildUrl(path, query)
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('GET', url, true)
        xhr.withCredentials = true
        xhr.setRequestHeader('Accept', 'application/json, text/plain, */*')
        xhr.setRequestHeader('Referer', ORIGIN + '/')
        xhr.setRequestHeader('Accept-Language', 'zh-CN,zh;q=0.9,en;q=0.8')
        xhr.onload = function () {
          if (xhr.status < 200 || xhr.status >= 300) {
            reject(new Error(`douyin ${path} ${xhr.status}`))
            return
          }
          try {
            const json = JSON.parse(xhr.responseText)
            resolve(json)
          } catch (e) {
            reject(new Error(`douyin ${path} parse error: ${e.message}`))
          }
        }
        xhr.onerror = function () { reject(new Error(`douyin ${path} network error`)) }
        xhr.send()
      })
    }

    async function dyGet(path, query) {
      let url = buildUrl(path, query)
      // 尝试用页面签名函数加 a_bogus
      const signed = trySignUrl(url)
      if (signed) {
        url = signed
        console.log(`[DoList] dyGet: signed url ${url}`)
      }
      console.log(`[DoList] dyGet: fetching ${url}`)
      const json = await dyXhr(path, query, url)
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

      // 音乐 API 需要 a_bogus 签名，页面自身没有暴露签名函数
      // 方案：通过 background 调后端签名代理（需要账号已绑定 cookie）
      for (let page = 0; page < maxPages; page++) {
        const query = {
          sec_user_id: 'self',
          count: 20,
          max_cursor: cursor,
          locate_query: false
        }

        let r = null

        // 先尝试后端签名代理
        try {
          r = await proxySignedRequest('/aweme/v1/web/music/listcollection/', query)
          if (r && typeof r === 'object' && !r.error) {
            console.log(`[DoList] music collector: proxy ok, status_code=${r.status_code ?? 0}`)
          }
        } catch (e) {
          console.warn('[DoList] music collector: proxy failed:', e?.message || e)
        }

        // 代理失败则尝试直接请求（不需要签名的端点可能成功）
        if (!r || r.error || (r.status_code && r.status_code !== 0)) {
          try {
            r = await dyGet('/aweme/v1/web/music/listcollection/', query)
            if (r && typeof r === 'object') {
              console.log(`[DoList] music collector: direct ok, status_code=${r.status_code ?? 0}`)
            }
          } catch (e) {
            console.warn('[DoList] music collector: direct failed:', e?.message || e)
          }
        }

        if (!r || r.error || (r.status_code && r.status_code !== 0)) {
          console.warn('[DoList] music collector: all methods failed, stopping. Last error:', r?.error || r?.status_msg)
          break
        }

        const items = Array.isArray(r?.music_list) ? r.music_list
          : Array.isArray(r?.aweme_list) ? r.aweme_list
          : Array.isArray(r?.data) ? r.data
          : []

        if (items.length === 0) break
        out.push(...items)
        if (!r?.has_more) break
        cursor = Number(r?.max_cursor) || cursor + items.length
        await new Promise(res => setTimeout(res, pageDelayMs))
      }

      if (out.length === 0) {
        console.warn('[DoList] collectCollectMusicList: no items from API, trying SSR data')
        const ssrData = tryExtractMusicFromPage()
        if (ssrData.length > 0) {
          console.log(`[DoList] collectCollectMusicList: extracted ${ssrData.length} items from page SSR`)
          return ssrData
        }
        console.warn('[DoList] collectCollectMusicList: no items collected, falling back to visible awemes')
        return fallbackVisibleAwemes()
      }
      console.log(`[DoList] collectCollectMusicList: collected ${out.length} music items`)
      return out
    }

    // 通过 background 调后端签名代理
    function proxySignedRequest(path, query) {
      return new Promise((resolve, reject) => {
        try {
          chrome.runtime.sendMessage(
            { type: 'signedProxy', path, query },
            (response) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message))
                return
              }
              resolve(response)
            }
          )
        } catch (e) {
          reject(e)
        }
      })
    }

    // 尝试从页面 SSR/SPA 数据中提取音乐列表
    function tryExtractMusicFromPage() {
      const results = []
      try {
        // 方法1: window.__INITIAL_STATE__ (SSR 数据)
        const initState = window.__INITIAL_STATE__
        if (initState) {
          console.log('[DoList] SSR: __INITIAL_STATE__ found, keys:', Object.keys(initState))
          // 递归搜索 music_list
          const musicList = findMusicList(initState)
          if (musicList && musicList.length > 0) {
            return musicList
          }
        }
        // 方法2: window.__SSR_DATA__
        const ssrData = window.__SSR_DATA__
        if (ssrData) {
          console.log('[DoList] SSR: __SSR_DATA__ found')
          const musicList = findMusicList(ssrData)
          if (musicList && musicList.length > 0) return musicList
        }
        // 方法3: 从 DOM 中提取 musicId
        const musicIds = new Set()
        // 音乐收藏页面的链接格式
        const links = document.querySelectorAll('a[href*="music-detail"]')
        for (const a of links) {
          const href = a.getAttribute('href') || ''
          const m = /music-detail\?music_id=(\d+)/.exec(href)
          if (m) musicIds.add(m[1])
        }
        if (musicIds.size > 0) {
          console.log(`[DoList] SSR: found ${musicIds.size} music links in DOM`)
          // 有 musicId 但没详细信息，返回 ID 列表让后端用 detail API 补全
          for (const id of musicIds) {
            results.push({ id, id_str: String(id), __fromDom: true })
          }
        }
      } catch (e) {
        console.warn('[DoList] SSR extraction error:', e)
      }
      return results
    }

    function findMusicList(obj, depth = 0) {
      if (depth > 10 || !obj || typeof obj !== 'object') return null
      if (Array.isArray(obj)) {
        // 检查是否是音乐列表
        if (obj.length > 0 && (obj[0].music_id || obj[0].id || obj[0].title)) {
          return obj
        }
        for (const item of obj) {
          const found = findMusicList(item, depth + 1)
          if (found) return found
        }
        return null
      }
      // 直接包含 music_list 键
      if (Array.isArray(obj.music_list)) return obj.music_list
      if (Array.isArray(obj.musicList)) return obj.musicList
      // 递归搜索
      for (const val of Object.values(obj)) {
        if (val && typeof val === 'object') {
          const found = findMusicList(val, depth + 1)
          if (found) return found
        }
      }
      return null
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
