import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import tinymce from 'tinymce/tinymce.js';
import 'tinymce/icons/default/index.js';
import 'tinymce/themes/silver/index.js';
import 'tinymce/plugins/autolink/index.js';
import 'tinymce/plugins/link/index.js';
import 'tinymce/plugins/lists/index.js';
import 'tinymce/plugins/code/index.js';

function stripHtmlTags(value = '') {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function getApiErrorMessage(data, fallback) {
  const msg = data?.message || data?.error || '';
  if (typeof msg === 'string' && msg.trim()) return msg.trim();
  return fallback;
}

function normalizeDomain(meta = {}) {
  const direct = String(meta.shop_domain || meta.domain || '').trim();
  if (direct) return direct.replace(/^https?:\/\//i, '').split('/')[0] || '';
  const url = String(meta.shop_url || '').trim();
  if (url) {
    try {
      return new URL(url).hostname || '';
    } catch {}
  }
  return '';
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

function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildSignatureBlock({
  vendorContactName = '',
  vendorCompanyName = '',
  vendorPhone = '',
  vendorEmail = '',
  vendorDomain = '',
  shopUrl = '',
  logoUrl = '',
} = {}) {
  const contactLine = vendorContactName || vendorCompanyName || '';
  const rows = [];
  if (contactLine) {
    rows.push(`<div style="font-size:12px;color:#111827;font-weight:600;margin:0 0 6px 0;">${escapeHtml(contactLine)}</div>`);
  }
  if (vendorPhone) {
    rows.push(
      `<div style="font-size:12px;color:#111827;margin:0 0 2px 0;">Tel ${escapeHtml(vendorPhone)}</div>`
    );
  }
  if (vendorEmail) {
    rows.push(
      `<div style="font-size:12px;color:#111827;margin:0 0 2px 0;">Email <a href="mailto:${escapeHtml(
        vendorEmail
      )}" style="color:#2563eb;text-decoration:underline;">${escapeHtml(vendorEmail)}</a></div>`
    );
  }
  const normalizedWebUrl = shopUrl || (vendorDomain ? `https://${vendorDomain.replace(/\/+$/, '')}/` : '');
  if (normalizedWebUrl) {
    const text = vendorDomain || normalizedWebUrl;
    rows.push(
      `<div style="font-size:12px;color:#111827;margin:0 0 6px 0;">Web <a href="${escapeHtml(
        normalizedWebUrl
      )}" target="_blank" rel="noreferrer" style="color:#2563eb;text-decoration:underline;">${escapeHtml(text)}</a></div>`
    );
  }
  const hasContent = rows.length > 0 || logoUrl;
  if (!hasContent) return '';
  const logoBlock = logoUrl
    ? `<div style="margin-top:6px;">
        <img src="${escapeHtml(logoUrl)}" alt="Logo" style="height:42px;max-width:120px;object-fit:contain;display:block;border:0;outline:none;text-decoration:none;" />
      </div>`
    : '';
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" width="100%" bgcolor="#ffffff" style="max-width:680px;width:100%;background:#ffffff;border:1px solid #dcdfe6;border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;">
      <tr>
        <td style="padding:12px 16px;font-family:Arial,Helvetica,sans-serif;border-top:1px solid #e5e7eb;">
          ${rows.join('')}
          ${logoBlock}
        </td>
      </tr>
    </table>`;
}

function wrapSignature(signature) {
  if (!signature) return '';
  return `<div style="margin-top:28px;">${signature}</div>`;
}

function appendSignature(html, signature) {
  if (!signature) return String(html || '');
  const base = String(html || '');
  const block = wrapSignature(signature);
  return base ? `${base}${block}` : block;
}

function extractBodyInnerHtml(html = '') {
  const value = String(html || '');
  const match = value.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return match ? match[1] : value;
}

function injectBodyInnerHtml(baseHtml = '', bodyInner = '') {
  const base = String(baseHtml || '');
  const body = String(bodyInner || '');
  if (!base) return body;
  if (!/<body\b/i.test(base)) return body;
  return base.replace(/<body[^>]*>[\s\S]*?<\/body>/i, (fullMatch) => {
    const open = fullMatch.match(/<body[^>]*>/i)?.[0] || '<body>';
    return `${open}${body}</body>`;
  });
}

export default function EmailFromDbTemplatePanel({
  headers,
  defaultProfileId = '',
  defaultShopId = '',
  defaultLangId = '',
}) {

  const [profileId, setProfileId] = useState('');
  const [idShop, setIdShop] = useState('');
  const [idLang, setIdLang] = useState('');
  const [profiles, setProfiles] = useState([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [profilesError, setProfilesError] = useState('');

  const [shops, setShops] = useState([]);
  const [shopsLoading, setShopsLoading] = useState(false);
  const [shopsError, setShopsError] = useState('');

  const [languages, setLanguages] = useState([]);
  const [languagesLoading, setLanguagesLoading] = useState(false);
  const [languagesError, setLanguagesError] = useState('');

  const [types, setTypes] = useState([]);
  const [typesLoading, setTypesLoading] = useState(false);
  const [typesError, setTypesError] = useState('');
  const [selectedType, setSelectedType] = useState('');

  const [renderLoading, setRenderLoading] = useState(false);
  const [renderError, setRenderError] = useState('');
  const [item, setItem] = useState(null);

  const [copyMsg, setCopyMsg] = useState('');
  const [vendorMetaLoading, setVendorMetaLoading] = useState(false);
  const [vendorMetaError, setVendorMetaError] = useState('');
  const [vendorEmail, setVendorEmail] = useState('');
  const [vendorDomain, setVendorDomain] = useState('');
  const [vendorContactName, setVendorContactName] = useState('');
  const [vendorCompanyName, setVendorCompanyName] = useState('');
  const [vendorPhone, setVendorPhone] = useState('');
  const [vendorShopUrl, setVendorShopUrl] = useState('');
  const [vendorLogoUrl, setVendorLogoUrl] = useState('');
  const [toEmail, setToEmail] = useState('');
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftMessage, setDraftMessage] = useState('');
  const [draftError, setDraftError] = useState('');
  const [editedHtml, setEditedHtml] = useState('');
  const editorMountRef = useRef(null);
  const tinymceEditorRef = useRef(null);
  const [hasForcedDefaultShop, setHasForcedDefaultShop] = useState(false);

  const resolvedHeaders = useMemo(() => {
    return headers && typeof headers === 'object' ? headers : {};
  }, [headers]);

  useEffect(() => {
    if (!profileId && defaultProfileId) setProfileId(String(defaultProfileId));
    if (!idShop && defaultShopId) setIdShop(String(defaultShopId));
    if (!idLang && defaultLangId) setIdLang(String(defaultLangId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (hasForcedDefaultShop) return;
    const fallback = shops.find((s) => String(s.id_shop) === '3');
    if (fallback) {
      setIdShop('3');
      setHasForcedDefaultShop(true);
    }
  }, [shops, hasForcedDefaultShop]);

  const handleShopChange = useCallback(
    (value) => {
      setIdShop(value);
      setHasForcedDefaultShop(true);
    },
    [setIdShop]
  );

  useEffect(() => {
    setHasForcedDefaultShop(false);
  }, [profileId]);

  const loadProfiles = async () => {
    setProfilesLoading(true);
    setProfilesError('');
    try {
      const resp = await fetch('/api/db-mysql/profiles?limit=200', {
        credentials: 'include',
        headers: resolvedHeaders,
      });
      const data = await resp.json().catch(() => ({}));
      const ok = resp.ok && (data?.ok === undefined || data?.ok === true);
      if (ok) {
        const items = Array.isArray(data.items) ? data.items : [];
        setProfiles(items);
        if (!String(profileId || '').trim() && items.length) {
          const preferred = items.find((p) => p && p.is_default) || items[0];
          setProfileId(String(preferred?.id || items[0]?.id || ''));
        }
      } else {
        setProfiles([]);
        if (resp.status === 401 || resp.status === 403) setProfilesError('Admin required to list MySQL profiles.');
        else setProfilesError(getApiErrorMessage(data, 'Failed to load MySQL profiles.'));
      }
    } catch (error) {
      setProfiles([]);
      setProfilesError(error?.message || 'Failed to load MySQL profiles.');
    } finally {
      setProfilesLoading(false);
    }
  };

  const loadShops = async (pId) => {
    const pid = String(pId || '').trim();
    if (!pid) return;
    setShopsLoading(true);
    setShopsError('');
    try {
      const params = new URLSearchParams({ profile_id: pid, limit: '200' });
      const resp = await fetch(`/api/product-search-index/mysql/shops?${params.toString()}`, {
        credentials: 'include',
        headers: resolvedHeaders,
      });
      const data = await resp.json().catch(() => ({}));
      const ok = resp.ok && (data?.ok === undefined || data?.ok === true);
      if (ok) {
        const items = Array.isArray(data.items) ? data.items : [];
        setShops(items);
        if (!String(idShop || '').trim() && items.length) {
          setIdShop(String(items[0].id_shop));
        }
      } else {
        setShops([]);
        setShopsError(getApiErrorMessage(data, 'Failed to load shops.'));
      }
    } catch (error) {
      setShops([]);
      setShopsError(error?.message || 'Failed to load shops.');
    } finally {
      setShopsLoading(false);
    }
  };

  const loadLanguages = async (pId, sId) => {
    const pid = String(pId || '').trim();
    const sid = String(sId || '').trim();
    if (!pid || !sid) return;
    setLanguagesLoading(true);
    setLanguagesError('');
    try {
      const params = new URLSearchParams({ profile_id: pid, id_shop: sid, limit: '200' });
      const resp = await fetch(`/api/product-search-index/mysql/languages?${params.toString()}`, {
        credentials: 'include',
        headers: resolvedHeaders,
      });
      const data = await resp.json().catch(() => ({}));
      const ok = resp.ok && (data?.ok === undefined || data?.ok === true);
      if (ok) {
        const items = Array.isArray(data.items) ? data.items : [];
        setLanguages(items);
        if (!String(idLang || '').trim() && items.length) {
          setIdLang(String(items[0].id_lang));
        }
      } else {
        setLanguages([]);
        setLanguagesError(getApiErrorMessage(data, 'Failed to load languages.'));
      }
    } catch (error) {
      setLanguages([]);
      setLanguagesError(error?.message || 'Failed to load languages.');
    } finally {
      setLanguagesLoading(false);
    }
  };

  useEffect(() => {
    loadProfiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setShops([]);
    setLanguages([]);
    setShopsError('');
    setLanguagesError('');
    if (String(profileId || '').trim()) loadShops(profileId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  useEffect(() => {
    if (String(idShop || '').trim()) return;
    const preferredShop = shops.find((s) => String(s.id_shop) === '3');
    if (preferredShop) setIdShop('3');
  }, [shops, idShop]);

  useEffect(() => {
    setLanguages([]);
    setLanguagesError('');
    if (String(profileId || '').trim() && String(idShop || '').trim()) loadLanguages(profileId, idShop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, idShop]);

  useEffect(() => {
    const pid = String(profileId || '').trim();
    const sid = String(idShop || '').trim();
    if (!pid || !sid) {
      setVendorEmail('');
      setVendorDomain('');
      setVendorContactName('');
      setVendorCompanyName('');
      setVendorPhone('');
      setVendorShopUrl('');
      setVendorLogoUrl('');
      setVendorMetaError('');
      setVendorMetaLoading(false);
      return;
    }
    let active = true;
    const controller = new AbortController();
    const fetchVendorMeta = async () => {
      setVendorMetaLoading(true);
      setVendorMetaError('');
      setVendorEmail('');
      setVendorDomain('');
      setVendorContactName('');
      setVendorCompanyName('');
      setVendorPhone('');
      setVendorShopUrl('');
      setVendorLogoUrl('');
      try {
        const params = new URLSearchParams({ profile_id: pid, id_shop: sid });
        const resp = await fetch(`/api/tools/devis/vendor-meta?${params.toString()}`, {
          credentials: 'include',
          headers: resolvedHeaders,
          signal: controller.signal,
        });
        const data = await resp.json().catch(() => ({}));
        if (!active) return;
        if (resp.ok && data?.ok && data?.meta) {
          const meta = data.meta || {};
          setVendorEmail(String(meta.vendor_email || meta.shop_email || '').trim());
          setVendorDomain(normalizeDomain(meta));
          setVendorContactName(String(meta.vendor_contact_name || '').trim());
          setVendorCompanyName(String(meta.vendor_company_name || '').trim());
          setVendorPhone(String(meta.vendor_phone || '').trim());
          setVendorShopUrl(String(meta.shop_url || '').trim());
          setVendorLogoUrl(String(meta.logo_url || '').trim());
          setVendorMetaError('');
        } else {
          setVendorEmail('');
          setVendorDomain('');
          setVendorContactName('');
          setVendorCompanyName('');
          setVendorPhone('');
          setVendorShopUrl('');
          setVendorLogoUrl('');
          setVendorMetaError(getApiErrorMessage(data, 'Failed to load shop metadata.'));
        }
      } catch (error) {
        if (error?.name === 'AbortError') return;
        setVendorEmail('');
        setVendorDomain('');
        setVendorContactName('');
        setVendorCompanyName('');
        setVendorPhone('');
        setVendorShopUrl('');
        setVendorLogoUrl('');
        setVendorMetaError(error?.message || 'Failed to load shop metadata.');
      } finally {
        if (active) setVendorMetaLoading(false);
      }
    };
    fetchVendorMeta();
    return () => {
      active = false;
      controller.abort();
    };
  }, [profileId, idShop, resolvedHeaders]);

  const typeOptions = useMemo(() => {
    return (Array.isArray(types) ? types : []).map((t) => ({
      value: String(t.template_type || '').trim(),
      label: String(t.template_type || '').trim(),
      hint: t.subject ? String(t.subject).slice(0, 80) : '',
      variants: Number(t.variants_count || 0) || 0,
      hasHtml: !!t.has_html,
    })).filter((x) => x.value);
  }, [types]);

  const effectiveType = useMemo(() => {
    return String(selectedType || '').trim();
  }, [selectedType]);

  useEffect(() => {
    if (selectedType) return;
    if (!typeOptions.length) return;
    setSelectedType(typeOptions[0].value);
  }, [selectedType, setSelectedType, typeOptions]);

  const loadTypes = useCallback(async () => {
    setTypesLoading(true);
    setTypesError('');
    setTypes([]);
    try {
      const params = new URLSearchParams();
      if (idShop && String(idShop).trim()) params.set('id_shop', String(idShop).trim());
      if (idLang && String(idLang).trim()) params.set('id_lang', String(idLang).trim());
      params.set('limit', '200');
      const resp = await fetch(`/api/tools/email-from-template/types?${params.toString()}`, {
        credentials: 'include',
        headers: resolvedHeaders,
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data?.ok) {
        const items = Array.isArray(data.items) ? data.items : [];
        setTypes(items);
      } else {
        setTypesError(getApiErrorMessage(data, 'Failed to load template types.'));
      }
    } catch (error) {
      setTypesError(error?.message || 'Failed to load template types.');
    } finally {
      setTypesLoading(false);
    }
  }, [resolvedHeaders, idLang, idShop]);

  useEffect(() => {
    if (!profileId || !idShop || !idLang) return;
    loadTypes();
  }, [profileId, idShop, idLang, loadTypes]);

  const lastRenderKeyRef = useRef('');

  const render = useCallback(async (options = {}) => {
    const { force = false } = options;
    const typeChunk = selectedType || '';
    const key = `${typeChunk}-${idShop || ''}-${idLang || ''}`;
    if (!force && key && key === lastRenderKeyRef.current) {
      return;
    }
    setRenderLoading(true);
    setRenderError('');
    try {
      const params = new URLSearchParams();
      params.set('template_type', effectiveType);
      params.set('id_shop', String(idShop || '0').trim() || '0');
      params.set('id_lang', String(idLang || '0').trim() || '0');
      const resp = await fetch(`/api/tools/email-from-template/render?${params.toString()}`, {
        credentials: 'include',
        headers: resolvedHeaders,
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data?.ok && data?.item) {
        setItem(data.item);
        if (key) lastRenderKeyRef.current = key;
      } else {
        setRenderError(getApiErrorMessage(data, 'Template not found.'));
      }
    } catch (error) {
      setRenderError(error?.message || 'Failed to render template.');
      } finally {
        setRenderLoading(false);
      }
  }, [effectiveType, resolvedHeaders, idLang, idShop, selectedType]);

  useEffect(() => {
    if (!selectedType) return;
    if (!idShop || !idLang) return;
    render({ force: true });
  }, [selectedType, idShop, idLang, render]);

  const subjectWithDomain = vendorDomain
    ? `[${vendorDomain}] ${String(item?.subject || '').trim()}`
    : String(item?.subject || '');

  const copySubject = async () => {
    const ok = await copyToClipboard(subjectWithDomain);
    setCopyMsg(ok ? 'Subject copied.' : 'Copy failed.');
    setTimeout(() => setCopyMsg(''), 1600);
  };

  const copyHtml = async () => {
    const ok = await copyToClipboard(previewHtml || '');
    setCopyMsg(ok ? 'HTML copied.' : 'Copy failed.');
    setTimeout(() => setCopyMsg(''), 1600);
  };

  const signatureHtml = useMemo(
    () =>
      buildSignatureBlock({
        vendorContactName,
        vendorCompanyName,
        vendorPhone,
        vendorEmail,
        vendorDomain,
        shopUrl: vendorShopUrl,
        logoUrl: vendorLogoUrl,
      }),
    [
      vendorContactName,
      vendorCompanyName,
      vendorPhone,
      vendorEmail,
      vendorDomain,
      vendorShopUrl,
      vendorLogoUrl,
    ]
  );
  const emailWithSignature = useMemo(
    () => appendSignature(String(item?.html_body || ''), signatureHtml),
    [item?.html_body, signatureHtml]
  );
  const previewHtml = editedHtml || emailWithSignature;
  const baseHtmlRef = useRef('');

  useEffect(() => {
    setEditedHtml('');
  }, [emailWithSignature]);

  useEffect(() => {
    baseHtmlRef.current = emailWithSignature;
  }, [emailWithSignature]);

  const initTinyMce = useCallback(() => {
    if (!editorMountRef.current) return;
    if (tinymceEditorRef.current) return;
    tinymce.init({
      target: editorMountRef.current,
      base_url: '/tinymce',
      suffix: '.min',
      license_key: 'gpl',
      height: 360,
      menubar: false,
      statusbar: false,
      plugins: ['link', 'lists', 'autolink', 'code'],
      toolbar: 'undo redo | bold italic underline | link | bullist numlist | removeformat | code',
      toolbar_mode: 'sliding',
      branding: false,
      skin: 'oxide',
      content_style: 'body{font-family:Arial,sans-serif;font-size:14px;}',
      setup(editor) {
        tinymceEditorRef.current = editor;
        let ready = false;
        const updateEditedHtml = () => {
          if (!ready) return;
          const bodyInner = editor.getContent() || '';
          const fullHtml = injectBodyInnerHtml(baseHtmlRef.current || '', bodyInner);
          setEditedHtml(fullHtml);
        };
        editor.on('init', () => {
          const initial = extractBodyInnerHtml(previewHtml || '');
          editor.setContent(initial || '', { format: 'raw' });
          ready = true;
        });
        editor.on('Change KeyUp Undo Redo SetContent', updateEditedHtml);
        editor.on('Blur', updateEditedHtml);
      },
    });
  }, [previewHtml]);

  useEffect(() => {
    if (!item || !editorMountRef.current || tinymceEditorRef.current) return;
    initTinyMce();
  }, [item, initTinyMce]);

  useEffect(() => {
    return () => {
      if (tinymceEditorRef.current) {
        tinymceEditorRef.current.remove();
        tinymceEditorRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!tinymceEditorRef.current) return;
    const editor = tinymceEditorRef.current;
    const next = extractBodyInnerHtml(previewHtml || '');
    const current = editor.getContent();
    if (current !== next) {
      editor.setContent(next || '', { format: 'raw' });
    }
  }, [previewHtml]);

  const createGmailDraft = useCallback(async () => {
    setDraftError('');
    setDraftMessage('');
    const recipient = String(toEmail || vendorEmail || '').trim();
    const htmlBody = String(previewHtml || '').trim();
    const fromAddress = String(vendorEmail || '').trim();
    if (!recipient) {
      setDraftError('Specify a recipient email first.');
      return;
    }
    if (!subjectWithDomain && !htmlBody) {
      setDraftError('Render a template before creating a draft.');
      return;
    }
    const textValue = htmlBody ? stripHtmlTags(htmlBody) : stripHtmlTags(subjectWithDomain);
    setDraftLoading(true);
    try {
      const resp = await fetch('/api/tools/email-template/draft', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...resolvedHeaders },
        body: JSON.stringify({
          to: recipient,
          subject: subjectWithDomain,
          html_body: htmlBody,
          text: textValue,
          from: fromAddress,
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
  }, [subjectWithDomain, vendorEmail, toEmail, resolvedHeaders, previewHtml]);

  return (
    <div className="border rounded bg-white">
      <div className="p-3 space-y-3">
        {copyMsg && <div className="text-xs text-green-700">{copyMsg}</div>}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-gray-600">MySQL profile</label>
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
                    <option key={p.id} value={String(p.id)}>
                      {p.name || `Profile ${p.id}`}
                    </option>
                  ))
                )}
              </select>
              {profilesError && <div className="text-xs text-red-600 mt-1">{profilesError}</div>}
              <div className="text-[11px] text-gray-400 mt-1">Used only to list shops/languages (templates are stored in Postgres).</div>
            </div>
            <div>
              <label className="text-xs text-gray-600">Shop</label>
              <select
                className="w-full border rounded px-2 py-1 bg-white"
                value={idShop}
                onChange={(e) => handleShopChange(e.target.value)}
                disabled={shopsLoading || !String(profileId || '').trim()}
              >
                <option value="">All shops (0)</option>
                {shops.length === 0 ? (
                  <option value="" disabled>{shopsLoading ? 'Loading.' : 'Select a profile.'}</option>
                ) : (
                  shops.map((s) => (
                    <option key={String(s.id_shop)} value={String(s.id_shop)}>
                      {s.name ? `${s.name} (ID ${s.id_shop})` : `ID ${s.id_shop}`}
                    </option>
                  ))
                )}
              </select>
              {shopsError && <div className="text-xs text-red-600 mt-1">{shopsError}</div>}
            </div>
            <div>
              <label className="text-xs text-gray-600">Language</label>
              <select
                className="w-full border rounded px-2 py-1 bg-white"
                value={idLang}
                onChange={(e) => setIdLang(e.target.value)}
                disabled={languagesLoading || !String(profileId || '').trim()}
              >
                <option value="">All languages (0)</option>
                {languages.length === 0 ? (
                  <option value="" disabled>{languagesLoading ? 'Loading.' : 'Select a shop.'}</option>
                ) : (
                  languages.map((l) => (
                    <option key={String(l.id_lang)} value={String(l.id_lang)}>
                      {l.name ? `${l.name} (ID ${l.id_lang})` : `ID ${l.id_lang}`}
                    </option>
                  ))
                )}
              </select>
              {languagesError && <div className="text-xs text-red-600 mt-1">{languagesError}</div>}
              <div className="text-[11px] text-gray-400 mt-1">Pick a shop to load languages, or leave empty to use 0 (global).</div>
            </div>
            <div className="md:col-span-3">
              <label className="text-xs text-gray-600">Template type</label>
              <select
                className="w-full border rounded px-2 py-1 bg-white"
                value={selectedType}
                onChange={(e) => {
                  setSelectedType(e.target.value);
                }}
                disabled={typesLoading || !typeOptions.length}
              >
                {!typeOptions.length ? (
                  <option value="">{typesLoading ? 'Loading.' : 'Load types first.'}</option>
                ) : (
                  typeOptions.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}{t.variants > 1 ? ` (${t.variants})` : ''}{t.hasHtml ? '' : ' [no html]'}
                    </option>
                  ))
                )}
              </select>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-[11px] text-gray-400">Template list reloads automatically when the shop changes.</span>
              </div>
              {typesError && <div className="text-xs text-red-600 mt-1">{typesError}</div>}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
              onClick={() => render({ force: true })}
              disabled={renderLoading || !effectiveType}
            >
              {renderLoading ? 'Loading.' : 'Render'}
            </button>
            <button
              type="button"
              className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
              onClick={copySubject}
              disabled={!subjectWithDomain.trim()}
            >
              Copy subject
            </button>
            <button
              type="button"
              className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
              onClick={copyHtml}
              disabled={!String(previewHtml || '').trim()}
            >
              Copy HTML
            </button>
          </div>

          {renderError && <div className="text-xs text-red-600">{renderError}</div>}

          {item ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-gray-600 mb-1">From</div>
                  <input
                    className="w-full border rounded px-2 py-1 bg-gray-50"
                    value={vendorEmail}
                    placeholder={vendorMetaLoading ? 'Loading from address…' : 'PS_SHOP_EMAIL'}
                    readOnly
                  />
                  {vendorMetaLoading && (
                    <div className="text-[11px] text-gray-500 mt-1">Loading shop metadata…</div>
                  )}
                  {vendorMetaError && (
                    <div className="text-[11px] text-red-600 mt-1">{vendorMetaError}</div>
                  )}
                </div>
                <div>
                  <div className="text-xs text-gray-600 mb-1">To</div>
                  <input
                    className="w-full border rounded px-2 py-1 bg-white"
                    value={toEmail}
                    onChange={(e) => setToEmail(e.target.value)}
                    placeholder="Recipient email (fill manually)"
                  />
                  <div className="text-[11px] text-gray-400 mt-1">
                    Optional: enter who should receive this template.
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="text-xs px-3 py-1.5 rounded border bg-white hover:bg-gray-50"
                  onClick={createGmailDraft}
                  disabled={draftLoading}
                >
                  {draftLoading ? 'Creating Gmail draft…' : 'Create Gmail draft'}
                </button>
                <span className="text-[11px] text-gray-500">Requires configured Google API credentials (Tools → Google API).</span>
              </div>
              {draftMessage && <div className="text-[11px] text-green-700">{draftMessage}</div>}
              {draftError && <div className="text-[11px] text-red-600">{draftError}</div>}
              <div className="text-[11px] text-gray-500">
                {vendorDomain ? `Subject prefix: [${vendorDomain}]` : 'No shop domain available for prefix.'}
              </div>
              <div>
                <div className="text-xs text-gray-600 mb-1">Subject (prefixed)</div>
                <input
                  className="w-full border rounded px-2 py-1 bg-gray-50"
                  value={subjectWithDomain}
                  readOnly
                />
              </div>
              <div>
                <div className="text-xs text-gray-600 mb-1">HTML (preview)</div>
                <textarea
                  ref={editorMountRef}
                  className="w-full min-h-[360px] border rounded bg-white p-3 text-[12px] text-gray-700"
                  defaultValue={previewHtml}
                />
                <div className="text-[11px] text-gray-400 mt-1">
                  Rich editor (TinyMCE) updates the Gmail draft automatically.
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-600 mb-1">Email preview (rendered)</div>
                <iframe
                  title="email-preview"
                  className="w-full min-h-[360px] border rounded bg-white"
                  sandbox=""
                  srcDoc={String(previewHtml || '')}
                />
              </div>
            </div>
          ) : (
            <div className="text-xs text-gray-500">Select a template type and click Render.</div>
          )}
        </div>
      </div>
    
  );
}
