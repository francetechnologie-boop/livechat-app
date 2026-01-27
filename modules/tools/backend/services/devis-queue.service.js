import { createOpenAIClient, respondWithPrompt } from '../../../../backend/lib/openaiResponses.js';
import { recordPromptConfigHistory } from '../../../../backend/lib/promptConfigHistory.js';

const DEFAULT_MODEL = process.env.DEVIS_EXTRACTION_MODEL || process.env.OPENAI_EXTRACTION_MODEL || 'gpt-4o-mini';
const MAX_BODY_LENGTH = Math.max(2000, Number(process.env.DEVIS_QUEUE_BODY_LIMIT || 20000));

const noopLog = () => {};

function safeString(value) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function trimTo(value, max = MAX_BODY_LENGTH) {
  const str = safeString(value);
  if (!max || str.length <= max) return str;
  return str.slice(0, max);
}

function stripHtml(value = '') {
  try {
    const text = String(value || '');
    return text.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ');
  } catch {
    return safeString(value);
  }
}

function parseAddress(raw = '') {
  const text = safeString(raw).trim();
  if (!text) return { email: '', name: '' };
  const match = text.match(/^(.*?)(?:<([^>]+)>)$/);
  if (match) {
    const name = safeString(match[1]).replace(/["']/g, '').trim();
    const email = safeString(match[2]).trim();
    return { email, name };
  }
  if (text.includes('@')) return { email: text, name: '' };
  return { email: '', name: text };
}

function splitName(fullName = '') {
  const trimmed = safeString(fullName).trim();
  if (!trimmed) return { first: '', last: '' };
  const parts = trimmed.split(/\s+/);
  const first = parts.shift() || '';
  const last = parts.join(' ');
  return { first, last };
}

function guessLanguage(text = '') {
  const lower = safeString(text).toLowerCase();
  if (/bonjour|cordialement|merci|piscine|devis/.test(lower)) return 'fr';
  if (/hello|hi |regards|thank you|thanks/.test(lower)) return 'en';
  return '';
}

function extractPhone(text = '') {
  const match = safeString(text).match(/(\+?\d[\d .-]{7,})/);
  return match ? match[1].trim() : '';
}

async function resolveOpenaiKey(ctx) {
  const envKey = safeString(process.env.OPENAI_API_KEY).trim();
  if (envKey) return envKey;
  if (typeof ctx?.getSetting === 'function') {
    try {
      const key = await ctx.getSetting('OPENAI_API_KEY');
      if (key) return safeString(key).trim();
    } catch {}
  }
  return '';
}

function normalizeExtractionFields(raw = {}) {
  const clean = (value) => {
    const v = safeString(value).trim();
    return v || '';
  };
  return {
    customer_email: clean(raw.customer_email || raw.email || raw.to_email),
    customer_first_name: clean(raw.customer_first_name || raw.first_name || raw.firstname),
    customer_last_name: clean(raw.customer_last_name || raw.last_name || raw.lastname),
    customer_language: clean(raw.customer_language || raw.language || raw.lang),
    customer_company: clean(raw.customer_company || raw.company || raw.organization),
    customer_phone: clean(raw.customer_phone || raw.phone || raw.tel),
  };
}

function mergeFields(base = {}, extra = {}) {
  const merged = { ...base };
  Object.entries(extra || {}).forEach(([key, value]) => {
    const v = safeString(value).trim();
    if (v) merged[key] = v;
  });
  return merged;
}

async function loadPromptConfig(pool, promptConfigId, orgId) {
  if (!promptConfigId || !pool) return null;
  const args = [promptConfigId];
  let whereOrg = 'AND org_id IS NULL';
  if (orgId != null) {
    args.push(orgId);
    whereOrg = 'AND (org_id IS NULL OR org_id = $2)';
  }
  const sql = `
    SELECT id, org_id, name, prompt_id, prompt_version, model
      FROM mod_automation_suite_prompt_config
     WHERE id = $1
       ${whereOrg}
     LIMIT 1
  `;
  const res = await pool.query(sql, args);
  return res.rowCount ? res.rows[0] : null;
}

function parseJsonObject(text = '') {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function extractWithPrompt(
  { subject, fromLine, toLine, snippet, body, requestPreview },
  ctx,
  chatLog = noopLog,
  promptOpts = {},
  historyCtx = {}
) {
  const promptId = safeString(promptOpts.promptId).trim();
  if (!promptId) return null;
  try {
    const inputPayload = {
      subject: subject || '',
      from: fromLine || '',
      to: toLine || '',
      snippet: snippet || '',
      body: trimTo(body, 8000) || '',
      instructions: 'Extract lead/contact info to prepare a sales quote. Return JSON only.',
    };
    const t0 = Date.now();
    const { text, request, request_body, raw } = await respondWithPrompt({
      promptId,
      promptVersion: promptOpts.promptVersion ? String(promptOpts.promptVersion) : undefined,
      model: promptOpts.model || process.env.DEVIS_EXTRACTION_MODEL || process.env.OPENAI_EXTRACTION_MODEL || 'gpt-4o-mini',
      input: JSON.stringify(inputPayload),
      responseFormat: 'json_object',
      instructions: 'Return a JSON object with fields customer_email, customer_first_name, customer_last_name, customer_language, customer_company, customer_phone. Use empty strings if unknown.',
    });
    const ms = Date.now() - t0;
    const promptConfigId = safeString(historyCtx?.promptConfigId).trim();
    if (promptConfigId) {
      try {
        await recordPromptConfigHistory(historyCtx?.pool, {
          promptConfigId,
          input: JSON.stringify(inputPayload),
          output: String(text || ''),
          requestBody: request_body || null,
          response: raw || null,
          ms,
        });
      } catch {}
    }
    const parsed = parseJsonObject(text || '{}');
    const normalized = normalizeExtractionFields(parsed || {});
    chatLog('devis_queue_prompt_used', { prompt_id: promptId, prompt_version: promptOpts.promptVersion || null });
    return {
      fields: normalized,
      model: promptOpts.model,
      raw: parsed,
      request,
      request_preview: requestPreview || inputPayload,
    };
  } catch (error) {
    const msg = safeString(error?.message || error).slice(0, 200);
    chatLog('devis_queue_prompt_error', { prompt_id: promptId, message: msg });
    // Propagate so callers can stop and surface the failure (no fallback)
    throw new Error(`prompt_failed: ${msg}`);
  }
}

async function extractWithOpenAI({ subject, fromLine, toLine, body }, ctx, chatLog = noopLog) {
  try {
    const apiKey = await resolveOpenaiKey(ctx);
    if (!apiKey && !safeString(process.env.OPENAI_API_KEY).trim()) return null;
    const client = createOpenAIClient({ apiKey });
    const content = trimTo(body, 8000);
    const prompt = [
      { role: 'system', content: 'You extract lead details from emails to create sales quotes. Respond with JSON and keep unknown fields empty strings.' },
      {
        role: 'user',
        content: [
          `Subject: ${subject || ''}`,
          `From: ${fromLine || ''}`,
          `To: ${toLine || ''}`,
          '',
          'Email content:',
          content || '(empty body)',
        ].join('\n'),
      },
    ];
    const completion = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: prompt,
    });
    const raw = completion?.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(raw);
    const normalized = normalizeExtractionFields(parsed);
    return { fields: normalized, model: DEFAULT_MODEL, raw: parsed };
  } catch (error) {
    chatLog('devis_queue_llm_error', { message: safeString(error?.message || error).slice(0, 200) });
    return null;
  }
}

export async function queueEmailForDevis({ pool, payload = {}, orgId = null, chatLog = noopLog, ctx = {} }) {
  if (!pool) throw new Error('db_unavailable');
  const messageId = safeString(payload.messageId || payload.id).trim();
  const threadId = safeString(payload.threadId || payload.thread_id).trim();
  const subject = trimTo(payload.subject, 1024);
  const fromLine = safeString(payload.from || payload.from_email).trim();
  const toLine = safeString(payload.to || payload.to_email).trim();
  const snippet = trimTo(payload.snippet || payload.body_snippet || '');
  const bodyText = trimTo(payload.body_text || payload.bodyText || payload.text || payload.snippet || '');
  const bodyHtmlRaw = trimTo(payload.body_html || payload.bodyHtml || '', MAX_BODY_LENGTH);
  const promptConfigId = safeString(payload.promptConfigId || payload.prompt_config_id).trim();
  const promptId = safeString(
    payload.promptId ||
      payload.prompt_id ||
      process.env.DEVIS_QUEUE_PROMPT_ID ||
      process.env.DEVIS_PROMPT_ID
  ).trim();
  const promptVersion = safeString(
    payload.promptVersion || payload.prompt_version || process.env.DEVIS_QUEUE_PROMPT_VERSION
  ).trim();
  const promptModel = safeString(payload.promptModel || payload.prompt_model || '').trim() || undefined;
  const promptOpts = {
    promptId,
    promptVersion: promptVersion || undefined,
    model: promptModel,
  };
  const promptConfig = promptConfigId ? await loadPromptConfig(pool, promptConfigId, orgId) : null;
  if (promptConfig) {
    if (!promptOpts.promptId && promptConfig.prompt_id) promptOpts.promptId = promptConfig.prompt_id;
    if (!promptOpts.promptVersion && promptConfig.prompt_version) promptOpts.promptVersion = promptConfig.prompt_version;
    if (!promptOpts.model && promptConfig.model) promptOpts.model = promptConfig.model;
  }
  const promptIdEffective = promptOpts.promptId || null;
  const promptVersionEffective = promptOpts.promptVersion || null;
  const wantPrompt = Boolean(promptConfigId || promptIdEffective);
  if (wantPrompt && !promptIdEffective) {
    throw new Error('prompt_missing_for_config');
  }
  if (!messageId) throw new Error('message_id_required');
  const fromParsed = parseAddress(fromLine);
  const toParsed = parseAddress(toLine);
  const { first: baseFirst, last: baseLast } = splitName(fromParsed.name);
  const bodyForModel = bodyText || stripHtml(bodyHtmlRaw) || '';
  const heuristicFields = {
    customer_email: fromParsed.email || toParsed.email || '',
    customer_first_name: baseFirst,
    customer_last_name: baseLast,
    customer_language: guessLanguage(bodyText || subject),
    customer_company: '',
    customer_phone: extractPhone(bodyText),
  };
  const promptExtraction = await extractWithPrompt(
    { subject, fromLine, toLine, snippet, body: bodyForModel, requestPreview: payload.request_preview },
    ctx,
    chatLog || noopLog,
    promptOpts,
    { pool, promptConfigId: promptConfig?.id || promptConfigId || null }
  );
  if (wantPrompt && !promptExtraction) {
    throw new Error('prompt_extraction_failed');
  }
  const llmFallback = wantPrompt
    ? null
    : await extractWithOpenAI({ subject, fromLine, toLine, body: bodyForModel }, ctx, chatLog || noopLog);
  const chosen = promptExtraction || llmFallback || null;
  const merged = mergeFields(heuristicFields, chosen?.fields || {});
  const extraction = {
    heuristics: heuristicFields,
    prompt: promptExtraction
      ? {
          fields: promptExtraction.fields,
          model: promptExtraction.model || promptOpts.model || null,
          prompt_id: promptIdEffective,
          prompt_version: promptVersionEffective,
          prompt_config_id: promptConfig?.id || null,
          request: promptExtraction.request || null,
          request_preview: promptExtraction.request_preview || null,
        }
      : null,
    llm: llmFallback ? { fields: llmFallback.fields, model: llmFallback.model || null } : null,
    model: chosen?.model || promptOpts.model || null,
    applied: merged,
  };
  const customerEmail = merged.customer_email || fromParsed.email || toParsed.email || '';
  const customerNames = splitName(`${merged.customer_first_name} ${merged.customer_last_name}`.trim());
  const values = [
    orgId,
    messageId,
    threadId || null,
    subject,
    fromParsed.email || null,
    fromParsed.name || null,
    toParsed.email || null,
    customerEmail || null,
    customerNames.first || null,
    customerNames.last || null,
    merged.customer_language || null,
    merged.customer_company || null,
    merged.customer_phone || null,
    snippet || trimTo(bodyText, 240),
    bodyText || null,
    bodyHtmlRaw || null,
    JSON.stringify(extraction),
    'queued',
  ];
  const result = await pool.query(
    `
    INSERT INTO mod_tools_devis_queue (
      org_id, message_id, thread_id, subject, from_email, from_name, to_email,
      customer_email, customer_first_name, customer_last_name, customer_language,
      customer_company, customer_phone, body_snippet, body_text, body_html,
      extraction, status, created_at, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,
      $8,$9,$10,$11,
      $12,$13,$14,$15,$16,
      $17,$18,NOW(),NOW()
    )
    ON CONFLICT (message_id)
    DO UPDATE SET
      org_id = COALESCE(EXCLUDED.org_id, mod_tools_devis_queue.org_id),
      thread_id = COALESCE(EXCLUDED.thread_id, mod_tools_devis_queue.thread_id),
      subject = EXCLUDED.subject,
      from_email = EXCLUDED.from_email,
      from_name = EXCLUDED.from_name,
      to_email = COALESCE(NULLIF(EXCLUDED.to_email, ''), mod_tools_devis_queue.to_email),
      customer_email = COALESCE(NULLIF(EXCLUDED.customer_email, ''), mod_tools_devis_queue.customer_email),
      customer_first_name = COALESCE(NULLIF(EXCLUDED.customer_first_name, ''), mod_tools_devis_queue.customer_first_name),
      customer_last_name = COALESCE(NULLIF(EXCLUDED.customer_last_name, ''), mod_tools_devis_queue.customer_last_name),
      customer_language = COALESCE(NULLIF(EXCLUDED.customer_language, ''), mod_tools_devis_queue.customer_language),
      customer_company = COALESCE(NULLIF(EXCLUDED.customer_company, ''), mod_tools_devis_queue.customer_company),
      customer_phone = COALESCE(NULLIF(EXCLUDED.customer_phone, ''), mod_tools_devis_queue.customer_phone),
      body_snippet = EXCLUDED.body_snippet,
      body_text = EXCLUDED.body_text,
      body_html = EXCLUDED.body_html,
      extraction = EXCLUDED.extraction,
      status = EXCLUDED.status,
      updated_at = NOW()
    RETURNING *
    `,
    values
  );
  const row = result.rows?.[0] || null;
  chatLog('devis_queue_added', {
    message_id: messageId,
    org_id: orgId || null,
    used_prompt: wantPrompt,
    used_llm: Boolean(llmFallback),
    prompt_id: promptIdEffective,
    prompt_version: promptVersionEffective,
    prompt_config_id: promptConfig?.id || null,
  });
  return { item: row, extraction };
}
