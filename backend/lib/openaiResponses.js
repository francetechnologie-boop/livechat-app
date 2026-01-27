import OpenAI from "openai";
import fs from "fs";
import path from "path";

// Enable logging when OPENAI_LOG is any non-empty value except 0/false/no
const OPENAI_LOG = (() => {
  const v = String(process.env.OPENAI_LOG || "").trim();
  if (!v) return false;
  return !/^(0|false|no)$/i.test(v);
})();
function logLine(obj) {
  if (!OPENAI_LOG) return;
  try {
    const line = `[${new Date().toISOString()}] ${JSON.stringify(obj)}\n`;
    const logPath = path.resolve(process.cwd(), "chat.log");
    fs.appendFile(logPath, line, () => {});
  } catch {}
}

// Minimal in-memory debug store (accessible from server routes)
if (!globalThis.__OPENAI_DEBUG) globalThis.__OPENAI_DEBUG = {};
function setDebug(patch = {}) {
  try {
    const d = (globalThis.__OPENAI_DEBUG = globalThis.__OPENAI_DEBUG || {});
    Object.assign(d, patch);
  } catch {}
}
export function getOpenaiDebug() {
  try { return globalThis.__OPENAI_DEBUG || {}; } catch { return {}; }
}

export function createOpenAIClient({ apiKey, organization, project, baseURL } = {}) {
  const key = apiKey || process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY missing");
  const isProjectScoped = /^sk-proj-/.test(String(key));
  const orgOk = organization && /^org_[a-zA-Z0-9]+$/.test(String(organization)) ? organization : undefined;
  const projOk = project && /^proj_[a-zA-Z0-9]+$/.test(String(project)) ? project : undefined;
  return new OpenAI({
    apiKey: key,
    organization: isProjectScoped ? undefined : (orgOk || process.env.OPENAI_ORG || undefined),
    project: isProjectScoped ? undefined : (projOk || process.env.OPENAI_PROJECT || undefined),
    baseURL: baseURL || process.env.OPENAI_BASE_URL || undefined,
  });
}

export function extractTextFromResponse(r) {
  try {
    if (typeof r?.output_text === "string" && r.output_text)
      return r.output_text;
    const out = Array.isArray(r?.output) ? r.output : [];
    let text = "";
    for (const part of out) {
      const content = Array.isArray(part?.content) ? part.content : [];
      for (const c of content) {
        if (c?.type === "text" && c?.text?.value) text += c.text.value;
        if (c?.type === "output_text" && c?.text) text += c.text;
      }
    }
    return text;
  } catch {
    return "";
  }
}


function summarizeToolDescriptor(tool) {
  if (!tool || typeof tool !== "object") return null;
  if (tool.type === "function") {
    return {
      type: "function",
      name: tool.function?.name || tool.name || null,
    };
  }
  return { type: tool?.type || null };
}

function summarizeTools(tools) {
  if (!Array.isArray(tools) || !tools.length) return undefined;
  const out = [];
  for (const tool of tools) {
    const summary = summarizeToolDescriptor(tool);
    if (summary) out.push(summary);
  }
  return out.length ? out : undefined;
}

function summarizeFunctionTools(functionTools) {
  if (!Array.isArray(functionTools) || !functionTools.length) return undefined;
  return functionTools
    .map((tool) => tool?.function?.name || tool?.name || null)
    .filter(Boolean);
}

function buildRequestDebug(body, extras = {}) {
  const input = typeof body.input === "string" ? body.input : "";
  const instructions = typeof body.instructions === "string" ? body.instructions : undefined;
  const summary = {
    model: typeof body.model === "string" && body.model.trim() ? body.model : "<from_prompt>",
    input,
    input_length: input.length,
    instructions,
    instructions_length: instructions ? instructions.length : undefined,
    text: body.text || undefined,
    reasoning: body.reasoning || undefined,
    max_output_tokens: body.max_output_tokens || undefined,
    tools: summarizeTools(body.tools),
    tool_resources: body.tool_resources || undefined,
  };
  if (Object.prototype.hasOwnProperty.call(body, "temperature")) {
    summary.temperature = body.temperature;
  }
  if (Object.prototype.hasOwnProperty.call(body, "top_p")) {
    summary.top_p = body.top_p;
  }
  return { ...summary, ...extras };
}
export async function respondWithPrompt({
  apiKey,
  model,
  promptId,
  promptVersion,
  input,
  seedMessages,
  instructions,
  toolsFileSearch,
  toolsCodeInterpreter,
  vectorStoreId,
  vectorStoreIds,
  webSearchEnabled,
  webSearchAllowedDomains,
  webSearchContextSize,
  variables,
  responseFormat,
  textVerbosity,
  reasoningEffort,
  maxOutputTokens,
  temperature,
  topP,
  metadata,
  organization,
  project,
  baseURL,
  extraTools,
}, { includeToolsOnGpt5 = false, buildOnly = false } = {}) {
  let client = null;
  if (!buildOnly) {
    client = createOpenAIClient({ apiKey, organization, project, baseURL });
  }

  const tools = [];
  // Avoid code_interpreter for GPT-5 models unless container is configured (not supported here)
  const m = (model || process.env.OPENAI_MODEL || "gpt-4o-mini").toLowerCase();
  const isGpt5 = /^gpt-5/i.test(m);
  if (toolsCodeInterpreter && !m.startsWith("gpt-5")) tools.push({ type: "code_interpreter" });
  if (toolsFileSearch) tools.push({ type: "file_search" });
  if (Array.isArray(extraTools) && extraTools.length) {
    for (const t of extraTools) { if (t && typeof t === 'object') tools.push(t); }
  }
  // m already computed above
  if (webSearchEnabled) {
    if (m.startsWith("gpt-5")) {
      const ws = { type: "web_search" };
      if (
        Array.isArray(webSearchAllowedDomains) &&
        webSearchAllowedDomains.length
      ) {
        ws.filters = { allowed_domains: webSearchAllowedDomains };
      }
      if (webSearchContextSize) ws.search_context_size = webSearchContextSize;
      tools.push(ws);
    } else {
      tools.push({ type: "web_search" });
    }
  }

  const tool_resources = {};
  if (toolsFileSearch) {
    const ids = [];
    if (Array.isArray(vectorStoreIds)) {
      for (const v of vectorStoreIds) { const s = String(v||'').trim(); if (s) ids.push(s); }
    }
    const single = String(vectorStoreId || '').trim();
    if (single) ids.push(single);
    const uniq = Array.from(new Set(ids));
    if (uniq.length) tool_resources.file_search = { vector_store_ids: uniq };
  }

  let textBlock = undefined;
  if (responseFormat || textVerbosity) {
    const fmt = String(responseFormat).toLowerCase();
    let type = "text";
    if (fmt === "json_object") type = "json_object";
    else if (fmt === "json") type = "json";
    textBlock = { format: { type } };
    if (textVerbosity) textBlock.verbosity = textVerbosity;
  }

  const body = {
    tools: tools.length ? tools : undefined,
    tool_resources: Object.keys(tool_resources).length
      ? tool_resources
      : undefined,
    text: textBlock,
    reasoning: reasoningEffort ? { effort: reasoningEffort } : undefined,
  };
  // Optional structured metadata (e.g. id_shop/id_lang) for debugging / routing.
  // If the API rejects this field, we will retry without it.
  try {
    if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
      const cleaned = {};
      for (const [k, v] of Object.entries(metadata)) {
        const key = String(k || "").trim();
        if (!key) continue;
        cleaned[key] = (v == null) ? "" : String(v);
      }
      if (Object.keys(cleaned).length) body.metadata = cleaned;
    }
  } catch {}
  // Compatibility: some regions expect vector_store_ids inline on the file_search tool
  try {
    const ids = (tool_resources && tool_resources.file_search && tool_resources.file_search.vector_store_ids) || [];
    if (Array.isArray(ids) && ids.length && Array.isArray(body.tools)) {
      for (const t of body.tools) {
        if (t && t.type === 'file_search' && !t.vector_store_ids) t.vector_store_ids = ids;
      }
    }
  } catch {}
  // Always include a model, even when using a Prompt ID
  body.model = String(model || process.env.OPENAI_MODEL || "gpt-4o-mini");
  if (temperature != null) body.temperature = Number(temperature);
  if (topP != null) body.top_p = Number(topP);
  // Guard: many models reject reasoning.effort; allow only families known to support it (o3, some gpt‑5)
  try {
    const ml = (body.model || '').toLowerCase();
    const reasoningAllowed = /^o3\b/.test(ml) || /^gpt-5\b/.test(ml);
    if (!reasoningAllowed && body.reasoning) delete body.reasoning;
  } catch {}
  // Track the effective body actually sent to OpenAI (after any fallbacks)
  let effectiveBody = body;

  // If we have seed messages, build multi-message input and append the live user input as the last user turn
  const hasSeed = Array.isArray(seedMessages) && seedMessages.length > 0;
  if (promptId) {
    body.prompt = { id: promptId };
    if (promptVersion) body.prompt.version = String(promptVersion);
    if (hasSeed) {
      const arr = [];
      for (const m of seedMessages) {
        const role = (m && typeof m.role === 'string' && m.role) || 'user';
        const content = (m && typeof m.content === 'string') ? m.content : '';
        arr.push({ role, content });
      }
      arr.push({ role: 'user', content: `${input ?? ''}` });
      body.input = arr;
    } else {
      body.input = `${input ?? ""}`;
    }
    // Ensure developer instructions are included even when using a Prompt ID
    // This is important for GPT-5 family where top-level prompt may be removed.
    if (instructions) body.instructions = String(instructions);
  } else {
    if (hasSeed) {
      const arr = [];
      for (const m of seedMessages) {
        const role = (m && typeof m.role === 'string' && m.role) || 'user';
        const content = (m && typeof m.content === 'string') ? m.content : '';
        arr.push({ role, content });
      }
      arr.push({ role: 'user', content: `${input ?? ''}` });
      body.input = arr;
    } else {
      body.input = `${input ?? ""}`;
    }
    if (instructions) body.instructions = String(instructions);
  }

  // OpenAI guardrail: when requesting `text.format: { type: "json_object" }`, the *input messages*
  // must mention "json" somewhere. Prompt-level instructions may not be counted.
  try {
    const wantsJsonObject = body && body.text && body.text.format && body.text.format.type === "json_object";
    if (wantsJsonObject) {
      const inputVal = body.input;
      const inputText = Array.isArray(inputVal)
        ? inputVal.map((m) => String((m && m.content) || "")).join("\n")
        : String(inputVal || "");
      if (!/json/i.test(inputText)) {
        body.input = [
          { role: "user", content: "Return a JSON object." },
          { role: "user", content: String(inputVal || "") },
        ];
      }
    }
  } catch {}

  // Proactive hardening for GPT‑5 family to avoid intermittent 5xx:
  try {
    if (isGpt5) {
      // Drop top-level prompt for real calls; keep it in preview-only builds
      if (!buildOnly && body.prompt) delete body.prompt;
      // Optionally keep tool_resources and file_search for gpt-5 when explicitly requested
      if (!includeToolsOnGpt5 && body.tool_resources) delete body.tool_resources;
      // Drop temperature/top_p proactively (common rejection on gpt-5)
      if (Object.prototype.hasOwnProperty.call(body, 'temperature')) delete body.temperature;
      if (Object.prototype.hasOwnProperty.call(body, 'top_p')) delete body.top_p;
      if (Array.isArray(body.tools)) {
        body.tools = body.tools.filter((t) => t && (includeToolsOnGpt5 ? true : (t.type !== 'file_search')));
        if (!body.tools.length) delete body.tools;
      }
    }
  } catch {}

  const requestDebug = buildRequestDebug(body, {
    promptId: promptId || null,
    promptVersion: promptVersion || null,
    vectorStoreId: vectorStoreId || null,
    vectorStoreIds: Array.isArray(vectorStoreIds) ? vectorStoreIds : undefined,
    webSearchEnabled: !!webSearchEnabled,
    metadata: body.metadata || undefined,
  });

  logLine({
    event: "openai_request",
    prompt_id: promptId || null,
    prompt_version: promptVersion || null,
    model: body.model || "<from_prompt>",
    input_len: (body.input || "").length,
    tools: (tools || []).map((t) => t.type),
    vector_store_id: vectorStoreId || null,
    vector_store_ids: Array.isArray(vectorStoreIds) ? vectorStoreIds : undefined,
    web_search_enabled: !!webSearchEnabled,
    web_search_domains: Array.isArray(webSearchAllowedDomains)
      ? webSearchAllowedDomains
      : undefined,
	    text_format: body.text?.format?.type || undefined,
	    text_verbosity: body.text?.verbosity || undefined,
	    reasoning_effort: body.reasoning?.effort || undefined,
	    tool_resources_present: !!body.tool_resources,
	    metadata: body.metadata || undefined,
	  });

  // Record last request body for debugging (sanitized)
  setDebug({ lastRequestAt: Date.now(), lastRequestBody: { ...body, apiKey: undefined } });

  // Preview-only: return the effective body and request summary without calling OpenAI
  if (buildOnly) {
    return { text: '', raw: null, request: requestDebug, request_body: effectiveBody };
  }

  let r;
  try {
    r = await client.responses.create(body);
  } catch (e) {
    const msg = String(e?.message || "");
    const unsupportedTemp =
      msg.includes("Unsupported parameter: 'temperature'") ||
      msg.includes('Unsupported parameter: "temperature"');
    const unsupportedTopP =
      msg.includes("Unsupported parameter: 'top_p'") ||
      msg.includes('Unsupported parameter: "top_p"');
    const unsupportedReasoning =
      msg.includes("Unsupported parameter: 'reasoning.effort'") ||
      msg.includes('Unsupported parameter: "reasoning.effort"');
    const unknownToolResources =
      msg.includes("Unknown parameter: 'tool_resources'") ||
      msg.includes('Unknown parameter: "tool_resources"');
	    const invalidTopLevelPrompt =
	      msg.includes("Unknown parameter: 'prompt'") ||
	      msg.includes('Unknown parameter: "prompt"') ||
	      /prompt is not a valid top-level field/i.test(msg) ||
	      /invalid parameter[^:]*: '?prompt'?/i.test(msg);
	    const unknownMetadata =
	      msg.includes("Unknown parameter: 'metadata'") ||
	      msg.includes('Unknown parameter: "metadata"');
	    const missingVectorIds =
	      /tools\[\d+\]\.vector_store_ids/.test(msg) || /vector_store_ids/.test(msg);
    if ((unsupportedTemp || unsupportedTopP) && (body.temperature != null || body.top_p != null)) {
      const retry = { ...body };
      delete retry.temperature;
      delete retry.top_p;
      requestDebug.retry = {
        reason: "drop_temperature_top_p",
        removed: {
          temperature: body.temperature ?? undefined,
          top_p: body.top_p ?? undefined,
        },
      };
      requestDebug.temperature = undefined;
      requestDebug.top_p = undefined;
      logLine({ event: "openai_retry", reason: "drop_temperature_top_p", model: body.model || "<from_prompt>" });
      setDebug({ lastRetryBody: { ...retry } });
      effectiveBody = retry;
      r = await client.responses.create(retry);
    } else if (unsupportedReasoning) {
      // Retry without reasoning, regardless of whether we explicitly set it
      const retry = { ...body };
      try { delete retry.reasoning; } catch {}
      requestDebug.retry = { reason: "drop_reasoning_always" };
      logLine({ event: "openai_retry", reason: "drop_reasoning_always", model: body.model || "<from_prompt>" });
      try {
        setDebug({ lastRetryBody: { ...retry } });
        effectiveBody = retry;
        r = await client.responses.create(retry);
      } catch (e2) {
        // As a last resort, send a minimal request (model + prompt/input only)
        const minimal = {};
        minimal.model = retry.model;
        if (retry.prompt) minimal.prompt = retry.prompt;
        minimal.input = retry.input ?? '';
        logLine({ event: "openai_retry", reason: "minimal_after_reasoning", model: minimal.model || "<from_prompt>" });
        setDebug({ lastRetryBody: { ...minimal } });
        effectiveBody = minimal;
        r = await client.responses.create(minimal);
      }
    } else if (unknownToolResources && body.tool_resources) {
      // Retry without tool_resources for compatibility with regions/models
      const retry = { ...body };
      try { delete retry.tool_resources; } catch {}
      requestDebug.retry = { reason: "drop_tool_resources" };
      logLine({ event: "openai_retry", reason: "drop_tool_resources", model: body.model || "<from_prompt>" });
      setDebug({ lastRetryBody: { ...retry } });
      effectiveBody = retry;
      r = await client.responses.create(retry);
	    } else if (invalidTopLevelPrompt && body.prompt) {
	      // Retry without top-level prompt for regions that disallow it
	      const retry = { ...body };
	      try { delete retry.prompt; } catch {}
	      requestDebug.retry = { reason: 'drop_prompt_top_level' };
	      logLine({ event: 'openai_retry', reason: 'drop_prompt_top_level', model: body.model || '<from_prompt>' });
	      setDebug({ lastRetryBody: { ...retry } });
	      effectiveBody = retry;
	      r = await client.responses.create(retry);
	    } else if (unknownMetadata && body.metadata) {
	      const retry = { ...body };
	      try { delete retry.metadata; } catch {}
	      requestDebug.retry = { reason: 'drop_metadata' };
	      logLine({ event: 'openai_retry', reason: 'drop_metadata', model: body.model || '<from_prompt>' });
	      setDebug({ lastRetryBody: { ...retry } });
	      effectiveBody = retry;
	      r = await client.responses.create(retry);
	    } else if (missingVectorIds && Array.isArray(body.tools) && body.tools.some(t => t && t.type === 'file_search')) {
	      // Retry by dropping file_search when vector_store_ids are required but absent
	      const retry = { ...body, tools: (body.tools || []).filter(t => (t && t.type !== 'file_search')) };
	      try {
        if (retry.tool_resources && retry.tool_resources.file_search) delete retry.tool_resources.file_search;
        // If tool_resources becomes empty, drop it entirely
        if (retry.tool_resources && !Object.keys(retry.tool_resources).length) delete retry.tool_resources;
      } catch {}
      requestDebug.retry = { reason: 'drop_file_search_missing_vector_store_ids' };
      logLine({ event: 'openai_retry', reason: 'drop_file_search_missing_vector_store_ids', model: body.model || '<from_prompt>' });
      setDebug({ lastRetryBody: { ...retry } });
      effectiveBody = retry;
      r = await client.responses.create(retry);
    } else if (/Missing required parameter: 'tools\[[0-9]+\]\.container'/.test(msg) || /Missing required parameter: 'container'/.test(msg)) {
      // Retry by dropping code_interpreter when container is required but not provided
      if (Array.isArray(body.tools) && body.tools.some(t => t && t.type === 'code_interpreter')) {
        const retry = { ...body, tools: (body.tools || []).filter(t => (t && t.type !== 'code_interpreter')) };
        requestDebug.retry = { reason: 'drop_code_interpreter_missing_container' };
        logLine({ event: 'openai_retry', reason: 'drop_code_interpreter_missing_container', model: body.model || '<from_prompt>' });
        setDebug({ lastRetryBody: { ...retry } });
        effectiveBody = retry;
        r = await client.responses.create(retry);
      } else {
        logLine({ event: "openai_error", message: msg, status: e?.status || e?.statusCode || null, model: body.model || "<from_prompt>" });
        setDebug({ lastError: { message: msg, when: Date.now() } });
        throw e;
      }
    } else if ((() => { const lower = msg.toLowerCase(); return /http_5\d\d/.test(lower) || lower.includes('an error occurred while processing your request'); })() || ((body.model || '').toLowerCase().startsWith('gpt-5'))) {
      // Generic fallback for transient 5xx or GPT-5 family instability:
      // retry once with a stable model to avoid hard failure in UIs like Prompt tests.
      const fallbackModel = String(process.env.OPENAI_FALLBACK_MODEL || 'gpt-4o-mini');
      const retry = { ...body, model: fallbackModel };
      try {
        if (Array.isArray(retry.tools)) retry.tools = retry.tools.filter(t => t && t.type !== 'file_search');
        if (retry.tool_resources) delete retry.tool_resources;
      } catch {}
      requestDebug.retry = { reason: 'fallback_model', from: body.model || '<from_prompt>', to: fallbackModel };
      logLine({ event: 'openai_retry', reason: 'fallback_model', from: body.model || '<from_prompt>', to: fallbackModel });
      setDebug({ lastRetryBody: { ...retry } });
      effectiveBody = retry;
      r = await client.responses.create(retry);
    } else {
      logLine({ event: "openai_error", message: msg, status: e?.status || e?.statusCode || null, model: body.model || "<from_prompt>" });
      setDebug({ lastError: { message: msg, when: Date.now() } });
      throw e;
    }
  }
  const text = extractTextFromResponse(r);
  // Capture IDs for debugging
  try {
    const reqId = (r && r.response && r.response.headers && typeof r.response.headers.get === 'function') ? r.response.headers.get('x-request-id') : undefined;
    setDebug({ lastResponseId: r?.id || null, lastOpenAIRequestId: reqId || null });
  } catch {}

  logLine({
    event: "openai_response",
    id: r?.id || null,
    model: r?.model || null,
    text_len: (text || "").length,
    usage: r?.usage || undefined,
    status: "ok",
  });
  if (text) {
    const snippet = String(text).slice(0, 400);
    logLine({ event: "openai_response_text_snippet", snippet_len: snippet.length, snippet });
  }
  // Build simple transcript (seed -> user -> assistant)
  const conversation = [];
  try {
    if (Array.isArray(seedMessages)) {
      for (const m of seedMessages) {
        const role = (m && typeof m.role === 'string' && m.role) || 'user';
        const content = (m && typeof m.content === 'string') ? m.content : '';
        if (String(content).trim()) conversation.push({ role, content });
      }
    }
    const userText = `${input ?? ''}`;
    if (String(userText).trim()) conversation.push({ role: 'user', content: userText });
    // Attempt to include tool calls detected in final response (when present)
    try {
      const calls = extractToolCalls(r) || [];
      for (const call of calls) {
        conversation.push({ role: 'assistant', tool_call: { name: call.name, arguments: call.arguments || {} } });
      }
    } catch {}
    if (String(text).trim()) conversation.push({ role: 'assistant', content: text });
  } catch {}
  let openai_request_id = undefined;
  try { if (r && r.response && r.response.headers && typeof r.response.headers.get === 'function') openai_request_id = r.response.headers.get('x-request-id'); } catch {}
  return { text, raw: r, request: requestDebug, request_body: effectiveBody, conversation, response_id: r?.id || null, openai_request_id };
}


// Helper: scan Responses output for tool_use calls in OpenAI Responses API
function extractToolCalls(resp) {
  try {
    const out = Array.isArray(resp?.output) ? resp.output : [];
    const calls = [];
    for (const part of out) {
      // Newer Responses API (tool_use inside content parts)
      const content = Array.isArray(part?.content) ? part.content : [];
      for (const c of content) {
        if (c?.type === 'tool_use' && c?.name) {
          calls.push({ id: c.id, name: c.name, arguments: c?.input || {} });
        }
      }
      // Function tools shape: top-level output items of type 'function_call'
      if (part?.type === 'function_call' && part?.name) {
        let argsObj = {};
        try { argsObj = part?.arguments ? JSON.parse(part.arguments) : {}; } catch { argsObj = {}; }
        const callId = part?.call_id || part?.id || undefined;
        calls.push({ id: callId, name: part.name, arguments: argsObj });
      }
    }
    return calls;
  } catch { return []; }
}

// Extended flow: include custom function-tools and resolve tool calls by callback
export async function respondWithPromptAndTools({
  apiKey,
  model,
  promptId,
  promptVersion,
  input,
  seedMessages,
  instructions,
  variables,
  responseFormat,
  textVerbosity,
  reasoningEffort,
  temperature,
  topP,
  organization,
  project,
  baseURL,
  functionTools = [],
  onToolCall,
  toolChoiceName,
}) {
  const client = createOpenAIClient({ apiKey, organization, project, baseURL });

  const tools = [...(functionTools || [])];

  const body = {
    tools: tools.length ? tools : undefined,
    tool_choice: tools.length ? (toolChoiceName ? { type: 'function', name: toolChoiceName } : 'auto') : undefined,
    text: responseFormat || textVerbosity
      ? {
          format: {
            type:
              String(responseFormat).toLowerCase() === "json" ||
              String(responseFormat).toLowerCase() === "json_object"
                ? "json"
                : "text",
          },
          ...(textVerbosity ? { verbosity: textVerbosity } : {}),
        }
      : undefined,
    reasoning: reasoningEffort ? { effort: reasoningEffort } : undefined,
  };
  if (maxOutputTokens != null && maxOutputTokens !== '') {
    const mot = Number(maxOutputTokens);
    if (Number.isFinite(mot) && mot > 0) body.max_output_tokens = mot;
  }
  // Track the effective initial body submitted to OpenAI
  let effectiveBody = body;
  // Always include a model, even when using a Prompt ID
  body.model = String(model || process.env.OPENAI_MODEL || "gpt-4o-mini");
  if (temperature != null) body.temperature = Number(temperature);
  if (topP != null) body.top_p = Number(topP);
  // Guard: many models reject reasoning.effort; allow only o3/gpt‑5 families
  try {
    const ml = (body.model || '').toLowerCase();
    const reasoningAllowed = /^o3\b/.test(ml) || /^gpt-5\b/.test(ml);
    if (!reasoningAllowed && body.reasoning) delete body.reasoning;
  } catch {}
  // Additional guardrails for GPT‑5: drop fields known to cause 5xx
  try {
    if ((body.model || '').toLowerCase().startsWith('gpt-5')) {
      if (body.prompt) delete body.prompt;
      if (Object.prototype.hasOwnProperty.call(body, 'temperature')) delete body.temperature;
      if (Object.prototype.hasOwnProperty.call(body, 'top_p')) delete body.top_p;
      if (Array.isArray(body.tools)) {
        // Ensure we don't include file_search here either
        body.tools = body.tools.filter((t) => t && t.type !== 'file_search');
        if (!body.tools.length) delete body.tools;
      }
    }
  } catch {}
  const hasSeed = Array.isArray(seedMessages) && seedMessages.length > 0;
  if (promptId) {
    body.prompt = { id: promptId };
    if (promptVersion) body.prompt.version = String(promptVersion);
    if (hasSeed) {
      const arr = [];
      for (const m of seedMessages) {
        const role = (m && typeof m.role === 'string' && m.role) || 'user';
        const content = (m && typeof m.content === 'string') ? m.content : '';
        arr.push({ role, content });
      }
      arr.push({ role: 'user', content: `${input ?? ''}` });
      body.input = arr;
    } else {
      body.input = `${input ?? ''}`;
    }
    if (instructions) body.instructions = String(instructions);
  } else {
    if (hasSeed) {
      const arr = [];
      for (const m of seedMessages) {
        const role = (m && typeof m.role === 'string' && m.role) || 'user';
        const content = (m && typeof m.content === 'string') ? m.content : '';
        arr.push({ role, content });
      }
      arr.push({ role: 'user', content: `${input ?? ''}` });
      body.input = arr;
    } else {
      body.input = `${input ?? ''}`;
    }
    if (instructions) body.instructions = String(instructions);
  }

  const requestDebug = buildRequestDebug(body, {
    promptId: promptId || null,
    promptVersion: promptVersion || null,
    functionTools: summarizeFunctionTools(functionTools),
  });

  const toolCallHistory = [];

  // Record last request
  setDebug({ lastRequestAt: Date.now(), lastRequestBody: { ...body } });

  let resp;
  try {
    resp = await client.responses.create(body);
  } catch (e) {
    const msg = String(e?.message || '');
    const unsupportedReasoning = msg.includes("Unsupported parameter: 'reasoning.effort'") || msg.includes('Unsupported parameter: "reasoning.effort"');
    const invalidTopLevelPrompt =
      msg.includes("Unknown parameter: 'prompt'") ||
      msg.includes('Unknown parameter: "prompt"') ||
      /prompt is not a valid top-level field/i.test(msg) ||
      /invalid parameter[^:]*: '?prompt'?/i.test(msg);
    if (unsupportedReasoning) {
      const retry = { ...body }; try { delete retry.reasoning; } catch {}
      setDebug({ lastRetryBody: { ...retry } });
      resp = await client.responses.create(retry);
    } else if (invalidTopLevelPrompt && body.prompt) {
      const retry = { ...body }; try { delete retry.prompt; } catch {}
      setDebug({ lastRetryBody: { ...retry } });
      resp = await client.responses.create(retry);
    } else { throw e; }
  }
  for (let iter = 0; iter < 4; iter++) {
    const calls = extractToolCalls(resp);
    if (!calls.length) break;
    const tool_outputs = [];
    for (const call of calls) {
      const callSummary = {
        id: call.id,
        name: call.name,
        arguments: call.arguments || {},
      };
      try {
        const result = onToolCall ? await onToolCall(call) : null;
        callSummary.output = result ?? null;
        tool_outputs.push({ tool_call_id: call.id, output: JSON.stringify(result ?? null) });
      } catch (e) {
        const message = String(e?.message || e);
        callSummary.error = message;
        tool_outputs.push({
          tool_call_id: call.id,
          output: JSON.stringify({ ok:false, error: message }),
        });
      }
      toolCallHistory.push(callSummary);
    }
    try {
      // Prefer the dedicated submitToolOutputs endpoint when available
      if (typeof client.responses.submitToolOutputs === 'function') {
        logLine({ event: 'openai_tool_continue_submit', tool_outputs_count: tool_outputs.length });
        setDebug({ lastContinue: { method: 'submitToolOutputs', response_id: resp.id, tool_outputs_count: tool_outputs.length, at: Date.now() } });
        resp = await client.responses.submitToolOutputs(resp.id, { tool_outputs });
      } else {
        const cont = { response_id: resp.id, tool_outputs, model: body.model || process.env.OPENAI_MODEL || 'gpt-4o-mini' };
        logLine({ event: 'openai_tool_continue_create', model: cont.model, tool_outputs_count: tool_outputs.length });
        setDebug({ lastContinue: { method: 'create', body: cont, at: Date.now() } });
        resp = await client.responses.create(cont);
      }
    } catch (e) {
      const msg = String(e?.message || "");
      const unsupportedReasoning = msg.includes("Unsupported parameter: 'reasoning.effort'") || msg.includes('Unsupported parameter: "reasoning.effort"');
      if (unsupportedReasoning) {
        const retry = { response_id: resp.id, tool_outputs };
        // No reasoning field in submitToolOutputs request, but guard just in case
        try { delete retry.reasoning; } catch {}
        if (typeof client.responses.submitToolOutputs === 'function') {
          setDebug({ lastContinue: { method: 'submitToolOutputs(retry)', response_id: resp.id, tool_outputs_count: tool_outputs.length, at: Date.now() } });
          resp = await client.responses.submitToolOutputs(resp.id, retry);
        } else {
          const cont2 = { ...retry, model: body.model || process.env.OPENAI_MODEL || 'gpt-4o-mini' };
          setDebug({ lastContinue: { method: 'create(retry)', body: cont2, at: Date.now() } });
          resp = await client.responses.create(cont2);
        }
      } else if (/Missing required parameter: 'input'/.test(msg)) {
        // Some regions require an 'input' field on create() continuation
        const cont3 = { response_id: resp.id, tool_outputs, model: body.model || process.env.OPENAI_MODEL || 'gpt-4o-mini', input: '' };
        setDebug({ lastContinue: { method: 'create(with_input)', body: cont3, at: Date.now() } });
        resp = await client.responses.create(cont3);
      } else if (/Unknown parameter: 'response_id'/.test(msg)) {
        // Compatibility: use raw HTTP endpoint /responses/{id}/tool_outputs
        try {
          const urlBase = (baseURL && String(baseURL).trim()) || 'https://api.openai.com/v1';
          const url = `${urlBase.replace(/\/$/, '')}/responses/${resp.id}/tool_outputs`;
          const r = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({ tool_outputs }),
          });
          if (!r.ok) throw new Error(`http_${r.status}`);
          setDebug({ lastContinue: { method: 'http_tool_outputs', response_id: resp.id, tool_outputs_count: tool_outputs.length, at: Date.now() } });
          resp = await r.json();
        } catch (e2) {
          setDebug({ lastError: { message: String(e2?.message || e2), when: Date.now() } });
          throw e2;
        }
      } else {
        setDebug({ lastError: { message: msg, when: Date.now() } });
        throw e;
      }
    }
    if (tool_outputs.length) {
      const snapshot = tool_outputs.map((entry) => ({
        tool_call_id: entry.tool_call_id,
        output: entry.output,
      }));
      requestDebug.tool_outputs = [
        ...(requestDebug.tool_outputs || []),
        ...snapshot,
      ];
    }
  }

  if (toolCallHistory.length) {
    requestDebug.tool_calls = toolCallHistory;
  }

  const text = extractTextFromResponse(resp);
  // Capture IDs for debugging
  try {
    const reqId = (resp && resp.response && resp.response.headers && typeof resp.response.headers.get === 'function') ? resp.response.headers.get('x-request-id') : undefined;
    setDebug({ lastResponseId: resp?.id || null, lastOpenAIRequestId: reqId || null });
  } catch {}
  // Build transcript including tool calls and outputs
  const conversation = [];
  try {
    if (Array.isArray(seedMessages)) {
      for (const m of seedMessages) {
        const role = (m && typeof m.role === 'string' && m.role) || 'user';
        const content = (m && typeof m.content === 'string') ? m.content : '';
        if (String(content).trim()) conversation.push({ role, content });
      }
    }
    const userText = `${input ?? ''}`;
    if (String(userText).trim()) conversation.push({ role: 'user', content: userText });
    if (Array.isArray(toolCallHistory) && toolCallHistory.length) {
      for (const call of toolCallHistory) {
        conversation.push({ role: 'assistant', tool_call: { name: call.name, arguments: call.arguments || {} } });
        if (Object.prototype.hasOwnProperty.call(call, 'error')) {
          conversation.push({ role: 'tool', tool_result: { name: call.name, error: String(call.error || '') } });
        } else {
          conversation.push({ role: 'tool', tool_result: { name: call.name, output: call.output ?? null } });
        }
      }
    }
    if (String(text).trim()) conversation.push({ role: 'assistant', content: text });
  } catch {}
  let openai_request_id2 = undefined;
  try { if (resp && resp.response && resp.response.headers && typeof resp.response.headers.get === 'function') openai_request_id2 = resp.response.headers.get('x-request-id'); } catch {}
  return { text, raw: resp, request: requestDebug, request_body: effectiveBody, conversation, response_id: resp?.id || null, openai_request_id: openai_request_id2 };
}

