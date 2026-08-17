import assert from "node:assert/strict";
import test from "node:test";

import {
  applyReplicaOverrides,
  handleProxy,
  isAllowedMediaHost,
  resolveUpstreamTarget,
  rewriteText,
} from "../src/proxy.js";
import { createJavdbSignature } from "../src/emby.js";

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

test("creates the same JavDB MD5 signature format as the web client", () => {
  assert.equal(
    createJavdbSignature(1700000000),
    "1700000000.lpw6vgqzsp.dacaffcd8b4e1b35c2752f065e906f3a",
  );
});

test("serves Emby system metadata without contacting the upstream", async () => {
  const response = await handleProxy(
    new Request("https://clone.example/emby/System/Info/Public"),
    {},
    {},
    () => {
      throw new Error("fetch must not be called");
    },
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).ProductName, "Emby Compatible Server");
});

test("advertises an auto-login Emby guest without a password", async () => {
  const response = await handleProxy(
    new Request("https://clone.example/emby/Users/Public"),
    {},
    {},
    () => {
      throw new Error("fetch must not be called");
    },
  );

  const [user] = await response.json();
  assert.equal(response.status, 200);
  assert.equal(user.Name, "JAVDB Guest");
  assert.equal(user.HasPassword, false);
  assert.equal(user.HasConfiguredPassword, false);
  assert.equal(user.EnableAutoLogin, true);
});

test("authenticates an empty Emby login as the local guest", async () => {
  const response = await handleProxy(
    new Request("https://clone.example/emby/Users/AuthenticateByName", {
      method: "POST",
    }),
    {},
    {},
    () => {
      throw new Error("fetch must not be called");
    },
  );

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.AccessToken, "bbjavdb-guest");
  assert.equal(payload.User.Name, "JAVDB Guest");
  assert.equal(payload.User.HasPassword, false);
});

test("can disable passwordless Emby guest access", async () => {
  const response = await handleProxy(
    new Request("https://clone.example/emby/Users/AuthenticateByName", {
      method: "POST",
    }),
    { EMBY_GUEST_ACCESS: "false" },
    {},
    () => {
      throw new Error("fetch must not be called");
    },
  );

  assert.equal(response.status, 401);
});

test("maps JavDB movies into an Emby item list", async () => {
  const response = await handleProxy(
    new Request("https://clone.example/Items?ParentId=bbjavdb-root&Limit=10"),
    {},
    {},
    async (url) => {
      assert.match(url, /jdforrepam\.com\/api\/v1\/movies\/latest/);
      return new Response(
        JSON.stringify({
          success: 1,
          data: {
            movies: [
              {
                id: 42,
                number: "TEST-001",
                title: "Test Movie",
                release_date: "2024-01-02",
                duration: 120,
                summary: "A test movie",
                cover_url: "https://jdforrepam.com/covers/test.jpg",
                tags: [{ name: "Drama" }],
              },
            ],
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  );

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.Items[0].Id, "42");
  assert.equal(payload.Items[0].Name, "Test Movie");
  assert.equal(payload.Items[0].Type, "Movie");
  assert.equal(payload.Items[0].ServerId, "bbjavdb-emby");
  assert.equal(payload.Items[0].ParentId, "bbjavdb-root");
  assert.deepEqual(payload.Items[0].Genres, ["Drama"]);
});

test("maps the user-scoped latest route into an Emby item array", async () => {
  const response = await handleProxy(
    new Request("https://clone.example/emby/Users/bbjavdb-user/Items/Latest?Limit=1"),
    {},
    {},
    async (url) => {
      assert.match(url, /jdforrepam\.com\/api\/v1\/movies\/latest/);
      return new Response(
        JSON.stringify({
          success: 1,
          data: {
            movies: [{ id: 42, number: "TEST-001", title: "Latest Movie" }],
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  );

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(Array.isArray(payload), true);
  assert.equal(payload[0].Name, "Latest Movie");
  assert.match(payload[0].Path, /\/emby\/Items\/42$/);
});

test("returns JSON placeholders for optional Emby home sections", async () => {
  const paths = [
    "/emby/Users/bbjavdb-user/Items/Resume",
    "/emby/Shows/NextUp",
    "/emby/Shows/Upcoming",
    "/emby/Genres",
    "/emby/Studios",
    "/emby/Persons",
  ];

  for (const path of paths) {
    const response = await handleProxy(
      new Request(`https://clone.example${path}`),
      {},
      {},
      () => {
        throw new Error("fetch must not be called");
      },
    );
    const payload = await response.json();
    assert.equal(response.status, 200, path);
    assert.deepEqual(payload.Items, [], path);
  }
});

test("authenticates Emby users against JavDB and returns an access token", async () => {
  let receivedBody;
  const response = await handleProxy(
    new Request("https://clone.example/Users/AuthenticateByName", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ Username: "demo", Pw: "secret" }),
    }),
    {},
    {},
    async (url, init) => {
      assert.match(url, /jdforrepam\.com\/api\/v1\/sessions/);
      receivedBody = await new Response(init.body).formData();
      return new Response(
        JSON.stringify({
          success: 1,
          data: { token: "javdb-token", user: { username: "demo" } },
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  );

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.AccessToken, "javdb-token");
  assert.equal(payload.User.Name, "demo");
  assert.equal(receivedBody.get("username"), "demo");
  assert.equal(receivedBody.get("password"), "secret");
});

test("maps full-video resolution into Emby playback info", async () => {
  const response = await handleProxy(
    new Request("https://clone.example/Items/42/PlaybackInfo", {
      method: "POST",
    }),
    {},
    {},
    async (url) => {
      if (url.includes("/v4/movies/42")) {
        return new Response(
          JSON.stringify({
            success: 1,
            data: { movie: { id: 42, number: "TEST-001", title: "Test Movie" } },
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      assert.match(url, /\/api\/v\/resolve\?code=TEST-001/);
      return new Response(
        JSON.stringify({
          variants: [{ variant: "original", sourceUrl: "https://jdforrepam.com/video/test.mp4", sourceType: "video/mp4" }],
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  );

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.MediaSources[0].Container, "mp4");
  assert.match(payload.MediaSources[0].Path, /\/Videos\/42\/stream/);
  assert.match(payload.MediaSources[0].Path, /api_key=bbjavdb-guest/);
});

test("serves a movie primary image through the Emby endpoint", async () => {
  const imageBytes = new Uint8Array([255, 216, 255, 217]);
  let imageUrl;
  const response = await handleProxy(
    new Request("https://clone.example/Items/42/Images/Primary"),
    {},
    {},
    async (url) => {
      const target = String(url);
      if (target.includes("/v4/movies/42")) {
        return new Response(
          JSON.stringify({
            success: 1,
            data: { movie: { id: 42, cover_url: "https://jdforrepam.com/covers/test.jpg" } },
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      imageUrl = target;
      return new Response(imageBytes, {
        headers: { "content-type": "image/jpeg" },
      });
    },
  );

  assert.equal(response.status, 200);
  assert.equal(imageUrl, "https://jdforrepam.com/covers/test.jpg");
  assert.equal(response.headers.get("content-type"), "image/jpeg");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), imageBytes);
});

test("streams a resolved video and forwards Range headers", async () => {
  const videoBytes = new Uint8Array([0, 1, 2, 3]);
  let sourceRange;
  const response = await handleProxy(
    new Request("https://clone.example/Videos/42/stream?api_key=javdb-token", {
      headers: { range: "bytes=0-3" },
    }),
    {},
    {},
    async (url, init = {}) => {
      const target = String(url);
      if (target.includes("/v4/movies/42")) {
        return new Response(
          JSON.stringify({
            success: 1,
            data: { movie: { id: 42, number: "TEST-001", title: "Test Movie" } },
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      if (target.includes("/api/v/resolve")) {
        return new Response(
          JSON.stringify({
            variants: [{ variant: "original", sourceUrl: "https://jdforrepam.com/video/test.mp4", sourceType: "video/mp4" }],
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      sourceRange = init.headers?.get("range");
      return new Response(videoBytes, {
        status: 206,
        headers: {
          "accept-ranges": "bytes",
          "content-range": "bytes 0-3/4",
          "content-type": "video/mp4",
        },
      });
    },
  );

  assert.equal(response.status, 206);
  assert.equal(sourceRange, "bytes=0-3");
  assert.equal(response.headers.get("content-range"), "bytes 0-3/4");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), videoBytes);
});
