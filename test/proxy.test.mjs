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
  assert.equal(isAllowedMediaHost("fast-stream.jav.si"), true);
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
      assert.match(url, /filter_by=subtitle/);
      assert.match(url, /limit=50/);
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
                can_play: true,
                has_cnsub: true,
              },
              {
                id: 43,
                number: "TEST-002",
                title: "Not Playable",
                can_play: false,
                has_cnsub: true,
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
  assert.equal(payload.Items.length, 1);
  assert.deepEqual(payload.Items[0].Genres, ["可播放", "中文字幕", "Drama"]);
});

test("forwards Emby access tokens to JavDB catalog requests", async () => {
  let authorization;
  const response = await handleProxy(
    new Request(
      "https://clone.example/Users/bbjavdb-user/Items?ParentId=bbjavdb-root&Limit=1",
      { headers: { "X-MediaBrowser-Token": "javdb-token" } },
    ),
    {},
    {},
    async (_url, init) => {
      authorization = init.headers.get("authorization");
      return new Response(
        JSON.stringify({ success: 1, data: { movies: [] } }),
        { headers: { "content-type": "application/json" } },
      );
    },
  );

  assert.equal(response.status, 200);
  assert.equal(authorization, "javdb-token");
});

test("maps the playable media library to the playable JavDB filter", async () => {
  const response = await handleProxy(
    new Request(
      "https://clone.example/Items?ParentId=bbjavdb-playable&Limit=10",
    ),
    {},
    {},
    async (url) => {
      assert.match(url, /filter_by=can_play/);
      return new Response(
        JSON.stringify({
          success: 1,
          data: {
            movies: [{
              id: 44,
              number: "TEST-003",
              title: "Playable without subtitles",
              can_play: true,
              has_cnsub: false,
            }],
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  );

  const payload = await response.json();
  assert.equal(payload.Items.length, 1);
  assert.equal(payload.Items[0].ParentId, "bbjavdb-playable");
  assert.deepEqual(payload.Items[0].Genres, ["可播放"]);
});

test("supports an Emby-prefixed server probe", async () => {
  const response = await handleProxy(
    new Request("https://clone.example/emby/"),
    {},
    {},
    () => {
      throw new Error("fetch must not be called");
    },
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).ProductName, "Emby Compatible Server");
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
            movies: [{
              id: 42,
              number: "TEST-001",
              title: "Latest Movie",
              can_play: true,
              has_cnsub: true,
            }],
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
  assert.equal(payload[0].ParentId, "bbjavdb-chinese-playable");
  assert.equal("Path" in payload[0], false);
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

test("serves Emby display preferences that enable latest media", async () => {
  const response = await handleProxy(
    new Request(
      "https://clone.example/emby/DisplayPreferences/usersettings?UserId=bbjavdb-user&Client=Forward",
    ),
    {},
    {},
    () => {
      throw new Error("fetch must not be called");
    },
  );

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.UserId, "bbjavdb-user");
  assert.equal(payload.Client, "Forward");
  assert.equal(payload.Configuration.homesection0, "latestmedia");
});

test("supports common Emby client bootstrap and session endpoints", async () => {
  const me = await handleProxy(
    new Request("https://clone.example/emby/Users/Me"),
    {},
    {},
    () => {
      throw new Error("fetch must not be called");
    },
  );
  const endpoint = await handleProxy(
    new Request("https://clone.example/emby/System/Endpoint"),
    {},
    {},
    () => {
      throw new Error("fetch must not be called");
    },
  );
  const capabilities = await handleProxy(
    new Request("https://clone.example/emby/Sessions/Capabilities/Full", {
      method: "POST",
    }),
    {},
    {},
    () => {
      throw new Error("fetch must not be called");
    },
  );

  assert.equal(me.status, 200);
  assert.equal((await me.json()).Id, "bbjavdb-user");
  assert.deepEqual(await endpoint.json(), { IsLocal: false, IsInNetwork: false });
  assert.equal(capabilities.status, 204);
});

test("advertises a non-empty virtual movie library", async () => {
  const views = await handleProxy(
    new Request("https://clone.example/emby/Users/bbjavdb-user/Views"),
    {},
    {},
    () => {
      throw new Error("fetch must not be called");
    },
  );
  const counts = await handleProxy(
    new Request("https://clone.example/emby/Items/Counts"),
    {},
    {},
    () => {
      throw new Error("fetch must not be called");
    },
  );

  const viewsPayload = await views.json();
  const countsPayload = await counts.json();
  assert.equal(viewsPayload.Items[0].ChildCount, 32);
  assert.equal(viewsPayload.TotalRecordCount, 2);
  assert.equal(viewsPayload.StartIndex, 0);
  assert.deepEqual(
    viewsPayload.Items.map((item) => [item.Id, item.Name]),
    [
      ["bbjavdb-playable", "可播放"],
      ["bbjavdb-chinese-playable", "中文可播放"],
    ],
  );
  assert.equal(countsPayload.MovieCount, 32);
  assert.equal(countsPayload.ItemCount, 32);
});

test("returns Emby-compatible media folder and virtual folder queries", async () => {
  const mediaFolders = await handleProxy(
    new Request("https://clone.example/emby/Library/MediaFolders"),
    {},
    {},
    () => {
      throw new Error("fetch must not be called");
    },
  );
  const virtualFolders = await handleProxy(
    new Request("https://clone.example/emby/Library/VirtualFolders/Query"),
    {},
    {},
    () => {
      throw new Error("fetch must not be called");
    },
  );

  const mediaPayload = await mediaFolders.json();
  const virtualPayload = await virtualFolders.json();
  assert.equal(mediaPayload.TotalRecordCount, 2);
  assert.equal(mediaPayload.Items[0].Id, "bbjavdb-playable");
  assert.equal(mediaPayload.Items[0].Type, "CollectionFolder");
  assert.equal(virtualPayload.TotalRecordCount, 2);
  assert.equal(virtualPayload.Items[0].ItemId, "bbjavdb-playable");
  assert.equal(virtualPayload.Items[0].CollectionType, "movies");
});

test("serves the user root item and user-scoped suggestions", async () => {
  const root = await handleProxy(
    new Request("https://clone.example/emby/Users/bbjavdb-user/Items/Root"),
    {},
    {},
    () => {
      throw new Error("fetch must not be called");
    },
  );
  const suggestions = await handleProxy(
    new Request("https://clone.example/emby/Users/bbjavdb-user/Suggestions"),
    {},
    {},
    () => {
      throw new Error("fetch must not be called");
    },
  );

  const rootPayload = await root.json();
  assert.equal(rootPayload.Id, "bbjavdb-root");
  assert.equal(rootPayload.Type, "Folder");
  assert.equal(rootPayload.ChildCount, 2);
  assert.deepEqual(await suggestions.json(), {
    Items: [],
    TotalRecordCount: 0,
    StartIndex: 0,
  });
});

test("returns JSON errors for unknown Emby routes instead of proxying HTML", async () => {
  const response = await handleProxy(
    new Request("https://clone.example/emby/Unknown/Endpoint"),
    {},
    {},
    () => {
      throw new Error("fetch must not be called");
    },
  );

  assert.equal(response.status, 404);
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.equal((await response.json()).Message, "Emby endpoint not found");
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
      if (url.includes("javstrm.emby-59f.workers.dev/api/resolve")) {
        return new Response(
          JSON.stringify({
            variants: [{ variant: "original", sourceUrl: "https://jdforrepam.com/video/test.mp4", sourceType: "video/mp4" }],
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      assert.match(url, /\/api\/subtitle\?name=TEST-001/);
      return new Response(
        JSON.stringify({
          code: 0,
          data: [{
            cid: "subtitle-1",
            url: "https://subtitle.example/test.srt",
            ext: "srt",
            name: "TEST-001.srt",
          }],
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  );

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.MediaSources[0].Container, "mp4");
  assert.match(payload.MediaSources[0].Path, /\/Videos\/42\/stream\.mp4/);
  assert.match(payload.MediaSources[0].Path, /api_key=bbjavdb-guest/);
  assert.match(payload.MediaSources[0].Path, /static=true/);
  assert.match(payload.MediaSources[0].Path, /mediaSourceId=42/);
  assert.match(payload.MediaSources[0].Path, /source=https%3A%2F%2Fjdforrepam\.com/);
  assert.match(payload.MediaSources[0].DirectStreamUrl, /^\/Videos\/42\/stream\.mp4/);
  assert.equal(payload.MediaSources[0].MediaStreams[1].Type, "Audio");
  assert.equal(payload.MediaSources[0].MediaStreams[1].Codec, "aac");
  assert.equal(payload.MediaSources[0].MediaStreams[2].Language, "chi");
  assert.match(payload.MediaSources[0].MediaStreams[2].DeliveryUrl, /\/Subtitles\/2\/Stream\.srt/);
});

test("embeds a directly streamable media source in movie details", async () => {
  const response = await handleProxy(
    new Request("https://clone.example/Items/42?api_key=bbjavdb-guest"),
    {},
    {},
    async (url) => {
      if (url.includes("/v4/movies/42")) {
        return new Response(
          JSON.stringify({
            success: 1,
            data: {
              movie: {
                id: 42,
                number: "TEST-001",
                title: "Test Movie",
                can_play: true,
                has_cnsub: true,
              },
            },
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("javstrm.emby-59f.workers.dev/api/resolve")) {
        return new Response(
          JSON.stringify({
            variants: [{
              variant: "original",
              sourceUrl: "https://fast-stream.jav.si/video/test.mp4",
              sourceType: "video/mp4",
              quality: 1080,
            }],
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      assert.match(url, /\/api\/subtitle\?name=TEST-001/);
      return new Response(
        JSON.stringify({
          code: 0,
          data: [{
            cid: "subtitle-1",
            url: "https://subtitle.example/test.srt",
            ext: "srt",
          }],
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  );

  const payload = await response.json();
  assert.equal(payload.PlayAccess, "Full");
  assert.equal(payload.MediaSourceCount, 1);
  assert.match(payload.Path, /\/Videos\/42\/stream\.mp4/);
  assert.equal(payload.MediaSources[0].MediaStreams[1].Type, "Audio");
  assert.equal(payload.MediaSources[0].DefaultSubtitleStreamIndex, 2);
});

test("serves inline HLS variants through a short Emby stream URL", async () => {
  const playlist = "#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nhttps://media.example/segment.ts\n#EXT-X-ENDLIST\n";
  const inlineSource = `data:application/vnd.apple.mpegurl,${encodeURIComponent(playlist)}`;
  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.includes("/v4/movies/42")) {
      return new Response(
        JSON.stringify({
          success: 1,
          data: { movie: { id: 42, number: "TEST-001", title: "HLS Movie" } },
        }),
        { headers: { "content-type": "application/json" } },
      );
    }
    if (target.includes("javstrm.emby-59f.workers.dev/api/resolve")) {
      return new Response(
        JSON.stringify({
          variants: [{
            variant: "javgg_original",
            sourceUrl: inlineSource,
            sourceType: "application/vnd.apple.mpegurl",
          }],
        }),
        { headers: { "content-type": "application/json" } },
      );
    }
    if (target.includes("/api/subtitle")) {
      return new Response(
        JSON.stringify({ code: 0, data: [] }),
        { headers: { "content-type": "application/json" } },
      );
    }
    throw new Error(`unexpected fetch: ${target}`);
  };

  const playback = await handleProxy(
    new Request("https://clone.example/emby/Items/42/PlaybackInfo?api_key=bbjavdb-guest", {
      method: "POST",
    }),
    {},
    {},
    fetchImpl,
  );
  const mediaSource = (await playback.json()).MediaSources[0];
  assert.equal(mediaSource.Container, "m3u8");
  assert.match(mediaSource.DirectStreamUrl, /\/emby\/Videos\/42\/stream\.m3u8/);
  assert.doesNotMatch(mediaSource.DirectStreamUrl, /source=/);
  assert.ok(mediaSource.DirectStreamUrl.length < 200);

  const stream = await handleProxy(
    new Request(new URL(mediaSource.DirectStreamUrl, "https://clone.example")),
    {},
    {},
    fetchImpl,
  );
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get("content-type"), /application\/vnd\.apple\.mpegurl/);
  assert.equal(await stream.text(), playlist);
});

test("serves a movie primary image through the Emby endpoint", async () => {
  const imageBytes = new Uint8Array([255, 216, 255, 217]);
  const encryptedImageBytes = new Uint8Array([234, 21, 50, 21, 51]);
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
      return new Response(encryptedImageBytes, {
        headers: { "content-type": "binary/octet-stream" },
      });
    },
  );

  assert.equal(response.status, 200);
  assert.equal(imageUrl, "https://jdforrepam.com/covers/test.jpg");
  assert.equal(response.headers.get("content-type"), "image/jpeg");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), imageBytes);
});

test("serves the advertised Chinese subtitle stream", async () => {
  const subtitleText = "1\r\n00:00:01,000 --> 00:00:02,000\r\n你好\r\n";
  let subtitleFileUrl;
  const response = await handleProxy(
    new Request("https://clone.example/Videos/42/42/Subtitles/2/Stream.srt?api_key=bbjavdb-guest"),
    {},
    {},
    async (url) => {
      const target = String(url);
      if (target.includes("/v4/movies/42")) {
        return new Response(
          JSON.stringify({
            success: 1,
            data: { movie: { id: 42, number: "TEST-001" } },
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      if (target.includes("/api/subtitle?name=TEST-001")) {
        return new Response(
          JSON.stringify({
            code: 0,
            data: [{
              cid: "subtitle-1",
              url: "https://subtitle.example/test.srt",
              ext: "srt",
            }],
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      subtitleFileUrl = target;
      return new Response(subtitleText, {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    },
  );

  assert.equal(response.status, 200);
  assert.match(subtitleFileUrl, /\/api\/subtitle\/file\?url=/);
  assert.equal(response.headers.get("content-type"), "application/x-subrip; charset=utf-8");
  assert.equal(await response.text(), subtitleText);
});

test("streams a resolved video and forwards Range headers", async () => {
  const videoBytes = new Uint8Array([0, 1, 2, 3]);
  let sourceRange;
  const response = await handleProxy(
    new Request("https://clone.example/Videos/42/stream.mp4?api_key=javdb-token", {
      headers: { "if-range": "test-etag", range: "bytes=0-3" },
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
      if (target.includes("javstrm.emby-59f.workers.dev/api/resolve")) {
        return new Response(
          JSON.stringify({
            variants: [{ variant: "original", sourceUrl: "https://fast-stream.jav.si/video/test.mp4", sourceType: "video/mp4" }],
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
  assert.match(response.headers.get("access-control-expose-headers"), /Content-Range/);
  assert.equal(response.headers.get("content-range"), "bytes 0-3/4");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), videoBytes);
});

test("reuses the source advertised by PlaybackInfo without resolving it again", async () => {
  const videoBytes = new Uint8Array([0, 0, 0, 32]);
  const calls = [];
  const source = encodeURIComponent("https://fast-stream.jav.si/video/test.mp4");
  const response = await handleProxy(
    new Request(
      `https://clone.example/Videos/42/stream.mp4?api_key=bbjavdb-guest&source=${source}&sourceType=video%2Fmp4`,
      { headers: { range: "bytes=0-3" } },
    ),
    {},
    {},
    async (url, init = {}) => {
      calls.push(String(url));
      assert.equal(String(url), "https://fast-stream.jav.si/video/test.mp4");
      assert.equal(init.headers.get("range"), "bytes=0-3");
      return new Response(videoBytes, {
        status: 206,
        headers: {
          "content-range": "bytes 0-3/4",
          "content-type": "video/mp4",
        },
      });
    },
  );

  assert.equal(response.status, 206);
  assert.equal(calls.length, 1);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), videoBytes);
});

test("refreshes a stale media URL and accepts SenPlayer stream path variants", async () => {
  const videoBytes = new Uint8Array([0, 0, 0, 32]);
  const calls = [];
  const staleSource = encodeURIComponent("https://fast-stream.jav.si/video/stale.mp4");
  const response = await handleProxy(
    new Request(
      `https://clone.example/emby/Videos/42/42/stream.mp4?api_key=bbjavdb-guest&source=${staleSource}&sourceType=video%2Fmp4`,
      { headers: { range: "bytes=0-3" } },
    ),
    {},
    {},
    async (url, init = {}) => {
      const target = String(url);
      calls.push(target);
      if (target.endsWith("/video/stale.mp4")) {
        return new Response("expired", { status: 404 });
      }
      if (target.includes("/v4/movies/42")) {
        return new Response(
          JSON.stringify({
            success: 1,
            data: { movie: { id: 42, number: "TEST-001" } },
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      if (target.includes("javstrm.emby-59f.workers.dev/api/resolve")) {
        return new Response(
          JSON.stringify({
            variants: [{
              variant: "original",
              sourceUrl: "https://fast-stream.jav.si/video/fresh.mp4",
              sourceType: "video/mp4",
            }],
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      assert.equal(target, "https://fast-stream.jav.si/video/fresh.mp4");
      assert.equal(init.headers.get("range"), "bytes=0-3");
      return new Response(videoBytes, {
        status: 206,
        headers: {
          "content-range": "bytes 0-3/4",
          "content-type": "video/mp4",
        },
      });
    },
  );

  assert.equal(response.status, 206);
  assert.deepEqual(calls, [
    "https://fast-stream.jav.si/video/stale.mp4",
    "https://jdforrepam.com/api/v4/movies/42",
    "https://javstrm.emby-59f.workers.dev/api/resolve?code=TEST-001&lang=zh",
    "https://fast-stream.jav.si/video/fresh.mp4",
  ]);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), videoBytes);
});

test("accepts SenPlayer source aliases and sends media hotlink headers", async () => {
  const videoBytes = new Uint8Array([0, 0, 0, 32]);
  const source = encodeURIComponent("https://fast-stream.jav.si/video/test.mp4");
  const response = await handleProxy(
    new Request(
      `https://clone.example/emby/videos/42/42/streaming-video.mp4?api_key=bbjavdb-guest&sourceUrl=${source}`,
      { headers: { range: "bytes=0-3" } },
    ),
    {},
    {},
    async (url, init = {}) => {
      assert.equal(String(url), "https://fast-stream.jav.si/video/test.mp4");
      assert.equal(init.headers.get("range"), "bytes=0-3");
      assert.equal(init.headers.get("origin"), UPSTREAM);
      assert.equal(init.headers.get("referer"), `${UPSTREAM}/`);
      return new Response(videoBytes, {
        status: 206,
        headers: {
          "content-range": "bytes 0-3/4",
          "content-type": "video/mp4",
        },
      });
    },
  );

  assert.equal(response.status, 206);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), videoBytes);
});

test("streams relative URLs from alternate resolver response fields", async () => {
  const videoBytes = new Uint8Array([0, 0, 0, 32]);
  const calls = [];
  const response = await handleProxy(
    new Request(
      "https://clone.example/Videos/42/playback.mp4?api_key=bbjavdb-guest",
      { headers: { range: "bytes=0-3" } },
    ),
    {},
    {},
    async (url, init = {}) => {
      const target = String(url);
      calls.push(target);
      if (target.includes("/v4/movies/42")) {
        return new Response(
          JSON.stringify({
            success: 1,
            data: { movie: { id: 42, number: "TEST-001" } },
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      if (target.includes("javstrm.emby-59f.workers.dev/api/resolve")) {
        return new Response(
          JSON.stringify({
            data: {
              sources: [{
                name: "original",
                source_url: "/video/fresh.mp4",
                mime_type: "video/mp4",
              }],
            },
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      assert.equal(target, `${UPSTREAM}/video/fresh.mp4`);
      assert.equal(init.headers.get("range"), "bytes=0-3");
      return new Response(videoBytes, {
        status: 206,
        headers: {
          "content-range": "bytes 0-3/4",
          "content-type": "video/mp4",
        },
      });
    },
  );

  assert.equal(response.status, 206);
  assert.deepEqual(calls, [
    "https://jdforrepam.com/api/v4/movies/42",
    "https://javstrm.emby-59f.workers.dev/api/resolve?code=TEST-001&lang=zh",
    `${UPSTREAM}/video/fresh.mp4`,
  ]);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), videoBytes);
});
