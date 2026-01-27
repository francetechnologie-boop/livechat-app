import { respondWithPrompt } from '../../../../backend/lib/openaiResponses.js';
import { recordPromptConfigHistory } from '../../../../backend/lib/promptConfigHistory.js';
import { createDraft } from '../../../google-api/backend/services/gmail.service.js';

function requireAdminGuard(ctx) {
  if (typeof ctx?.requireAdmin === 'function') return ctx.requireAdmin;
  return () => true;
}

function pickOrgId(req) {
  try {
    const raw = req.headers['x-org-id'] || req.query?.org_id || req.body?.org_id;
    if (!raw) return null;
    const trimmed = String(raw).trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

function toOrgInt(orgId) {
  try {
    if (orgId === null || orgId === undefined) return null;
    const s = String(orgId).trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

async function resolveOpenAiApiKey(ctx) {
  try {
    const env = String(process.env.OPENAI_API_KEY || '').trim();
    if (env) return env;
  } catch {}
  try {
    if (typeof ctx?.getSetting !== 'function') return '';
    const fromSettings = await ctx.getSetting('OPENAI_API_KEY');
    return String(fromSettings || '').trim();
  } catch {
    return '';
  }
}

function normalizeLang(value) {
  const s = String(value || '').trim();
  return s || null;
}

async function loadPromptConfigById(pool, { promptConfigId, orgId }) {
  const id = String(promptConfigId || '').trim();
  if (!pool || typeof pool.query !== 'function' || !id) return null;
  const orgInt = toOrgInt(orgId);
  const r = await pool.query(
    `
      SELECT id, org_id, name, prompt_id, prompt_version, model, openai_api_key
        FROM mod_automation_suite_prompt_config
       WHERE id = $1
         AND ( ($2::int IS NULL AND org_id IS NULL) OR (org_id = $2::int) OR (org_id IS NULL) )
       LIMIT 1
    `,
    [id, orgInt]
  );
  return r.rows?.[0] || null;
}

export function registerToolsEmailTemplateCreatorRoutes(app, ctx = {}) {
  const requireAdmin = requireAdminGuard(ctx);
  const chatLog = typeof ctx?.chatLog === 'function' ? ctx.chatLog : () => {};
  const pool = ctx.pool;

  // POST /api/tools/email-template/translate
  // Body: { subject?, html_body?, from_lang?, to_lang, prompt_config_id? }
  app.post('/api/tools/email-template/translate', async (req, res) => {
    if (!requireAdmin(req, res)) return;

    const body = req.body || {};
    const subject = String(body.subject ?? '');
    const htmlBody = String(body.html_body ?? body.htmlBody ?? body.html ?? '');
    const fromLang = normalizeLang(body.from_lang ?? body.fromLang);
    const toLang = normalizeLang(body.to_lang ?? body.toLang);
    const promptConfigId = String(body.prompt_config_id || body.promptConfigId || '').trim();
    const orgId = pickOrgId(req);

    if (!toLang) {
      return res.status(400).json({ ok: false, error: 'missing_to_lang', message: 'to_lang is required' });
    }
    if (!String(subject || '').trim() && !String(htmlBody || '').trim()) {
      return res.status(400).json({ ok: false, error: 'missing_content', message: 'subject or html_body is required' });
    }
    if (!promptConfigId) {
      return res.status(400).json({ ok: false, error: 'missing_prompt_config_id', message: 'prompt_config_id is required' });
    }

    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });

    const cfg = await loadPromptConfigById(pool, { promptConfigId, orgId });
    if (!cfg) return res.status(404).json({ ok: false, error: 'prompt_config_not_found' });
    const promptId = String(cfg.prompt_id || '').trim();
    if (!promptId) return res.status(400).json({ ok: false, error: 'prompt_id_missing', message: 'prompt_id is missing on this prompt config' });
    const model = String(cfg.model || process.env.OPENAI_TRANSLATE_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();

    const apiKey = String(cfg.openai_api_key || '').trim() || (await resolveOpenAiApiKey(ctx));
    if (!apiKey) {
      return res.status(400).json({
        ok: false,
        error: 'missing_api_key',
        message: 'OPENAI_API_KEY is missing (set env or Settings).',
      });
    }

    const inputPayload = {
      subject,
      html_body: htmlBody,
      from_lang: fromLang,
      to_lang: toLang,
    };

    const t0 = Date.now();
    chatLog('tools_email_template_translate_start', {
      model,
      from_lang: fromLang,
      to_lang: toLang,
      prompt_config_id: promptConfigId,
      prompt_id: promptId,
      has_subject: !!String(subject || '').trim(),
      has_html: !!String(htmlBody || '').trim(),
    });

    try {
      const out = await respondWithPrompt({
        apiKey,
        model,
        promptId,
        promptVersion: cfg.prompt_version ? String(cfg.prompt_version) : undefined,
        input: JSON.stringify(inputPayload),
        responseFormat: 'json_object',
        instructions:
          'Return JSON only. Translate the email template into the target language. Preserve ALL HTML tags and structure. Do not translate template variables/placeholders like {foo}, {{foo}}, %FOO%, {$foo}, or URLs/emails. Output: { "subject": string, "html_body": string }.',
      });
      const ms = Date.now() - t0;
      try {
        await recordPromptConfigHistory(pool, {
          promptConfigId: promptConfigId,
          input: JSON.stringify(inputPayload),
          output: String(out?.text || ''),
          requestBody: out?.request_body || null,
          response: out?.raw || null,
          ms,
        });
      } catch {}

      let parsed = {};
      try { parsed = JSON.parse(String(out?.text || '{}')); } catch { parsed = {}; }
      const outSubject = typeof parsed?.subject === 'string' ? parsed.subject : '';
      const outHtmlBody = typeof parsed?.html_body === 'string' ? parsed.html_body : (typeof parsed?.html === 'string' ? parsed.html : '');

      if (!String(outSubject || '').trim() && !String(outHtmlBody || '').trim()) {
        chatLog('tools_email_template_translate_invalid_output', { model, ms });
        return res.status(500).json({
          ok: false,
          error: 'prompt_invalid_output',
          message: 'Model output is not valid JSON with { subject, html_body }.',
        });
      }

      chatLog('tools_email_template_translate_done', { model, ms });
      return res.json({ ok: true, model, ms, prompt_config_id: promptConfigId, subject: outSubject, html_body: outHtmlBody });
    } catch (error) {
      const msg = String(error?.message || error);
      chatLog('tools_email_template_translate_error', { model, message: msg.slice(0, 240) });
      return res.status(500).json({ ok: false, error: 'translate_failed', message: msg });
    }
  });

  app.post('/api/tools/email-template/draft', async (req, res) => {
    if (!requireAdmin(req, res)) return;

    const body = req.body || {};
    const to = String(body.to || '').trim();
    const subject = String(body.subject || '').trim();
    const htmlBody = String(body.html_body ?? body.htmlBody ?? body.html ?? '').trim();
    const text = String(body.text || body.plain_text || '').trim();
    const from = String(body.from || body.from_email || '').trim();

    if (!to) {
      return res.status(400).json({ ok: false, error: 'missing_recipient', message: 'Recipient (to) is required' });
    }
    if (!subject && !htmlBody && !text) {
      return res
        .status(400)
        .json({ ok: false, error: 'missing_content', message: 'Provide subject, html_body, or text for the draft.' });
    }

    try {
      const draft = await createDraft({ ctx, to, subject, html: htmlBody, text, from });
      return res.json({ ok: true, draft: { id: draft?.id || '', threadId: draft?.message?.threadId || '' } });
    } catch (error) {
      const msg = String(error?.message || error);
      return res.status(500).json({ ok: false, error: 'draft_failed', message: msg });
    }
  });
}
