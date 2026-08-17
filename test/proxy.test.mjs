import assert from "node:assert/strict";
import test from "node:test";

import {
  applyReplicaOverrides,
  handleProxy,
  isAllowedMediaHost,
  resolveUpstreamTarget,
  rewriteText,
} from "../src/proxy.js";

const UPSTREAM = "https://catembylegacy.fastcdn.dpdns.org";

test("maps application routes to the source site", () => {
  const target = resolveUpstreamTarget(
    "https://clone.example/movie/z4VJpy?page=2",
  );

  assert.equal(target.kind, "application");
  assert.equal(
    target.url.toString(),
    `${UPSTREAM}/movie/z4VJpy?page=2`,
  );
});

test("allows only known media hosts", () => {
  assert.equal(isAllowedMediaHost("jdforrepam.com"), true);
  assert.equal(isAllowedMediaHost("h7.gzankun.com"), true);
  assert.equal(isAllowedMediaHost("evil.example"), false);

  const target = resolveUpstreamTarget(
    "https://clone.example/__media/h7.gzankun.com/video/seg.ts?sign=abc",
  );

  assert.equal(target.kind, "media");
  assert.equal(
    target.url.toString(),
    "https://h7.gzankun.com/video/seg.ts?sign=abc",
  );
});

test("keeps signed external URLs direct by default", () => {
  const source = [
    `${UPSTREAM}/assets/app.js`,
    "https://jdforrepam.com/api/v1/movies/latest",
    "https://tp.spfcas.com/covers/a.jpg",
    "https://h1.gzankun.com/video/seg.ts",
  ].join("\n");

  assert.equal(
    rewriteText(source, "https://clone.example", UPSTREAM),
    [
      "https://clone.example/assets/app.js",
      "https://jdforrepam.com/api/v1/movies/latest",
      "https://tp.spfcas.com/covers/a.jpg",
      "https://h1.gzankun.com/video/seg.ts",
    ].join("\n"),
  );
});

test("renames the visible site brand", () => {
  const source = 'children:"catemby\u9057\u4ea7"';
  const result = applyReplicaOverrides(source);

  assert.equal(result, 'children:"\u6b65\u5175JAVDB"');
  assert.doesNotMatch(result, /catemby/);
});

test("keeps five desktop columns and 32 movies per page", () => {
  const source = [
    "--container-7xl:80rem",
    "grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8",
    "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5",
    'pathname:"/v1/movies/latest",query:{page:t,filter_by:n}',
    "function bG(t,n=1,e=24,r=",
    "function CG(t,{filterByTags:n,page:e=1,limit:r=24,sortBy:",
    "movie_filter_by:r.movieFilterBy,movie_sort_by:r.sortBy,limit:r.limit",
    "const jx=24,pK=5",
  ].join("\n");

  const result = applyReplicaOverrides(source);

  assert.match(result, /--container-7xl:100rem/);
  assert.match(result, /grid-cols-2 sm:grid-cols-4\n/);
  assert.match(
    result,
    /grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5/,
  );
  assert.match(result, /filter_by:n,limit:32/);
  assert.match(result, /function bG\(t,n=1,e=32,r=/);
  assert.match(result, /limit:r=32,sortBy:/);
  assert.match(result, /limit:r\.limit\|\|32/);
  assert.match(result, /const jx=32,pK=5/);
  assert.doesNotMatch(result, /lg:grid-cols-8/);
  assert.doesNotMatch(result, /--container-7xl:80rem/);
});

test("adds copy controls beside mobile and desktop magnet links", () => {
  const source = [
    "function dY({magnet:t})",
    't.downloadUrl?f.jsx("a",{href:t.downloadUrl,target:"_blank",rel:"noreferrer",className:"text-sm font-medium text-primary hover:underline break-all",children:t.name}):f.jsx("span",{className:"text-sm font-medium break-all",children:t.name})',
    'f.jsx(ff,{className:"max-w-md truncate font-medium",children:e.downloadUrl?f.jsx("a",{href:e.downloadUrl,target:"_blank",rel:"noreferrer",className:"text-primary hover:underline",children:e.name}):e.name})',
  ].join("\n");

  const result = applyReplicaOverrides(source);

  assert.match(result, /magnet:\?xt=urn:btih:/);
  assert.match(result, /navigator\.clipboard/);
  assert.match(result, /"aria-label":"\u590d\u5236\u78c1\u529b\u94fe\u63a5"/);
  assert.match(result, /bbCopyButton\(t\.hash\)/);
  assert.match(result, /bbCopyButton\(e\.hash\)/);
  assert.doesNotMatch(result, /max-w-md truncate font-medium/);
});

test("can rewrite external media URLs when explicitly enabled", () => {
  const source = [
    "https://jdforrepam.com/api/v1/movies/latest",
    "https://tp.spfcas.com/covers/a.jpg",
    "https://h1.gzankun.com/video/seg.ts",
  ].join("\n");

  assert.equal(
    rewriteText(source, "https://clone.example", UPSTREAM, {
      PROXY_EXTERNAL_MEDIA: "true",
    }),
    [
      "https://clone.example/__media/jdforrepam.com/api/v1/movies/latest",
      "https://clone.example/__media/tp.spfcas.com/covers/a.jpg",
      "https://clone.example/__media/h1.gzankun.com/video/seg.ts",
    ].join("\n"),
  );
});

test("forwards Range requests and streams binary responses unchanged", async () => {
  const payload = new Uint8Array([0, 1, 2, 3]);
  let received;
  const response = await handleProxy(
    new Request("https://clone.example/preview.mp4?number=MBMA-279", {
      headers: { range: "bytes=0-3" },
    }),
    {},
    {},
    async (url, init) => {
      received = { url, init };
      return new Response(payload, {
        status: 206,
        headers: {
          "accept-ranges": "bytes",
          "content-range": "bytes 0-3/4",
          "content-type": "video/mp4",
        },
      });
    },
  );

  assert.equal(received.url, `${UPSTREAM}/preview.mp4?number=MBMA-279`);
  assert.equal(received.init.headers.get("range"), "bytes=0-3");
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 0-3/4");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), payload);
});

test("rewrites text, redirects, and cookie domains", async () => {
  const response = await handleProxy(
    new Request("https://clone.example/login", {
      headers: {
        origin: "https://clone.example",
        referer: "https://clone.example/login",
      },
    }),
    {},
    {},
    async (_url, init) => {
      assert.equal(init.headers.get("origin"), UPSTREAM);
      assert.equal(init.headers.get("referer"), `${UPSTREAM}/`);

      return new Response(`location = '${UPSTREAM}/account'`, {
        status: 302,
        headers: {
          "content-type": "text/html; charset=utf-8",
          location: `${UPSTREAM}/account`,
          "set-cookie":
            "session=abc; Domain=catembylegacy.fastcdn.dpdns.org; Path=/; Secure; HttpOnly",
        },
      });
    },
  );

  assert.equal(response.headers.get("location"), "https://clone.example/account");
  assert.equal(
    response.headers.get("set-cookie"),
    "session=abc; Path=/; Secure; HttpOnly",
  );
  assert.match(await response.text(), /https:\/\/clone\.example\/account/);
});

test("forwards login methods, headers, and request bodies", async () => {
  let forwarded;
  const response = await handleProxy(
    new Request("https://clone.example/api/login", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: "device=web",
      },
      body: "username=test&password=secret",
    }),
    {},
    {},
    async (url, init) => {
      forwarded = {
        url,
        method: init.method,
        cookie: init.headers.get("cookie"),
        body: await new Response(init.body).text(),
      };
      return new Response('{"ok":true}', {
        headers: { "content-type": "application/json" },
      });
    },
  );

  assert.deepEqual(forwarded, {
    url: `${UPSTREAM}/api/login`,
    method: "POST",
    cookie: "device=web",
    body: "username=test&password=secret",
  });
  assert.deepEqual(await response.json(), { ok: true });
});

test("blocks arbitrary proxy targets", async () => {
  const response = await handleProxy(
    new Request("https://clone.example/__media/127.0.0.1/admin"),
    {},
    {},
    () => {
      throw new Error("fetch must not be called");
    },
  );

  assert.equal(response.status, 403);
});
