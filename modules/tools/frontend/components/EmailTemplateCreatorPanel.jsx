import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import EmailTemplatePreviewFrame from './EmailTemplatePreviewFrame.jsx';
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

function HtmlEditor({ value, onChange }) {
  const editorRef = useRef(null);
  const handleInput = useCallback(() => {
    if (!editorRef.current) return;
    onChange(editorRef.current.innerHTML);
  }, [onChange]);

  useEffect(() => {
    if (!editorRef.current) return;
    const next = value || '';
    if (editorRef.current.innerHTML !== next) {
      editorRef.current.innerHTML = next;
    }
  }, [value]);

  const applyCommand = useCallback(
    (command, argument = null) => {
      if (!editorRef.current) return;
      editorRef.current.focus();
      document.execCommand(command, false, argument);
      handleInput();
    },
    [handleInput]
  );

  const handleLink = () => {
    const url = window.prompt('Lien complet (https://example.com)');
    if (!url) return;
    applyCommand('createLink', url);
  };

  const buttons = [
    { label: 'B', title: 'Gras', command: 'bold' },
    { label: 'I', title: 'Italique', command: 'italic' },
    { label: 'U', title: 'Souligné', command: 'underline' },
    { label: '• List', title: 'Liste à puces', command: 'insertUnorderedList' },
    { label: '1. List', title: 'Liste numérotée', command: 'insertOrderedList' },
  ];

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between text-[11px] text-gray-500 mb-1">
        <span>HTML body (éditeur riche)</span>
        <span className="text-[10px] text-gray-400">Format rapide</span>
      </div>
      <div className="rounded border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-wrap gap-1 border-b border-gray-100 bg-gray-50 p-2">
          {buttons.map((btn) => (
            <button
              key={btn.command}
              type="button"
              title={btn.title}
              className="text-[11px] font-semibold text-gray-600 rounded border border-gray-200 px-2 py-1 hover:bg-gray-100"
              onMouseDown={(event) => {
                event.preventDefault();
                applyCommand(btn.command);
              }}
            >
              {btn.label}
            </button>
          ))}
          <button
            type="button"
            title="Ajouter un lien"
            className="text-[11px] font-semibold text-gray-600 rounded border border-gray-200 px-2 py-1 hover:bg-gray-100"
            onMouseDown={(event) => {
              event.preventDefault();
              handleLink();
            }}
          >
            Lien
          </button>
        </div>
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          onInput={handleInput}
          className="min-h-[180px] rounded-b border border-t-0 border-gray-200 p-3 text-[12px] leading-relaxed text-gray-700 outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
    </div>
  );
}

export default function EmailTemplateCreatorPanel({
  orgId,
  setOrgId,
  headers = {},
  defaultProfileId = '',
}) {
  const resolvedOrgId = useMemo(() => coerceIntOrEmpty(orgId), [orgId]);
  const baseHeaders = useMemo(() => attachAdminHeaders(headers), [headers]);
  const orgHeaders = useMemo(() => {
    const out = { ...baseHeaders };
    if (resolvedOrgId) out['x-org-id'] = resolvedOrgId;
    return out;
  }, [baseHeaders, resolvedOrgId]);

  // For language list we want ALL languages from ps_lang (not shop-scoped).
  // Do not pass org headers so profiles are not filtered away.
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

  const [idLang, setIdLang] = useState('');
  const [templateType, setTemplateType] = useState('');
  const [subject, setSubject] = useState('');
  const [htmlBody, setHtmlBody] = useState('');

  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveOkMsg, setSaveOkMsg] = useState('');
  const [templateList, setTemplateList] = useState([]);
  const [templateListLoading, setTemplateListLoading] = useState(false);
  const [templateListError, setTemplateListError] = useState('');
  const [templateListQuery, setTemplateListQuery] = useState('');
  const [templateRenderLoadingKey, setTemplateRenderLoadingKey] = useState('');
  const [templateRenderError, setTemplateRenderError] = useState('');
  const [templateDeleteState, setTemplateDeleteState] = useState({ busy: false, message: '', error: '' });
 
  useEffect(() => {
    if (String(idLang || '').trim()) return;
    if (!Array.isArray(languages) || !languages.length) return;
    setIdLang(String(languages[0]?.id_lang ?? ''));
  }, [idLang, languages]);

  const effectiveTemplateType = String(templateType || '').trim();
  const effectiveLangId = coerceIntOrEmpty(idLang);
  const effectiveSubject = String(subject || '').trim() || effectiveTemplateType;
  const effectiveHtml = String(htmlBody || '');

  const canSave = !!effectiveTemplateType && !!effectiveLangId && !!String(effectiveHtml || '').trim();
  const loadTemplateList = useCallback(async () => {
    setTemplateListLoading(true);
    setTemplateListError('');
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (String(templateListQuery || '').trim()) params.set('q', String(templateListQuery || '').trim());
      if (String(idShop || '').trim()) params.set('id_shop', String(idShop));
      if (String(idLang || '').trim()) params.set('id_lang', String(idLang));
      const resp = await fetch(`/api/tools/email-from-template/types?${params.toString()}`, {
        credentials: 'include',
        headers: orgHeaders,
      });
      const data = await resp.json().catch(() => ({}));
      if (!(resp.ok && (data?.ok === undefined || data.ok === true))) {
        throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
      }
      const items = Array.isArray(data.items) ? data.items : [];
      setTemplateList(items);
    } catch (error) {
      setTemplateList([]);
      setTemplateListError(error?.message || 'Impossible de charger la liste des templates.');
    } finally {
      setTemplateListLoading(false);
    }
  }, [idLang, idShop, orgHeaders, templateListQuery]);

  const loadTemplateForEdit = useCallback(
    async (item) => {
      if (!item?.template_type) return;
      const key = `${String(item.template_type)}|${String(item.id_shop ?? '')}|${String(item.id_lang ?? '')}|${String(resolvedOrgId || '')}`;
      setTemplateRenderLoadingKey(key);
      setTemplateRenderError('');
      try {
        const params = new URLSearchParams({ template_type: String(item.template_type) });
        if (item.id_shop !== undefined && item.id_shop !== null) params.set('id_shop', String(item.id_shop));
        if (item.id_lang !== undefined && item.id_lang !== null) params.set('id_lang', String(item.id_lang));
        const resp = await fetch(`/api/tools/email-from-template/render?${params.toString()}`, {
          credentials: 'include',
          headers: orgHeaders,
        });
        const data = await resp.json().catch(() => ({}));
        if (!(resp.ok && (data?.ok === undefined || data.ok === true))) {
          throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
        }
        const loaded = data?.item || {};
        if (loaded.template_type) setTemplateType(loaded.template_type);
        if (loaded.subject) setSubject(loaded.subject);
        if (typeof loaded.html_body === 'string') setHtmlBody(loaded.html_body);
        if (loaded.id_lang !== undefined && loaded.id_lang !== null) setIdLang(String(loaded.id_lang));
        if (loaded.id_shop !== undefined && loaded.id_shop !== null) setIdShop(String(loaded.id_shop));
        if (loaded.org_id !== undefined && loaded.org_id !== null) setOrgId(String(loaded.org_id));
      } catch (error) {
        setTemplateRenderError(error?.message || 'Impossible de charger le template.');
      } finally {
        setTemplateRenderLoadingKey('');
      }
    },
    [orgHeaders, resolvedOrgId, setIdLang, setIdShop, setOrgId]
  );
  const resolvedShopId = (() => {
    const value = Number(idShop);
    return Number.isFinite(value) ? value : 0;
  })();
  const deleteTemplate = useCallback(
    async (item) => {
      if (!item?.template_type) return;
      setTemplateDeleteState({ busy: true, message: '', error: '' });
      try {
        const payload = {
          template_type: item.template_type,
          id_shop: item.id_shop ?? resolvedShopId,
          id_lang: item.id_lang ?? Number(effectiveLangId || 0),
        };
        if (resolvedOrgId) payload.org_id = Number(resolvedOrgId);
        const resp = await fetch('/api/tools/email-from-template/template', {
          method: 'DELETE',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...orgHeaders },
          body: JSON.stringify(payload),
        });
        const data = await resp.json().catch(() => ({}));
        if (!(resp.ok && data?.ok)) {
          throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
        }
        setTemplateDeleteState({ busy: false, message: 'Template supprimé.', error: '' });
        loadTemplateList();
      } catch (error) {
        setTemplateDeleteState({ busy: false, message: '', error: error?.message || 'Impossible de supprimer le template.' });
      }
    },
    [effectiveLangId, loadTemplateList, orgHeaders, resolvedOrgId, resolvedShopId]
  );
  const selectedShop = shops.find((s) => String(s.id_shop) === String(idShop));
  const selectedLanguage = (languages || []).find((l) => String(l.id_lang) === String(idLang));
  const onSave = async () => {
    setSaveLoading(true);
    setSaveError('');
    setSaveOkMsg('');
    try {
      const payload = {
        template_type: effectiveTemplateType,
        id_shop: resolvedShopId,
        id_lang: Number(effectiveLangId),
        subject: effectiveSubject,
        html_body: effectiveHtml,
      };
      if (resolvedOrgId) payload.org_id = Number(resolvedOrgId);

      const resp = await fetch('/api/tools/email-from-template/template', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...orgHeaders },
        body: JSON.stringify(payload),
      });
      const data = await resp.json().catch(() => ({}));
      if (!(resp.ok && data?.ok)) {
        setSaveError(getApiErrorMessage(data, 'Save failed.'));
        return;
      }
      setSaveOkMsg(`Saved to Postgres \`mod_tools_email_template\` (id_shop=${resolvedShopId}).`);
      setTimeout(() => setSaveOkMsg(''), 2500);
    } catch (error) {
      setSaveError(error?.message || 'Save failed.');
    } finally {
      setSaveLoading(false);
    }
  };

  useEffect(() => {
    if (!profileId && defaultProfileId) {
      setProfileId(String(defaultProfileId));
    }
  }, [defaultProfileId, profileId, setProfileId]);

  useEffect(() => {
    loadTemplateList();
  }, [loadTemplateList, idShop, idLang]);

  return (
    <div className="border rounded p-3 bg-white">
      <div className="text-sm font-medium mb-2">Creator</div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
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
          <label className="text-xs text-gray-600">MySQL profile (for languages list)</label>
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
            <div className="text-[11px] text-gray-400">Lists all active languages from `ps_lang`.</div>
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
          <label className="text-xs text-gray-600">Shop (MySQL)</label>
          <select
            className="w-full border rounded px-2 py-1 bg-white"
            value={idShop}
            onChange={(e) => setIdShop(e.target.value)}
            disabled={shopsLoading || !String(profileId || '').trim()}
          >
            {shops.length === 0 ? (
              <option value="">{shopsLoading ? 'Loading.' : 'Select a profile.'}</option>
            ) : (
              shops.map((s) => (
                <option key={String(s.id_shop)} value={String(s.id_shop)}>
                  {s.name ? `${s.name} (ID ${s.id_shop})` : `ID ${s.id_shop}`}
                </option>
              ))
            )}
          </select>
          <div className="mt-1 flex items-center justify-between gap-2">
            <div className="text-[11px] text-gray-400">Choose the shop tied to this template.</div>
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
        <div>
          <label className="text-xs text-gray-600">Language (ps_lang)</label>
          <select
            className="w-full border rounded px-2 py-1 bg-white"
            value={idLang}
            onChange={(e) => setIdLang(e.target.value)}
            disabled={languagesLoading || !String(profileId || '').trim()}
          >
            <option value="">{languagesLoading ? 'Loading.' : 'Select a language.'}</option>
            {(languages || []).map((l) => (
              <option key={String(l.id_lang)} value={String(l.id_lang)}>
                {l.iso_code ? `${l.iso_code} — ${l.name || ''} (ID ${l.id_lang})` : `${l.name || ''} (ID ${l.id_lang})`}
              </option>
            ))}
          </select>
          <div className="mt-1 flex items-center justify-between gap-2">
            <div className="text-[11px] text-gray-400">Saved with `id_shop=0` (global shop).</div>
            <button
              type="button"
              className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
              onClick={reloadLanguages}
              disabled={languagesLoading || !String(profileId || '').trim()}
            >
              {languagesLoading ? 'Loading.' : 'Refresh'}
            </button>
          </div>
          {languagesError && <div className="text-xs text-red-600 mt-1">{languagesError}</div>}
        </div>
      </div>

      <div className="rounded border border-dashed border-gray-200 bg-gray-50 p-3 mb-3 space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Available templates</div>
          <button
            type="button"
            className="text-[11px] px-2 py-1 rounded border bg-white hover:bg-gray-100"
            onClick={loadTemplateList}
            disabled={templateListLoading}
          >
            {templateListLoading ? 'Rechargement…' : 'Rafraîchir'}
          </button>
        </div>
        <div className="text-[11px] text-gray-500">
          Affiche les templates disponibles pour{" "}
          <span className="font-medium text-gray-700">
            {selectedShop ? `${selectedShop.name || `Shop ${selectedShop.id_shop}`}` : "Shop global"}
          </span>{" "}
          /
          <span className="font-medium text-gray-700">
            {selectedLanguage
              ? selectedLanguage.iso_code
                ? `${selectedLanguage.iso_code} (ID ${selectedLanguage.id_lang})`
                : `Lang ${selectedLanguage.id_lang}`
              : "Langue non sélectionnée"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="flex-1 rounded border border-gray-200 px-2 py-1 text-xs"
            value={templateListQuery}
            onChange={(event) => setTemplateListQuery(event.target.value)}
            placeholder="Filtrer par template_type"
          />
          <button
            type="button"
            className="text-[11px] px-2 py-1 rounded border bg-white hover:bg-gray-100"
            onClick={loadTemplateList}
            disabled={templateListLoading}
          >
            Rechercher
          </button>
        </div>
        {templateListLoading ? (
          <div className="text-xs text-gray-500">Chargement…</div>
        ) : templateListError ? (
          <div className="text-xs text-red-600">{templateListError}</div>
        ) : templateList.length ? (
          <div className="grid gap-2 max-h-48 overflow-auto text-[11px]">
            {templateList.map((item) => {
              const cardKey = `${String(item.template_type || '')}-${item.id_lang || ''}-${item.id_shop || ''}-${item.org_id || ''}`;
              const isLoadingCard = templateRenderLoadingKey === cardKey;
              return (
                <div key={cardKey} className="rounded border border-gray-200 bg-white p-2">
                  <div className="font-semibold">{String(item.template_type || '—')}</div>
                  <div className="text-gray-500">{String(item.subject || 'Sans sujet')}</div>
                  <div className="mt-1 text-[10px] text-gray-400 flex flex-wrap gap-2">
                    <span>Shop: {item.id_shop ?? 0}</span>
                    <span>Lang: {item.id_lang ?? 0}</span>
                    <span>{item.org_id ? `Org ${item.org_id}` : 'Global'}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="text-[11px] px-2 py-1 rounded border bg-white hover:bg-gray-50 disabled:opacity-60"
                      onClick={() => loadTemplateForEdit(item)}
                      disabled={isLoadingCard}
                    >
                      {isLoadingCard ? 'Chargement…' : 'Charger'}
                    </button>
                    <button
                      type="button"
                      className="text-[11px] px-2 py-1 rounded border border-red-200 bg-white text-red-600 hover:bg-red-50 disabled:opacity-60"
                      onClick={() => deleteTemplate(item)}
                      disabled={templateDeleteState.busy}
                    >
                      {templateDeleteState.busy ? 'Suppression…' : 'Supprimer'}
                    </button>
                    {isLoadingCard && <span className="text-[10px] text-gray-500">Loading template…</span>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-xs text-gray-500">Aucun template disponible.</div>
        )}
        {templateRenderError && <div className="text-xs text-red-600">{templateRenderError}</div>}
        {(templateDeleteState.message || templateDeleteState.error) && (
          <div className={`text-xs ${templateDeleteState.error ? 'text-red-600' : 'text-green-700'}`}>
            {templateDeleteState.error || templateDeleteState.message}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-xs text-gray-600">Template type</label>
          <input
            className="w-full border rounded px-2 py-1 bg-white"
            value={templateType}
            onChange={(e) => setTemplateType(e.target.value)}
            placeholder="e.g. order_conf"
          />
        </div>
        <div>
          <label className="text-xs text-gray-600">Subject</label>
          <input
            className="w-full border rounded px-2 py-1 bg-white"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="(optional: defaults to template type)"
          />
        </div>
      </div>
      <HtmlEditor value={htmlBody} onChange={setHtmlBody} />

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button
          type="button"
          className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
          onClick={onSave}
          disabled={!canSave || saveLoading}
        >
          {saveLoading ? 'Saving.' : 'Save'}
        </button>
        {saveOkMsg && <div className="text-xs text-green-700">{saveOkMsg}</div>}
        {saveError && <div className="text-xs text-red-600">{saveError}</div>}
      </div>

      <div>
        <div className="text-xs text-gray-600 mb-1">Preview</div>
        <EmailTemplatePreviewFrame html={effectiveHtml} title="creator_email_template_preview" height={360} />
      </div>
    </div>
  );
}
