import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import EmailTemplatePreviewFrame from './EmailTemplatePreviewFrame.jsx';

function getApiErrorMessage(data, fallback) {
  const msg = data?.message || data?.error || '';
  return typeof msg === 'string' && msg.trim() ? msg.trim() : fallback;
}

function toInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

export default function EmailTemplateCopyPanel({
  headers = {},
  orgHeaders = {},
  orgId,
  setOrgId,
  resolvedOrgId,
  profileId,
  setProfileId,
  profiles,
  profilesLoading,
  profilesError,
  reloadProfiles,
  shops,
  shopsLoading,
  shopsError,
  reloadShops,
}) {
  const [sourceShopId, setSourceShopId] = useState('');
  const [sourceLanguages, setSourceLanguages] = useState([]);
  const [sourceLanguagesLoading, setSourceLanguagesLoading] = useState(false);
  const [sourceLanguagesError, setSourceLanguagesError] = useState('');
  const [sourceLangId, setSourceLangId] = useState('');

  const [targetShopId, setTargetShopId] = useState('');
  const [targetLanguages, setTargetLanguages] = useState([]);
  const [targetLanguagesLoading, setTargetLanguagesLoading] = useState(false);
  const [targetLanguagesError, setTargetLanguagesError] = useState('');
  const [targetLangId, setTargetLangId] = useState('');

  const [copyTemplates, setCopyTemplates] = useState([]);
  const [copyTemplatesLoading, setCopyTemplatesLoading] = useState(false);
  const [copyTemplatesError, setCopyTemplatesError] = useState('');
  const [copyQuery, setCopyQuery] = useState('');
  const queryRef = useRef(copyQuery);
  useEffect(() => {
    queryRef.current = copyQuery;
  }, [copyQuery]);

  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [selectedTemplateType, setSelectedTemplateType] = useState('');
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateError, setTemplateError] = useState('');

  const [copyState, setCopyState] = useState({ busy: false, message: '', error: '' });

  const canListTemplates = useMemo(() => !!(sourceShopId && sourceLangId), [sourceShopId, sourceLangId]);

  useEffect(() => {
    if (shops.length && !sourceShopId) {
      setSourceShopId(String(shops[0].id_shop ?? ''));
    }
    if (shops.length && !targetShopId) {
      setTargetShopId(String(shops[0].id_shop ?? ''));
    }
  }, [shops, sourceShopId, targetShopId]);

  useEffect(() => {
    setSourceShopId('');
    setTargetShopId('');
    setSourceLangId('');
    setTargetLangId('');
  }, [profileId]);

  const loadLanguagesFor = useCallback(
    async ({ shopId, setter, setId, setLoading, setError, currentValue }) => {
      if (!profileId || !shopId) {
        setter([]);
        setId('');
        return;
      }
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ profile_id: profileId, id_shop: shopId, limit: '500' });
        const resp = await fetch(`/api/product-search-index/mysql/languages?${params.toString()}`, {
          credentials: 'include',
          headers,
        });
        const data = await resp.json().catch(() => ({}));
        const ok = resp.ok && (data?.ok === undefined || data?.ok === true);
        if (!ok) {
          setter([]);
          setId('');
          setError(getApiErrorMessage(data, 'Impossible de charger les langues.'));
          return;
        }
        const items = Array.isArray(data.items) ? data.items : [];
        setter(items);
        if (items.length) {
          const normalized = String(currentValue || '').trim();
          const match = items.find((item) => String(item.id_lang) === normalized);
          setId(String((match || items[0]).id_lang || ''));
        } else {
          setId('');
        }
      } catch (error) {
        setter([]);
        setId('');
        setError(error?.message || 'Impossible de charger les langues.');
      } finally {
        setLoading(false);
      }
    },
    [headers, profileId]
  );

  useEffect(() => {
    loadLanguagesFor({
      shopId: sourceShopId,
      setter: setSourceLanguages,
      setId: setSourceLangId,
      setLoading: setSourceLanguagesLoading,
      setError: setSourceLanguagesError,
      currentValue: sourceLangId,
    });
  }, [loadLanguagesFor, sourceLangId, sourceShopId]);

  useEffect(() => {
    loadLanguagesFor({
      shopId: targetShopId,
      setter: setTargetLanguages,
      setId: setTargetLangId,
      setLoading: setTargetLanguagesLoading,
      setError: setTargetLanguagesError,
      currentValue: targetLangId,
    });
  }, [loadLanguagesFor, targetLangId, targetShopId]);

  useEffect(() => {
    setSelectedTemplate(null);
    setTemplateError('');
    setCopyState((prev) => ({ ...prev, message: '', error: '' }));
  }, [sourceShopId, sourceLangId]);

  const loadTemplates = useCallback(async () => {
    if (!canListTemplates) {
      setCopyTemplates([]);
      return;
    }
    setCopyTemplatesLoading(true);
    setCopyTemplatesError('');
    try {
      const params = new URLSearchParams({
        limit: '200',
        id_shop: sourceShopId,
        id_lang: sourceLangId,
      });
      const query = String(queryRef.current || '').trim();
      if (query) params.set('q', query);
      const resp = await fetch(`/api/tools/email-from-template/types?${params.toString()}`, {
        credentials: 'include',
        headers: orgHeaders,
      });
      const data = await resp.json().catch(() => ({}));
      if (!(resp.ok && (data?.ok === undefined || data.ok === true))) {
        throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
      }
      setCopyTemplates(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      setCopyTemplates([]);
      setCopyTemplatesError(error?.message || 'Impossible de charger les templates.');
    } finally {
      setCopyTemplatesLoading(false);
    }
  }, [canListTemplates, orgHeaders, sourceLangId, sourceShopId]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const loadTemplateDetails = useCallback(
    async (templateType) => {
      if (!templateType || !sourceShopId || !sourceLangId) return;
      setTemplateLoading(true);
      setTemplateError('');
      setSelectedTemplate(null);
      setCopyState({ busy: false, message: '', error: '' });
      try {
        const params = new URLSearchParams({
          template_type: templateType,
          id_shop: sourceShopId,
          id_lang: sourceLangId,
        });
        const resp = await fetch(`/api/tools/email-from-template/render?${params.toString()}`, {
          credentials: 'include',
          headers: orgHeaders,
        });
        const data = await resp.json().catch(() => ({}));
        if (!(resp.ok && (data?.ok === undefined || data.ok === true))) {
          throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
        }
        setSelectedTemplate(data.item || null);
      } catch (error) {
        setSelectedTemplate(null);
        setTemplateError(error?.message || 'Impossible de charger le template.');
      } finally {
        setTemplateLoading(false);
      }
    },
    [orgHeaders, sourceLangId, sourceShopId]
  );

  useEffect(() => {
    if (!selectedTemplateType && copyTemplates.length) {
      setSelectedTemplateType(copyTemplates[0].template_type);
    }
  }, [copyTemplates, selectedTemplateType]);

  useEffect(() => {
    if (!copyTemplates.length) {
      setSelectedTemplateType('');
    }
  }, [copyTemplates.length]);

  useEffect(() => {
    if (!selectedTemplateType) {
      setSelectedTemplate(null);
      return;
    }
    loadTemplateDetails(selectedTemplateType);
  }, [loadTemplateDetails, selectedTemplateType]);

  const handleCopy = useCallback(async () => {
    if (!selectedTemplate || !targetShopId || !targetLangId) return;
    setCopyState({ busy: true, message: '', error: '' });
    try {
      const payload = {
        template_type: selectedTemplate.template_type,
        id_shop: toInt(targetShopId),
        id_lang: toInt(targetLangId),
        subject: String(selectedTemplate.subject || ''),
        html_body: String(selectedTemplate.html_body || ''),
      };
      if (resolvedOrgId) payload.org_id = Number(resolvedOrgId);
      const resp = await fetch('/api/tools/email-from-template/template', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...orgHeaders },
        body: JSON.stringify(payload),
      });
      const data = await resp.json().catch(() => ({}));
      if (!(resp.ok && (data?.ok === undefined || data.ok === true))) {
        throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
      }
      setCopyState({
        busy: false,
        message: `Template copié vers Shop ${targetShopId || 0} / Lang ${targetLangId || 0}.`,
        error: '',
      });
    } catch (error) {
      setCopyState({
        busy: false,
        message: '',
        error: error?.message || 'Impossible de copier le template.',
      });
    }
  }, [orgHeaders, resolvedOrgId, selectedTemplate, targetLangId, targetShopId]);

  const targetShopLabel = useMemo(() => {
    const shop = shops.find((s) => String(s.id_shop) === String(targetShopId));
    return shop ? `${shop.name || `Shop ${shop.id_shop}`}` : 'target shop';
  }, [shops, targetShopId]);

  const handleSelectTemplate = useCallback(
    (templateType) => {
      if (!templateType) return;
      if (selectedTemplateType === templateType) {
        loadTemplateDetails(templateType);
        return;
      }
      setSelectedTemplateType(templateType);
    },
    [loadTemplateDetails, selectedTemplateType]
  );

  return (
    <div className="border rounded p-3 bg-white">
      <div className="text-sm font-medium mb-2">Copy template</div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <div>
          <label className="text-xs text-gray-600">Org ID (optional)</label>
          <input
            className="w-full border rounded px-2 py-1 bg-white"
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            placeholder="(empty = global)"
          />
        </div>
        <div>
          <label className="text-xs text-gray-600">MySQL profile (for shops & languages)</label>
          <select
            className="w-full border rounded px-2 py-1 bg-white"
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
            disabled={profilesLoading}
          >
            {profiles.length === 0 ? (
              <option value="">{profilesLoading ? 'Loading.' : 'No profiles.'}</option>
            ) : (
              profiles.map((p) => (
                <option key={String(p.id)} value={String(p.id)}>
                  {p.name ? `${p.name} (ID ${p.id})` : `Profile ${p.id}`}
                </option>
              ))
            )}
          </select>
          <div className="mt-1 flex items-center justify-between gap-2">
            <div className="text-[11px] text-gray-400">Lists MySQL shops & languages.</div>
            <button
              type="button"
              className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
              onClick={reloadProfiles}
              disabled={profilesLoading}
            >
              {profilesLoading ? 'Loading.' : 'Refresh'}
            </button>
          </div>
          {profilesError && <div className="text-xs text-red-600 mt-1">{profilesError}</div>}
        </div>
        <div>
          <label className="text-xs text-gray-600">Source Shop (MySQL)</label>
          <select
            className="w-full border rounded px-2 py-1 bg-white"
            value={sourceShopId}
            onChange={(e) => setSourceShopId(e.target.value)}
            disabled={shopsLoading || !String(profileId || '').trim()}
          >
            {shops.length === 0 ? (
              <option value="">{shopsLoading ? 'Loading.' : 'Select a profile.'}</option>
            ) : (
              shops.map((s) => (
                <option key={String(s.id_shop)} value={String(s.id_shop)}>
                  {s.name ? `${s.name} (ID ${s.id_shop})` : `Shop ${s.id_shop}`}
                </option>
              ))
            )}
          </select>
          <div className="mt-1 flex items-center justify-between gap-2">
            <div className="text-[11px] text-gray-400">Select the source shop.</div>
            <button
              type="button"
              className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
              onClick={reloadShops}
              disabled={shopsLoading}
            >
              {shopsLoading ? 'Loading.' : 'Refresh'}
            </button>
          </div>
          {shopsError && <div className="text-xs text-red-600 mt-1">{shopsError}</div>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <div>
          <label className="text-xs text-gray-600">Source Language (ps_lang)</label>
          <select
            className="w-full border rounded px-2 py-1 bg-white"
            value={sourceLangId}
            onChange={(e) => setSourceLangId(e.target.value)}
            disabled={sourceLanguagesLoading || !sourceShopId}
          >
            <option value="">{sourceLanguagesLoading ? 'Loading.' : 'Select a shop.'}</option>
            {sourceLanguages.map((lang) => (
              <option key={String(lang.id_lang)} value={String(lang.id_lang)}>
                {lang.iso_code ? `${lang.iso_code} — ${lang.name || ''} (ID ${lang.id_lang})` : `Lang ${lang.id_lang}`}
              </option>
            ))}
          </select>
          <div className="mt-1 text-[11px] text-gray-400 flex items-center justify-between gap-2">
            <span>Loaded via `ps_lang`.</span>
            <button
              type="button"
              className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
              onClick={() =>
                loadLanguagesFor({
                  shopId: sourceShopId,
                  setter: setSourceLanguages,
                  setId: setSourceLangId,
                  setLoading: setSourceLanguagesLoading,
                  setError: setSourceLanguagesError,
                  currentValue: sourceLangId,
                })
              }
              disabled={sourceLanguagesLoading}
            >
              {sourceLanguagesLoading ? 'Loading.' : 'Refresh'}
            </button>
          </div>
          {sourceLanguagesError && <div className="text-xs text-red-600 mt-1">{sourceLanguagesError}</div>}
        </div>
        <div>
          <label className="text-xs text-gray-600">Target Shop (MySQL)</label>
          <select
            className="w-full border rounded px-2 py-1 bg-white"
            value={targetShopId}
            onChange={(e) => setTargetShopId(e.target.value)}
            disabled={shopsLoading || !String(profileId || '').trim()}
          >
            {shops.length === 0 ? (
              <option value="">{shopsLoading ? 'Loading.' : 'Select a profile.'}</option>
            ) : (
              shops.map((s) => (
                <option key={String(s.id_shop)} value={String(s.id_shop)}>
                  {s.name ? `${s.name} (ID ${s.id_shop})` : `Shop ${s.id_shop}`}
                </option>
              ))
            )}
          </select>
          <div className="mt-1 text-[11px] text-gray-400">Target shop for the copied template.</div>
        </div>
        <div>
          <label className="text-xs text-gray-600">Target Language (ps_lang)</label>
          <select
            className="w-full border rounded px-2 py-1 bg-white"
            value={targetLangId}
            onChange={(e) => setTargetLangId(e.target.value)}
            disabled={targetLanguagesLoading || !targetShopId}
          >
            <option value="">{targetLanguagesLoading ? 'Loading.' : 'Select a shop.'}</option>
            {targetLanguages.map((lang) => (
              <option key={String(lang.id_lang)} value={String(lang.id_lang)}>
                {lang.iso_code ? `${lang.iso_code} — ${lang.name || ''} (ID ${lang.id_lang})` : `Lang ${lang.id_lang}`}
              </option>
            ))}
          </select>
          <div className="mt-1 flex items-center justify-between gap-2">
            <div className="text-[11px] text-gray-400">Target languages from `ps_lang`.</div>
            <button
              type="button"
              className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
              onClick={() =>
                loadLanguagesFor({
                  shopId: targetShopId,
                  setter: setTargetLanguages,
                  setId: setTargetLangId,
                  setLoading: setTargetLanguagesLoading,
                  setError: setTargetLanguagesError,
                  currentValue: targetLangId,
                })
              }
              disabled={targetLanguagesLoading}
            >
              {targetLanguagesLoading ? 'Loading.' : 'Refresh'}
            </button>
          </div>
          {targetLanguagesError && <div className="text-xs text-red-600 mt-1">{targetLanguagesError}</div>}
        </div>
      </div>

      <div className="rounded border border-dashed border-gray-200 bg-gray-50 p-3 mb-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Available templates</div>
          <div className="flex items-center gap-2">
            <input
              className="text-[11px] rounded border border-gray-200 px-2 py-1"
              placeholder="Filter template_type"
              value={copyQuery}
              onChange={(event) => setCopyQuery(event.target.value)}
            />
            <button
              type="button"
              className="text-[11px] px-2 py-1 rounded border bg-white hover:bg-gray-100"
              onClick={loadTemplates}
              disabled={copyTemplatesLoading}
            >
              {copyTemplatesLoading ? 'Chargement…' : 'Refresh'}
            </button>
          </div>
        </div>
        <div className="text-[11px] text-gray-500">
          Affiche les templates pour
          <span className="font-medium text-gray-700 ml-1">
            {sourceShopId ? `Shop ${sourceShopId}` : 'Shop non sélectionné'}
          </span>
          /
          <span className="font-medium text-gray-700 ml-1">
            {sourceLangId ? `Lang ID ${sourceLangId}` : 'Langue non sélectionnée'}
          </span>
        </div>
        {copyTemplatesLoading ? (
          <div className="text-xs text-gray-500">Chargement…</div>
        ) : copyTemplatesError ? (
          <div className="text-xs text-red-600">{copyTemplatesError}</div>
        ) : copyTemplates.length ? (
          <div className="grid gap-2 max-h-48 overflow-auto text-[11px]">
            {copyTemplates.map((item) => {
              const key = `${item.template_type}-${item.id_shop}-${item.id_lang}-${item.variants_count}`;
              const isSelected = selectedTemplateType === item.template_type;
              return (
                <div key={key} className="rounded border border-gray-200 bg-white p-2">
                  <div className="font-semibold">{item.template_type}</div>
                  <div className="text-[11px] text-gray-500">{item.subject || 'Sans sujet'}</div>
                  <div className="mt-1 text-[10px] text-gray-400 flex flex-wrap gap-2">
                    <span>Shop {item.id_shop ?? 0}</span>
                    <span>Lang {item.id_lang ?? 0}</span>
                    <span>{item.variants_count ? `${item.variants_count} variantes` : '1 variante'}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className={`text-[11px] px-2 py-1 rounded border ${
                        isSelected ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white hover:bg-gray-50'
                      }`}
                      onClick={() => handleSelectTemplate(item.template_type)}
                      disabled={templateLoading}
                    >
                      {isSelected ? 'Sélectionné' : templateLoading ? 'Chargement…' : 'Recharger'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-xs text-gray-500">{canListTemplates ? 'Aucun template trouvé.' : 'Choisissez une boutique et une langue.'}</div>
        )}
        {templateError && <div className="text-xs text-red-600">{templateError}</div>}
      </div>

      {selectedTemplate && (
        <div className="mb-3 text-sm text-gray-600">Template sélectionné: {selectedTemplate.template_type}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <div>
          <div className="text-xs text-gray-600 mb-1">Sujet (source)</div>
          <div className="rounded border border-gray-200 bg-white p-2 text-[11px]">
            {selectedTemplate?.subject || 'Aucun sujet'}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-600 mb-1">Prévisualisation (source)</div>
          <div className="rounded border border-gray-200 bg-white overflow-hidden">
            <EmailTemplatePreviewFrame
              html={selectedTemplate?.html_body || ''}
              title="copy_template_preview"
              height={200}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="text-xs px-3 py-1.5 rounded border bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
          onClick={handleCopy}
          disabled={copyState.busy || !selectedTemplate || !targetShopId || !targetLangId}
        >
          {copyState.busy ? 'Copie…' : `Copier vers ${targetShopLabel}`}
        </button>
        {copyState.message && <div className="text-xs text-green-700">{copyState.message}</div>}
        {copyState.error && <div className="text-xs text-red-600">{copyState.error}</div>}
      </div>
    </div>
  );
}
