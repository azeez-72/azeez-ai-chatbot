var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-86n1l8/checked-fetch.js
var urls = /* @__PURE__ */ new Set();
function checkURL(request, init) {
  const url = request instanceof URL ? request : new URL(
    (typeof request === "string" ? new Request(request, init) : request).url
  );
  if (url.port && url.port !== "443" && url.protocol === "https:") {
    if (!urls.has(url.toString())) {
      urls.add(url.toString());
      console.warn(
        `WARNING: known issue with \`fetch()\` requests to custom HTTPS ports in published Workers:
 - ${url.toString()} - the custom port will be ignored when the Worker is published using the \`wrangler deploy\` command.
`
      );
    }
  }
}
__name(checkURL, "checkURL");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    const [request, init] = argArray;
    checkURL(request, init);
    return Reflect.apply(target, thisArg, argArray);
  }
});

// .wrangler/tmp/bundle-86n1l8/strip-cf-connecting-ip-header.js
function stripCfConnectingIPHeader(input, init) {
  const request = new Request(input, init);
  request.headers.delete("CF-Connecting-IP");
  return request;
}
__name(stripCfConnectingIPHeader, "stripCfConnectingIPHeader");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    return Reflect.apply(target, thisArg, [
      stripCfConnectingIPHeader.apply(null, argArray)
    ]);
  }
});

// src/chat-memory.js
import { DurableObject } from "cloudflare:workers";
var ChatMemory = class extends DurableObject {
  constructor(state, env) {
    super(state, env);
    this.state = state;
    this.env = env;
  }
  async addMessage(userMessage, botResponse) {
    const messages = await this.getHistory();
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    messages.push({
      role: "user",
      content: userMessage,
      timestamp
    });
    messages.push({
      role: "assistant",
      content: botResponse,
      timestamp
    });
    if (messages.length > 20) {
      messages.splice(0, messages.length - 20);
    }
    await this.state.storage.put("messages", messages);
    await this.updateSessionMetadata();
  }
  async getHistory() {
    return await this.state.storage.get("messages") || [];
  }
  async clearHistory() {
    await this.state.storage.delete("messages");
    await this.state.storage.delete("session_metadata");
  }
  async updateSessionMetadata() {
    const metadata = await this.state.storage.get("session_metadata") || {
      created_at: (/* @__PURE__ */ new Date()).toISOString(),
      message_count: 0,
      last_activity: (/* @__PURE__ */ new Date()).toISOString()
    };
    metadata.message_count += 2;
    metadata.last_activity = (/* @__PURE__ */ new Date()).toISOString();
    await this.state.storage.put("session_metadata", metadata);
  }
  async getSessionMetadata() {
    return await this.state.storage.get("session_metadata") || {
      created_at: (/* @__PURE__ */ new Date()).toISOString(),
      message_count: 0,
      last_activity: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  async getConversationSummary() {
    const messages = await this.getHistory();
    const metadata = await this.getSessionMetadata();
    return {
      message_count: metadata.message_count,
      last_activity: metadata.last_activity,
      session_duration: this.calculateSessionDuration(metadata.created_at),
      recent_messages: messages.slice(-4)
      // Last 4 messages
    };
  }
  calculateSessionDuration(createdAt) {
    const start = new Date(createdAt);
    const now = /* @__PURE__ */ new Date();
    const duration = now - start;
    const hours = Math.floor(duration / (1e3 * 60 * 60));
    const minutes = Math.floor(duration % (1e3 * 60 * 60) / (1e3 * 60));
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }
};
__name(ChatMemory, "ChatMemory");

// src/index.js
var src_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return env.ASSETS.fetch(request);
    }
    if (url.pathname === "/api/chat") {
      return handleChatRequest(request, env);
    }
    if (url.pathname === "/api/history") {
      return handleHistoryRequest(request, env);
    }
    if (url.pathname === "/api/clear") {
      return handleClearRequest(request, env);
    }
    if (url.pathname === "/api/summary") {
      return handleSummaryRequest(request, env);
    }
    return new Response("Not Found", { status: 404 });
  }
};
async function handleChatRequest(request, env) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }
  try {
    const { message } = await request.json();
    if (!message) {
      return new Response(JSON.stringify({ error: "Message is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (typeof message !== "string") {
      return new Response(JSON.stringify({ error: "Message must be a string" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (message.trim().length === 0) {
      return new Response(JSON.stringify({ error: "Message cannot be empty" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (message.length > 4e3) {
      return new Response(JSON.stringify({ error: "Message too long (max 4000 characters)" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    const memoryId = env.CHAT_MEMORY.idFromName("default-chat");
    const memoryStub = env.CHAT_MEMORY.get(memoryId);
    const history = await memoryStub.getHistory();
    const messages = [
      { role: "system", content: "You are a helpful AI assistant. Be concise and friendly." },
      ...history,
      { role: "user", content: message.trim() }
    ];
    const aiResponse = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
      messages,
      max_tokens: 500,
      temperature: 0.7
    });
    if (!aiResponse || !aiResponse.response) {
      throw new Error("Invalid AI response");
    }
    const response = aiResponse.response.trim();
    if (!response) {
      throw new Error("Empty AI response");
    }
    await memoryStub.addMessage(message.trim(), response);
    return new Response(JSON.stringify({ response }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    console.error("Chat error:", error);
    if (error instanceof SyntaxError) {
      return new Response(JSON.stringify({ error: "Invalid JSON in request body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (error.message.includes("AI binding")) {
      return new Response(JSON.stringify({ error: "AI service unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
__name(handleChatRequest, "handleChatRequest");
async function handleHistoryRequest(request, env) {
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }
  try {
    const memoryId = env.CHAT_MEMORY.idFromName("default-chat");
    const memoryStub = env.CHAT_MEMORY.get(memoryId);
    const history = await memoryStub.getHistory();
    return new Response(JSON.stringify({ history }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    console.error("History error:", error);
    if (error.message.includes("Durable Object")) {
      return new Response(JSON.stringify({ error: "Memory service unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ error: "Failed to retrieve history" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
__name(handleHistoryRequest, "handleHistoryRequest");
async function handleClearRequest(request, env) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }
  try {
    const memoryId = env.CHAT_MEMORY.idFromName("default-chat");
    const memoryStub = env.CHAT_MEMORY.get(memoryId);
    await memoryStub.clearHistory();
    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    console.error("Clear error:", error);
    if (error.message.includes("Durable Object")) {
      return new Response(JSON.stringify({ error: "Memory service unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ error: "Failed to clear history" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
__name(handleClearRequest, "handleClearRequest");
async function handleSummaryRequest(request, env) {
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }
  try {
    const memoryId = env.CHAT_MEMORY.idFromName("default-chat");
    const memoryStub = env.CHAT_MEMORY.get(memoryId);
    const summary = await memoryStub.getConversationSummary();
    return new Response(JSON.stringify({ summary }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    console.error("Summary error:", error);
    if (error.message.includes("Durable Object")) {
      return new Response(JSON.stringify({ error: "Memory service unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ error: "Failed to retrieve summary" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
__name(handleSummaryRequest, "handleSummaryRequest");

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-86n1l8/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-86n1l8/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof __Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
__name(__Facade_ScheduledController__, "__Facade_ScheduledController__");
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = (request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    };
    #dispatcher = (type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    };
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  ChatMemory,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
