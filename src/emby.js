const DEFAULT_API_ORIGIN = "https://jdforrepam.com/api";
const DEFAULT_UPSTREAM_ORIGIN = "https://catembylegacy.fastcdn.dpdns.org";
const SIGNATURE_KEY = "lpw6vgqzsp";
const SIGNATURE_SECRET =
  "71cf27bb3c0bcdf207b64abecddc970098c7421ee7203b9cdae54478478a199e7d5a6e1a57691123c1a931c057842fb73ba3b3c83bcd69c17ccf174081e3d8aa";
const ROOT_ID = "bbjavdb-root";
const PLAYABLE_LIBRARY_ID = "bbjavdb-playable";
const CHINESE_PLAYABLE_LIBRARY_ID = "bbjavdb-chinese-playable";
const USER_ID = "bbjavdb-user";
const PRODUCT_NAME = "步兵JAVDB";
const DEFAULT_GUEST_TOKEN = "bbjavdb-guest";
const LIBRARIES = [
  {
    id: PLAYABLE_LIBRARY_ID,
    name: "可播放",
    sourceFilter: "can_play",
    matches: (movie) => Boolean(movie?.can_play),
  },
  {
    id: CHINESE_PLAYABLE_LIBRARY_ID,
    name: "中文可播放",
    sourceFilter: "subtitle",
    matches: (movie) => isPlayableChinese(movie),
  },
];

const MEDIA_HOSTS = new Set([
  "fast-stream.jav.si",
  "jdforrepam.com",
  "tp.spfcas.com",
  "h1.gzankun.com",
]);
const MEDIA_SUFFIXES = [".spfcas.com", ".gzankun.com"];
const INLINE_HLS_CONTENT_TYPES = new Set([
  "application/mpegurl",
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
]);
const MAX_INLINE_HLS_LENGTH = 2_000_000;
const HOME_SOURCE_PAGE_SIZE = 50;
const HOME_MAX_SOURCE_PAGES = 12;
const IMAGE_CONTENT_TYPES = new Map([
  [".avif", "image/avif"],
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);
const IMAGE_SIGNATURES = [
  { contentType: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { contentType: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { contentType: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] },
  { contentType: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] },
  { contentType: "image/bmp", bytes: [0x42, 0x4d] },
];

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
    const raw = String(value || "").trim();
    if (!raw || raw.startsWith("data:")) {
      return null;
    }

    // Resolver responses have used both absolute and root-relative URLs over
    // time. Relative media paths are safe because they are pinned to the
    // configured upstream origin before the host allowlist is checked.
    const url = new URL(raw, upstreamOrigin(env));
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

function sourceUrlValue(value) {
  if (typeof value === "string") {
    return value;
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  return value.sourceUrl || value.source_url || value.url || value.playUrl ||
    value.play_url || value.directUrl || value.direct_url || value.file ||
    value.src || "";
}

function sourceVariants(payload) {
  const data = payload?.data || payload;
  if (Array.isArray(data)) {
    return data;
  }
  const candidates = [
    data?.variants,
    data?.sources,
    data?.videos,
    data?.streams,
    data?.data?.variants,
    data?.data?.sources,
  ];
  const list = candidates.find((item) => Array.isArray(item) && item.length > 0) ||
    candidates.find(Array.isArray);
  if (list) {
    return list;
  }

  // Some resolver versions return one source object instead of an array.
  return sourceUrlValue(data) ? [data] : [];
}

function safeMediaContentType(value) {
  const type = String(value || "").toLowerCase();
  return /^(?:video\/[a-z0-9.+-]+|application\/(?:vnd\.apple\.|x-)?mpegurl)$/.test(type)
    ? type
    : "video/mp4";
}

function decodeInlineHls(value) {
  const source = String(value || "");
  if (!source.startsWith("data:") || source.length > MAX_INLINE_HLS_LENGTH) {
    return null;
  }

  const commaIndex = source.indexOf(",");
  if (commaIndex === -1) {
    return null;
  }

  const metadata = source.slice(5, commaIndex).toLowerCase();
  const contentType = metadata.split(";")[0];
  if (!INLINE_HLS_CONTENT_TYPES.has(contentType)) {
    return null;
  }

  try {
    const payload = source.slice(commaIndex + 1);
    const playlist = metadata.split(";").includes("base64")
      ? new TextDecoder().decode(
          Uint8Array.from(atob(payload), (character) => character.charCodeAt(0)),
        )
      : decodeURIComponent(payload);
    return playlist.trimStart().startsWith("#EXTM3U") ? playlist : null;
  } catch {
    return null;
  }
}

function getToken(request, url) {
  const queryToken =
    url.searchParams.get("api_key") ||
    url.searchParams.get("ApiKey") ||
    url.searchParams.get("access_token") ||
    url.searchParams.get("AccessToken");
  if (queryToken) {
    return queryToken;
  }

  const directToken =
    request.headers.get("x-emby-token") ||
    request.headers.get("x-mediabrowser-token");
  if (directToken) {
    return directToken;
  }

  const authorization =
    request.headers.get("x-emby-authorization") ||
    request.headers.get("authorization") ||
    "";
  const tokenMatch = authorization.match(/\bToken\s*[=:]\s*"?([^",\s]+)/i);
  if (tokenMatch) {
    return tokenMatch[1];
  }

  const bearerMatch = authorization.match(/^Bearer\s+([^\s]+)/i);
  return bearerMatch ? bearerMatch[1] : "";
}

function routePath(requestUrl) {
  const path = new URL(requestUrl).pathname;
  const withoutPrefix = /^\/emby(?:\/|$)/i.test(path)
    ? path.slice("/emby".length)
    : path;
  return withoutPrefix.replace(/\/+$/, "") || "/";
}

function normalizeClientPath(path) {
  return path
    .replace(/^\/Users\/[^/]+\/Items(?=\/|$)/i, "/Items")
    .replace(/^\/Users\/[^/]+\/Suggestions$/i, "/Suggestions");
}

function publicRoutePath(requestUrl, path) {
  const requestPath = new URL(requestUrl).pathname;
  return /^\/emby(?:\/|$)/i.test(requestPath) ? `/emby${path}` : path;
}

function serverId(env) {
  return String(env.EMBY_SERVER_ID || "bbjavdb-emby");
}

function guestAccessEnabled(env) {
  const value = String(env.EMBY_GUEST_ACCESS ?? "true").trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(value);
}

function guestToken(env) {
  return String(env.EMBY_GUEST_TOKEN || DEFAULT_GUEST_TOKEN);
}

function virtualUser(env = {}, name = "JAVDB Guest", hasPassword = false) {
  return {
    Id: USER_ID,
    Name: name,
    ServerId: serverId(env),
    HasPassword: hasPassword,
    HasConfiguredPassword: hasPassword,
    HasConfiguredEasyPassword: false,
    EnableAutoLogin: !hasPassword,
    LastLoginDate: new Date().toISOString(),
    LastActivityDate: new Date().toISOString(),
    Configuration: {
      PlayDefaultAudioTrack: true,
      SubtitleLanguagePreference: "zh-CN",
      DisplayMissingEpisodes: false,
      GroupedFolders: [],
      SubtitleMode: "Default",
      DisplayCollectionsView: false,
      EnableLocalPassword: false,
      OrderedViews: [],
      LatestItemsExcludes: [],
      MyMediaExcludes: [],
      HidePlayedInLatest: false,
      RememberAudioSelections: true,
      RememberSubtitleSelections: true,
      EnableNextEpisodeAutoPlay: true,
    },
    Policy: {
      IsAdministrator: false,
      IsHidden: false,
      IsDisabled: false,
      BlockedTags: [],
      EnableUserPreferenceAccess: true,
      AccessSchedules: [],
      EnableRemoteControlOfOtherUsers: false,
      EnableSharedDeviceControl: false,
      EnableRemoteAccess: true,
      EnableLiveTvManagement: false,
      EnableLiveTvAccess: true,
      EnableMediaPlayback: true,
      EnableAudioPlaybackTranscoding: true,
      EnableVideoPlaybackTranscoding: true,
      EnablePlaybackRemuxing: true,
      EnableContentDeletion: false,
      EnableContentDownloading: true,
      EnableSyncTranscoding: true,
      EnableMediaConversion: true,
      EnableAllFolders: true,
      EnabledFolders: [],
      EnableContentDeletionFromFolders: [],
      InvalidLoginAttemptCount: 0,
      LoginAttemptsBeforeLockout: -1,
      IsProtected: false,
      EnablePublicSharing: true,
      RemoteClientBitrateLimit: 0,
      AuthenticationProviderId: "DefaultAuthenticationProvider",
      PasswordResetProviderId: "DefaultPasswordResetProvider",
      SyncPlayAccess: "CreateAndJoin",
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
  headers.set("user-agent", "Mozilla/5.0");
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

function hasChineseSubtitles(movie) {
  return Boolean(movie?.has_cnsub || Number(movie?.play_subtitle || 0) > 0);
}

function isPlayableChinese(movie) {
  return Boolean(movie?.can_play) && hasChineseSubtitles(movie);
}

function bytesStartWith(bytes, signature, offset = 0) {
  return bytes.length >= offset + signature.length &&
    signature.every((value, index) => bytes[offset + index] === value);
}

function sniffImageContentType(bytes) {
  for (const signature of IMAGE_SIGNATURES) {
    if (bytesStartWith(bytes, signature.bytes)) {
      return signature.contentType;
    }
  }
  if (
    bytesStartWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytesStartWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image/webp";
  }
  if (
    bytesStartWith(bytes, [0x66, 0x74, 0x79, 0x70], 4) &&
    (
      bytesStartWith(bytes, [0x61, 0x76, 0x69, 0x66], 8) ||
      bytesStartWith(bytes, [0x61, 0x76, 0x69, 0x73], 8)
    )
  ) {
    return "image/avif";
  }
  return null;
}

function xorImageBytes(bytes, key, skip = 0) {
  const output = new Uint8Array(Math.max(bytes.length - skip, 0));
  for (let index = skip; index < bytes.length; index += 1) {
    output[index - skip] = bytes[index] ^ key;
  }
  return output;
}

function decodeImagePrefix(bytes) {
  const directType = sniffImageContentType(bytes);
  if (directType) {
    return { bytes, contentType: directType, xorKey: null };
  }

  if (bytes.length > 1) {
    const xorKey = bytes[0];
    const decoded = xorImageBytes(bytes, xorKey, 1);
    const contentType = sniffImageContentType(decoded);
    if (contentType) {
      return { bytes: decoded, contentType, xorKey };
    }
  }

  for (let skip = 0; skip <= 2; skip += 1) {
    const decoded = xorImageBytes(bytes, 0x7f, skip);
    const contentType = sniffImageContentType(decoded);
    if (contentType) {
      return { bytes: decoded, contentType, xorKey: 0x7f };
    }
  }

  return { bytes, contentType: null, xorKey: null };
}

async function decodeImageBody(body) {
  if (!body) {
    return { body: null, contentType: null };
  }

  const reader = body.getReader();
  const chunks = [];
  let byteLength = 0;
  while (byteLength < 12) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    chunks.push(result.value);
    byteLength += result.value.byteLength;
  }
  const prefix = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    prefix.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const decoded = decodeImagePrefix(prefix);
  const decodedBody = new ReadableStream({
    start(controller) {
      if (decoded.bytes.byteLength > 0) {
        controller.enqueue(decoded.bytes);
      }
    },
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          controller.close();
          return;
        }
        controller.enqueue(
          decoded.xorKey === null
            ? result.value
            : xorImageBytes(result.value, decoded.xorKey),
        );
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return { body: decodedBody, contentType: decoded.contentType };
}

function imageContentType(imageUrl, declaredType, detectedType) {
  if (detectedType) {
    return detectedType;
  }
  const normalized = String(declaredType || "").toLowerCase();
  if (normalized.startsWith("image/")) {
    return declaredType;
  }

  const pathname = imageUrl.pathname.toLowerCase();
  for (const [extension, contentType] of IMAGE_CONTENT_TYPES) {
    if (pathname.endsWith(extension)) {
      return contentType;
    }
  }

  return "image/jpeg";
}

function mapMovie(movie, requestUrl, env = {}, parentId = CHINESE_PLAYABLE_LIBRARY_ID) {
  const id = String(movie.id ?? movie.number ?? "");
  const image = movie.cover_url || movie.thumb_url || "";
  const date = movie.release_date || movie.released_at || "";
  const year = Number.parseInt(String(date).slice(0, 4), 10);
  const duration = Number(movie.duration || 0);
  const tags = (movie.tags || []).map(tagName).filter(Boolean);
  if (hasChineseSubtitles(movie)) {
    tags.unshift("中文字幕");
  }
  if (movie.can_play) {
    tags.unshift("可播放");
  }
  const uniqueTags = [...new Set(tags)];
  const actors = (movie.actors || []).filter(Boolean).map((actor) => ({
    Name: actor.name || actor,
    Type: "Actor",
    Id: String(actor.id || actor.name || ""),
  }));
  const item = {
    Id: id,
    ServerId: serverId(env),
    ParentId: parentId,
    Name: movie.title || movie.number || id,
    OriginalTitle: movie.title || movie.number || id,
    SortName: movie.title || movie.number || id,
    Type: "Movie",
    IsFolder: false,
    CanDelete: false,
    CanDownload: true,
    SupportsSync: true,
    PlayAccess: "Full",
    LocationType: "Remote",
    MediaType: "Video",
    VideoType: "VideoFile",
    Container: "mp4",
    Overview: movie.summary || "",
    PremiereDate: date || undefined,
    ProductionYear: Number.isFinite(year) ? year : undefined,
    RunTimeTicks: duration > 0 ? Math.round(duration * 60 * 10_000_000) : undefined,
    Genres: uniqueTags,
    Tags: uniqueTags,
    People: actors,
    ImageTags: image ? { Primary: id } : {},
    BackdropImageTags: [],
    PrimaryImageAspectRatio: image ? 0.667 : undefined,
    ProviderIds: { JavDB: id },
    UserData: {
      Played: false,
      PlayCount: 0,
      IsFavorite: false,
      PlaybackPositionTicks: 0,
    },
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

function apiToken(token, env) {
  const value = String(token || "");
  return value && value !== guestToken(env) ? value : "";
}

async function getMovie(id, env, fetchImpl, token = "") {
  const payload = await javdbRequest(
    `/v4/movies/${encodeURIComponent(id)}`,
    env,
    fetchImpl,
    { token: apiToken(token, env) },
  );
  return movieFromPayload(payload);
}

async function getMoviePage(query, env, fetchImpl, token = "") {
  const startIndex = Math.max(0, Number(query.get("StartIndex") || 0));
  const limit = Math.min(100, Math.max(1, Number(query.get("Limit") || 32)));
  const page = Math.floor(startIndex / limit) + 1;
  const searchTerm = query.get("SearchTerm") || query.get("searchTerm") || "";
  const requestedParentId = query.get("ParentId") || CHINESE_PLAYABLE_LIBRARY_ID;
  const library = LIBRARIES.find((item) => item.id === requestedParentId) ||
    LIBRARIES.find((item) => item.id === CHINESE_PLAYABLE_LIBRARY_ID);
  const parentId = requestedParentId === ROOT_ID ? ROOT_ID : library.id;
  if (searchTerm) {
    const payload = await javdbRequest("/v2/search", env, fetchImpl, {
      query: {
        q: searchTerm,
        page,
        type: "movie",
        movie_filter_by: "p",
        limit,
      },
      token: apiToken(token, env),
    });
    const movies = moviesFromPayload(payload).filter(library.matches);
    return {
      Items: movies.map((movie) => mapMovie(
        movie,
        query.requestUrl || "https://localhost/",
        env,
        parentId,
      )),
      TotalRecordCount: Number(payload?.total_count || payload?.total || movies.length),
      StartIndex: startIndex,
    };
  }

  const requiredCount = startIndex + limit;
  const matchingMovies = [];
  let sourcePage = 1;
  let hasMoreSource = true;

  while (
    matchingMovies.length < requiredCount &&
    sourcePage <= HOME_MAX_SOURCE_PAGES &&
    hasMoreSource
  ) {
    const payload = await javdbRequest("/v1/movies/latest", env, fetchImpl, {
      query: {
        page: sourcePage,
        filter_by: library.sourceFilter,
        limit: HOME_SOURCE_PAGE_SIZE,
      },
      token: apiToken(token, env),
    });
    const movies = moviesFromPayload(payload);
    matchingMovies.push(...movies.filter(library.matches));
    hasMoreSource = movies.length >= HOME_SOURCE_PAGE_SIZE;
    sourcePage += 1;
  }

  const movies = matchingMovies.slice(startIndex, requiredCount);
  const totalRecordCount = hasMoreSource
    ? startIndex + movies.length + 1
    : matchingMovies.length;
  return {
    Items: movies.map((movie) => mapMovie(
      movie,
      query.requestUrl || "https://localhost/",
      env,
      parentId,
    )),
    TotalRecordCount: totalRecordCount,
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
  const variants = sourceVariants(payload)
    .flatMap((item) => {
      const rawSource = sourceUrlValue(item);
      const sourceUrl = safeMediaUrl(rawSource, env);
      const inlinePlaylist = sourceUrl ? null : decodeInlineHls(rawSource);
      if (!sourceUrl && !inlinePlaylist) {
        return [];
      }
      return [{
        sourceUrl: sourceUrl?.toString() || "",
        sourceType: inlinePlaylist
          ? "application/vnd.apple.mpegurl"
          : item.sourceType || item.source_type || item.mimeType ||
            item.mime_type || "video/mp4",
        inlinePlaylist,
        variant: item.variant || item.name || item.id,
        title: item.title || item.name || movie.title || movie.number || code,
        quality: Number(item.quality || item.height || 0),
      }];
    });
  const variant =
    variants.find((item) => item.variant === "original") || variants[0] || null;
  if (!variant) {
    return null;
  }

  return {
    ...variant,
    alternates: variants.filter((item) => item !== variant),
  };
}

function subtitleCodec(subtitle) {
  const value = String(subtitle?.ext || "srt").toLowerCase();
  return /^[a-z0-9]+$/.test(value) ? value : "srt";
}

async function resolveSubtitles(movie, env, fetchImpl) {
  const code = movie.number || movie.code || movie.title;
  if (!code) {
    return [];
  }

  const payload = await upstreamJson(
    `/api/subtitle?name=${encodeURIComponent(code)}`,
    env,
    fetchImpl,
  );
  if (payload?.code !== undefined && Number(payload.code) !== 0) {
    return [];
  }

  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const seen = new Set();
  return rows.flatMap((subtitle) => {
    const value = String(subtitle?.url || "");
    let url;
    try {
      url = new URL(value);
    } catch {
      return [];
    }
    if (!["http:", "https:"].includes(url.protocol)) {
      return [];
    }

    const id = String(subtitle.cid || subtitle.gcid || value);
    if (seen.has(id)) {
      return [];
    }
    seen.add(id);
    return [{
      id,
      url: url.toString(),
      codec: subtitleCodec(subtitle),
      title: String(subtitle.extra_name || subtitle.name || "中文字幕"),
    }];
  }).slice(0, 8);
}

function mediaSource(item, requestUrl, token, video, subtitles = []) {
  const isHls = /mpegurl|m3u8/i.test(video.sourceType || video.sourceUrl);
  const container = isHls ? "m3u8" : "mp4";
  const height = Number(video.quality || 0);
  const width = height > 0 ? Math.round((height * 16) / 9 / 2) * 2 : undefined;
  const streamUrl = new URL(
    publicRoutePath(
      requestUrl,
      `/Videos/${encodeURIComponent(item.Id)}/stream.${container}`,
    ),
    requestUrl,
  );
  streamUrl.searchParams.set("api_key", token);
  streamUrl.searchParams.set("static", "true");
  streamUrl.searchParams.set("mediaSourceId", item.Id);
  if (video.sourceUrl) {
    streamUrl.searchParams.set("source", video.sourceUrl);
    streamUrl.searchParams.set("sourceType", video.sourceType || "video/mp4");
  }
  const subtitleStreams = subtitles.map((subtitle, index) => {
    const streamIndex = index + 2;
    const deliveryUrl = new URL(
      publicRoutePath(
        requestUrl,
        `/Videos/${encodeURIComponent(item.Id)}/${encodeURIComponent(item.Id)}/Subtitles/${streamIndex}/Stream.${subtitle.codec}`,
      ),
      requestUrl,
    );
    deliveryUrl.searchParams.set("api_key", token);
    return {
      Type: "Subtitle",
      Codec: subtitle.codec,
      Language: "chi",
      DisplayLanguage: "中文",
      Title: subtitle.title,
      DisplayTitle: index === 0 ? "中文字幕" : `中文字幕 ${index + 1}`,
      Index: streamIndex,
      IsDefault: index === 0,
      IsForced: false,
      IsExternal: true,
      IsExternalUrl: false,
      IsTextSubtitleStream: true,
      SupportsExternalStream: true,
      DeliveryMethod: "External",
      DeliveryUrl: `${deliveryUrl.pathname}${deliveryUrl.search}`,
    };
  });
  return {
    Id: item.Id,
    Name: video.title,
    Path: streamUrl.toString(),
    DirectStreamUrl: `${streamUrl.pathname}${streamUrl.search}`,
    Protocol: "Http",
    Type: "Default",
    Container: container,
    VideoType: "VideoFile",
    IsRemote: true,
    SupportsDirectPlay: true,
    SupportsDirectStream: true,
    SupportsTranscoding: false,
    SupportsProbing: false,
    RequiresOpening: false,
    RequiresClosing: false,
    RequiredHttpHeaders: {},
    RunTimeTicks: item.RunTimeTicks,
    DefaultAudioStreamIndex: 1,
    DefaultSubtitleStreamIndex: subtitleStreams.length > 0 ? 2 : undefined,
    MediaStreams: [
      {
        Type: "Video",
        Codec: isHls ? "hls" : "h264",
        CodecTag: isHls ? undefined : "avc1",
        DisplayTitle: height > 0 ? `${height}p H264 SDR` : "H264 SDR",
        Index: 0,
        Width: width,
        Height: height || undefined,
        AspectRatio: "16:9",
        VideoRange: "SDR",
        VideoRangeType: "SDR",
        IsInterlaced: false,
        IsAVC: !isHls,
        IsAnamorphic: false,
        TimeBase: "1/10000000",
      },
      {
        Type: "Audio",
        Codec: "aac",
        CodecTag: "mp4a",
        Language: "und",
        DisplayLanguage: "Undetermined",
        DisplayTitle: "AAC stereo",
        Index: 1,
        Channels: 2,
        ChannelLayout: "stereo",
        SampleRate: 48000,
        IsDefault: true,
        IsExternal: false,
      },
      ...subtitleStreams,
    ],
  };
}

function authenticationResponse(request, env, user, token) {
  const sessionId = crypto.randomUUID();
  return jsonResponse({
    User: user,
    SessionInfo: {
      Id: sessionId,
      UserId: USER_ID,
      UserName: user.Name,
      ServerId: serverId(env),
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
    if (guestAccessEnabled(env)) {
      return authenticationResponse(
        request,
        env,
        virtualUser(env),
        guestToken(env),
      );
    }
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

    const user = virtualUser(
      env,
      data?.user?.username || username,
      true,
    );
    return authenticationResponse(request, env, user, token);
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

function rootItem(env) {
  return {
    Name: PRODUCT_NAME,
    SortName: PRODUCT_NAME,
    ServerId: serverId(env),
    Id: ROOT_ID,
    Guid: ROOT_ID,
    Type: "Folder",
    ChildCount: LIBRARIES.length,
    DisplayPreferencesId: "usersettings",
    IsFolder: true,
    LocationType: "Virtual",
    ImageTags: {},
    UserData: {
      Played: false,
      PlayCount: 0,
      IsFavorite: false,
      PlaybackPositionTicks: 0,
    },
  };
}

function libraryView(library, env) {
  return {
    Name: library.name,
    SortName: library.name,
    ServerId: serverId(env),
    ParentId: ROOT_ID,
    Id: library.id,
    Guid: library.id,
    Type: "CollectionFolder",
    CollectionType: "movies",
    ChildCount: 32,
    DisplayPreferencesId: `usersettings-${library.id}`,
    IsFolder: true,
    LocationType: "Virtual",
    ImageTags: {},
    UserData: {
      Played: false,
      PlayCount: 0,
      IsFavorite: false,
      PlaybackPositionTicks: 0,
    },
  };
}

function virtualFolder(library) {
  return {
    Name: library.name,
    Locations: [],
    CollectionType: "movies",
    ItemId: library.id,
    Id: library.id,
    Guid: library.id,
  };
}

async function itemResponse(id, request, env, fetchImpl, token) {
  const movie = await getMovie(id, env, fetchImpl, token);
  if (!movie?.id && !movie?.number) {
    return errorResponse(404, "Movie not found");
  }

  const item = mapMovie(movie, request.url, env);
  const [video, subtitles] = await Promise.all([
    resolveVideo(movie, env, fetchImpl),
    hasChineseSubtitles(movie)
      ? resolveSubtitles(movie, env, fetchImpl).catch(() => [])
      : Promise.resolve([]),
  ]);
  if (!video) {
    item.PlayAccess = "None";
    item.MediaSources = [];
    item.MediaStreams = [];
    item.MediaSourceCount = 0;
    item.HasSubtitles = false;
    return jsonResponse(item);
  }
  const source = mediaSource(
    item,
    request.url,
    token || (guestAccessEnabled(env) ? guestToken(env) : ""),
    video,
    subtitles,
  );
  item.Path = source.Path;
  item.MediaSources = [source];
  item.MediaStreams = source.MediaStreams;
  item.MediaSourceCount = 1;
  item.Container = source.Container;
  item.HasSubtitles = subtitles.length > 0;
  return jsonResponse(item);
}

function itemQuery(items, startIndex = 0) {
  return {
    Items: items,
    TotalRecordCount: items.length,
    StartIndex: startIndex,
  };
}

function emptyItemQuery() {
  return itemQuery([]);
}

function displayPreferences(url) {
  return {
    Id: "usersettings",
    UserId: url.searchParams.get("UserId") || USER_ID,
    Client: url.searchParams.get("Client") || "emby",
    Configuration: {
      homesection0: "latestmedia",
      homesection1: "resume",
      homesection2: "none",
      homesection3: "none",
      homesection4: "none",
      homesection5: "none",
    },
    CustomPrefs: {},
  };
}

function noContentResponse() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    },
  });
}

function isEmbyClientRequest(request) {
  const url = new URL(request.url);
  const authorization = request.headers.get("authorization") || "";
  return (
    url.pathname === "/emby" ||
    url.pathname.startsWith("/emby/") ||
    url.searchParams.has("api_key") ||
    url.searchParams.has("ApiKey") ||
    request.headers.has("x-emby-authorization") ||
    request.headers.has("x-emby-token") ||
    request.headers.has("x-mediabrowser-token") ||
    /^(?:MediaBrowser\b|Bearer\s+|Token\s*[=:])/i.test(authorization)
  );
}

async function imageResponse(id, request, env, fetchImpl, token) {
  const movie = await getMovie(id, env, fetchImpl, token);
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
  const decoded = await decodeImageBody(upstream.body);
  const headers = new Headers({
    "cache-control": "public, max-age=3600",
    "access-control-allow-origin": "*",
    "x-content-type-options": "nosniff",
  });
  headers.set(
    "content-type",
    imageContentType(
      imageUrl,
      upstream.headers.get("content-type"),
      decoded.contentType,
    ),
  );
  for (const name of ["etag", "last-modified"]) {
    const value = upstream.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }
  return new Response(request.method === "HEAD" ? null : decoded.body, {
    status: upstream.status,
    headers,
  });
}

async function subtitleResponse(id, index, request, env, fetchImpl, token) {
  try {
    const movie = await getMovie(id, env, fetchImpl, token);
    const subtitles = await resolveSubtitles(movie, env, fetchImpl);
    const subtitle = subtitles[index - 2] || subtitles[index - 1];
    if (!subtitle) {
      return errorResponse(404, "Movie subtitle not found");
    }

    const target = new URL("/api/subtitle/file", upstreamOrigin(env));
    target.searchParams.set("url", subtitle.url);
    const upstream = await fetchImpl(target.toString(), {
      method: request.method,
      headers: {
        accept: "text/vtt,application/x-subrip,text/plain,*/*;q=0.8",
        "user-agent": "Mozilla/5.0",
      },
      redirect: "follow",
    });
    if (!upstream.ok) {
      return errorResponse(404, "Movie subtitle not found");
    }

    const contentType = subtitle.codec === "vtt"
      ? "text/vtt; charset=utf-8"
      : "application/x-subrip; charset=utf-8";
    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: {
        "access-control-allow-origin": "*",
        "cache-control": "public, max-age=3600",
        "content-disposition": `inline; filename="subtitle.${subtitle.codec}"`,
        "content-type": contentType,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(502, error instanceof Error ? error.message : "Movie subtitle unavailable");
  }
}

async function streamResponse(id, request, env, fetchImpl, token) {
  if (!token && !guestAccessEnabled(env)) {
    return errorResponse(401, "Emby token is required for playback");
  }

  try {
    const requestUrl = new URL(request.url);
    const suppliedSourceValue = ["source", "sourceUrl", "source_url", "url"]
      .map((name) => requestUrl.searchParams.get(name))
      .find(Boolean);
    const suppliedSource = safeMediaUrl(suppliedSourceValue, env);
    const sourceOrigin = upstreamOrigin(env);
    const requestHeaders = new Headers({
      accept: request.headers.get("accept") || "video/*,*/*;q=0.8",
      origin: sourceOrigin,
      referer: `${sourceOrigin}/`,
      "user-agent": "Mozilla/5.0",
    });
    for (const name of ["range", "if-range", "if-none-match", "if-modified-since"]) {
      const value = request.headers.get(name);
      if (value) {
        requestHeaders.set(name, value);
      }
    }

    const triedSources = new Set();
    let lastStatus = 404;
    const tryVideo = async (video) => {
      const candidates = [video, ...(video?.alternates || [])].filter(Boolean);
      for (const candidate of candidates) {
        if (candidate.inlinePlaylist) {
          return new Response(
            request.method === "HEAD" ? null : candidate.inlinePlaylist,
            {
              status: 200,
              headers: {
                "access-control-allow-origin": "*",
                "cache-control": "no-store",
                "content-disposition": `inline; filename="${encodeURIComponent(id)}.m3u8"`,
                "content-type": "application/vnd.apple.mpegurl; charset=utf-8",
                "x-content-type-options": "nosniff",
              },
            },
          );
        }

        const sourceUrl = safeMediaUrl(candidate.sourceUrl, env);
        if (!sourceUrl || triedSources.has(sourceUrl.toString())) {
          continue;
        }
        triedSources.add(sourceUrl.toString());
        const upstream = await fetchImpl(sourceUrl.toString(), {
          method: request.method,
          headers: requestHeaders,
          redirect: "follow",
        });
        if (
          !upstream.ok &&
          (upstream.status === 403 ||
            upstream.status === 404 ||
            upstream.status === 410 ||
            upstream.status === 429 ||
            upstream.status >= 500)
        ) {
          lastStatus = upstream.status;
          await upstream.body?.cancel().catch(() => {});
          continue;
        }

        const responseHeaders = new Headers({
          "access-control-allow-origin": "*",
          "access-control-expose-headers": "Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag, Last-Modified",
          "cache-control": "no-store",
          "content-disposition": `inline; filename="${encodeURIComponent(id)}.${/mpegurl|m3u8/i.test(candidate.sourceType || candidate.sourceUrl) ? "m3u8" : "mp4"}"`,
          "x-content-type-options": "nosniff",
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
          responseHeaders.set("content-type", candidate.sourceType || "video/mp4");
        }
        return new Response(request.method === "HEAD" ? null : upstream.body, {
          status: upstream.status,
          statusText: upstream.statusText,
          headers: responseHeaders,
        });
      }
      return null;
    };

    if (suppliedSource) {
      const response = await tryVideo({
        sourceUrl: suppliedSource.toString(),
        sourceType: safeMediaContentType(requestUrl.searchParams.get("sourceType")),
      });
      if (response) {
        return response;
      }
    }

    const resolvedVideo = await resolveVideo(
      await getMovie(id, env, fetchImpl, token),
      env,
      fetchImpl,
    );
    const response = await tryVideo(resolvedVideo);
    if (response) {
      return response;
    }
    return errorResponse(
      lastStatus === 404 ? 404 : 502,
      "No playable video source was found",
    );
  } catch (error) {
    return errorResponse(502, error instanceof Error ? error.message : "Video source unavailable");
  }
}

function isHandledPath(path) {
  return (
    path === "/System/Info/Public" ||
    path === "/System/Info" ||
    path === "/System/Endpoint" ||
    path === "/System/Configuration" ||
    path === "/Users/Public" ||
    path === "/Users/AuthenticateByName" ||
    path === "/Users" ||
    path === "/Users/Me" ||
    path === "/Users/bbjavdb-user" ||
    path === "/Users/bbjavdb-user/Views" ||
    path === "/Library/VirtualFolders" ||
    path === "/Library/VirtualFolders/Query" ||
    path === "/Library/MediaFolders" ||
    path === "/Items" ||
    path === "/Items/Root" ||
    path === "/Items/Latest" ||
    path === "/Items/Resume" ||
    path === "/Items/Filters" ||
    path === "/Items/Filters2" ||
    path === "/UserViews" ||
    path === "/Shows/NextUp" ||
    path === "/Shows/Upcoming" ||
    path === "/Movies/Recommendations" ||
    path === "/Genres" ||
    path === "/Studios" ||
    path === "/Persons" ||
    path === "/SearchHints" ||
    path === "/Sessions" ||
    path === "/Sessions/Capabilities" ||
    path === "/Sessions/Capabilities/Full" ||
    path === "/Sessions/Viewing" ||
    path === "/Sessions/Playing" ||
    path === "/Sessions/Playing/Progress" ||
    path === "/Sessions/Playing/Stopped" ||
    path === "/DisplayPreferences/usersettings" ||
    path === "/Branding/Configuration" ||
    path === "/Startup/Configuration" ||
    path === "/Items/Counts" ||
    path === "/Suggestions" ||
    path === "/LiveTv/Programs/Recommended" ||
    path === "/Channels" ||
    path === "/Trailers" ||
    path === "/Artists/AlbumArtists" ||
    /^\/Users\/[^/]+$/i.test(path) ||
    /^\/Users\/[^/]+\/GroupingOptions$/i.test(path) ||
    /^\/Users\/[^/]+\/Views$/i.test(path) ||
    /^\/Users\/[^/]+\/Suggestions$/i.test(path) ||
    /^\/Users\/[^/]+\/Items(?:\/|$)/i.test(path) ||
    path.toLowerCase().startsWith("/items/") ||
    path.toLowerCase().startsWith("/videos/") ||
    path.toLowerCase().startsWith("/emby-media/")
  );
}

export async function handleEmby(request, env = {}, fetchImpl = fetch) {
  const url = new URL(request.url);
  const requestPath = routePath(request.url);
  if (requestPath === "/" && /^\/emby\/?$/i.test(url.pathname)) {
    return jsonResponse(systemInfo(request.url, env));
  }
  if (!isHandledPath(requestPath)) {
    if (isEmbyClientRequest(request)) {
      console.error(JSON.stringify({
        message: "Unhandled Emby endpoint",
        method: request.method,
        path: requestPath,
      }));
      return errorResponse(404, "Emby endpoint not found");
    }
    return null;
  }
  const path = normalizeClientPath(requestPath);

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
  if (path === "/System/Endpoint") {
    return jsonResponse({ IsLocal: false, IsInNetwork: false });
  }
  if (path === "/System/Configuration") {
    return jsonResponse({ EnableFolderView: true });
  }
  if (path === "/Branding/Configuration" || path === "/Startup/Configuration") {
    return jsonResponse({});
  }
  if (path === "/Users/Public" || path === "/Users") {
    return jsonResponse([virtualUser(env)]);
  }
  if (path === "/Users/AuthenticateByName") {
    return authenticate(request, env, fetchImpl);
  }
  if (path === "/Users/Me" || /^\/Users\/[^/]+$/i.test(path)) {
    return jsonResponse(virtualUser(env));
  }
  if (/^\/Users\/[^/]+\/GroupingOptions$/i.test(path)) {
    return jsonResponse([]);
  }
  if (/^\/Users\/[^/]+\/Views$/i.test(path) || path === "/UserViews") {
    return jsonResponse(itemQuery(
      LIBRARIES.map((library) => libraryView(library, env)),
    ));
  }
  if (path === "/Library/MediaFolders") {
    return jsonResponse(itemQuery(
      LIBRARIES.map((library) => libraryView(library, env)),
    ));
  }
  if (path === "/Library/VirtualFolders") {
    return jsonResponse(LIBRARIES.map(virtualFolder));
  }
  if (path === "/Library/VirtualFolders/Query") {
    return jsonResponse(itemQuery(LIBRARIES.map(virtualFolder)));
  }
  if (path === "/Sessions") {
    return jsonResponse([]);
  }
  if (path === "/DisplayPreferences/usersettings") {
    return jsonResponse(displayPreferences(url));
  }
  if (
    path === "/Sessions/Capabilities" ||
    path === "/Sessions/Capabilities/Full" ||
    path === "/Sessions/Viewing" ||
    path === "/Sessions/Playing" ||
    path === "/Sessions/Playing/Progress" ||
    path === "/Sessions/Playing/Stopped"
  ) {
    return noContentResponse();
  }

  const token = getToken(request, url);
  if (path === "/Items/Root") {
    return jsonResponse(rootItem(env));
  }
  if (path === "/Items") {
    try {
      const query = new URLSearchParams(url.search);
      query.requestUrl = request.url;
      const result = await getMoviePage(query, env, fetchImpl, token);
      result.Items = result.Items.map((item) => ({ ...item, Path: item.Path }));
      return jsonResponse(result);
    } catch (error) {
      return errorResponse(502, error instanceof Error ? error.message : "Movie catalog unavailable");
    }
  }
  if (path === "/Items/Latest") {
    try {
      const query = new URLSearchParams(url.search);
      query.set("StartIndex", "0");
      query.requestUrl = request.url;
      const result = await getMoviePage(query, env, fetchImpl, token);
      return jsonResponse(result.Items);
    } catch (error) {
      return errorResponse(502, error instanceof Error ? error.message : "Latest movies unavailable");
    }
  }
  if (
    path === "/Items/Resume" ||
    path === "/Shows/NextUp" ||
    path === "/Shows/Upcoming" ||
    path === "/Genres" ||
    path === "/Studios" ||
    path === "/Persons"
  ) {
    return jsonResponse(emptyItemQuery());
  }
  if (path === "/Movies/Recommendations") {
    return jsonResponse([]);
  }
  if (path === "/Items/Filters" || path === "/Items/Filters2") {
    return jsonResponse({ Genres: [], Tags: [], OfficialRatings: [], Years: [] });
  }
  if (path === "/Items/Counts") {
    return jsonResponse({
      MovieCount: 32,
      SeriesCount: 0,
      EpisodeCount: 0,
      ArtistCount: 0,
      ProgramCount: 0,
      TrailerCount: 0,
      SongCount: 0,
      AlbumCount: 0,
      MusicVideoCount: 0,
      BoxSetCount: 0,
      BookCount: 0,
      ItemCount: 32,
    });
  }
  if (
    path === "/Suggestions" ||
    path === "/LiveTv/Programs/Recommended" ||
    path === "/Channels" ||
    path === "/Trailers" ||
    path === "/Artists/AlbumArtists"
  ) {
    return jsonResponse(emptyItemQuery());
  }
  if (path === "/SearchHints") {
    try {
      const result = await getMoviePage(new URLSearchParams(`SearchTerm=${encodeURIComponent(url.searchParams.get("SearchTerm") || "")}`), env, fetchImpl, token);
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
      return await imageResponse(decodeURIComponent(imageMatch[1]), request, env, fetchImpl, token);
    } catch (error) {
      return errorResponse(502, error instanceof Error ? error.message : "Movie image unavailable");
    }
  }

  const playbackMatch = path.match(/^\/Items\/([^/]+)\/PlaybackInfo$/i);
  if (playbackMatch) {
    try {
      const movie = await getMovie(decodeURIComponent(playbackMatch[1]), env, fetchImpl, token);
      const item = mapMovie(movie, request.url, env);
      const [video, subtitles] = await Promise.all([
        resolveVideo(movie, env, fetchImpl),
        resolveSubtitles(movie, env, fetchImpl).catch(() => []),
      ]);
      if (!video) {
        return jsonResponse({ PlaySessionId: crypto.randomUUID(), MediaSources: [] });
      }
      return jsonResponse({
        PlaySessionId: crypto.randomUUID(),
        ItemId: item.Id,
        MediaSources: [
          mediaSource(
            item,
            request.url,
            token || (guestAccessEnabled(env) ? guestToken(env) : ""),
            video,
            subtitles,
          ),
        ],
      });
    } catch (error) {
      return errorResponse(502, error instanceof Error ? error.message : "Playback metadata unavailable");
    }
  }

  const downloadMatch = path.match(/^\/Items\/([^/]+)\/Download$/i);
  if (downloadMatch) {
    return streamResponse(
      decodeURIComponent(downloadMatch[1]),
      request,
      env,
      fetchImpl,
      token,
    );
  }

  const itemMatch = path.match(/^\/Items\/([^/]+)$/i);
  if (itemMatch) {
    try {
      return await itemResponse(decodeURIComponent(itemMatch[1]), request, env, fetchImpl, token);
    } catch (error) {
      return errorResponse(502, error instanceof Error ? error.message : "Movie metadata unavailable");
    }
  }

  const subtitleMatch = path.match(
    /^\/Videos\/([^/]+)\/[^/]+\/Subtitles\/(\d+)\/Stream\.[a-z0-9]+$/i,
  );
  if (subtitleMatch) {
    return subtitleResponse(
      decodeURIComponent(subtitleMatch[1]),
      Number(subtitleMatch[2]),
      request,
      env,
      fetchImpl,
      token,
    );
  }

  const streamMatch = path.match(
    /^\/Videos\/([^/]+)(?:\/[^/]+)?\/(?:stream(?:ing)?|original|download|playback)(?:[._-][^/]*)?$/i,
  );
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
