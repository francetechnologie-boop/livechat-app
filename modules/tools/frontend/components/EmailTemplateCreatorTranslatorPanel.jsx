import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import EmailTemplateCreatorPanel from './EmailTemplateCreatorPanel.jsx';
import EmailTemplateCreatorTranslatorForm from './EmailTemplateCreatorTranslatorForm.jsx';
import EmailTemplateCreatorTranslatorEditor from './EmailTemplateCreatorTranslatorEditor.jsx';
import EmailTemplateCopyPanel from './EmailTemplateCopyPanel.jsx';
import { useMySqlProfilesShopsLanguages } from '../utils/useMySqlProfilesShopsLanguages.js';
import { attachAdminHeaders } from '../utils/adminHeaders.js';

function getApiErrorMessage(data, fallback) {
  const msg = data?.message || data?.error || '';
  return typeof msg === 'string' && msg.trim() ? msg.trim() : fallback;
}

function coerceIntOrEmpty(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  const n = Number(s);
  if (!Number.isFinite(n)) return '';
  return String(Math.trunc(n));
}

function findLang(languages, idLang) {
  const id = String(idLang || '').trim();
  if (!id) return null;
  return languages.find((l) => String(l.id_lang) === id) || null;
}

function stripHtmlTags(value) {
  const raw = String(value || '');
  return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export default function EmailTemplateCreatorTranslatorPanel({ headers = {}, defaultProfileId = '' }) {
  const [mode, setMode] = useState('creator');
  const [orgId, setOrgId] = useState('');
  const [templateType, setTemplateType] = useState('');
  const [templateTypesQuery, setTemplateTypesQuery] = useState('');
  const [templateTypes, setTemplateTypes] = useState([]);
  const [templateTypesLoading, setTemplateTypesLoading] = useState(false);
  const [templateTypesError, setTemplateTypesError] = useState('');
  const [promptConfigId, setPromptConfigId] = useState('');
  const [promptConfigs, setPromptConfigs] = useState([]);
  const [promptConfigsLoading, setPromptConfigsLoading] = useState(false);
  const [promptConfigsError, setPromptConfigsError] = useState('');
  const [sourceLangId, setSourceLangId] = useState('');
  const [targetLangIds, setTargetLangIds] = useState([]);
  const [activeTargetLangId, setActiveTargetLangId] = useState('');
  const [allLanguages, setAllLanguages] = useState([]);
  const [allLanguagesLoading, setAllLanguagesLoading] = useState(false);
  const [allLanguagesError, setAllLanguagesError] = useState('');
  const [source, setSource] = useState(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState('');
  const [targetLoading, setTargetLoading] = useState(false);
  const [targetError, setTargetError] = useState('');
  const [targetSubject, setTargetSubject] = useState('');
  const [targetHtml, setTargetHtml] = useState('');
  const [translateLoading, setTranslateLoading] = useState(false);
  const [translateError, setTranslateError] = useState('');
  const [draftRecipient, setDraftRecipient] = useState('');
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftMessage, setDraftMessage] = useState('');
  const [draftError, setDraftError] = useState('');

  const resolvedOrgId = coerceIntOrEmpty(orgId);
  const baseHeaders = useMemo(() => attachAdminHeaders(headers), [headers]);

  const orgHeaders = useMemo(() => {
    const out = { ...baseHeaders };
    if (resolvedOrgId) out['x-org-id'] = resolvedOrgId;
    return out;
  }, [baseHeaders, resolvedOrgId]);

  const [promptStoreLoading, setPromptStoreLoading] = useState(false);
  const [promptStoreError, setPromptStoreError] = useState('');
  const [promptStoreMessage, setPromptStoreMessage] = useState('');

  // Use base headers for listing MySQL profiles/shops/languages.
  // Org scoping for templates (orgId) should not hide profiles.
  const {
    profileId,
    setProfileId,
    profiles,
    profilesLoading,
    profilesError,
    idShop,
    setIdShop,
    shops,
    shopsLoading,
    shopsError,
    languages,
    languagesLoading,
    languagesError,
    reloadProfiles,
    reloadShops,
    reloadLanguages,
  } = useMySqlProfilesShopsLanguages({ headers: baseHeaders });

  useEffect(() => {
    if (!profileId && defaultProfileId) {
      setProfileId(String(defaultProfileId));
    }
  }, [defaultProfileId, profileId, setProfileId]);

  const resolvedSourceShopId = coerceIntOrEmpty(idShop);
  const [targetShopId, setTargetShopId] = useState('');
  const resolvedTargetShopId = coerceIntOrEmpty(targetShopId);
  const resolvedSourceLangId = coerceIntOrEmpty(sourceLangId);
  const resolvedActiveTargetLangId = coerceIntOrEmpty(activeTargetLangId);
  const resolvedTemplateType = String(templateType || '').trim();
  const resolvedPromptConfigId = String(promptConfigId || '').trim();


  useEffect(() => {
    if (!resolvedSourceShopId) {
      setTargetShopId('');
      return;
    }
    setTargetShopId((previous) => (previous ? previous : String(resolvedSourceShopId)));
  }, [resolvedSourceShopId]);

  const loadStoredPrompt = useCallback(async () => {
    setPromptStoreLoading(true);
    setPromptStoreError('');
    setPromptStoreMessage('');
    try {
      const resp = await fetch('/api/tools/settings/translation-prompt', {
        credentials: 'include',
        headers: orgHeaders,
      });
      const data = await resp.json().catch(() => ({}));
      if (!(resp.ok && data?.ok)) {
        throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
      }
      const stored = String(data.prompt_config_id || '').trim();
      setPromptConfigId(stored);
      setPromptStoreMessage(stored ? 'Loaded saved prompt.' : 'No saved prompt.');
    } catch (error) {
      setPromptStoreError(error?.message || 'Unable to load saved prompt.');
    } finally {
      setPromptStoreLoading(false);
    }
  }, [orgHeaders]);

  const savePromptConfig = useCallback(
    async (value) => {
      setPromptStoreError('');
      setPromptStoreMessage('');
      try {
        const payload = {
          prompt_config_id: value || null,
        };
        const resp = await fetch('/api/tools/settings/translation-prompt', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...orgHeaders },
          body: JSON.stringify(payload),
        });
        const data = await resp.json().catch(() => ({}));
        if (!(resp.ok && data?.ok)) {
          throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
        }
        setPromptStoreMessage(data.prompt_config_id ? 'Prompt saved.' : 'Prompt cleared.');
      } catch (error) {
        setPromptStoreError(error?.message || 'Unable to save prompt.');
      }
    },
    [orgHeaders]
  );

  const handlePromptConfigChange = useCallback(
    (value) => {
      const normalized = String(value || '').trim();
      setPromptConfigId(normalized);
      savePromptConfig(normalized ? normalized : null);
    },
    [savePromptConfig]
  );

  const sourceLang = useMemo(() => findLang(languages, resolvedSourceLangId), [languages, resolvedSourceLangId]);
  const activeTargetLang = useMemo(() => findLang(allLanguages, resolvedActiveTargetLangId), [allLanguages, resolvedActiveTargetLangId]);

  useEffect(() => {
    if (!languages.length) return;
    const first = String(languages[0]?.id_lang ?? '');
    if (first && !String(sourceLangId || '').trim()) setSourceLangId(first);
  }, [languages, sourceLangId]);

  useEffect(() => {
    if (languages.length) return;
    if (!String(sourceLangId || '').trim()) return;
    setSourceLangId('');
  }, [languages, sourceLangId]);

  const loadAllLanguages = async (profileIdValue) => {
    const pid = String(profileIdValue || '').trim();
    if (!pid) return;
    setAllLanguagesLoading(true);
    setAllLanguagesError('');
    try {
      const qs = new URLSearchParams({ profile_id: pid, id_shop: '0', limit: '500' });
      const resp = await fetch(`/api/product-search-index/mysql/languages?${qs.toString()}`, {
        credentials: 'include',
        headers: baseHeaders,
      });
      const data = await resp.json().catch(() => ({}));
      const ok = resp.ok && (data?.ok === undefined || data?.ok === true);
      if (!ok) {
        setAllLanguages([]);
        setAllLanguagesError(getApiErrorMessage(data, 'Failed to load languages.'));
        return;
      }
      const items = Array.isArray(data.items) ? data.items : [];
      setAllLanguages(items);
    } catch (error) {
      setAllLanguages([]);
      setAllLanguagesError(error?.message || 'Failed to load languages.');
    } finally {
      setAllLanguagesLoading(false);
    }
  };

  useEffect(() => {
    if (mode !== 'translator') return;
    if (!String(profileId || '').trim()) return;
    loadAllLanguages(profileId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, profileId]);

  useEffect(() => {
    if (!Array.isArray(targetLangIds) || !targetLangIds.length) {
      if (String(activeTargetLangId || '').trim()) setActiveTargetLangId('');
      return;
    }
    if (!String(activeTargetLangId || '').trim()) setActiveTargetLangId(String(targetLangIds[0]));
    else if (!targetLangIds.includes(String(activeTargetLangId))) setActiveTargetLangId(String(targetLangIds[0]));
  }, [activeTargetLangId, targetLangIds]);

  const orgHeadersRef = useRef(orgHeaders);

  useEffect(() => {
    orgHeadersRef.current = orgHeaders;
  }, [orgHeaders]);

  const templateTypesQueryRef = useRef(String(templateTypesQuery || '').trim());
  useEffect(() => {
    templateTypesQueryRef.current = String(templateTypesQuery || '').trim();
  }, [templateTypesQuery]);

  const loadTemplateTypes = useCallback(async ({ signal, query } = {}) => {
    setTemplateTypesLoading(true);
    setTemplateTypesError('');
    try {
      const qs = new URLSearchParams();
      qs.set('limit', '200');
      if (resolvedSourceShopId) qs.set('id_shop', resolvedSourceShopId);
      qs.set('id_lang', resolvedSourceLangId || '0');
      const qValue = String(query ?? templateTypesQueryRef.current).trim();
      if (qValue) qs.set('q', qValue);
      const resp = await fetch(`/api/tools/email-from-template/types?${qs.toString()}`, {
        credentials: 'include',
        headers: orgHeadersRef.current,
        signal,
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data?.ok) {
        const items = Array.isArray(data.items) ? data.items : [];
        setTemplateTypes(items);
      } else {
        setTemplateTypes([]);
        setTemplateTypesError(getApiErrorMessage(data, 'Failed to load template types.'));
      }
    } catch (error) {
      if (signal?.aborted) {
        return;
      }
      setTemplateTypes([]);
      setTemplateTypesError(error?.message || 'Failed to load template types.');
    } finally {
      setTemplateTypesLoading(false);
    }
  }, [resolvedSourceLangId, resolvedSourceShopId, templateTypesQuery]);

  useEffect(() => {
    if (mode !== 'translator') return;
    if (!resolvedSourceShopId) {
      setTemplateTypes([]);
      setTemplateTypesError('');
    }
  }, [mode, resolvedSourceShopId]);

  useEffect(() => {
    if (mode !== 'translator') return;
    setTemplateTypes([]);
    setTemplateTypesError('');
  }, [mode, resolvedSourceLangId]);

  useEffect(() => {
    if (mode !== 'translator') return;
    loadStoredPrompt();
  }, [mode, loadStoredPrompt]);

  const loadPromptConfigs = async () => {
    setPromptConfigsLoading(true);
    setPromptConfigsError('');
    try {
      const limit = '200';
      const qsGlobal = new URLSearchParams({ limit });
      const qsOrg = resolvedOrgId ? new URLSearchParams({ limit, org_id: resolvedOrgId }) : null;

      const items = [];
      const seen = new Set();

      const fetchOne = async (qs) => {
        const resp = await fetch(`/api/automation-suite/prompt-configs?${qs.toString()}`, {
          credentials: 'include',
          headers: baseHeaders,
        });
        const data = await resp.json().catch(() => ({}));
        if (!(resp.ok && data?.ok)) throw new Error(getApiErrorMessage(data, 'Failed to load prompt configs.'));
        const arr = Array.isArray(data.items) ? data.items : [];
        for (const row of arr) {
          const id = String(row?.id || '').trim();
          if (!id || seen.has(id)) continue;
          seen.add(id);
          items.push(row);
        }
      };

      await fetchOne(qsGlobal);
      if (qsOrg) await fetchOne(qsOrg);

      setPromptConfigs(items);
      if (!resolvedPromptConfigId && items.length) {
        const preferred =
          items.find((p) => p && Number(p.org_id) === Number(resolvedOrgId) && /email|template|translate/i.test(String(p.name || ''))) ||
          items.find((p) => p && /email|template|translate/i.test(String(p.name || ''))) ||
          items.find((p) => p && Number(p.org_id) === Number(resolvedOrgId)) ||
          items[0];
        setPromptConfigId(String(preferred?.id || items[0]?.id || ''));
      }
    } catch (error) {
      setPromptConfigs([]);
      setPromptConfigsError(String(error?.message || error));
    } finally {
      setPromptConfigsLoading(false);
    }
  };

  useEffect(() => {
    loadPromptConfigs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedOrgId]);

  useEffect(() => {
    if (mode !== 'translator') return;
    setSource(null);
    setTargetSubject('');
    setTargetHtml('');
    setSourceError('');
    setTargetError('');
    setTranslateError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mode,
    resolvedTemplateType,
    resolvedSourceShopId,
    resolvedTargetShopId,
    resolvedSourceLangId,
    resolvedActiveTargetLangId,
  ]);

  const renderFromDb = async (langId, shopId, setLoading, setError) => {
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams({
        template_type: resolvedTemplateType,
        id_shop: shopId || '0',
        id_lang: String(langId || '').trim() || '0',
      });
      const resp = await fetch(`/api/tools/email-from-template/render?${qs.toString()}`, { credentials: 'include', headers: orgHeaders });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data?.ok && data?.item) return data.item;
      setError(getApiErrorMessage(data, 'Failed to load template.'));
      return null;
    } catch (error) {
      setError(error?.message || 'Failed to load template.');
      return null;
    } finally {
      setLoading(false);
    }
  };

  const loadSource = async () => {
    setSource(null);
    setTranslateError('');
    const item = await renderFromDb(resolvedSourceLangId, resolvedSourceShopId, setSourceLoading, setSourceError);
    if (item) setSource(item);
    return item;
  };

  const loadTarget = async () => {
    setTranslateError('');
    const item = await renderFromDb(resolvedActiveTargetLangId, resolvedTargetShopId, setTargetLoading, setTargetError);
    if (item) {
      setTargetSubject(String(item.subject || ''));
      setTargetHtml(String(item.html_body || ''));
    }
    return item;
  };

  const handleLoadTemplate = useCallback(async () => {
    if (!resolvedTemplateType || !resolvedSourceShopId) return;
    await loadSource();
    if (resolvedTargetShopId && resolvedActiveTargetLangId) {
      await loadTarget();
    }
  }, [
    loadSource,
    loadTarget,
    resolvedSourceShopId,
    resolvedTargetShopId,
    resolvedActiveTargetLangId,
    resolvedTemplateType,
  ]);

  const copySourceToTarget = () => {
    setTranslateError('');
    if (!source) return;
    setTargetSubject(String(source.subject || ''));
    setTargetHtml(String(source.html_body || ''));
  };

  const translateSourceToTarget = async () => {
    setTranslateLoading(true);
    setTranslateError('');
    try {
      const from = String(sourceLang?.iso_code || sourceLang?.name || '').trim();
      const to = String(activeTargetLang?.iso_code || activeTargetLang?.name || '').trim();
      let src = source;
      if (!src) src = await loadSource();
      if (!src) return setTranslateError('Source template not found for this template/shop/source language.');
      if (!to) return setTranslateError('Pick a target language first.');
      if (!resolvedPromptConfigId) return setTranslateError('Select a translation prompt first.');

      const payload = {
        subject: String(src.subject || ''),
        html_body: String(src.html_body || ''),
        from_lang: from || undefined,
        to_lang: to,
        prompt_config_id: resolvedPromptConfigId,
      };
      const resp = await fetch('/api/tools/email-template/translate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...orgHeaders },
        body: JSON.stringify(payload),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data?.ok) {
        setTargetSubject(String(data.subject || ''));
        setTargetHtml(String(data.html_body || ''));
      } else {
        setTranslateError(getApiErrorMessage(data, 'Translation failed.'));
      }
    } catch (error) {
      setTranslateError(error?.message || 'Translation failed.');
    } finally {
      setTranslateLoading(false);
    }
  };

  const translateAndSaveSelectedTargets = async () => {
    setTranslateLoading(true);
    setTranslateError('');
    try {
      const selected = Array.isArray(targetLangIds) ? targetLangIds.map(String).filter(Boolean) : [];
      if (!selected.length) return setTranslateError('Select at least one target language.');
      if (!resolvedPromptConfigId) return setTranslateError('Select a translation prompt first.');

      const from = String(sourceLang?.iso_code || sourceLang?.name || '').trim();
      let src = source;
      if (!src) src = await loadSource();
      if (!src) return setTranslateError('Source template not found for this template/shop/source language.');

      let saved = 0;
      for (const langId of selected) {
        const lang = findLang(allLanguages, langId);
        const to = String(lang?.iso_code || lang?.name || '').trim();
        if (!to) continue;

        const payload = {
          subject: String(src.subject || ''),
          html_body: String(src.html_body || ''),
          from_lang: from || undefined,
          to_lang: to,
          prompt_config_id: resolvedPromptConfigId,
        };
        const r1 = await fetch('/api/tools/email-template/translate', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...orgHeaders },
          body: JSON.stringify(payload),
        });
        const j1 = await r1.json().catch(() => ({}));
        if (!(r1.ok && j1?.ok)) continue;

        const body = {
          template_type: resolvedTemplateType,
          id_shop: resolvedTargetShopId ? Number(resolvedTargetShopId) : 0,
          id_lang: Number(coerceIntOrEmpty(langId) || 0),
          subject: String(j1.subject || ''),
          html_body: String(j1.html_body || ''),
        };
        if (resolvedOrgId) body.org_id = Number(resolvedOrgId);

        const r2 = await fetch('/api/tools/email-from-template/template', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...orgHeaders },
          body: JSON.stringify(body),
        });
        const j2 = await r2.json().catch(() => ({}));
        if (r2.ok && j2?.ok) {
          saved += 1;
          setActiveTargetLangId(String(langId));
          setTargetSubject(String(j1.subject || ''));
          setTargetHtml(String(j1.html_body || ''));
        }
      }
      if (!saved) return setTranslateError('No translations were saved (check prompt/languages).');
    } catch (error) {
      setTranslateError(error?.message || 'Batch translation failed.');
    } finally {
      setTranslateLoading(false);
    }
  };

  const saveTarget = async () => {
    setTargetLoading(true);
    setTargetError('');
    try {
      const body = {
        template_type: resolvedTemplateType,
        id_shop: resolvedTargetShopId ? Number(resolvedTargetShopId) : 0,
        id_lang: resolvedActiveTargetLangId ? Number(resolvedActiveTargetLangId) : 0,
        subject: targetSubject,
        html_body: targetHtml,
      };
      if (resolvedOrgId) body.org_id = Number(resolvedOrgId);

      const resp = await fetch('/api/tools/email-from-template/template', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...orgHeaders },
        body: JSON.stringify(body),
      });
      const data = await resp.json().catch(() => ({}));
      if (!(resp.ok && data?.ok)) {
        setTargetError(getApiErrorMessage(data, 'Save failed.'));
      }
    } catch (error) {
      setTargetError(error?.message || 'Save failed.');
    } finally {
      setTargetLoading(false);
    }
  };

  const canRender = resolvedTemplateType && resolvedSourceShopId && resolvedSourceLangId;
  const canSave = resolvedTemplateType && resolvedTargetShopId && resolvedActiveTargetLangId;
  const canTranslate =
    !!canRender && !!resolvedTargetShopId && !!resolvedActiveTargetLangId && !!resolvedPromptConfigId;
  const canBatchTranslate =
    !!canRender && !!resolvedTargetShopId && !!resolvedPromptConfigId && Array.isArray(targetLangIds) && targetLangIds.length > 0;
  const resolvedDraftRecipient = String(draftRecipient || '').trim();
  const draftContentSubject = String(targetSubject || source?.subject || '').trim();
  const draftContentHtml = String(targetHtml || source?.html_body || '').trim();
  const hasDraftContent = Boolean(draftContentSubject || draftContentHtml);
  const canCreateDraft = Boolean(resolvedDraftRecipient && hasDraftContent);
  const createGmailDraft = useCallback(async () => {
    setDraftError('');
    setDraftMessage('');
    const to = String(draftRecipient || '').trim();
    if (!to) {
      setDraftError('Enter a recipient email.');
      return;
    }
    if (!draftContentSubject && !draftContentHtml) {
      setDraftError('Load a template before creating a draft.');
      return;
    }
    const textValue = String(stripHtmlTags(draftContentHtml) || draftContentSubject || '');
    setDraftLoading(true);
    try {
      const resp = await fetch('/api/tools/email-template/draft', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...orgHeaders },
        body: JSON.stringify({
          to,
          subject: draftContentSubject,
          html_body: draftContentHtml,
          text: textValue,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data?.ok) {
        setDraftMessage('Gmail draft created.');
      } else {
        throw new Error(getApiErrorMessage(data, 'Failed to create Gmail draft.'));
      }
    } catch (error) {
      setDraftError(error?.message || 'Failed to create Gmail draft.');
    } finally {
      setDraftLoading(false);
    }
  }, [draftRecipient, draftContentSubject, draftContentHtml, orgHeaders]);
  const errorMessage = sourceError || targetError || translateError || allLanguagesError || '';

  const sourceLabel = sourceLang?.iso_code || sourceLang?.name || `ID ${resolvedSourceLangId || '?'}`;
  const targetLabel = activeTargetLang?.iso_code || activeTargetLang?.name || `ID ${resolvedActiveTargetLangId || '?'}`;

  return (
    <div className="border rounded p-3 bg-white">
      <div className="text-sm font-medium mb-2">Template creator & translator</div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button
          type="button"
          onClick={() => setMode('creator')}
          className={`text-xs px-3 py-1.5 rounded border transition-colors ${
            mode === 'creator' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white hover:bg-gray-50'
          }`}
        >
          Creator
        </button>
        <button
          type="button"
          onClick={() => setMode('translator')}
          className={`text-xs px-3 py-1.5 rounded border transition-colors ${
            mode === 'translator' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white hover:bg-gray-50'
          }`}
        >
          Translator
        </button>
        <button
          type="button"
          onClick={() => setMode('copy')}
          className={`text-xs px-3 py-1.5 rounded border transition-colors ${
            mode === 'copy' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white hover:bg-gray-50'
          }`}
        >
          Copy template
        </button>
      </div>

      {mode === 'creator' && (
        <EmailTemplateCreatorPanel
          orgId={orgId}
          setOrgId={setOrgId}
          headers={headers}
          defaultProfileId={defaultProfileId}
        />
      )}
      {mode === 'translator' && (
        <>
          <EmailTemplateCreatorTranslatorForm
            orgId={orgId}
            setOrgId={setOrgId}
            profileId={profileId}
            setProfileId={setProfileId}
            profiles={profiles}
            profilesLoading={profilesLoading}
            profilesError={profilesError}
            promptConfigId={promptConfigId}
            promptConfigs={promptConfigs}
            promptConfigsLoading={promptConfigsLoading}
            promptConfigsError={promptConfigsError}
            reloadPromptConfigs={loadPromptConfigs}
            templateType={templateType}
            setTemplateType={setTemplateType}
            templateTypesQuery={templateTypesQuery}
            setTemplateTypesQuery={setTemplateTypesQuery}
            templateTypes={templateTypes}
            templateTypesLoading={templateTypesLoading}
            templateTypesError={templateTypesError}
            reloadTemplateTypes={loadTemplateTypes}
            idShop={idShop}
            setIdShop={setIdShop}
            shops={shops}
            shopsLoading={shopsLoading}
            shopsError={shopsError}
            targetShopId={targetShopId}
            setTargetShopId={setTargetShopId}
            reloadShops={reloadShops}
            reloadLanguages={reloadLanguages}
            sourceLangId={sourceLangId}
            setSourceLangId={setSourceLangId}
            targetLangIds={targetLangIds}
            setTargetLangIds={setTargetLangIds}
            activeTargetLangId={activeTargetLangId}
            setActiveTargetLangId={setActiveTargetLangId}
            allLanguages={allLanguages}
            allLanguagesLoading={allLanguagesLoading}
            languages={languages}
            languagesLoading={languagesLoading}
            languagesError={languagesError}
            promptStoreLoading={promptStoreLoading}
            promptStoreMessage={promptStoreMessage}
            promptStoreError={promptStoreError}
            onPromptConfigChange={handlePromptConfigChange}
            canRender={!!canRender}
            canSave={!!canSave}
            canTranslate={canTranslate}
            canBatchTranslate={canBatchTranslate}
            hasSource={!!source}
            sourceLoading={sourceLoading}
            targetLoading={targetLoading}
            translateLoading={translateLoading}
            loadSource={loadSource}
            loadTarget={loadTarget}
            loadTemplate={handleLoadTemplate}
            canLoadTemplate={Boolean(resolvedTemplateType && resolvedSourceShopId)}
            loadTemplateLoading={sourceLoading || targetLoading}
            copySourceToTarget={copySourceToTarget}
            translateSourceToTarget={translateSourceToTarget}
            translateAndSaveSelectedTargets={translateAndSaveSelectedTargets}
            saveTarget={saveTarget}
            recipientEmail={draftRecipient}
            setRecipientEmail={setDraftRecipient}
            draftLoading={draftLoading}
            draftError={draftError}
            draftMessage={draftMessage}
            createDraft={createGmailDraft}
            canCreateDraft={canCreateDraft}
            errorMessage={errorMessage}
          />

          <EmailTemplateCreatorTranslatorEditor
            source={source}
            sourceLabel={sourceLabel}
            targetLabel={targetLabel}
            targetSubject={targetSubject}
            setTargetSubject={setTargetSubject}
            targetHtml={targetHtml}
            setTargetHtml={setTargetHtml}
          />
        </>
      )}
      {mode === 'copy' && (
        <EmailTemplateCopyPanel
          headers={headers}
          orgHeaders={orgHeaders}
          orgId={orgId}
          setOrgId={setOrgId}
          resolvedOrgId={resolvedOrgId}
          profileId={profileId}
          setProfileId={setProfileId}
          profiles={profiles}
          profilesLoading={profilesLoading}
          profilesError={profilesError}
          reloadProfiles={reloadProfiles}
          shops={shops}
          shopsLoading={shopsLoading}
          shopsError={shopsError}
          reloadShops={reloadShops}
        />
      )}
    </div>
  );
}
