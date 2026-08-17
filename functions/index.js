import { handleProxy } from "../src/proxy.js";

export function onRequest(context) {
  return handleProxy(context.request, context.env, context);
}
