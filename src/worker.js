import { handleProxy } from "./proxy.js";

export default {
  fetch(request, env, context) {
    return handleProxy(request, env, context);
  },
};
