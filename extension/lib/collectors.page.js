// 防重复注入
if (window.bootstrapCollectorsLoaded) {
  // noop
} else {
  window.bootstrapCollectorsLoaded = true

  ;(function bootstrapCollectors() {
    const globalApi = window.__DOLIKE__ || {}
    console.log('[DoList] bootstrapCollectors: loaded, api keys:', Object.keys(globalApi))
    if (typeof globalApi.collectSelfProfile === 'function') return

    const DOUYIN_ORIGIN = 'https://www.douyin.com'
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

    // ─── 页面 URL 检测 ──────────────────────────────────────────────────
    // 标记: PAGE_URL_CHECK
    function getCurrentPageType() {
      const url = window.location.href
      const path = window.location.pathname
      const params = new URLSearchParams(window.location.search)
      // 音乐收藏页面
      if (path.includes('/user/self') && (params.get('showTab') === 'favorite_collection' || params.get('showSubTab') === 'music')) {
        return 'music_favorite'
      }
      // 视频收藏页面
      if (path.includes('/user/self') && (params.get('showTab') === 'favorite_collection' || params.get('showSubTab') === 'video')) {
        return 'video_favorite'
      }
      // 用户主页（作品/喜欢）
      if (path.includes('/user/self') || path.match(/^\/user\/[A-Za-z0-9._-]{20,}$/)) {
        return 'user_home'
      }
      return 'unknown'
    }

    function assertPageType(expected, collectorName) {
      const actual = getCurrentPageType()
      if (expected === 'music_favorite' && actual !== 'music_favorite') {
        throw new Error(`${collectorName}：当前页面不是音乐收藏页，请在「个人主页 → 收藏 → 音乐」页面操作。当前 URL：${window.location.href}`)
      }
      if (expected === 'video_favorite' && actual !== 'video_favorite' && actual !== 'music_favorite' && actual !== 'user_home') {
        throw new Error(`${collectorName}：当前页面不是收藏页，请在「个人主页 → 收藏」页面操作。当前 URL：${window.location.href}`)
      }
      if (expected === 'user_home' && actual === 'unknown') {
        throw new Error(`${collectorName}：当前页面不是用户主页，请在 douyin.com/user/self 页面操作。当前 URL：${window.location.href}`)
      }
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
      return `${DOUYIN_ORIGIN}${path}?${qs.toString()}`
    }

    function trySignUrl(url) {
      // 探测页面签名能力并缓存
      if (window.__DOLIKE_SIGNER__) {
        try {
          const signed = window.__DOLIKE_SIGNER__(url)
          if (signed) { console.log('[DoList] signer: cached'); return signed }
        } catch(e) {}
      }
      // 方法1: window.byted_acrawler.sign (旧版抖音)
      if (window.byted_acrawler && typeof window.byted_acrawler.sign === 'function') {
        try {
          const result = window.byted_acrawler.sign({ url })
          if (result && result.url) { console.log('[DoList] signer: byted_acrawler.url'); return result.url }
          if (typeof result === 'string') { console.log('[DoList] signer: byted_acrawler.str'); return result }
        } catch(e) { console.log('[DoList] signer: byted_acrawler error', e?.message) }
      }
      // 方法2: window.abogus.generate (新版)
      if (window.abogus) {
        try {
          if (typeof window.abogus.generate === 'function') {
            const signed = window.abogus.generate(url)
            if (signed) { console.log('[DoList] signer: abogus.generate'); return signed }
          }
          if (typeof window.abogus === 'function') {
            const signed = window.abogus(url)
            if (signed) { console.log('[DoList] signer: abogus.fn'); return signed }
          }
        } catch(e) { console.log('[DoList] signer: abogus error', e?.message) }
      }
      // 方法3: window.XBogus
      if (window.XBogus && typeof window.XBogus.build === 'function') {
        try {
          const signed = window.XBogus.build(url)
          if (signed) { console.log('[DoList] signer: XBogus'); return signed }
        } catch(e) { console.log('[DoList] signer: XBogus error', e?.message) }
      }
      // 方法4: 搜索 webpack 模块里的签名函数
      try {
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
                    console.log('[DoList] signer: webpack chunk', id)
                    return result
                  }
                } catch(e) {}
              }
            }
          }
        }
      } catch(e) {}
      console.log('[DoList] signer: all methods failed, no signature')
      return null
    }

    function dyXhr(path, query, signedUrl) {
      const url = signedUrl || buildUrl(path, query)
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('GET', url, true)
        xhr.withCredentials = true
        xhr.setRequestHeader('Accept', 'application/json, text/plain, */*')
        xhr.setRequestHeader('Referer', DOUYIN_ORIGIN + '/')
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
      // ★ 合并默认 query 参数（参考 jiji262/douyin-downloader _default_query）
      const defaultQuery = {
        device_platform: 'webapp',
        aid: '6383',
        channel: 'channel_pc_web',
        update_version_code: '170400',
        pc_client_type: '1',
        version_code: '290100',
        version_name: '29.1.0',
        cookie_enabled: 'true',
        screen_width: '1920',
        screen_height: '1080',
        browser_language: 'zh-CN',
        browser_platform: 'MacIntel',
        browser_name: 'Chrome',
        browser_version: '124.0.0.0',
        browser_online: 'true',
        engine_name: 'Blink',
        engine_version: '124.0.0.0',
        os_name: 'Mac OS',
        os_version: '10.15.7',
        cpu_core_num: '8',
        device_memory: '8',
        platform: 'PC',
        downlink: '10',
        effective_type: '4g',
        round_trip_time: '50',
        ...query  // caller 提供的参数覆盖默认值
      }
      let url = buildUrl(path, defaultQuery)
      // 尝试用页面签名函数加 a_bogus
      const signed = trySignUrl(url)
      if (signed) {
        url = signed
        console.log(`[DoList] dyGet: signed url ${url}`)
      }
      console.log(`[DoList] dyGet: fetching ${url}`)
      const json = await dyXhr(path, defaultQuery, url)
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
      assertPageType('user_home', '推送作品')
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
      assertPageType('user_home', '推送喜欢')
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
      assertPageType('video_favorite', '推送收藏视频')
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
      assertPageType('user_home', '推送稍后再看')
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
      assertPageType('video_favorite', '推送收藏夹视频')
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


    // ─── 拦截抖音页面自己的音乐 API 请求（带签名）──
    // 标记: INTERCEPT_MUSIC_API
    // 在页面加载时立即安装，缓存抖音自己请求的音乐数据
    ;(function injectMusicInterceptor() {
      if (window.__DOLIKE_MUSIC_INTERCEPTOR__) return
      window.__DOLIKE_MUSIC_INTERCEPTOR__ = true
      window.__DOLIKE_CACHED_MUSIC_ITEMS__ = []

      // 拦截 fetch
      const origFetch = window.fetch
      window.fetch = async function(input, init) {
        const url = typeof input === 'string' ? input : (input?.url || '')
        try {
          const resp = await origFetch.apply(this, arguments)
          if (url.includes('/music/') || url.includes('music_list') || url.includes('music/list')) {
            const clone = resp.clone()
            clone.json().then(data => {
              const items = data?.music_list || data?.mc_list || data?.aweme_list || data?.data || []
              if (Array.isArray(items) && items.length > 0) {
                window.__DOLIKE_CACHED_MUSIC_ITEMS__.push(...items)
                console.log(`[DoList] interceptor: cached ${items.length} music items`)
              }
            }).catch(() => {})
          }
          return resp
        } catch (e) {
          return origFetch.apply(this, arguments)
        }
      }

      // 拦截 XHR
      const OrigXHR = window.XMLHttpRequest
      function PatchedXHR() {
        const xhr = new OrigXHR()
        const origOpen = xhr.open.bind(xhr)
        let _url = ''
        xhr.open = function(m, url) { _url = url; return origOpen.apply(this, arguments) }
        xhr.addEventListener('load', function() {
          if (_url && (_url.includes('/music/') || _url.includes('music_list') || _url.includes('music/list'))) {
            try {
              const data = JSON.parse(this.responseText)
              const items = data?.music_list || data?.mc_list || data?.aweme_list || data?.data || []
              if (Array.isArray(items) && items.length > 0) {
                window.__DOLIKE_CACHED_MUSIC_ITEMS__.push(...items)
                console.log(`[DoList] interceptor: cached ${items.length} music items from XHR`)
              }
            } catch (e) {}
          }
        })
        return xhr
      }
      PatchedXHR.prototype = OrigXHR.prototype
      window.XMLHttpRequest = PatchedXHR

      console.log('[DoList] interceptor: music API interceptor installed')
    })()

    // ─── 从 React Fiber 中提取音乐数据 ──
    // 标记: REACT_FIBER_MUSIC_EXTRACT
    function extractMusicFromReactFiber() {
      const results = []
      try {
        // 找到音乐列表容器
        const containers = document.querySelectorAll([
          '[class*="music-list"]',
          '[class*="musicList"]',
          '[class*="music_list"]',
          '[class*="collect-music"]',
          '[class*="collectMusic"]',
          '[class*="favorite-music"]',
        ].join(', '))

        for (const container of containers) {
          // 遍历 DOM 元素，查找 React fiber
          const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT)
          let node
          while ((node = walker.nextNode())) {
            const fiber = node[Object.keys(node).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'))]
            if (!fiber) continue
            // 遍历 fiber 链查找音乐数据
            let current = fiber
            for (let i = 0; i < 20; i++) {
              if (current?.memoizedProps) {
                const props = current.memoizedProps
                // 查找包含音乐列表的 props
                for (const key of Object.keys(props)) {
                  const val = props[key]
                  if (Array.isArray(val) && val.length > 0) {
                    const first = val[0]
                    if (first && (first.music_id || first.id_str || first.id) && (first.title || first.name)) {
                      // 确认是音乐列表
                      const musicItems = val.filter(item =>
                        item && (item.music_id || item.id_str || item.id) && (item.title || item.name || item.author)
                      )
                      if (musicItems.length > 0) {
                        console.log(`[DoList] ReactFiber: found ${musicItems.length} items in props.${key}`)
                        return musicItems
                      }
                    }
                  }
                }
              }
              current = current?.return
              if (!current) break
            }
          }
        }
      } catch (e) {
        console.warn('[DoList] ReactFiber extraction error:', e)
      }
      return results
    }

    async function collectCollectMusicList(opts = {}) {
      assertPageType('music_favorite', '推送收藏音乐')
      const { pageDelayMs = 800, maxPages = 200, secUid } = opts
      console.log('[DoList] music collector: start')

      // ── 方案A：使用拦截器缓存的数据（抖音页面自己请求的，带完整签名）──
      const cached = window.__DOLIKE_CACHED_MUSIC_ITEMS__ || []
      if (cached.length > 0) {
        // 去重
        const seen = new Set()
        const unique = []
        for (const item of cached) {
          const id = String(item?.id_str || item?.id || item?.music_id || '')
          if (id && !seen.has(id)) {
            seen.add(id)
            unique.push(item)
          }
        }
        console.log(`[DoList] music collector: using ${unique.length} items from interceptor cache`)
        return unique
      }

      // ── 方案B：从 React Fiber 中提取（抖音 SPA 页面数据在组件状态中）──
      const fiberData = extractMusicFromReactFiber()
      if (fiberData.length > 0) {
        console.log(`[DoList] music collector: collected ${fiberData.length} items from React Fiber`)
        return fiberData
      }

      // ── 方案C：从页面 DOM 直接提取（不需要签名）──
      const domData = tryExtractMusicFromPage()
      if (domData.length > 0) {
        console.log(`[DoList] music collector: collected ${domData.length} items from DOM`)
        return domData
      }

      // ── 方案D：尝试 API（需要 a_bogus 签名，可能失败）──
      console.warn('[DoList] music collector: cache/fiber/DOM all empty, trying API fallback')
      const realSecUid = secUid || findSecUidFromDocument() || 'self'
      console.log(`[DoList] music collector: sec_uid=${realSecUid}`)

      const apiPaths = [
        { path: '/aweme/v1/web/music/list/', params: {} },
        { path: '/aweme/v1/web/music/listcollection/', params: {} },
      ]

      for (const api of apiPaths) {
        const out = []
        let cursor = 0

        for (let page = 0; page < maxPages; page++) {
          const query = {
            sec_user_id: realSecUid,
            count: 20,
            max_cursor: cursor,
            locate_query: 'false',
            publish_video_strategy_type: '2',
            source: 'channel_pc_web',
            ...api.params
          }

          let r = null
          try {
            r = await dyGet(api.path, query)
          } catch (e) {
            console.warn(`[DoList] music collector: API ${api.path} failed:`, e?.message || e)
            break
          }

          if (!r || (r.status_code && r.status_code !== 0)) {
            console.warn(`[DoList] music collector: API ${api.path} returned status_code=${r?.status_code ?? 'null'}`)
            break
          }

          const items = Array.isArray(r?.music_list) ? r.music_list
            : Array.isArray(r?.mc_list) ? r.mc_list
            : Array.isArray(r?.aweme_list) ? r.aweme_list
            : Array.isArray(r?.data) ? r.data
            : []

          if (items.length === 0) break
          out.push(...items)
          console.log(`[DoList] music collector: page ${page + 1}, got ${items.length} items`)
          if (!r?.has_more) break
          cursor = Number(r?.max_cursor) || cursor + items.length
          await new Promise(res => setTimeout(res, pageDelayMs))
        }

        if (out.length > 0) {
          console.log(`[DoList] music collector: collected ${out.length} items via API ${api.path}`)
          return out
        }
      }

      console.warn('[DoList] music collector: all methods failed, returning empty')
      return []
    }

    // 从页面 DOM/SSR 中提取音乐列表（不需要 API 签名）
    function tryExtractMusicFromPage() {
      const results = []
      try {
        // 方法1: window.__INITIAL_STATE__ (SSR 数据)
        const initState = window.__INITIAL_STATE__
        if (initState) {
          console.log('[DoList] SSR: __INITIAL_STATE__ found, keys:', Object.keys(initState))
          const musicList = findMusicList(initState)
          if (musicList && musicList.length > 0) return musicList
        }
        // 方法2: window.__SSR_DATA__
        const ssrData = window.__SSR_DATA__
        if (ssrData) {
          console.log('[DoList] SSR: __SSR_DATA__ found')
          const musicList = findMusicList(ssrData)
          if (musicList && musicList.length > 0) return musicList
        }
        // 方法3: 从 DOM 中提取音乐信息
        // 抖音音乐收藏页结构：每个音乐项是一个卡片，包含封面图、标题、作者
        // 尝试多种选择器覆盖不同版本
        const seenIds = new Set()

        // 3a: 通过音乐详情链接提取（最可靠）
        const allLinks = document.querySelectorAll('a[href]')
        for (const a of allLinks) {
          const href = a.getAttribute('href') || ''
          const m = /music[_-]detail\?music_id=(\d+)/.exec(href)
          if (!m) continue
          const musicId = m[1]
          if (seenIds.has(musicId)) continue
          seenIds.add(musicId)

          // 从链接的父元素中提取标题、作者、封面
          const parent = a.closest('li, div[class*="item"], div[class*="card"], div[class*="music"]') || a.parentElement
          let title = '', author = '', coverUrl = ''

          if (parent) {
            // 标题：通常是第一个文本较长的元素
            const textEls = parent.querySelectorAll('span, p, div')
            for (const el of textEls) {
              const text = el.textContent?.trim() || ''
              if (text.length > 1 && text.length < 100 && !title) {
                title = text
              } else if (text.length > 0 && text.length < 50 && !author && text !== title) {
                author = text
              }
            }
            // 封面图
            const img = parent.querySelector('img[src]')
            if (img) coverUrl = img.getAttribute('src') || ''
          }

          results.push({
            id: musicId,
            id_str: String(musicId),
            title: title || undefined,
            author: author || undefined,
            play_url: { url_list: [] },
            cover_thumb: coverUrl ? { url_list: [coverUrl] } : undefined,
            __fromDom: true
          })
        }

        if (results.length > 0) {
          console.log(`[DoList] DOM: extracted ${results.length} music items from page links`)
          return results
        }

        // 3b: 通过图片 alt 文本提取（有些版本用 img alt 存标题）
        const musicImgs = document.querySelectorAll('img[alt*="音乐"], img[alt*="歌曲"], img[alt*="歌名"]')
        for (const img of musicImgs) {
          const src = img.getAttribute('src') || ''
          const alt = img.getAttribute('alt') || ''
          const parent = img.closest('a[href], li, div')
          let musicId = ''
          if (parent) {
            const href = parent.getAttribute?.('href') || ''
            const m = /music[_-]detail\?music_id=(\d+)/.exec(href)
            if (m) musicId = m[1]
          }
          if (!musicId || seenIds.has(musicId)) continue
          seenIds.add(musicId)
          results.push({
            id: musicId,
            id_str: String(musicId),
            title: alt || undefined,
            play_url: { url_list: [] },
            cover_thumb: src ? { url_list: [src] } : undefined,
            __fromDom: true
          })
        }

        if (results.length > 0) {
          console.log(`[DoList] DOM: extracted ${results.length} music items from images`)
          return results
        }

        console.log('[DoList] DOM: no music items found on page')
      } catch (e) {
        console.warn('[DoList] DOM extraction error:', e)
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
    // 音乐收藏接口已废弃，保留实现仅供历史排查，不再对外暴露。
  })()
}
