import OpenAI from "openai";
import fs from "fs";
import path from "path";

function logLine(obj) {
  try {
    const line = `[${new Date().toISOString()}] ${JSON.stringify(obj)}\n`;
    const logPath = path.resolve(process.cwd(), "chat.log");
    fs.appendFileSync(logPath, line);
  } catch {}
}

export function createOpenAIClient({
  apiKey,
  organization,
  project,
  baseURL,
} = {}) {
  const key = apiKey || process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY missing");
  return new OpenAI({
    apiKey: key,
    organization: organization || process.env.OPENAI_ORG || undefined,
    project: project || process.env.OPENAI_PROJECT || undefined,
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

export async function respondWithPrompt({
  apiKey,
  model,
  promptId,
  promptVersion,
  input,
  instructions,
  toolsFileSearch,
  toolsCodeInterpreter,
  vectorStoreId,
  webSearchEnabled,
  webSearchAllowedDomains,
  webSearchContextSize,
  variables, // reserved for future prompt-variables support
  responseFormat,
  textVerbosity,
  reasoningEffort,
  temperature,
  topP,
  organization,
  project,
  baseURL,
}) {
  const client = createOpenAIClient({ apiKey, organization, project, baseURL });

  const tools = [];
  if (toolsCodeInterpreter) tools.push({ type: "code_interpreter" });
  if (toolsFileSearch) tools.push({ type: "file_search" });
  // Web search: only include for models that support it; avoid unsupported 'filters' on some models
  const m = (model || process.env.OPENAI_MODEL || "gpt-4o-mini").toLowerCase();
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
      // fallback: add web_search without unsupported filters for non-gpt-5 models
      tools.push({ type: "web_search" });
    }
  }

  const tool_resources = {};
  if (toolsFileSearch && vectorStoreId) {
    tool_resources.file_search = { vector_store_ids: [vectorStoreId] };
  }

  // Map legacy response_format to Responses API `text.format`
  let textBlock = undefined;
  if (responseFormat || textVerbosity) {
    const fmt = String(responseFormat).toLowerCase();
    const type = fmt === "json_object" || fmt === "json" ? "json" : "text";
    textBlock = { format: { type } };
    if (textVerbosity) textBlock.verbosity = textVerbosity; // e.g., 'medium'
  }

  const body = {
    tools: tools.length ? tools : undefined,
    tool_resources: Object.keys(tool_resources).length
      ? tool_resources
      : undefined,
    text: textBlock,
    reasoning: reasoningEffort ? { effort: reasoningEffort } : undefined,
  };
  // Only set model explicitly if caller provided it or when not using a Prompt
  // (so we don't override the model defined inside the Prompt)
  if (model) body.model = model;
  if (temperature != null) body.temperature = Number(temperature);
  if (topP != null) body.top_p = Number(topP);

  if (promptId) {
    body.prompt = { id: promptId };
    if (promptVersion) body.prompt.version = String(promptVersion);
    body.input = `${input ?? ""}`;
    // TODO: when Prompt variables are used, map `variables` into the request as required by the prompt definition.
  } else {
    body.input = `${input ?? ""}`;
    if (instructions) body.instructions = String(instructions);
    if (!body.model) body.model = process.env.OPENAI_MODEL || "gpt-5";
  }

  // Log outgoing (sanitized)
  logLine({
    event: "openai_request",
    prompt_id: promptId || null,
    prompt_version: promptVersion || null,
    model: body.model || "<from_prompt>",
    input_len: (body.input || "").length,
    tools: (tools || []).map((t) => t.type),
    vector_store_id: vectorStoreId || null,
    web_search_enabled: !!webSearchEnabled,
    web_search_domains: Array.isArray(webSearchAllowedDomains)
      ? webSearchAllowedDomains
      : undefined,
    text_format: body.text?.format?.type || undefined,
    text_verbosity: body.text?.verbosity || undefined,
    reasoning_effort: body.reasoning?.effort || undefined,
  });

  let r;
  try {
    r = await client.responses.create(body);
  } catch (e) {
    const msg = String(e?.message || "");
    const unsupportedTemp = msg.includes("Unsupported parameter: 'temperature'") || msg.includes("Unsupported parameter: \"temperature\"");
    const unsupportedTopP = msg.includes("Unsupported parameter: 'top_p'") || msg.includes("Unsupported parameter: \"top_p\"");
    if ((unsupportedTemp || unsupportedTopP) && (body.temperature != null || body.top_p != null)) {
      // Retry once without temperature/top_p for models that don't support them
      const retry = { ...body };
      delete retry.temperature;
      delete retry.top_p;
      logLine({ event: "openai_retry", reason: "drop_temperature_top_p", model: body.model || "<from_prompt>" });
      r = await client.responses.create(retry);
    } else {
      // Log error and rethrow
      logLine({ event: "openai_error", message: msg, model: body.model || "<from_prompt>" });
      throw e;
    }
  }
  const text = extractTextFromResponse(r);

  // Log incoming summary
  logLine({
    event: "openai_response",
    id: r?.id || null,
    model: r?.model || null,
    text_len: (text || "").length,
    usage: r?.usage || undefined,
    status: "ok",
  });
  return { text, raw: r };
}
