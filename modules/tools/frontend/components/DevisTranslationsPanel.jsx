import React, { useEffect, useMemo, useState } from 'react';

const VENDOR_KEYS = ['contact_vendor', 'URL', 'name_web_site', 'logo', 'mobil_number_vendor', 'e-mail_vendor'];
const LABEL_KEYS = [
  // Core keys used by the quote templates (can override everything)
  'doc_title',
  'quote_number',
  'date',
  'client_info',
  'vendor_info',
  'client_name',
  'client_company',
  'client_email',
  'vendor_company',
  'vendor_contact',
  'vendor_email',
  'vendor_phone',
  'details',
  'reference',
  'product_name',
  'description',
  'unit_price',
  'quantity',
  'line_total',
  'total',
  'product_link',
  'image',
  'link_text',
  'transport_cost',
  'subtotal_products',
  'discount',
  'email_intro_html',
  'delivery_lead_time',
  'summary',
  // Legacy keys (your previous table)
  'web_text',
  'votre_contact_text',
  'email_text',
  'mobil_text',
  'date_devis_text',
  'adresse_de_facturation_text',
  'adresse_de_livraison_text',
  'references_text',
  'qty_text',
  'description_text',
  'port_text',
  'delai_text',
  'total_avant_remise_text',
  'remise_text',
  'total_text',
  'remarques_text',
  'customer_name_text',
  'customer_company_text',
  'prix_unitaire_text',
  'prix_total_text',
  'devis_number_text',
  'link_to_order_text',
  'transport_cost_text',
  'transport_by_text',
  'delivery_lead_time_text',
  'jour_ouvrable_text',
];

const LOCALE_BY_ISO = {
  fr: 'fr-FR',
  en: 'en-GB',
  nl: 'nl-NL',
  de: 'de-DE',
  cs: 'cs-CZ',
  it: 'it-IT',
  es: 'es-ES',
  pt: 'pt-PT',
  pl: 'pl-PL',
  lt: 'lt-LT',
};

function normalizeKey(key = '') {
  return String(key || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*:\s*$/g, '')
    .replace(/\s*:\s*/g, '_')
    .replace(/\s+/g, '_');
}

function safeParseJson(text) {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}

function toPrettyJson(obj) {
  try {
    return JSON.stringify(obj || {}, null, 2);
  } catch {
    return '{}';
  }
}

function parseLegacyPayload(text) {
  const raw = String(text || '').replace(/\r/g, '');
  const lines = raw
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim());
  if (!lines.length) return [];

  const first = lines[0];
  const looksLikeHeader = first.includes('\t') && /id_shop/i.test(first) && /id_lang/i.test(first);

  if (looksLikeHeader) {
    const header = first.split('\t').map((h) => normalizeKey(h));
    const rows = [];
    for (const line of lines.slice(1)) {
      const cols = line.split('\t');
      const rec = {};
      header.forEach((key, idx) => {
        rec[key] = cols[idx] != null ? String(cols[idx]) : '';
      });
      const shopId = Number(rec.id_shop || 0);
      const langId = Number(rec.id_lang || 0);
      if (!shopId || !langId) continue;
      const vendor = {};
      const labels = {};
      VENDOR_KEYS.forEach((k) => {
        const v = rec[normalizeKey(k)] ?? rec[k] ?? '';
        if (v != null) vendor[k] = String(v);
      });
      LABEL_KEYS.forEach((k) => {
        const v = rec[normalizeKey(k)] ?? rec[k] ?? '';
        if (v != null) labels[k] = String(v);
      });
      rows.push({ shop_id: shopId, lang_id: langId, vendor, labels });
    }
    return rows;
  }

  // "normalized" format: <group_id>\t<field>\t<value>
  const groups = new Map();
  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const groupId = String(parts[0] || '').trim();
    const field = normalizeKey(parts[1] || '');
    const value = String(parts.slice(2).join('\t') || '');
    if (!groupId || !field) continue;
    if (!groups.has(groupId)) groups.set(groupId, {});
    groups.get(groupId)[field] = value;
  }

  const rows = [];
  for (const rec of groups.values()) {
    const shopId = Number(rec.id_shop || 0);
    const langId = Number(rec.id_lang || 0);
    if (!shopId || !langId) continue;
    const vendor = {};
    const labels = {};
    VENDOR_KEYS.forEach((k) => {
      const nk = normalizeKey(k);
      vendor[k] = String(rec[nk] ?? rec[k] ?? '');
    });
    LABEL_KEYS.forEach((k) => {
      const nk = normalizeKey(k);
      labels[k] = String(rec[nk] ?? rec[k] ?? '');
    });
    rows.push({ shop_id: shopId, lang_id: langId, vendor, labels });
  }
  return rows;
}

export default function DevisTranslationsPanel({
  orgId,
  selectedShopId,
  selectedLanguageId,
  selectedLanguageIso,
  shops,
  languages,
  promptConfigs,
}) {
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [rows, setRows] = useState([]);

  const [targetShopId, setTargetShopId] = useState(selectedShopId || '');
  const [targetLangId, setTargetLangId] = useState(selectedLanguageId || '');

  const [vendorText, setVendorText] = useState('{}');
  const [labelsText, setLabelsText] = useState('{}');
  const [currentRowId, setCurrentRowId] = useState(null);
  const [saveMsg, setSaveMsg] = useState('');
  const [saveErr, setSaveErr] = useState('');
  const [saving, setSaving] = useState(false);

  const [emailIntroHtml, setEmailIntroHtml] = useState('');

  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [importErr, setImportErr] = useState('');

  const [translationPromptConfigId, setTranslationPromptConfigId] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generateMsg, setGenerateMsg] = useState('');
  const [generateErr, setGenerateErr] = useState('');
  const [sourceLangId, setSourceLangId] = useState('');
  const [sourceShopId, setSourceShopId] = useState('');
  const [sourceRows, setSourceRows] = useState([]);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState('');

  useEffect(() => {
    if (selectedShopId !== undefined && selectedShopId !== null) setTargetShopId(selectedShopId || '');
  }, [selectedShopId]);

  useEffect(() => {
    if (selectedLanguageId !== undefined && selectedLanguageId !== null) setTargetLangId(selectedLanguageId || '');
  }, [selectedLanguageId]);

  useEffect(() => {
    // Default source shop to target shop (common case)
    if (!sourceShopId && targetShopId) setSourceShopId(String(targetShopId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetShopId]);

  const targetLanguageIso = useMemo(() => {
    const items = Array.isArray(languages) ? languages : [];
    const found = items.find((l) => String(l.id_lang) === String(targetLangId));
    return String(found?.iso_code || selectedLanguageIso || '').toLowerCase();
  }, [languages, targetLangId, selectedLanguageIso]);

  const localeGuess = useMemo(() => {
    return LOCALE_BY_ISO[String(targetLanguageIso || '').toLowerCase()] || '';
  }, [targetLanguageIso]);

  const currentRow = useMemo(() => {
    if (!targetShopId || !targetLangId) return null;
    return rows.find(
      (r) => String(r.shop_id) === String(targetShopId) && String(r.lang_id) === String(targetLangId)
    ) || null;
  }, [rows, targetShopId, targetLangId]);

  const sourceRow = useMemo(() => {
    const srcShop = String(sourceShopId || '').trim();
    if (!srcShop) return null;
    const list = String(srcShop) === String(targetShopId) ? rows : sourceRows;
    if (sourceLangId) {
      return list.find((r) => String(r.shop_id) === String(srcShop) && String(r.lang_id) === String(sourceLangId)) || null;
    }
    // Prefer "some other lang" if available, else any row
    const any = list.find((r) => String(r.shop_id) === String(srcShop) && String(r.lang_id) !== String(targetLangId)) || null;
    return any || (list.find((r) => String(r.shop_id) === String(srcShop)) || null);
  }, [rows, sourceRows, targetShopId, targetLangId, sourceLangId, sourceShopId]);

  const shopOptions = useMemo(() => {
    const items = Array.isArray(shops) ? shops : [];
    return items.map((s) => ({ id: String(s.id_shop), label: s.name ? `${s.name} (ID ${s.id_shop})` : `ID ${s.id_shop}` }));
  }, [shops]);

  const langOptions = useMemo(() => {
    const items = Array.isArray(languages) ? languages : [];
    return items
      .slice()
      .sort((a, b) => Number(a.id_lang) - Number(b.id_lang))
      .map((l) => ({ id: String(l.id_lang), label: l.name ? `${l.name} (ID ${l.id_lang})` : `ID ${l.id_lang}` }));
  }, [languages]);

  const promptConfigOptions = useMemo(() => {
    const items = Array.isArray(promptConfigs) ? promptConfigs : [];
    return items.map((p) => ({
      id: p.id,
      label: p.name ? `${p.name} (${p.id})` : p.id,
    }));
  }, [promptConfigs]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('tools_devis_translation_prompt_config') || '{}');
      if (saved?.promptConfigId) setTranslationPromptConfigId(String(saved.promptConfigId));
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('tools_devis_translation_prompt_config', JSON.stringify({ promptConfigId: translationPromptConfigId || '' }));
    } catch {}
  }, [translationPromptConfigId]);

  const loadRowsForShop = async () => {
    if (!targetShopId) {
      setRows([]);
      setListError('');
      return;
    }
    setListLoading(true);
    setListError('');
    try {
      const params = new URLSearchParams();
      params.set('shop_id', String(targetShopId));
      params.set('limit', '200');
      const headers = {};
      if (orgId) headers['X-Org-Id'] = orgId;
      const resp = await fetch(`/api/tools/devis/translations?${params.toString()}`, { credentials: 'include', headers });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data?.ok) {
        const items = Array.isArray(data.items) ? data.items : [];
        setRows(items);
      } else {
        setRows([]);
        setListError(data?.message || data?.error || 'Impossible de charger les traductions.');
      }
    } catch (e) {
      setRows([]);
      setListError(e?.message || 'Erreur réseau');
    } finally {
      setListLoading(false);
    }
  };

  useEffect(() => {
    loadRowsForShop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetShopId, orgId]);

  useEffect(() => {
    if (currentRow) {
      setCurrentRowId(currentRow.id || null);
      setVendorText(toPrettyJson(currentRow.vendor || {}));
      setLabelsText(toPrettyJson(currentRow.labels || {}));
      setEmailIntroHtml(String(currentRow.labels?.email_intro_html || ''));
    } else {
      setCurrentRowId(null);
      setVendorText('{}');
      setLabelsText('{}');
      setEmailIntroHtml('');
    }
  }, [currentRow]);

  useEffect(() => {
    if (!sourceLangId && sourceRow?.lang_id) setSourceLangId(String(sourceRow.lang_id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length, sourceRows.length, targetShopId, sourceShopId]);

  const loadRowsForShopId = async (shopId) => {
    const sid = String(shopId || '').trim();
    if (!sid) return [];
    const params = new URLSearchParams();
    params.set('shop_id', sid);
    params.set('limit', '200');
    const headers = {};
    if (orgId) headers['X-Org-Id'] = orgId;
    const resp = await fetch(`/api/tools/devis/translations?${params.toString()}`, { credentials: 'include', headers });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data?.ok) throw new Error(data?.message || data?.error || 'translations_fetch_failed');
    return Array.isArray(data.items) ? data.items : [];
  };

  useEffect(() => {
    const sid = String(sourceShopId || '').trim();
    if (!sid || String(sid) === String(targetShopId)) {
      setSourceRows([]);
      setSourceError('');
      return;
    }
    let mounted = true;
    setSourceLoading(true);
    setSourceError('');
    (async () => {
      try {
        const items = await loadRowsForShopId(sid);
        if (!mounted) return;
        setSourceRows(items);
      } catch (e) {
        if (!mounted) return;
        setSourceRows([]);
        setSourceError(e?.message || 'Erreur chargement source');
      } finally {
        if (!mounted) return;
        setSourceLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [sourceShopId, targetShopId, orgId]);

  const upsertLabelKey = (key, value) => {
    const current = safeParseJson(labelsText) || {};
    current[key] = String(value || '');
    setLabelsText(toPrettyJson(current));
  };

  const upsertRow = async ({ shopId, langId, vendor, labels, isoCode, locale }) => {
    const headers = { 'Content-Type': 'application/json' };
    if (orgId) headers['X-Org-Id'] = orgId;
    const resp = await fetch('/api/tools/devis/translations/upsert', {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({
        shop_id: Number(shopId),
        lang_id: Number(langId),
        iso_code: isoCode || null,
        locale: locale || null,
        vendor: vendor || {},
        labels: labels || {},
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data?.ok) throw new Error(data?.message || data?.error || 'upsert_failed');
    return data.item;
  };

  const handleSave = async () => {
    setSaveMsg('');
    setSaveErr('');
    if (!targetShopId || !targetLangId) {
      setSaveErr('Sélectionnez une boutique et une langue.');
      return;
    }
    const vendor = safeParseJson(vendorText);
    const labels = safeParseJson(labelsText);
    if (!vendor) {
      setSaveErr('Vendor JSON invalide.');
      return;
    }
    if (!labels) {
      setSaveErr('Labels JSON invalide.');
      return;
    }
    setSaving(true);
    try {
      const item = await upsertRow({
        shopId: targetShopId,
        langId: targetLangId,
        vendor,
        labels,
        isoCode: targetLanguageIso || null,
        locale: localeGuess || null,
      });
      setSaveMsg('Traduction enregistrée.');
      setCurrentRowId(item?.id || null);
      await loadRowsForShop();
    } catch (e) {
      setSaveErr(e?.message || 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  const handleImport = async () => {
    setImportMsg('');
    setImportErr('');
    const batch = parseLegacyPayload(importText);
    if (!batch.length) {
      setImportErr('Aucune ligne importable détectée. Collez soit un TSV avec en-tête, soit le format (id, champ, valeur).');
      return;
    }
    setImporting(true);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (orgId) headers['X-Org-Id'] = orgId;
      const resp = await fetch('/api/tools/devis/translations/bulk-upsert', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({ items: batch }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data?.ok) throw new Error(data?.message || data?.error || 'bulk_upsert_failed');
      setImportMsg(`Import terminé: ${Number(data.count || 0)} ligne(s).`);
      await loadRowsForShop();
    } catch (e) {
      setImportErr(e?.message || 'Erreur import');
    } finally {
      setImporting(false);
    }
  };

  const handleGenerate = async () => {
    setGenerateMsg('');
    setGenerateErr('');
    if (!targetShopId || !targetLangId) {
      setGenerateErr('Sélectionnez une boutique et une langue.');
      return;
    }
    if (!translationPromptConfigId) {
      setGenerateErr('Sélectionnez une config prompt (Automation Suite).');
      return;
    }
    const baseVendor = sourceRow?.vendor || safeParseJson(vendorText) || {};
    const baseLabels = sourceRow?.labels || safeParseJson(labelsText) || {};
    setGenerating(true);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (orgId) headers['X-Org-Id'] = orgId;
      const resp = await fetch('/api/tools/devis/translations/generate', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          promptConfigId: translationPromptConfigId,
          shop_id: Number(targetShopId),
          lang_id: Number(targetLangId),
          target_iso_code: (targetLanguageIso || '').toLowerCase() || null,
          target_locale: localeGuess || null,
          source: { vendor: baseVendor, labels: baseLabels },
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data?.ok) throw new Error(data?.message || data?.error || 'generate_failed');
      const item = data.item || null;
      if (item) {
        setVendorText(toPrettyJson(item.vendor || {}));
        setLabelsText(toPrettyJson(item.labels || {}));
        setCurrentRowId(item.id || null);
        setGenerateMsg('Génération + sauvegarde OK.');
        await loadRowsForShop();
      } else {
        setGenerateMsg('Génération OK (aucune sauvegarde).');
      }
    } catch (e) {
      setGenerateErr(e?.message || 'Erreur génération');
    } finally {
      setGenerating(false);
    }
  };

  const sourceLangOptions = useMemo(() => {
    const srcShop = String(sourceShopId || '').trim();
    const list = srcShop && String(srcShop) !== String(targetShopId) ? sourceRows : rows;
    const opts = list
      .filter((r) => String(r.shop_id) === String(srcShop || targetShopId))
      .sort((a, b) => Number(a.lang_id) - Number(b.lang_id))
      .map((r) => ({
        id: String(r.lang_id),
        label: `Lang ${r.lang_id}${r.iso_code ? ` (${r.iso_code})` : ''}`,
      }));
    return opts;
  }, [rows, sourceRows, targetShopId, sourceShopId]);

  return (
    <div className="panel">
      <div className="panel__header">Traductions (mod_tools_devis_translations)</div>
      <div className="panel__body space-y-4">
        <div className="rounded border bg-white p-3 space-y-3">
          <div className="text-sm font-semibold text-gray-800">Cible</div>
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
            <div>
              <label className="text-[11px] font-semibold uppercase text-gray-500">Shop</label>
              {shopOptions.length ? (
                <select
                  className="mt-1 w-full rounded border px-2 py-1 text-sm"
                  value={String(targetShopId || '')}
                  onChange={(e) => setTargetShopId(e.target.value)}
                >
                  <option value="">Sélectionnez une boutique</option>
                  {shopOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="mt-1 w-full rounded border px-2 py-1 text-sm"
                  placeholder="ex: 3"
                  value={String(targetShopId || '')}
                  onChange={(e) => setTargetShopId(e.target.value)}
                />
              )}
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase text-gray-500">Langue</label>
              {langOptions.length ? (
                <select
                  className="mt-1 w-full rounded border px-2 py-1 text-sm"
                  value={String(targetLangId || '')}
                  onChange={(e) => setTargetLangId(e.target.value)}
                >
                  <option value="">Sélectionnez une langue</option>
                  {langOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="mt-1 w-full rounded border px-2 py-1 text-sm"
                  placeholder="ex: 1"
                  value={String(targetLangId || '')}
                  onChange={(e) => setTargetLangId(e.target.value)}
                />
              )}
            </div>
            <div className="flex items-end justify-end gap-2">
              <button
                type="button"
                className="px-3 py-1 rounded border bg-white hover:bg-gray-50 text-sm"
                onClick={loadRowsForShop}
                disabled={listLoading}
              >
                {listLoading ? 'Chargement…' : 'Recharger'}
              </button>
            </div>
          </div>
          {listError && <div className="text-sm text-red-600">{listError}</div>}
        </div>

        <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
          <div className="text-xs text-gray-600">
            <div>
              Shop: <span className="font-semibold text-gray-900">{targetShopId || '—'}</span>
            </div>
            <div>
              Lang: <span className="font-semibold text-gray-900">{targetLangId || '—'}</span>
              {targetLanguageIso ? <span className="text-gray-500"> ({targetLanguageIso})</span> : null}
            </div>
            <div className="text-[11px] text-gray-500">
              {listLoading ? 'Chargement…' : listError ? listError : currentRowId ? `Row ID: ${currentRowId}` : 'Aucune traduction enregistrée.'}
            </div>
          </div>
          <div className="flex items-start justify-end gap-2">
            <button type="button" className="px-3 py-1 rounded border bg-white hover:bg-gray-50 text-sm" onClick={loadRowsForShop} disabled={listLoading}>
              Rafraîchir
            </button>
            <button type="button" className="px-3 py-1 rounded border bg-blue-600 text-white hover:bg-blue-700 text-sm" onClick={handleSave} disabled={saving}>
              {saving ? 'Sauvegarde…' : 'Enregistrer'}
            </button>
          </div>
        </div>

        {(saveMsg || saveErr) && (
          <div className={`text-sm ${saveErr ? 'text-red-600' : 'text-emerald-700'}`}>{saveErr || saveMsg}</div>
        )}

	        <div>
	          <div>
	            <div className="text-[11px] font-semibold uppercase text-gray-500">Email intro (HTML)</div>
	            <textarea
	              className="mt-1 w-full rounded border px-2 py-2 text-xs font-mono min-h-[140px]"
	              value={emailIntroHtml}
	              onChange={(e) => {
	                const value = e.target.value;
	                setEmailIntroHtml(value);
	                upsertLabelKey('email_intro_html', value);
	              }}
	              placeholder="Collez ici votre HTML (vous pouvez coller <html>…</html>)."
	            />
	            <div className="text-[11px] text-gray-500">Stocké dans labels.email_intro_html.</div>
	          </div>
	        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <div className="text-[11px] font-semibold uppercase text-gray-500">Vendor JSON</div>
            <textarea className="mt-1 w-full rounded border px-2 py-2 text-xs font-mono min-h-[220px]" value={vendorText} onChange={(e) => setVendorText(e.target.value)} />
            <div className="text-[11px] text-gray-500">Clés utiles: {VENDOR_KEYS.join(', ')}</div>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase text-gray-500">Labels JSON</div>
            <textarea className="mt-1 w-full rounded border px-2 py-2 text-xs font-mono min-h-[220px]" value={labelsText} onChange={(e) => setLabelsText(e.target.value)} />
            <div className="text-[11px] text-gray-500">Clés utiles: {LABEL_KEYS.join(', ')}</div>
          </div>
        </div>

        <div className="rounded border bg-gray-50 p-3 space-y-3">
          <div className="text-sm font-semibold text-gray-800">Générer via prompt (Automation Suite)</div>
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr]">
            <div>
              <label className="text-[11px] font-semibold uppercase text-gray-500">Config prompt</label>
              <select className="mt-1 w-full rounded border px-2 py-1 text-sm" value={translationPromptConfigId} onChange={(e) => setTranslationPromptConfigId(e.target.value)}>
                <option value="">Sélectionnez une config</option>
                {promptConfigOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase text-gray-500">Source (eshop + langue)</label>
              <div className="mt-1 grid gap-2 md:grid-cols-2">
                <select className="w-full rounded border px-2 py-1 text-sm" value={String(sourceShopId || '')} onChange={(e) => setSourceShopId(e.target.value)}>
                  <option value="">Shop source</option>
                  {shopOptions.map((opt) => (
                    <option key={`src-shop-${opt.id}`} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <select className="w-full rounded border px-2 py-1 text-sm" value={sourceLangId} onChange={(e) => setSourceLangId(e.target.value)} disabled={!sourceLangOptions.length || sourceLoading}>
                  <option value="">{sourceLangOptions.length ? 'Lang source' : 'Lang source: —'}</option>
                  {sourceLangOptions.map((opt) => (
                    <option key={`src-lang-${opt.id}`} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              {sourceError ? (
                <div className="text-[11px] text-red-600">{sourceError}</div>
              ) : sourceLoading ? (
                <div className="text-[11px] text-gray-500">Chargement des traductions source…</div>
              ) : (
                <div className="text-[11px] text-gray-500">La source alimente le prompt (vendor+labels) à traduire.</div>
              )}
            </div>
            <div className="flex items-end justify-end">
              <button type="button" className="px-3 py-1 rounded border bg-white hover:bg-gray-50 text-sm" onClick={handleGenerate} disabled={generating}>
                {generating ? 'Génération…' : 'Générer + sauvegarder'}
              </button>
            </div>
          </div>
          <div className="text-[11px] text-gray-600">
            Cible: Shop <span className="font-semibold">{targetShopId || '—'}</span> · Lang <span className="font-semibold">{targetLangId || '—'}</span>
          </div>
          {(generateMsg || generateErr) && (
            <div className={`text-sm ${generateErr ? 'text-red-600' : 'text-emerald-700'}`}>{generateErr || generateMsg}</div>
          )}
        </div>

        <div className="rounded border bg-white p-3 space-y-2">
          <div className="text-sm font-semibold text-gray-800">Backfill (coller vos données)</div>
          <div className="text-xs text-gray-600">
            Collez soit le tableau TSV complet (avec en-tête id_shop/id_lang…), soit le format (id, champ, valeur).
          </div>
          <textarea className="mt-1 w-full rounded border px-2 py-2 text-xs font-mono min-h-[160px]" value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="Collez ici…" />
          <div className="flex items-center gap-2">
            <button type="button" className="px-3 py-1 rounded border bg-white hover:bg-gray-50 text-sm" onClick={handleImport} disabled={importing}>
              {importing ? 'Import…' : 'Importer'}
            </button>
            {importMsg && <div className="text-sm text-emerald-700">{importMsg}</div>}
            {importErr && <div className="text-sm text-red-600">{importErr}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
