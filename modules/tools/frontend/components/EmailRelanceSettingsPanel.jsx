import React from 'react';
import EmailRelanceBankSettingsEditor from './EmailRelanceBankSettingsEditor.jsx';

const DEV_MESSAGE_NUMERO_MAISON_SMS = `You generate a delivery-address reminder SMS (house number missing) for a PrestaShop order.

Input is JSON with this shape:
{
  "client": { "name": string|null, "email": string|null },
  "lang": { "name": string|null, "iso_code": string|null, "id_lang": number|null },
  "shop": { "id_shop": number|null, "domain": string|null },
  "order": { "id_order": number|null, "reference": string|null },
  "delivery": {
    "country": string|null,
    "call_prefix": string|null,
    "phone": string|null,
    "phone_e164": string|null,
    "mobile": string|null,
    "mobile_e164": string|null
  },
  "requested": { "type": "numero_de_maison_sms" }
}

Rules:
- Output MUST be a single SMS text only (no JSON, no quotes, no markdown).
- Language: write in the customer language (prefer lang.iso_code, else lang.name).
- MUST start with "[<shop.domain>]" where shop.domain has no "www".
- MUST include the order reference (order.reference). If missing, use order.id_order.
- Ask the customer to provide their house number (numéro de maison) to complete the delivery address.
- Keep it short and actionable (<= 320 characters).`;

const DEV_MESSAGE_TRACKING = `You generate tracking notifications (SMS or email) for a PrestaShop order.

Input is JSON with this shape:
{
  "id_order": number|null,
  "client": { "name": string|null, "email": string|null },
  "lang": { "name": string|null, "iso_code": string|null, "id_lang": number|null },
  "shop": { "id_shop": number|null, "domain": string|null, "email": string|null },
  "order": { "id_order": number|null, "reference": string|null },
  "tracking": {
    "url": string|null,
    "number": string|null,
    "carrier": string|null
  },
  "requested": { "type": "tracking_sms" | "tracking_email" }
}

Tool flow (required):
- You MUST retrieve a real tracking URL using the available MCP2 tools.
- ALWAYS start by calling: psdb.chatlive.carrier.list with {"id_order": <id_order>, "limit": 5}.
  - The tool returns JSON as a string inside content[0].text. Parse it.
  - Extract carrier_name and reference/id_shop/id_lang if present.
- Then choose by carrier_name (case-insensitive):
  - If carrier_name contains "zasilkovna" or "zasilkovana" or "packeta":
    - Call: postgresql.get_tracking_external_url_by_recipient_name_recipient_surname_email_id_order_customer_email
      Args: {"id_order": "<id_order>", "limit": 5}
    - Parse content[0].text JSON and use rows[0].tracking_external_url if present, else rows[0].tracking_packeta_url.
  - If carrier_name contains "dhl":
    - Call: dhl.presta.order.track with {"id_order": <id_order>, "raw": 0}
    - Parse the result and extract a usable tracking URL.
    - If no URL is returned but tracking number is available, build:
      https://www.dhl.com/fr-fr/home/tracking/tracking-express.html?tracking-id=<TRACKING_NUMBER>
- If a tool call fails or returns no rows, try the next-best available tool, but NEVER invent a tracking URL.

Writing rules:
- Language: write ONLY in the customer language (prefer lang.iso_code, else lang.name). No bilingual words.
- Shop prefix: include "[<shop.domain>]" at the start (domain without www) in subject/SMS when shop.domain exists.
- Always include the order reference (order.reference). If missing, use id_order.
- Always include the resolved tracking URL exactly once.

Output rules:
- If requested.type = "tracking_sms": output MUST be a single SMS text only (no JSON, no quotes, no markdown), <= 320 chars.
- If requested.type = "tracking_email": output MUST be a JSON object with keys: subject (string), html (string), text (string). HTML must be a clean email body (no markdown). Do NOT add signature/contact details.`;

const DEV_MESSAGE_VIREMENT_EMAIL = `You generate a bank transfer (wire) payment reminder email for a PrestaShop order.

Input is JSON with this shape:
{
  "client": { "name": string|null, "email": string|null },
  "lang": { "name": string|null, "iso_code": string|null, "id_lang": number|null },
  "shop": { "id_shop": number|null, "domain": string|null, "email": string|null },
  "order": {
    "id_order": number|null,
    "reference": string|null,
    "total_paid_tax_incl": number|null,
    "currency_iso": string|null
  },
  "bank_wire": { "i18n_seed": { "labels_fr": object, "values": object } },
  "signature": { "block_text": string|null, "block_html": string|null },
  "requested": { "type": "virement_bancaire" }
}

Rules:
- Output MUST be a JSON object with keys: subject (string), html (string), text (string), and optionally bank_wire_html (string), bank_wire_text (string), bank_country_translated (string).
- Subject MUST start with "[<shop.domain>]" (domain without www) and include the order reference.
- Language: write ONLY in the customer language from lang.iso_code (treat gb as en). No bilingual terms.
- IMPORTANT: Do NOT include the bank wire section nor the signature inside html/text; return bank_wire_html/bank_wire_text separately.`;

const DEV_MESSAGE_VIREMENT_SUBJECT = `You generate ONLY an email subject line for a bank transfer (wire) payment reminder.

Rules:
- Output MUST be a single subject line only (no JSON, no quotes, no markdown).
- Subject MUST start with "[<shop.domain>]" (domain without www) and include the order reference.`;

const DEV_MESSAGE_NUMERO_TELEPHONE = `You generate a delivery-address follow-up message requesting a missing phone number for a PrestaShop order.

Rules:
- If requested.type = "numero_telephone_sms": output MUST be a single SMS text only (no JSON, no quotes, no markdown), <= 320 chars.
- Language: write ONLY in the customer language (prefer lang.iso_code).
- MUST start with "[<shop.domain>]" (domain without www) and include the order reference.`;

function Field({ label, children, hint }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-gray-500 mb-1">{label}</div>
      {children}
      {hint ? <div className="text-[11px] text-gray-400 mt-1">{hint}</div> : null}
    </div>
  );
}

function Section({ title, children, right }) {
  return (
    <div className="border rounded bg-white p-3">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="text-xs uppercase tracking-wide text-gray-500">{title}</div>
        {right || null}
      </div>
      {children}
    </div>
  );
}

function PromptSelect({ value, onChange, promptConfigs, filterText }) {
  const f = String(filterText || '').trim().toLowerCase();
  const list = Array.isArray(promptConfigs) ? promptConfigs : [];
  const filtered = !f
    ? list
    : list.filter((p) => String(p?.name || '').toLowerCase().includes(f) || String(p?.id || '').toLowerCase().includes(f));
  return (
    <select className="w-full rounded border px-2 py-1 text-sm bg-white" value={value || ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">(Aucun)</option>
      {filtered.map((p) => (
        <option key={String(p.id)} value={String(p.id)}>
          {String(p.name || p.id)} ({String(p.id)})
        </option>
      ))}
    </select>
  );
}

async function copyToClipboard(text) {
  const value = String(text || '');
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {}
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', 'readonly');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return !!ok;
  } catch {
    return false;
  }
}

function parseMcp2NameFromUrl(url) {
  try {
    const u = new URL(String(url || '').trim());
    const m = String(u.pathname || '').match(/\/api\/mcp2\/([^/]+)(?:\/|$)/i);
    return m && m[1] ? decodeURIComponent(m[1]) : null;
  } catch {
    try {
      const s = String(url || '').trim();
      const m = s.match(/\/api\/mcp2\/([^/]+)(?:\/|$)/i);
      return m && m[1] ? decodeURIComponent(m[1]) : null;
    } catch {
      return null;
    }
  }
}

function extractMcp2ServerRefsFromPromptTools(toolsValue) {
  try {
    const tools = Array.isArray(toolsValue) ? toolsValue : [];
    const refs = [];
    for (const t of tools) {
      const o = t && typeof t === 'object' && !Array.isArray(t) ? t : null;
      if (!o) continue;
      if (String(o.type || '').toLowerCase() !== 'mcp') continue;
      const label = String(o.server_label || '').trim();
      const url = String(o.server_url || '').trim();
      const fromUrl = url ? parseMcp2NameFromUrl(url) : null;
      for (const r of [label, fromUrl]) {
        const v = String(r || '').trim();
        if (v) refs.push(v);
      }
    }
    return Array.from(new Set(refs));
  } catch {
    return [];
  }
}

export default function EmailRelanceSettingsPanel({
  settings,
  setSettings,
  settingsFilter,
  setSettingsFilter,
  promptConfigs,
  mcp2Servers,
  listsLoading,
  listsError,
  settingsLoading,
  settingsSaving,
  settingsError,
  signatureUpdating,
  signatureUpdateMsg,
  onUpdateSignatureCache,
  onReloadSettings,
  onSaveSettings,
  onReloadLists,
}) {
  const selectedTrackingPrompt =
    (Array.isArray(promptConfigs) ? promptConfigs : []).find(
      (p) => String(p?.id || '') === String(settings?.tracking_prompt_config_id || '')
    ) || null;
  const promptMcpRefs = extractMcp2ServerRefsFromPromptTools(selectedTrackingPrompt?.tools);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-gray-700">
          Paramètres EmailRelance (persistés serveur).
          <a className="ml-2 text-blue-700 hover:underline" href="#/automation-suite/prompts">
            Ouvrir Automation Suite
          </a>
          <a className="ml-2 text-blue-700 hover:underline" href="#/mcp2">
            Ouvrir MCP2
          </a>
        </div>
        <div className="flex items-center gap-2">
          {onUpdateSignatureCache ? (
            <button
              type="button"
              className="text-xs px-2 py-1 rounded border bg-amber-600 text-white hover:bg-amber-700"
              onClick={onUpdateSignatureCache}
              disabled={!!(settingsLoading || settingsSaving || signatureUpdating)}
              title="Recalcule et met en cache les signatures (logo+tel+email+site) par id_shop/lang pour accelerer la generation."
            >
              {signatureUpdating ? 'Mise a jour signature...' : 'Update signature'}
            </button>
          ) : null}
          <button
            type="button"
            className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
            onClick={onReloadSettings}
            disabled={settingsLoading || settingsSaving}
          >
            {settingsLoading ? 'Chargement…' : 'Recharger'}
          </button>
          <button
            type="button"
            className="text-xs px-2 py-1 rounded border bg-blue-600 text-white hover:bg-blue-700"
            onClick={onSaveSettings}
            disabled={settingsLoading || settingsSaving}
          >
            {settingsSaving ? 'Sauvegarde…' : 'Sauvegarder'}
          </button>
          <button
            type="button"
            className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
            onClick={onReloadLists}
            disabled={listsLoading}
          >
            {listsLoading ? 'Chargement…' : 'Rafraîchir listes'}
          </button>
        </div>
      </div>

      <div className="rounded border bg-white p-3">
        <div className="text-sm font-medium">Signature cache</div>
        <div className="text-xs text-gray-600 mt-1">
          Derniere mise a jour: {settings?.signature_cache_updated_at ? String(settings.signature_cache_updated_at) : '—'}
          {' · '}shops: {Number(settings?.signature_cache_shop_count || 0)}
          {' · '}entries: {Number(settings?.signature_cache_entry_count || 0)}
        </div>
        {signatureUpdateMsg ? <div className="text-xs mt-2">{String(signatureUpdateMsg)}</div> : null}
        <div className="text-xs text-gray-500 mt-2">
          Astuce: apres modification de PS_SHOP_PHONE / PS_LOGO_INVOICE, cliquer “Update signature” pour rafraichir le cache.
        </div>
      </div>

      {settingsError && <div className="text-sm text-red-600">{settingsError}</div>}
      {listsError && <div className="text-sm text-red-600">{listsError}</div>}

      <Section title="Filtre">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Field label="Filtre (prompts + serveurs MCP2)" hint="Tape un nom ou un ID (ex: pc_…, m2s_…).">
            <input
              className="w-full rounded border px-2 py-1 text-sm"
              placeholder="Rechercher…"
              value={settingsFilter}
              onChange={(e) => setSettingsFilter(e.target.value)}
            />
          </Field>
          <Field label="Gateway (SMS) : subscription_id par défaut" hint="Utilisé pour les envois SMS (Numero de maison / Tracking / Telephone).">
            <input
              className="w-full rounded border px-2 py-1 text-sm"
              placeholder="ex: 3"
              value={settings?.gateway_default_subscription_id ?? ''}
              onChange={(e) => setSettings((prev) => ({ ...prev, gateway_default_subscription_id: e.target.value }))}
            />
          </Field>
        </div>
      </Section>

      <Section title="Virement bancaire">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Field label="Prompt (email complet : subject + html + text)">
            <PromptSelect
              value={settings?.virement_email_prompt_config_id || null}
              onChange={(v) => setSettings((prev) => ({ ...prev, virement_email_prompt_config_id: v }))}
              promptConfigs={promptConfigs}
              filterText={settingsFilter}
            />
          </Field>
          <Field label="Prompt (objet email) — fallback">
            <PromptSelect
              value={settings?.virement_prompt_config_id || null}
              onChange={(v) => setSettings((prev) => ({ ...prev, virement_prompt_config_id: v }))}
              promptConfigs={promptConfigs}
              filterText={settingsFilter}
            />
          </Field>
        </div>
        <div className="text-xs text-gray-500 mt-2">
          “Email complet” doit retourner un JSON: {"{ subject, html, text }"}.
        </div>
        <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-gray-500">Developer message (email complet)</div>
              <button
                type="button"
                className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
                onClick={async () => {
                  const ok = await copyToClipboard(DEV_MESSAGE_VIREMENT_EMAIL);
                  try { if (!ok) alert('Copy failed'); } catch {}
                }}
              >
                Copier
              </button>
            </div>
            <textarea
              className="mt-2 w-full min-h-[160px] rounded border px-2 py-2 text-[12px] font-mono bg-white"
              value={DEV_MESSAGE_VIREMENT_EMAIL}
              readOnly
            />
          </div>
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-gray-500">Developer message (objet — fallback)</div>
              <button
                type="button"
                className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
                onClick={async () => {
                  const ok = await copyToClipboard(DEV_MESSAGE_VIREMENT_SUBJECT);
                  try { if (!ok) alert('Copy failed'); } catch {}
                }}
              >
                Copier
              </button>
            </div>
            <textarea
              className="mt-2 w-full min-h-[160px] rounded border px-2 py-2 text-[12px] font-mono bg-white"
              value={DEV_MESSAGE_VIREMENT_SUBJECT}
              readOnly
            />
          </div>
        </div>
      </Section>

      <Section title="Virement bancaire — Coordonnées bancaires">
        <EmailRelanceBankSettingsEditor
          value={settings?.virement_bank_details || {}}
          onChange={(next) => setSettings((prev) => ({ ...prev, virement_bank_details: next }))}
        />
        <div className="text-xs text-gray-500 mt-2">
          Le système choisit la banque + l’IBAN/BIC en fonction de `order.currency_iso`. Si la devise n’existe pas, il prend la 1ère banque.
        </div>
      </Section>

      <Section title="Numero de maison">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Field label="Prompt (SMS)">
            <PromptSelect
              value={settings?.numero_maison_prompt_config_id || null}
              onChange={(v) => setSettings((prev) => ({ ...prev, numero_maison_prompt_config_id: v }))}
              promptConfigs={promptConfigs}
              filterText={settingsFilter}
            />
          </Field>
          <div className="text-xs text-gray-500 flex items-center">
            Utilisé pour générer le texte SMS (bouton “Générer SMS”).
          </div>
        </div>
        <div className="mt-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-gray-500">Developer message (à coller dans Automation Suite → Prompt Config)</div>
            <button
              type="button"
              className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
              onClick={async () => {
                const ok = await copyToClipboard(DEV_MESSAGE_NUMERO_MAISON_SMS);
                try { if (!ok) alert('Copy failed'); } catch {}
              }}
            >
              Copier
            </button>
          </div>
          <textarea
            className="mt-2 w-full min-h-[220px] rounded border px-2 py-2 text-[12px] font-mono bg-white"
            value={DEV_MESSAGE_NUMERO_MAISON_SMS}
            readOnly
          />
        </div>
      </Section>

      <Section title="Send Tracking link">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
          <Field label="Prompt (Tracking: SMS + email)">
            <PromptSelect
              value={settings?.tracking_prompt_config_id || null}
              onChange={(v) => setSettings((prev) => ({ ...prev, tracking_prompt_config_id: v }))}
              promptConfigs={promptConfigs}
              filterText={settingsFilter}
            />
          </Field>
          <div className="text-xs text-gray-500 flex items-center">
            Utilisé pour générer le SMS (requested.type=tracking_sms) et l’email (requested.type=tracking_email).
          </div>
        </div>
        {selectedTrackingPrompt ? (
          <div className="text-xs text-gray-600 mb-3">
            Prompt sélectionné: <span className="font-semibold">{String(selectedTrackingPrompt.name || selectedTrackingPrompt.id)}</span>
            {selectedTrackingPrompt.model ? <span>{` · model: ${String(selectedTrackingPrompt.model)}`}</span> : null}
            <span> · tracking: prompt-only (pas de lookup MCP2)</span>
          </div>
        ) : (
          <div className="text-xs text-gray-500 mb-3">Sélectionne un prompt Tracking (SMS + email) utilisé pour la génération.</div>
        )}

        <div className="mt-1 mb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-gray-500">Developer message (à coller dans Automation Suite → Prompt Config)</div>
            <button
              type="button"
              className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
              onClick={async () => {
                const ok = await copyToClipboard(DEV_MESSAGE_TRACKING);
                try { if (!ok) alert('Copy failed'); } catch {}
              }}
            >
              Copier
            </button>
          </div>
          <textarea
            className="mt-2 w-full min-h-[220px] rounded border px-2 py-2 text-[12px] font-mono bg-white"
            value={DEV_MESSAGE_TRACKING}
            readOnly
          />
        </div>

        <div className="rounded border bg-white p-3 text-xs text-gray-700 space-y-1">
          <div className="font-semibold">Tracking link</div>
          <div>
            Le bouton “Générer SMS + email” n’interroge pas MCP2. Les données Presta (tracking_url / tracking_number / carrier) sont envoyées au prompt.
          </div>
          <div className="text-gray-500">
            Si tracking_url est manquant, le prompt ne doit pas inventer d’URL (utiliser le numéro de suivi si disponible).
          </div>
        </div>
      </Section>

      <Section title="Numero de telephone">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Field label="Prompt (demande numéro de téléphone)">
            <PromptSelect
              value={settings?.numero_telephone_prompt_config_id || null}
              onChange={(v) => setSettings((prev) => ({ ...prev, numero_telephone_prompt_config_id: v }))}
              promptConfigs={promptConfigs}
              filterText={settingsFilter}
            />
          </Field>
          <div className="text-xs text-gray-500 flex items-center">
            Utilisé pour la future relance “Numero de telephone”.
          </div>
        </div>
        <div className="mt-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-gray-500">Developer message (à coller dans Automation Suite → Prompt Config)</div>
            <button
              type="button"
              className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
              onClick={async () => {
                const ok = await copyToClipboard(DEV_MESSAGE_NUMERO_TELEPHONE);
                try { if (!ok) alert('Copy failed'); } catch {}
              }}
            >
              Copier
            </button>
          </div>
          <textarea
            className="mt-2 w-full min-h-[160px] rounded border px-2 py-2 text-[12px] font-mono bg-white"
            value={DEV_MESSAGE_NUMERO_TELEPHONE}
            readOnly
          />
        </div>
      </Section>
    </div>
  );
}
