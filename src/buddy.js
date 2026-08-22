import { javdbRequest } from "./emby.js";

const BUDDY_ASSET_PATH = "/__bbjavdb/buddy.js";
const JAVBUS_ORIGIN = "https://www.javbus.com";
const SUBTITLECAT_ORIGIN = "https://www.subtitlecat.com";
const BUDDY_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,119}$/;

function jsonResponse(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      ...extraHeaders,
    },
  });
}

function cleanCode(value) {
  const code = String(value || "").trim();
  return BUDDY_CODE_PATTERN.test(code) ? code : "";
}

function apiError(error) {
  return error instanceof Error ? error.message : "JavDB API request failed";
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function parseJavbusRows(html) {
  const rows = [];
  const rowMatches = String(html || "").match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
  for (const row of rowMatches) {
    const cells = row.match(/<td\b[\s\S]*?<\/td>/gi) || [];
    if (cells.length < 3) continue;
    const magnetMatch = cells[0].match(/href=["'](magnet:[^"']+)["']/i);
    if (!magnetMatch) continue;
    const name = stripHtml(cells[0]);
    rows.push({
      name: name || "JAVBUS magnet",
      size: stripHtml(cells[1]),
      date: stripHtml(cells[2]),
      magnetUrl: magnetMatch[1].replace(/&amp;/g, "&"),
      hasSub: /字幕|中字|subtitle/i.test(name),
      hasHD: /高清|4k|1080p|2160p/i.test(name),
    });
  }
  return rows.sort((left, right) => Number(right.hasSub) - Number(left.hasSub));
}

function parseSubtitleRows(html, code) {
  const results = [];
  const wanted = code.toUpperCase();
  const rowMatches = String(html || "").match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
  for (const row of rowMatches) {
    const cells = row.match(/<td\b[\s\S]*?<\/td>/gi) || [];
    if (cells.length < 4) continue;
    const link = cells[0].match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const name = stripHtml(link[2]);
    const languages = stripHtml(cells[3]);
    if (!name.toUpperCase().includes(wanted) || !/中文|chinese|zh[-_ ]?(?:cn|tw)|简体|繁体/i.test(`${name} ${languages}`)) continue;
    results.push({
      name,
      url: new URL(link[1], SUBTITLECAT_ORIGIN).toString(),
      size: stripHtml(cells[1]),
      downloads: stripHtml(cells[2]),
      languages,
    });
  }
  return results;
}

async function fetchSubtitles(code, fetchImpl) {
  const target = new URL("/index.php", SUBTITLECAT_ORIGIN);
  target.searchParams.set("search", code);
  const response = await fetchImpl(target.toString(), {
    headers: { accept: "text/html", "accept-language": "zh-CN,zh;q=0.9,en;q=0.8" },
    redirect: "follow",
  });
  return { code, subtitles: response.ok ? parseSubtitleRows(await response.text(), code) : [], status: response.status };
}

async function fetchJavbus(code, fetchImpl) {
  const pageUrl = `${JAVBUS_ORIGIN}/${encodeURIComponent(code)}`;
  const page = await fetchImpl(pageUrl, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      referer: `${JAVBUS_ORIGIN}/`,
      cookie: "existmag=all",
    },
    redirect: "follow",
  });
  const html = await page.text();
  if (!page.ok) return { code, magnets: [], status: page.status };

  const gid = html.match(/var\s+gid\s*=\s*(\d+)\s*;/i)?.[1];
  const uc = html.match(/var\s+uc\s*=\s*(\d+)\s*;/i)?.[1];
  const image = html.match(/var\s+img\s*=\s*'([^']+)'\s*;/i)?.[1];
  if (!gid || !uc || !image) {
    return { code, magnets: parseJavbusRows(html), status: 200 };
  }

  const ajax = new URL(`${JAVBUS_ORIGIN}/ajax/uncledatoolsbyajax.php`);
  ajax.searchParams.set("gid", gid);
  ajax.searchParams.set("lang", "zh");
  ajax.searchParams.set("img", image);
  ajax.searchParams.set("uc", uc);
  const magnetResponse = await fetchImpl(ajax.toString(), {
    headers: {
      accept: "text/html,*/*",
      "x-requested-with": "XMLHttpRequest",
      referer: pageUrl,
      cookie: "existmag=all",
    },
    redirect: "follow",
  });
  const magnetHtml = await magnetResponse.text();
  return {
    code,
    magnets: magnetResponse.ok ? parseJavbusRows(`<table>${magnetHtml}</table>`) : [],
    status: magnetResponse.status,
  };
}

async function buddyApi(request, env, fetchImpl) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/jb/")) return null;
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, OPTIONS",
        "access-control-allow-headers": "content-type",
      },
    });
  }
  if (request.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    if (path === "/api/jb/javbus") {
      const code = cleanCode(url.searchParams.get("code"));
      if (!code) return jsonResponse({ error: "Movie code is required" }, 400);
      return jsonResponse(await fetchJavbus(code, fetchImpl));
    }

    if (path === "/api/jb/subtitles") {
      const code = cleanCode(url.searchParams.get("code"));
      if (!code) return jsonResponse({ error: "Movie code is required" }, 400);
      return jsonResponse(await fetchSubtitles(code, fetchImpl));
    }

    if (path === "/api/jb/playback") {
      const data = await javdbRequest("/v1/rankings/playback", env, fetchImpl, {
        query: {
          period: url.searchParams.get("period") || "daily",
          filter_by: url.searchParams.get("filter_by") || "high_score",
        },
      });
      return jsonResponse({ data: data?.movies || data || [] });
    }

    if (path === "/api/jb/top") {
      const data = await javdbRequest("/v1/movies/top", env, fetchImpl, {
        query: {
          start_rank: 1,
          type: url.searchParams.get("type") || "all",
          type_value: url.searchParams.get("type_value") || "",
          ignore_watched: "false",
          page: url.searchParams.get("page") || 1,
          limit: url.searchParams.get("limit") || 40,
        },
        token: url.searchParams.get("authorization") || "",
      });
      return jsonResponse({ data });
    }

    if (path === "/api/jb/search") {
      const query = String(url.searchParams.get("q") || "").trim();
      if (!query) return jsonResponse({ data: { movies: [] } });
      const data = await javdbRequest("/v2/search", env, fetchImpl, {
        query: {
          q: query,
          page: url.searchParams.get("page") || 1,
          type: "movie",
          limit: url.searchParams.get("limit") || 20,
          movie_type: "all",
          from_recent: "false",
          movie_filter_by: "all",
          movie_sort_by: "relevance",
        },
      });
      return jsonResponse({ data });
    }

    const reviewsMatch = path.match(/^\/api\/jb\/reviews\/([^/]+)$/);
    if (reviewsMatch) {
      const movieId = cleanCode(decodeURIComponent(reviewsMatch[1]));
      if (!movieId) return jsonResponse({ error: "Movie id is invalid" }, 400);
      const data = await javdbRequest(`/v1/movies/${encodeURIComponent(movieId)}/reviews`, env, fetchImpl, {
        query: {
          page: url.searchParams.get("page") || 1,
          sort_by: "hotly",
          limit: url.searchParams.get("limit") || 20,
        },
      });
      return jsonResponse({ data });
    }

    const relatedMatch = path.match(/^\/api\/jb\/related\/([^/]+)$/);
    if (relatedMatch) {
      const movieId = cleanCode(decodeURIComponent(relatedMatch[1]));
      if (!movieId) return jsonResponse({ error: "Movie id is invalid" }, 400);
      const data = await javdbRequest("/v1/lists/related", env, fetchImpl, {
        query: {
          movie_id: movieId,
          page: url.searchParams.get("page") || 1,
          limit: url.searchParams.get("limit") || 20,
        },
      });
      return jsonResponse({ data });
    }

    const movieMatch = path.match(/^\/api\/jb\/movie\/([^/]+)$/);
    if (movieMatch) {
      const movieId = cleanCode(decodeURIComponent(movieMatch[1]));
      if (!movieId) return jsonResponse({ error: "Movie id is invalid" }, 400);
      const data = await javdbRequest(`/v4/movies/${encodeURIComponent(movieId)}`, env, fetchImpl);
      return jsonResponse({ data });
    }

    return jsonResponse({ error: "Unknown JavdbBuddy endpoint" }, 404);
  } catch (error) {
    return jsonResponse({ error: apiError(error) }, 502);
  }
}

export async function handleBuddyRoute(request, env = {}, fetchImpl = fetch) {
  const url = new URL(request.url);
  if (url.pathname === BUDDY_ASSET_PATH) {
    return new Response(BUDDY_CLIENT_SCRIPT, {
      headers: {
        "content-type": "application/javascript; charset=utf-8",
        "cache-control": "public, max-age=300",
        "x-content-type-options": "nosniff",
      },
    });
  }
  return buddyApi(request, env, fetchImpl);
}

export function injectBuddyScript(body, publicOrigin) {
  if (!/<html\b/i.test(body) || /data-bbjavdb-buddy/i.test(body)) return body;
  const tag = `<script data-bbjavdb-buddy src="${publicOrigin}${BUDDY_ASSET_PATH}"></script>`;
  return /<\/body>/i.test(body)
    ? body.replace(/<\/body>/i, `${tag}</body>`)
    : `${body}${tag}`;
}

export const BUDDY_CLIENT_SCRIPT = String.raw`(function () {
  'use strict';
  if (window.__bbjavdbBuddy) return;
  window.__bbjavdbBuddy = true;

  var HOT = '/advanced_search?handlePlayback=1&period=daily';
  var TOP = '/advanced_search?handleTop=1&handleType=all&type_value=&page=1';
  var FC2 = '/advanced_search?type=3&score_min=0&d=1';
  var esc = function (value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char];
    });
  };
  var codeFrom = function (text) {
    var match = String(text || '').match(/[A-Za-z]{2,12}[-_][A-Za-z0-9]{2,12}|[A-Za-z]{2,10}[0-9]{3,6}/i);
    return match ? match[0].toUpperCase() : String(text || '').trim().split(/\s+/)[0];
  };
  var api = function (path, params) {
    var query = new URLSearchParams(params || {});
    return fetch(path + (query.toString() ? '?' + query : ''), {headers:{accept:'application/json'}})
      .then(function (response) { return response.json().then(function (value) { if (!response.ok) throw new Error(value.error || '请求失败'); return value; }); });
  };
  var embyConfig = function () { try { return JSON.parse(localStorage.getItem('bbjb_emby_config') || '{}'); } catch (_) { return {}; } };
  var embyCache = Object.create(null);
  var embyRequests = Object.create(null);
  var embyOrigin = function (config) { return String(config.url || '').trim().replace(/\/+$/, ''); };
  var embyLookup = function (code) {
    var config = embyConfig(); var origin = embyOrigin(config); var key = String(code || '').toUpperCase();
    if (!origin || !config.apiKey || !key) return Promise.resolve({configured:false});
    if (embyCache[key]) return Promise.resolve(embyCache[key]);
    if (embyRequests[key]) return embyRequests[key];
    var query = new URLSearchParams({searchTerm:key,Recursive:'true',IncludeItemTypes:'Movie',Limit:'5',api_key:String(config.apiKey)});
    embyRequests[key] = fetch(origin + '/Items?' + query, {headers:{accept:'application/json'},credentials:'omit'})
      .then(function (response) { if (!response.ok) throw new Error('Emby HTTP '+response.status); return response.json(); })
      .then(function (payload) { var item=(payload.Items||[]).find(function (entry) { return String(entry.Name||'').toUpperCase().includes(key) || String(entry.Path||'').toUpperCase().includes(key); }) || (payload.Items||[])[0] || null; var result={configured:true,item:item}; embyCache[key]=result; return result; })
      .catch(function (error) { var result={configured:true,error:error}; embyCache[key]=result; return result; })
      .finally(function () { delete embyRequests[key]; });
    return embyRequests[key];
  };
  var addEmbyStatus = function (host, code) {
    if (!host || host.querySelector('.bbjb-emby-status')) return;
    var badge=document.createElement('span'); badge.className='bbjb-emby-status'; badge.textContent='Emby查询中'; host.appendChild(badge);
    embyLookup(code).then(function (result) {
      if (!badge.isConnected) return;
      if (!result.configured) { badge.remove(); return; }
      if (result.error) { badge.className='bbjb-emby-status bbjb-emby-error'; badge.textContent='Emby连接失败'; badge.title=result.error.message || '请检查 Emby 地址、API Key 和 CORS'; badge.addEventListener('click',function (event) { event.preventDefault(); event.stopPropagation(); showEmbySettings(); }); return; }
      if (result.item) { badge.className='bbjb-emby-status bbjb-emby-found'; badge.textContent='Emby已入库'; badge.title='点击打开 Emby 条目'; badge.addEventListener('click',function (event) { event.preventDefault(); event.stopPropagation(); var config=embyConfig(); window.open(embyOrigin(config)+'/web/index.html#!/item?id='+encodeURIComponent(result.item.Id),'_blank','noopener'); }); }
      else { badge.className='bbjb-emby-status bbjb-emby-missing'; badge.textContent='Emby未入库'; badge.title='Emby 中没有找到 '+code; }
    });
  };
  var showEmbySettings = function () {
    var body=modal('Emby 入库查询','<p>保存后会在列表和详情页按番号自动查询。</p><label class="bbjb-field">Emby 地址<input id="bbjb-emby-url" type="url" placeholder="https://emby.example.com"></label><label class="bbjb-field">API Key<input id="bbjb-emby-key" type="password" placeholder="Emby API Key"></label><p class="bbjb-hint">API Key 只保存在当前浏览器。Emby 服务端需要允许当前站点跨域访问（CORS）。</p><button class="bbjb-btn" id="bbjb-emby-save">保存并刷新状态</button><button class="bbjb-btn" id="bbjb-emby-clear">清除配置</button>');
    var config=embyConfig(); body.querySelector('#bbjb-emby-url').value=config.url||''; body.querySelector('#bbjb-emby-key').value=config.apiKey||'';
    body.querySelector('#bbjb-emby-save').addEventListener('click',function () { var url=body.querySelector('#bbjb-emby-url').value.trim().replace(/\/+$/,''); var apiKey=body.querySelector('#bbjb-emby-key').value.trim(); if (!url || !apiKey) { alert('请填写 Emby 地址和 API Key'); return; } try { var parsed=new URL(url); if (!/^https?:$/.test(parsed.protocol)) throw new Error('bad protocol'); localStorage.setItem('bbjb_emby_config',JSON.stringify({url:parsed.origin+parsed.pathname.replace(/\/+$/,''),apiKey:apiKey})); Object.keys(embyCache).forEach(function (key) { delete embyCache[key]; }); document.querySelectorAll('.bbjb-emby-status').forEach(function (node) { node.remove(); }); body.closest('.bbjb-modal').remove(); run(); } catch (_) { alert('Emby 地址必须是 http 或 https URL'); } });
    body.querySelector('#bbjb-emby-clear').addEventListener('click',function () { localStorage.removeItem('bbjb_emby_config'); Object.keys(embyCache).forEach(function (key) { delete embyCache[key]; }); document.querySelectorAll('.bbjb-emby-status').forEach(function (node) { node.remove(); }); body.closest('.bbjb-modal').remove(); run(); });
  };
  var css = document.createElement('style');
  css.textContent = '.bbjb-tools{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}.bbjb-btn{border:1px solid #c9d4e1;background:#fff;color:#26547c;border-radius:4px;padding:4px 9px;font-size:12px;cursor:pointer}.bbjb-btn:hover{background:#eef6ff}.bbjb-panel{background:#fff;border:1px solid #e5e7eb;padding:12px;margin-top:10px}.bbjb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px}.bbjb-grid img{width:100%;aspect-ratio:2/3;object-fit:cover;cursor:zoom-in}.bbjb-modal{position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:2147483647;padding:5vh 5vw;overflow:auto}.bbjb-modal-inner{max-width:1100px;margin:auto;background:#fff;color:#222;padding:18px;border-radius:6px}.bbjb-modal-close{float:right;border:0;background:transparent;font-size:24px;cursor:pointer}.bbjb-row{border-top:1px solid #eee;padding:10px 0}.bbjb-field{display:block;margin:10px 0;font-size:13px}.bbjb-field input{display:block;box-sizing:border-box;width:100%;margin-top:5px;padding:8px;border:1px solid #c9d4e1;border-radius:4px}.bbjb-hint{font-size:12px;color:#6b7280}.bbjb-emby-status-row{display:block;min-height:19px;margin:5px 0 2px}.bbjb-emby-status{display:inline-block;padding:3px 8px;border-radius:4px;font-size:11px;line-height:1.3;white-space:nowrap}.bbjb-emby-found{background:#dcfce7;color:#166534;cursor:pointer}.bbjb-emby-missing{background:#fee2e2;color:#b91c1c}.bbjb-emby-error{background:#fef3c7;color:#92400e;cursor:pointer}.bbjb-nav{position:fixed;right:14px;top:48%;z-index:1000;display:grid;gap:5px}.bbjb-nav button{width:32px;height:32px;border:0;border-radius:50%;background:#2d6cdf;color:#fff;cursor:pointer}.bbjb-special{margin:12px 0}.bbjb-special .box{height:100%}';
  (document.head || document.documentElement).appendChild(css);
  var button = function (label, handler) { var el = document.createElement('button'); el.className='bbjb-btn'; el.type='button'; el.textContent=label; el.addEventListener('click', handler); return el; };
  var modal = function (title, content) {
    var old = document.querySelector('.bbjb-modal'); if (old) old.remove();
    var overlay = document.createElement('div'); overlay.className='bbjb-modal';
    var inner = document.createElement('div'); inner.className='bbjb-modal-inner';
    inner.innerHTML = '<button class="bbjb-modal-close" aria-label="关闭">×</button><h3>'+esc(title)+'</h3><div class="bbjb-modal-content">'+content+'</div>';
    overlay.appendChild(inner); document.body.appendChild(overlay);
    inner.querySelector('.bbjb-modal-close').addEventListener('click', function(){overlay.remove();});
    overlay.addEventListener('click', function(event){if(event.target===overlay) overlay.remove();});
    return inner.querySelector('.bbjb-modal-content');
  };
  var renderMovies = function (movies) {
    return '<div class="bbjb-grid">' + (movies || []).map(function(movie){
      var id = movie.id || movie.uuid || ''; var cover = movie.cover_url || movie.cover || '';
      var code = movie.number || movie.code || ''; var title = movie.origin_title || movie.title || '';
      return '<a class="box item" href="/v/'+encodeURIComponent(id)+'"><div class="cover">'+(cover?'<img loading="lazy" src="'+esc(cover)+'">':'')+'</div><div class="video-title"><strong>'+esc(code)+'</strong> '+esc(title)+'</div><div class="meta">'+esc(movie.release_date || '')+'</div></a>';
    }).join('') + '</div>';
  };
  var specialPage = function () {
    var params = new URLSearchParams(location.search); var isHot=params.get('handlePlayback')==='1'; var isTop=params.get('handleTop')==='1'; var isFc2=params.get('type')==='3' && !isHot && !isTop;
    if (!isHot && !isTop && !isFc2) return;
    var main = document.querySelector('.section .container') || document.querySelector('main') || document.body; var old=main.querySelector('.bbjb-special'); if(old)return;
    var section=document.createElement('section'); section.className='bbjb-special box';
    section.innerHTML='<h2>'+(isHot?'热播':isTop?'Top250':'FC2PPV')+'</h2><p class="bbjb-loading">正在加载...</p>'; main.prepend(section);
    if (isFc2) { section.querySelector('.bbjb-loading').innerHTML='第三方 FC2 资源：<a href="https://fc2ppvdb.com/" target="_blank" rel="noreferrer">FC2PPVDB</a>　<a href="https://adult.contents.fc2.com/" target="_blank" rel="noreferrer">FC2 官方</a>　<a href="https://123av.com/search?keyword=FC2-PPV" target="_blank" rel="noreferrer">123AV</a>'; return; }
    var topToken = isTop ? (localStorage.getItem('bbjb_authorization') || '') : '';
    var load = function () { return api(isHot?'/api/jb/playback':'/api/jb/top',{period:params.get('period')||'daily',page:params.get('page')||1,limit:40,type:params.get('handleType')||'all',type_value:params.get('type_value')||'',authorization:topToken}); };
    if (isTop) { var tokenButton=button(topToken?'更新 Top250 Token':'设置 Top250 Token',function(){var value=window.prompt('粘贴 JavDB 登录 Token（可带 Bearer 前缀）',topToken);if(value){topToken=/^Bearer\s/i.test(value)?value:'Bearer '+value;localStorage.setItem('bbjb_authorization',topToken);tokenButton.textContent='更新 Top250 Token';load().then(render).catch(showError);}});section.insertBefore(tokenButton,section.querySelector('.bbjb-loading')); }
    var render = function(result){
      var data=result.data||{}; var movies=Array.isArray(data)?data:(data.movies||data.items||[]); var mount=section.querySelector('.bbjb-loading'); mount.className='bbjb-results'; mount.innerHTML=renderMovies(movies);
    };
    var showError = function(error){var mount=section.querySelector('.bbjb-loading')||section.querySelector('.bbjb-results');if(mount)mount.textContent=error.message+(isTop?'。Top250 可能需要有效的登录 Token。':'');};
    load().then(render).catch(showError);
  };
  var detailPage = function () {
    if (!/^\/v\//.test(location.pathname)) return;
    var id = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
    var blocks = document.querySelectorAll('.video-meta-panel .panel-block,.movie-panel-info .panel-block,.panel-block'); var code=''; var target=null;
    Array.prototype.some.call(blocks,function(block){var strong=block.querySelector('strong'); if(strong && /番.?[号號]|number/i.test(strong.textContent)){code=codeFrom((block.querySelector('.value')||block).textContent);target=block;return true;} return false;});
    if (!code || !target || target.dataset.bbjbDone) return; target.dataset.bbjbDone='1';
    var tools=document.createElement('div'); tools.className='bbjb-tools'; addEmbyStatus(tools,code);
    tools.appendChild(button('预览图',function(){
      modal(code+' 预览图','<p>正在加载...</p>'); api('/api/jb/movie/'+encodeURIComponent(id)).then(function(result){var movie=(result.data||{}).movie||result.data||{}; var images=(movie.preview_images||[]).map(function(item){return item.large_url||item.url||item.medium_url;}).filter(Boolean); var actors=(movie.actors||[]).map(function(item){return typeof item==='string'?item:item.name;}).filter(Boolean); var body=modal(code+' 预览图','<p>正在加载...</p>'); body.innerHTML=(actors.length?'<p><strong>演员：</strong>'+esc(actors.join('、'))+'</p>':'')+(images.length?'<div class="bbjb-grid">'+images.map(function(src){return '<img src="'+esc(src)+'">';}).join('')+'</div>':'<p>暂无预览图</p>');}).catch(function(error){modal(code+' 预览图','<p>'+esc(error.message)+'</p>');});
    }));
    tools.appendChild(button('全部评论',function(){var body=modal('全部评论','<p>正在加载...</p>'); api('/api/jb/reviews/'+encodeURIComponent(id),{page:1,limit:20}).then(function(result){var rows=(result.data||{}).reviews||[]; body.innerHTML=rows.length?rows.map(function(item){return '<div class="bbjb-row"><strong>'+esc(item.username||'匿名')+'</strong>　'+esc(item.created_at||'')+'<p>'+esc(item.content||'')+'</p></div>';}).join(''):'<p>暂无评论</p>';}).catch(function(error){body.innerHTML='<p>'+esc(error.message)+'</p>';});}));
    tools.appendChild(button('相关清单',function(){var body=modal('相关清单','<p>正在加载...</p>'); api('/api/jb/related/'+encodeURIComponent(id),{page:1,limit:20}).then(function(result){var rows=(result.data||{}).lists||[]; body.innerHTML=rows.length?rows.map(function(item){return '<div class="bbjb-row"><a href="/lists/'+encodeURIComponent(item.id)+'" target="_blank">'+esc(item.name||'未命名清单')+'</a><br><small>影片 '+esc(item.movies_count||0)+' 部　收藏 '+esc(item.collections_count||0)+'</small></div>';}).join(''):'<p>暂无相关清单</p>';}).catch(function(error){body.innerHTML='<p>'+esc(error.message)+'</p>';});}));
    tools.appendChild(button('JAVBUS 磁力',function(){var body=modal(code+' JAVBUS 磁力','<p>正在加载...</p>'); api('/api/jb/javbus',{code:code}).then(function(result){var rows=result.magnets||[]; body.innerHTML=rows.length?rows.map(function(item){return '<div class="bbjb-row"><a href="'+esc(item.magnetUrl)+'">'+esc(item.name)+'</a><br><small>'+esc(item.size)+'　'+esc(item.date)+(item.hasSub?'　中字':'')+'</small></div>';}).join(''):'<p>JAVBUS 未收录该影片或暂无磁力。</p>';}).catch(function(error){body.innerHTML='<p>'+esc(error.message)+'</p>';});}));
    tools.appendChild(button('字幕',function(){var body=modal(code+' 中文字幕','<p>正在加载...</p>'); api('/api/jb/subtitles',{code:code}).then(function(result){var rows=result.subtitles||[]; body.innerHTML=rows.length?rows.map(function(item){return '<div class="bbjb-row"><a href="'+esc(item.url)+'" target="_blank" rel="noreferrer">'+esc(item.name)+'</a><br><small>'+esc(item.size)+'　'+esc(item.downloads)+'　'+esc(item.languages)+'</small></div>';}).join(''):'<p>未找到中文字幕。</p>';}).catch(function(error){body.innerHTML='<p>'+esc(error.message)+'</p>';});}));
    var sites=[['JAVBUS','https://www.javbus.com/'],['JAVLibrary','https://www.javlibrary.com/cn/vl_searchbyid.php?keyword='],['JAV321','https://www.jav321.com/search?searchword='],['Google','https://www.google.com/search?q=']];
    sites.forEach(function(site){tools.appendChild(button(site[0],function(){window.open(site[1]+encodeURIComponent(code),'_blank','noopener');}));});
    target.appendChild(tools);
  };
  var listPage = function () {
    if (/^\/v\//.test(location.pathname)) return;
    Array.prototype.forEach.call(document.querySelectorAll('.grid-item,.movie-list .item'), function (item) {
      if (item.dataset.bbjbTools) return;
      var link = item.querySelector('a[href^="/v/"]') || (item.matches('a[href^="/v/"]') ? item : null);
      if (!link) return;
      var id = decodeURIComponent(link.getAttribute('href').split('/').filter(Boolean).pop() || '');
      var code = codeFrom(item.textContent);
      if (!id || !code) return;
      var host = item.querySelector('.tags') || item;
      var tools = document.createElement('div'); tools.className='bbjb-tools';
      var cover = item.querySelector('.cover');
      if (cover) {
        var statusRow = document.createElement('div'); statusRow.className='bbjb-emby-status-row';
        addEmbyStatus(statusRow,code);
        cover.insertAdjacentElement('afterend',statusRow);
      } else addEmbyStatus(tools,code);
      tools.appendChild(button('预览',function(){
        var body=modal(code+' 预览图','<p>正在加载...</p>');
        api('/api/jb/movie/'+encodeURIComponent(id)).then(function(result){var movie=(result.data||{}).movie||result.data||{};var images=(movie.preview_images||[]).map(function(entry){return entry.large_url||entry.url||entry.medium_url;}).filter(Boolean);body.innerHTML=images.length?'<div class="bbjb-grid">'+images.map(function(src){return '<img src="'+esc(src)+'">';}).join('')+'</div>':'<p>暂无预览图</p>';}).catch(function(error){body.innerHTML='<p>'+esc(error.message)+'</p>';});
      }));
      tools.appendChild(button('JAVBUS',function(){window.open('https://www.javbus.com/'+encodeURIComponent(code),'_blank','noopener');}));
      host.appendChild(tools); item.dataset.bbjbTools='1';
    });
  };
  var nav = function () {
    var dropdowns=document.querySelectorAll('a[href*="rankings/playback"],a[href*="rankings/top"],a[href*="/rankings"],a[href*="type=3"],.navbar-item,.tabs a'); Array.prototype.forEach.call(dropdowns,function(link){if(/playback/.test(link.href))link.href=HOT;else if(/top/.test(link.href))link.href=TOP;else if(/type=3/.test(link.href)||/^FC2$/i.test(link.textContent.trim()))link.href=FC2;});
    var float=document.querySelector('.bbjb-nav'); if(float)return; float=document.createElement('div'); float.className='bbjb-nav'; float.innerHTML='<button title="返回顶部">↑</button><button title="翻到底部">↓</button><button title="Emby 入库查询设置">⚙</button>'; document.body.appendChild(float); float.children[0].onclick=function(){scrollTo({top:0,behavior:'smooth'});}; float.children[1].onclick=function(){scrollTo({top:document.body.scrollHeight,behavior:'smooth'});}; float.children[2].onclick=showEmbySettings;
  };
  var run=function(){nav();specialPage();detailPage();listPage();};
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',run); else run();
  new MutationObserver(function(){run();}).observe(document.documentElement,{childList:true,subtree:true});
  setInterval(function(){ if (!embyConfig().url) return; Object.keys(embyCache).forEach(function (key) { delete embyCache[key]; }); document.querySelectorAll('.bbjb-emby-status').forEach(function (node) { node.remove(); }); run(); }, 15*60*1000);
})();`;

export { BUDDY_ASSET_PATH };
