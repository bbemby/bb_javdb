import http from "node:http";
import { Readable } from "node:stream";

import { handleProxy } from "../src/proxy.js";

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 8788);
const env = {
  UPSTREAM_ORIGIN:
    process.env.UPSTREAM_ORIGIN ||
    "https://catembylegacy.fastcdn.dpdns.org",
  JAVDB_API_ORIGIN:
    process.env.JAVDB_API_ORIGIN || "https://jdforrepam.com/api",
  EMBY_SERVER_ID: process.env.EMBY_SERVER_ID || "bbjavdb-emby",
  EXTRA_MEDIA_HOSTS: process.env.EXTRA_MEDIA_HOSTS || "",
};

function nodeFetch(url, init) {
  return fetch(url, {
    ...init,
    duplex: init.body ? "half" : undefined,
  });
}

function toWebRequest(request) {
  const origin = `http://${request.headers.host || `${host}:${port}`}`;
  const init = {
    method: request.method,
    headers: request.headers,
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = Readable.toWeb(request);
    init.duplex = "half";
  }

  return new Request(new URL(request.url || "/", origin), init);
}

async function sendWebResponse(response, outgoing) {
  const headers = {};

  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") {
      headers[name] = value;
    }
  });

  if (typeof response.headers.getSetCookie === "function") {
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) {
      headers["set-cookie"] = cookies;
    }
  }

  outgoing.writeHead(response.status, response.statusText, headers);

  if (!response.body) {
    outgoing.end();
    return;
  }

  Readable.fromWeb(response.body).pipe(outgoing);
}

const server = http.createServer(async (request, response) => {
  try {
    const proxyResponse = await handleProxy(
      toWebRequest(request),
      env,
      {},
      nodeFetch,
    );
    await sendWebResponse(proxyResponse, response);
  } catch (error) {
    console.error(error);
    response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    response.end("Upstream request failed");
  }
});

server.listen(port, host, () => {
  console.log(`Local proxy listening on http://${host}:${port}`);
});
