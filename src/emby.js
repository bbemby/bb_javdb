const DEFAULT_API_ORIGIN = "https://jdforrepam.com/api";
const DEFAULT_UPSTREAM_ORIGIN = "https://catembylegacy.fastcdn.dpdns.org";
const SIGNATURE_KEY = "lpw6vgqzsp";
const SIGNATURE_SECRET =
  "71cf27bb3c0bcdf207b64abecddc970098c7421ee7203b9cdae54478478a199e7d5a6e1a57691123c1a931c057842fb73ba3b3c83bcd69c17ccf174081e3d8aa";
const ROOT_ID = "bbjavdb-root";
const USER_ID = "bbjavdb-user";
const PRODUCT_NAME = "步兵JAVDB";

const MEDIA_HOSTS = new Set([
  "jdforrepam.com",
  "tp.spfcas.com",
  "h1.gzankun.com",
]);
const MEDIA_SUFFIXES = [".spfcas.com", ".gzankun.com"];

function add32(...values) {
  return values.reduce((sum, value) => (sum + value) | 0, 0);
}

function rotateLeft(value, amount) {
  return (value << amount) | (value >>> (32 - amount));
}

function littleEndianHex(value) {
  const unsigned = value >>> 0;
  let result = "";
  for (let index = 0; index < 4; index += 1) {
    result += (`0${((unsigned >>> (index * 8)) & 255).toString(16)}`).slice(-2);
  }
  return result;
}

// The upstream API uses MD5 for its public, time-based request signature.
function md5(value) {
  const bytes = new TextEncoder().encode(value);
  const blockLength = (((bytes.length + 8) >>> 6) + 1) * 16;
  const words = new Int32Array(blockLength);

  for (let index = 0; index < bytes.length; index += 1) {
    words[index >>> 2] |= bytes[index] << ((index & 3) * 8);
  }

  words[bytes.length >>> 2] |= 0x80 << ((bytes.length & 3) * 8);
  const bitLength = bytes.length * 8;
  words[blockLength - 2] = bitLength;
  words[blockLength - 1] = Math.floor(bitLength / 4294967296);

  const shifts = [
    [7, 12, 17, 22],
    [5, 9, 14, 20],
    [4, 11, 16, 23],
    [6, 10, 15, 21],
  ];
  const constants = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
    0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
    0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
    0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
    0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
    0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
    0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
    0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
    0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
  ];

  let a = 0x67452301 | 0;
  let b = 0xefcdab89 | 0;
  let c = 0x98badcfe | 0;
  let d = 0x10325476 | 0;

  for (let offset = 0; offset < blockLength; offset += 16) {
    const originalA = a;
    const originalB = b;
    const originalC = c;
    const originalD = d;

    for (let index = 0; index < 64; index += 1) {
      let functionValue;
      let wordIndex;
      let round;

      if (index < 16) {
        functionValue = (b & c) | (~b & d);
        wordIndex = index;
        round = 0;
      } else if (index < 32) {
        functionValue = (d & b) | (~d & c);
        wordIndex = (5 * index + 1) % 16;
        round = 1;
      } else if (index < 48) {
        functionValue = b ^ c ^ d;
        wordIndex = (3 * index + 5) % 16;
        round = 2;
      } else {
        functionValue = c ^ (b | ~d);
        wordIndex = (7 * index) % 16;
        round = 3;
      }

      const shifted = add32(
        a,
        functionValue,
        words[offset + wordIndex],
        constants[index],
      );
      const nextA = d;
      d = c;
      c = b;
      b = add32(
        b,
        rotateLeft(shifted, shifts[round][index % 4]),
      );
      a = nextA;
    }

    a = add32(a, originalA);
    b = add32(b, originalB);
    c = add32(c, originalC);
    d = add32(d, originalD);
  }

  return [a, b, c, d].map(littleEndianHex).join("");
}

export function createJavdbSignature(timestamp = Math.floor(Date.now() / 1000)) {
  const value = String(timestamp);
  return `${value}.${SIGNATURE_KEY}.${md5(value + SIGNATURE_SECRET)}`;
}

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

function errorResponse(status, message) {
  return jsonResponse({
    error: message,
    ErrorCode: status === 401 ? "Unauthorized" : "UnknownError",
    Message: message,
  }, status);
}

function apiOrigin(env) {
  return String(env.JAVDB_API_ORIGIN || DEFAULT_API_ORIGIN).replace(/\/$/, "");
}

function upstreamOrigin(env) {
  return new URL(env.UPSTREAM_ORIGIN || DEFAULT_UPSTREAM_ORIGIN).origin;
}

function mediaHostAllowed(hostname, env) {
  const host = String(hostname || "").toLowerCase();
  if (MEDIA_HOSTS.has(host) || MEDIA_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return true;
  }

  return String(env.EXTRA_MEDIA_HOSTS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .includes(host);
}

function safeMediaUrl(value, env) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }

    if (url.origin === upstreamOrigin(env) || mediaHostAllowed(url.hostname, env)) {
      return url;
    }
  } catch {
    return null;
  }

  return null;
}

function getToken(request, url) {
  const queryToken = url.searchParams.get("api_key") || url.searchParams.get("ApiKey");
  if (queryToken) {
    return queryToken;
  }

  const directToken = request.headers.get("x-emby-token");
  if (directToken) {
    return directToken;
  }

  const authorization =
    request.headers.get("x-emby-authorization") ||
    request.headers.get("authorization") ||
    "";
  const match = authorization.match(/Token[= ]+"?([^", ]+)/i);
  return match ? match[1] : "";
}

function routePath(requestUrl) {
  const path = new URL(requestUrl).pathname;
  return path.startsWith("/emby/") ? path.slice("/emby".length) : path;
}

function publicRoutePath(requestUrl, path) {
  const requestPath = new URL(requestUrl).pathname;
  return requestPath.startsWith("/emby/") ? `/emby${path}` : path;
}

function serverId(env) {
  return String(env.EMBY_SERVER_ID || "bbjavdb-emby");
}

function virtualUser() {
  return {
    Id: USER_ID,
    Name: "JAVDB User",
    ServerId: "",
    HasPassword: true,
    HasConfiguredPassword: true,
    EnableAutoLogin: false,
    Configuration: {
      PlayDefaultAudioTrack: true,
      SubtitleLanguagePreference: "zh-CN",
    },
  };
}

async function javdbRequest(path, env, fetchImpl, options = {}) {
  const url = new URL(`${apiOrigin(env)}${path}`);
  if (options.query) {
    Object.entries(options.query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });
  }

  const headers = new Headers(options.headers);
  headers.set("accept", "application/json");
  headers.set("jdsignature", createJavdbSignature());
  if (options.token) {
    headers.set("authorization", options.token);
  }

  const response = await fetchImpl(url.toString(), {
    method: options.method || "GET",
    headers,
    body: options.body,
    redirect: "follow",
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || payload.error || `JavDB API HTTP ${response.status}`);
  }
  if (payload.success !== undefined && payload.success !== 1) {
    throw new Error(payload.message || "JavDB API request failed");
  }

  return payload.data === undefined ? payload : payload.data;
}

async function upstreamJson(path, env, fetchImpl) {
  const response = await fetchImpl(new URL(path, upstreamOrigin(env)).toString(), {
    headers: { accept: "application/json" },
    redirect: "follow",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || payload.error || `Upstream HTTP ${response.status}`);
  }
  return payload;
}

function movieFromPayload(payload) {
  return payload?.movie || payload?.data?.movie || payload?.data || payload;
}

function moviesFromPayload(payload) {
  return payload?.movies || payload?.data?.movies || [];
}

function tagName(tag) {
  return typeof tag === "string" ? tag : tag?.name || "";
}

function mapMovie(movie, requestUrl) {
  const id = String(movie.id ?? movie.number ?? "");
  const image = movie.cover_url || movie.thumb_url || "";
  const date = movie.release_date || movie.released_at || "";
  const year = Number.parseInt(String(date).slice(0, 4), 10);
  const duration = Number(movie.duration || 0);
  const tags = (movie.tags || []).map(tagName).filter(Boolean);
  const actors = (movie.actors || []).filter(Boolean).map((actor) => ({
    Name: actor.name || actor,
    Type: "Actor",
    Id: String(actor.id || actor.name || ""),
  }));
  const item = {
    Id: id,
    Name: movie.title || movie.number || id,
    OriginalTitle: movie.title || movie.number || id,
    Type: "Movie",
    IsFolder: false,
    CanDelete: false,
    CanDownload: false,
    LocationType: "Remote",
    MediaType: "Video",
    Overview: movie.summary || "",
    PremiereDate: date || undefined,
    ProductionYear: Number.isFinite(year) ? year : undefined,
    RunTimeTicks: duration > 0 ? Math.round(duration * 60 * 10_000_000) : undefined,
    Genres: tags,
    People: actors,
    ImageTags: image ? { Primary: "1" } : {},
    ProviderIds: { JavDB: id },
    UserData: {
      Played: false,
      PlayCount: 0,
      IsFavorite: false,
      PlaybackPositionTicks: 0,
    },
    Path: `${new URL(requestUrl).origin}${publicRoutePath(requestUrl, `/Items/${encodeURIComponent(id)}`)}`,
  };

  if (movie.maker_name) {
    item.Studios = [{ Name: movie.maker_name, Id: String(movie.maker_id || "") }];
  }
  if (movie.director_name) {
    item.People.push({
      Name: movie.director_name,
      Type: "Director",
      Id: String(movie.director_id || movie.director_name),
    });
  }
  if (movie.series_name) {
    item.SeriesName = movie.series_name;
    item.SeriesId = String(movie.series_id || "");
  }

  return item;
}

async function getMovie(id, env, fetchImpl) {
  const payload = await javdbRequest(`/v4/movies/${encodeURIComponent(id)}`, env, fetchImpl);
  return movieFromPayload(payload);
}

async function getMoviePage(query, env, fetchImpl) {
  const startIndex = Math.max(0, Number(query.get("StartIndex") || 0));
  const limit = Math.min(100, Math.max(1, Number(query.get("Limit") || 32)));
  const page = Math.floor(startIndex / limit) + 1;
  const searchTerm = query.get("SearchTerm") || query.get("searchTerm") || "";
  const payload = searchTerm
    ? await javdbRequest("/v2/search", env, fetchImpl, {
        query: { q: searchTerm, page, type: "movie", limit },
      })
    : await javdbRequest("/v1/movies/latest", env, fetchImpl, {
        query: { page, filter_by: "all", limit },
      });
  const movies = moviesFromPayload(payload);
  return {
    Items: movies.map((movie) => mapMovie(movie, query.requestUrl || "https://localhost/")),
    TotalRecordCount: Number(payload?.total_count || payload?.total || movies.length),
    StartIndex: startIndex,
  };
}

async function resolveVideo(movie, env, fetchImpl) {
  const code = movie.number || movie.code || movie.title;
  if (!code) {
    return null;
  }

  const payload = await upstreamJson(
    `/api/v/resolve?code=${encodeURIComponent(code)}&lang=zh`,
    env,
    fetchImpl,
  );
  const data = payload?.data || payload;
  const variants = Array.isArray(data?.variants) ? data.variants : [];
  const variant =
    variants.find((item) => item.variant === "original") || variants[0] || null;
  if (!variant?.sourceUrl) {
    return null;
  }

  return {
    sourceUrl: variant.sourceUrl,
    sourceType: variant.sourceType || "video/mp4",
    title: variant.title || movie.title || movie.number || code,
  };
}

function mediaSource(item, requestUrl, token, video) {
  const streamUrl = new URL(
    publicRoutePath(requestUrl, `/Videos/${encodeURIComponent(item.Id)}/stream`),
    requestUrl,
  );
  streamUrl.searchParams.set("api_key", token);
  const isHls = /mpegurl|m3u8/i.test(video.sourceType || video.sourceUrl);
  return {
    Id: item.Id,
    Name: video.title,
    Path: streamUrl.toString(),
    Protocol: "Http",
    Type: "Default",
    Container: isHls ? "m3u8" : "mp4",
    IsRemote: true,
    SupportsDirectPlay: true,
    SupportsDirectStream: true,
    SupportsTranscoding: false,
    RequiresOpening: false,
    RequiresClosing: false,
    RunTimeTicks: item.RunTimeTicks,
    MediaStreams: [
      {
        Type: "Video",
        Codec: isHls ? "hls" : "h264",
        Index: 0,
        IsInterlaced: false,
        IsAVC: !isHls,
        TimeBase: "1/10000000",
      },
    ],
  };
}

async function authenticate(request, env, fetchImpl) {
  let input = {};
  try {
    input = await request.clone().json();
  } catch {
    try {
      const form = await request.clone().formData();
      input = Object.fromEntries(form.entries());
    } catch {
      input = {};
    }
  }

  const url = new URL(request.url);
  const username = String(input.Username || input.username || url.searchParams.get("username") || "").trim();
  const password = String(input.Pw || input.Password || input.password || url.searchParams.get("password") || "");
  if (!username || !password) {
    return errorResponse(401, "JavDB username and password are required");
  }

  const form = new FormData();
  form.set("username", username);
  form.set("password", password);
  form.set("device_uuid", "emby");
  form.set("device_name", "Emby Client");
  form.set("device_model", "Emby Compatible");
  form.set("platform", "android");
  form.set("system_version", "Emby Compatible");
  form.set("app_channel", "official");
  form.set("app_version", "emby-bridge");
  form.set("app_version_number", "1.0.0");

  try {
    const data = await javdbRequest("/v1/sessions", env, fetchImpl, {
      method: "POST",
      body: form,
    });
    const token = String(data?.token || "");
    if (!token) {
      return errorResponse(401, "JavDB authentication failed");
    }

    const user = virtualUser();
    user.Name = data?.user?.username || username;
    user.ServerId = serverId(env);
    return jsonResponse({
      User: user,
      SessionInfo: {
        Id: crypto.randomUUID(),
        UserId: USER_ID,
        UserName: user.Name,
        Client: "Emby Compatible",
        DeviceName: "Emby Client",
        DeviceId: "bbjavdb-emby",
        ApplicationVersion: "1.0.0",
        RemoteEndPoint: new URL(request.url).hostname,
        PlayState: {},
        AdditionalUsers: [],
      },
      AccessToken: token,
      ServerId: serverId(env),
    });
  } catch (error) {
    return errorResponse(401, error instanceof Error ? error.message : "JavDB authentication failed");
  }
}

function systemInfo(requestUrl, env) {
  return {
    LocalAddress: new URL(requestUrl).origin,
    ServerName: PRODUCT_NAME,
    Version: "1.0.0",
    ProductName: "Emby Compatible Server",
    Id: serverId(env),
    OperatingSystem: "Cloudflare Workers",
    StartupWizardCompleted: true,
    SupportsLibraryMonitor: false,
  };
}

function rootView(env) {
  return {
    Name: PRODUCT_NAME,
    ServerId: serverId(env),
    Id: ROOT_ID,
    Guid: ROOT_ID,
    Type: "CollectionFolder",
    CollectionType: "movies",
    IsFolder: true,
    LocationType: "Virtual",
    ImageTags: {},
  };
}

async function itemResponse(id, request, env, fetchImpl) {
  const movie = await getMovie(id, env, fetchImpl);
  if (!movie?.id && !movie?.number) {
    return errorResponse(404, "Movie not found");
  }
  return jsonResponse(mapMovie(movie, request.url));
}

async function imageResponse(id, request, env, fetchImpl) {
  const movie = await getMovie(id, env, fetchImpl);
  const imageUrl = safeMediaUrl(movie?.cover_url || movie?.thumb_url, env);
  if (!imageUrl) {
    return errorResponse(404, "Movie image not found");
  }

  const upstream = await fetchImpl(imageUrl.toString(), {
    headers: { accept: "image/avif,image/webp,image/*,*/*;q=0.8" },
    redirect: "follow",
  });
  if (!upstream.ok) {
    return errorResponse(404, "Movie image not found");
  }
  const headers = new Headers({
    "cache-control": "public, max-age=3600",
    "access-control-allow-origin": "*",
  });
  if (upstream.headers.get("content-type")) {
    headers.set("content-type", upstream.headers.get("content-type"));
  }
  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
}

async function streamResponse(id, request, env, fetchImpl, token) {
  if (!token) {
    return errorResponse(401, "Emby token is required for playback");
  }

  try {
    const movie = await getMovie(id, env, fetchImpl);
    const video = await resolveVideo(movie, env, fetchImpl);
    const sourceUrl = safeMediaUrl(video?.sourceUrl, env);
    if (!video || !sourceUrl) {
      return errorResponse(404, "No playable video source was found");
    }

    const headers = new Headers();
    const range = request.headers.get("range");
    if (range) {
      headers.set("range", range);
    }
    const upstream = await fetchImpl(sourceUrl.toString(), {
      method: request.method,
      headers,
      redirect: "follow",
    });
    const responseHeaders = new Headers({
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    });
    for (const name of [
      "accept-ranges",
      "content-length",
      "content-range",
      "content-type",
      "etag",
      "last-modified",
    ]) {
      const value = upstream.headers.get(name);
      if (value) {
        responseHeaders.set(name, value);
      }
    }
    if (!responseHeaders.has("content-type")) {
      responseHeaders.set("content-type", video.sourceType || "video/mp4");
    }

    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    return errorResponse(502, error instanceof Error ? error.message : "Video source unavailable");
  }
}

function isHandledPath(path) {
  return (
    path === "/System/Info/Public" ||
    path === "/System/Info" ||
    path === "/Users/Public" ||
    path === "/Users/AuthenticateByName" ||
    path === "/Users" ||
    path === "/Users/bbjavdb-user" ||
    path === "/Users/bbjavdb-user/Views" ||
    path === "/Library/VirtualFolders" ||
    path === "/Library/MediaFolders" ||
    path === "/Items" ||
    path === "/SearchHints" ||
    path === "/Sessions" ||
    path === "/Branding/Configuration" ||
    path === "/Startup/Configuration" ||
    path.startsWith("/Users/bbjavdb-user/Items") ||
    path.startsWith("/Items/") ||
    path.startsWith("/Videos/") ||
    path.startsWith("/emby-media/")
  );
}

export async function handleEmby(request, env = {}, fetchImpl = fetch) {
  const url = new URL(request.url);
  const path = routePath(request.url);
  if (!isHandledPath(path)) {
    return null;
  }

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,HEAD,POST,OPTIONS",
        "access-control-allow-headers": "*",
      },
    });
  }

  if (path === "/System/Info/Public" || path === "/System/Info") {
    return jsonResponse(systemInfo(request.url, env));
  }
  if (path === "/Branding/Configuration" || path === "/Startup/Configuration") {
    return jsonResponse({});
  }
  if (path === "/Users/Public" || path === "/Users") {
    return jsonResponse([virtualUser()]);
  }
  if (path === "/Users/AuthenticateByName") {
    return authenticate(request, env, fetchImpl);
  }
  if (path === "/Users/bbjavdb-user") {
    return jsonResponse(virtualUser());
  }
  if (path === "/Users/bbjavdb-user/Views") {
    return jsonResponse({ Items: [rootView(env)] });
  }
  if (path === "/Library/VirtualFolders" || path === "/Library/MediaFolders") {
    return jsonResponse([rootView(env)]);
  }
  if (path === "/Sessions") {
    return jsonResponse([]);
  }

  const token = getToken(request, url);
  if (path === "/Items" || path === "/Users/bbjavdb-user/Items") {
    try {
      const query = new URLSearchParams(url.search);
      query.requestUrl = request.url;
      const result = await getMoviePage(query, env, fetchImpl);
      result.Items = result.Items.map((item) => ({ ...item, Path: item.Path }));
      return jsonResponse(result);
    } catch (error) {
      return errorResponse(502, error instanceof Error ? error.message : "Movie catalog unavailable");
    }
  }
  if (path === "/SearchHints") {
    try {
      const result = await getMoviePage(new URLSearchParams(`SearchTerm=${encodeURIComponent(url.searchParams.get("SearchTerm") || "")}`), env, fetchImpl);
      return jsonResponse({
        SearchHints: result.Items.map((item) => ({
          ItemId: item.Id,
          Id: item.Id,
          Name: item.Name,
          Type: "Movie",
          MediaType: "Video",
          ProductionYear: item.ProductionYear,
          PrimaryImageTag: item.ImageTags?.Primary,
        })),
      });
    } catch (error) {
      return errorResponse(502, error instanceof Error ? error.message : "Search unavailable");
    }
  }

  const imageMatch = path.match(/^\/Items\/([^/]+)\/Images\/Primary$/i);
  if (imageMatch) {
    try {
      return await imageResponse(decodeURIComponent(imageMatch[1]), request, env, fetchImpl);
    } catch (error) {
      return errorResponse(502, error instanceof Error ? error.message : "Movie image unavailable");
    }
  }

  const playbackMatch = path.match(/^\/Items\/([^/]+)\/PlaybackInfo$/i);
  if (playbackMatch) {
    try {
      const movie = await getMovie(decodeURIComponent(playbackMatch[1]), env, fetchImpl);
      const item = mapMovie(movie, request.url);
      const video = await resolveVideo(movie, env, fetchImpl);
      if (!video) {
        return jsonResponse({ PlaySessionId: crypto.randomUUID(), MediaSources: [] });
      }
      return jsonResponse({
        PlaySessionId: crypto.randomUUID(),
        ItemId: item.Id,
        MediaSources: [mediaSource(item, request.url, token, video)],
      });
    } catch (error) {
      return errorResponse(502, error instanceof Error ? error.message : "Playback metadata unavailable");
    }
  }

  const itemMatch = path.match(/^\/Items\/([^/]+)$/i);
  if (itemMatch) {
    try {
      return await itemResponse(decodeURIComponent(itemMatch[1]), request, env, fetchImpl);
    } catch (error) {
      return errorResponse(502, error instanceof Error ? error.message : "Movie metadata unavailable");
    }
  }

  const streamMatch = path.match(/^\/Videos\/([^/]+)\/stream(?:\.mp4)?$/i);
  if (streamMatch) {
    return streamResponse(
      decodeURIComponent(streamMatch[1]),
      request,
      env,
      fetchImpl,
      token,
    );
  }

  if (path.startsWith("/emby-media/")) {
    const mediaUrl = safeMediaUrl(url.searchParams.get("url"), env);
    if (!mediaUrl) {
      return errorResponse(403, "Media URL is not allowed");
    }
    const headers = new Headers();
    const range = request.headers.get("range");
    if (range) {
      headers.set("range", range);
    }
    const upstream = await fetchImpl(mediaUrl.toString(), {
      method: request.method,
      headers,
      redirect: "follow",
    });
    const responseHeaders = new Headers();
    for (const name of ["accept-ranges", "content-length", "content-range", "content-type"]) {
      const value = upstream.headers.get(name);
      if (value) {
        responseHeaders.set(name, value);
      }
    }
    responseHeaders.set("access-control-allow-origin", "*");
    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  }

  return errorResponse(404, "Emby endpoint not found");
}
