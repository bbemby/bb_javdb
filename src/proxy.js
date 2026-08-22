import { handleEmby } from "./emby.js";
import { handleBuddyRoute, injectBuddyScript } from "./buddy.js";

export const DEFAULT_UPSTREAM_ORIGIN =
  "https://catembylegacy.fastcdn.dpdns.org";

export const MEDIA_PROXY_PREFIX = "/__media/";

const DEFAULT_MEDIA_HOSTS = new Set([
  "fast-stream.jav.si",
  "jdforrepam.com",
  "tp.spfcas.com",
  "h1.gzankun.com",
]);

const MEDIA_HOST_SUFFIXES = [".spfcas.com", ".gzankun.com"];
const BODYLESS_METHODS = new Set(["GET", "HEAD"]);
const BODYLESS_STATUSES = new Set([101, 204, 205, 304]);
const TEXT_CONTENT_TYPES = [
  "application/javascript",
  "application/json",
  "application/ld+json",
  "application/mpegurl",
  "application/vnd.apple.mpegurl",
  "application/x-javascript",
  "application/x-mpegurl",
  "image/svg+xml",
  "text/",
];

const MAGNET_COPY_COMPONENT_SOURCE = "function dY({magnet:t})";
const MAGNET_COPY_COMPONENT_PATCH =
  'async function bbCopyMagnet(t,n){const e="magnet:?xt=urn:btih:"+t;try{if(navigator.clipboard&&window.isSecureContext)await navigator.clipboard.writeText(e);else{const r=document.createElement("textarea");r.value=e,r.setAttribute("readonly",""),r.style.position="fixed",r.style.opacity="0",document.body.appendChild(r),r.focus(),r.select();try{if(!document.execCommand("copy"))throw new Error("copy failed")}finally{r.remove()}}n.textContent="\u5df2\u590d\u5236"}catch{n.textContent="\u590d\u5236\u5931\u8d25"}setTimeout(()=>{n.isConnected&&(n.textContent="\u590d\u5236")},1500)}function bbCopyButton(t){return f.jsx(Ar,{type:"button",variant:"outline",size:"sm",className:"h-7 shrink-0 px-2 text-xs",title:"\u590d\u5236\u78c1\u529b\u94fe\u63a5","aria-label":"\u590d\u5236\u78c1\u529b\u94fe\u63a5",onClick:n=>bbCopyMagnet(t,n.currentTarget),children:"\u590d\u5236"})}function dY({magnet:t})';

const MAGNET_MOBILE_TITLE_SOURCE =
  't.downloadUrl?f.jsx("a",{href:t.downloadUrl,target:"_blank",rel:"noreferrer",className:"text-sm font-medium text-primary hover:underline break-all",children:t.name}):f.jsx("span",{className:"text-sm font-medium break-all",children:t.name})';
const MAGNET_MOBILE_TITLE_PATCH =
  'f.jsxs("div",{className:"flex items-start gap-2",children:[t.downloadUrl?f.jsx("a",{href:t.downloadUrl,target:"_blank",rel:"noreferrer",className:"min-w-0 flex-1 text-sm font-medium text-primary hover:underline break-all",children:t.name}):f.jsx("span",{className:"min-w-0 flex-1 text-sm font-medium break-all",children:t.name}),bbCopyButton(t.hash)]})';

const MAGNET_DESKTOP_TITLE_SOURCE =
  'f.jsx(ff,{className:"max-w-md truncate font-medium",children:e.downloadUrl?f.jsx("a",{href:e.downloadUrl,target:"_blank",rel:"noreferrer",className:"text-primary hover:underline",children:e.name}):e.name})';
const MAGNET_DESKTOP_TITLE_PATCH =
  'f.jsx(ff,{className:"max-w-md font-medium",children:f.jsxs("div",{className:"flex items-center gap-2",children:[e.downloadUrl?f.jsx("a",{href:e.downloadUrl,target:"_blank",rel:"noreferrer",className:"min-w-0 flex-1 truncate text-primary hover:underline",children:e.name}):f.jsx("span",{className:"min-w-0 flex-1 truncate",children:e.name}),bbCopyButton(e.hash)]})})';

const REPLICA_SOURCE_PATCHES = [
  ["catemby\u9057\u4ea7", "\u6b65\u5175JAVDB"],
  ["--container-7xl:80rem", "--container-7xl:100rem"],
  [
    "grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8",
    "grid-cols-2 sm:grid-cols-4",
  ],
  [
    'pathname:"/v1/movies/latest",query:{page:t,filter_by:n}',
    'pathname:"/v1/movies/latest",query:{page:t,filter_by:n,limit:32}',
  ],
  ["function bG(t,n=1,e=24,r=", "function bG(t,n=1,e=32,r="],
  [
    "function CG(t,{filterByTags:n,page:e=1,limit:r=24,sortBy:",
    "function CG(t,{filterByTags:n,page:e=1,limit:r=32,sortBy:",
  ],
  [
    "movie_filter_by:r.movieFilterBy,movie_sort_by:r.sortBy,limit:r.limit",
    "movie_filter_by:r.movieFilterBy,movie_sort_by:r.sortBy,limit:r.limit||32",
  ],
  ["const jx=24,pK=5", "const jx=32,pK=5"],
  [MAGNET_COPY_COMPONENT_SOURCE, MAGNET_COPY_COMPONENT_PATCH],
  [MAGNET_MOBILE_TITLE_SOURCE, MAGNET_MOBILE_TITLE_PATCH],
  [MAGNET_DESKTOP_TITLE_SOURCE, MAGNET_DESKTOP_TITLE_PATCH],
];

function normalizeOrigin(value) {
  const url = new URL(value || DEFAULT_UPSTREAM_ORIGIN);

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError("UPSTREAM_ORIGIN must use http or https");
  }

  return url.origin;
}

function extraMediaHosts(env) {
  return String(env.EXTRA_MEDIA_HOSTS || "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedMediaHost(hostname, env = {}) {
  const host = String(hostname || "").toLowerCase();

  if (!/^[a-z0-9.-]+$/.test(host)) {
    return false;
  }

  return (
    DEFAULT_MEDIA_HOSTS.has(host) ||
    MEDIA_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix)) ||
    extraMediaHosts(env).includes(host)
  );
}

export function resolveUpstreamTarget(requestUrl, env = {}) {
  const incoming = new URL(requestUrl);
  const upstreamOrigin = normalizeOrigin(env.UPSTREAM_ORIGIN);

  if (!incoming.pathname.startsWith(MEDIA_PROXY_PREFIX)) {
    return {
      kind: "application",
      upstreamOrigin,
      url: new URL(`${incoming.pathname}${incoming.search}`, upstreamOrigin),
    };
  }

  const remainder = incoming.pathname.slice(MEDIA_PROXY_PREFIX.length);
  const slashIndex = remainder.indexOf("/");
  const hostname = (slashIndex === -1 ? remainder : remainder.slice(0, slashIndex))
    .toLowerCase();
  const pathname = slashIndex === -1 ? "/" : remainder.slice(slashIndex);

  if (!isAllowedMediaHost(hostname, env)) {
    return { kind: "blocked", hostname, upstreamOrigin };
  }

  return {
    kind: "media",
    hostname,
    upstreamOrigin,
    url: new URL(`https://${hostname}${pathname}${incoming.search}`),
  };
}

function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceOrigin(text, sourceOrigin, destinationOrigin) {
  const normalPattern = new RegExp(escapeForRegExp(sourceOrigin), "gi");
  const escapedSource = sourceOrigin.replaceAll("/", "\\/");
  const escapedDestination = destinationOrigin.replaceAll("/", "\\/");
  const escapedPattern = new RegExp(escapeForRegExp(escapedSource), "gi");

  return text
    .replace(normalPattern, destinationOrigin)
    .replace(escapedPattern, escapedDestination);
}

export function applyReplicaOverrides(text) {
  return REPLICA_SOURCE_PATCHES.reduce(
    (source, [from, to]) => source.replaceAll(from, to),
    text,
  );
}

export function rewriteText(text, publicOrigin, upstreamOrigin, env = {}) {
  let rewritten = applyReplicaOverrides(
    replaceOrigin(text, upstreamOrigin, publicOrigin),
  );

  // The upstream app signs direct API URLs in the browser. Rewriting those URLs
  // by default would prevent it from attaching the required jdsignature header.
  if (String(env.PROXY_EXTERNAL_MEDIA || "").toLowerCase() !== "true") {
    return rewritten;
  }

  rewritten = rewritten.replace(
    /https?:\/\/([a-z0-9.-]+)/gi,
    (urlOrigin, hostname) =>
      isAllowedMediaHost(hostname, env)
        ? `${publicOrigin}${MEDIA_PROXY_PREFIX}${hostname.toLowerCase()}`
        : urlOrigin,
  );

  rewritten = rewritten.replace(
    /https?:\\\/\\\/([a-z0-9.-]+)/gi,
    (urlOrigin, hostname) =>
      isAllowedMediaHost(hostname, env)
        ? `${publicOrigin}${MEDIA_PROXY_PREFIX}${hostname.toLowerCase()}`.replaceAll(
            "/",
            "\\/",
          )
        : urlOrigin,
  );

  return rewritten;
}

function rewriteLocation(location, publicOrigin, upstreamOrigin, env) {
  if (!location) {
    return location;
  }

  try {
    const target = new URL(location, upstreamOrigin);

    if (target.origin === upstreamOrigin) {
      return `${publicOrigin}${target.pathname}${target.search}${target.hash}`;
    }

    if (isAllowedMediaHost(target.hostname, env)) {
      return `${publicOrigin}${MEDIA_PROXY_PREFIX}${target.host}${target.pathname}${target.search}${target.hash}`;
    }
  } catch {
    return location;
  }

  return location;
}

function rewriteSetCookie(cookie) {
  return cookie.replace(/;\s*Domain=[^;]*/gi, "");
}

function copyResponseHeaders(response, publicOrigin, upstreamOrigin, env) {
  const headers = new Headers(response.headers);
  const location = headers.get("location");

  if (location) {
    headers.set(
      "location",
      rewriteLocation(location, publicOrigin, upstreamOrigin, env),
    );
  }

  const contentSecurityPolicy = headers.get("content-security-policy");
  if (contentSecurityPolicy) {
    headers.set(
      "content-security-policy",
      rewriteText(contentSecurityPolicy, publicOrigin, upstreamOrigin, env),
    );
  }

  const getSetCookie = response.headers.getSetCookie;
  const cookies =
    typeof getSetCookie === "function"
      ? getSetCookie.call(response.headers)
      : headers.get("set-cookie")
        ? [headers.get("set-cookie")]
        : [];

  if (cookies.length > 0) {
    headers.delete("set-cookie");
    for (const cookie of cookies) {
      headers.append("set-cookie", rewriteSetCookie(cookie));
    }
  }

  return headers;
}

function isTextResponse(headers) {
  const contentType = (headers.get("content-type") || "").toLowerCase();
  return TEXT_CONTENT_TYPES.some((type) => contentType.includes(type));
}

function createForwardHeaders(request, upstreamOrigin) {
  const headers = new Headers(request.headers);

  for (const name of [
    "cf-connecting-ip",
    "cf-ipcountry",
    "cf-ray",
    "cf-visitor",
    "host",
    "x-forwarded-host",
    "x-forwarded-proto",
    "x-real-ip",
  ]) {
    headers.delete(name);
  }

  if (headers.has("origin")) {
    headers.set("origin", upstreamOrigin);
  }

  if (headers.has("referer")) {
    headers.set("referer", `${upstreamOrigin}/`);
  }

  return headers;
}

function forbiddenProxyResponse() {
  return new Response("Forbidden media host", {
    status: 403,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

async function handlePublicApi(request, env = {}, fetchImpl = fetch) {
  const incoming = new URL(request.url);
  if (incoming.pathname !== "/api/v/resolve" && incoming.pathname !== "/api/subtitle") {
    return null;
  }
  if (incoming.pathname === "/api/subtitle") {
    return new Response(JSON.stringify({ error: "Subtitle resolver is unavailable" }), {
      status: 503,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      },
    });
  }
  const code = String(incoming.searchParams.get("code") || "").trim();
  if (!code) {
    return new Response(JSON.stringify({ error: "Movie code is required" }), {
      status: 400,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      },
    });
  }
  const resolverOrigin = String(env.JAVSTRM_ORIGIN || "https://javstrm.emby-59f.workers.dev").replace(/\/$/, "");
  const target = new URL("/api/resolve", resolverOrigin);
  target.searchParams.set("code", code);
  if (incoming.searchParams.get("refresh") === "1") {
    target.searchParams.set("refresh", "1");
  }
  try {
    const upstream = await fetchImpl(target.toString(), {
      headers: { accept: "application/json" },
      redirect: "follow",
    });
    const text = await upstream.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: `Resolver returned non-JSON (${upstream.status})` };
    }
    return new Response(JSON.stringify(payload), {
      status: upstream.ok ? 200 : upstream.status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Resolver unavailable",
    }), {
      status: 502,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      },
    });
  }
}

export async function handleProxy(
  request,
  env = {},
  _context = {},
  fetchImpl = fetch,
) {
  const buddyResponse = await handleBuddyRoute(request, env, fetchImpl);
  if (buddyResponse) {
    return buddyResponse;
  }

  const publicApiResponse = await handlePublicApi(request, env, fetchImpl);
  if (publicApiResponse) {
    return publicApiResponse;
  }
  const embyResponse = await handleEmby(request, env, fetchImpl);
  if (embyResponse) {
    return embyResponse;
  }

  const target = resolveUpstreamTarget(request.url, env);

  if (target.kind === "blocked") {
    return forbiddenProxyResponse();
  }

  const incoming = new URL(request.url);
  const publicOrigin = incoming.origin;
  const headers = createForwardHeaders(request, target.upstreamOrigin);
  const init = {
    method: request.method,
    headers,
    redirect: "manual",
  };

  if (!BODYLESS_METHODS.has(request.method.toUpperCase())) {
    init.body = request.body;
  }

  const upstreamResponse = await fetchImpl(target.url.toString(), init);

  if (upstreamResponse.status === 101) {
    return upstreamResponse;
  }

  const responseHeaders = copyResponseHeaders(
    upstreamResponse,
    publicOrigin,
    target.upstreamOrigin,
    env,
  );

  if (
    request.method.toUpperCase() === "HEAD" ||
    BODYLESS_STATUSES.has(upstreamResponse.status)
  ) {
    return new Response(null, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  }

  if (!isTextResponse(responseHeaders)) {
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  }

  const text = await upstreamResponse.text();
  let body = rewriteText(
    text,
    publicOrigin,
    target.upstreamOrigin,
    env,
  );

  if ((responseHeaders.get("content-type") || "").toLowerCase().includes("text/html")) {
    body = injectBuddyScript(body, publicOrigin);
  }

  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  responseHeaders.delete("etag");

  return new Response(body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}
