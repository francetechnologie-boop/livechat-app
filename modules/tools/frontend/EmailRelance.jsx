import React, { useEffect, useMemo, useState } from 'react';
import { attachAdminHeaders } from './utils/adminHeaders.js';
import EmailRelanceSettingsPanel from './components/EmailRelanceSettingsPanel.jsx';
import EmailRelanceVirementPanel from './components/EmailRelanceVirementPanel.jsx';
import EmailRelanceNumeroMaisonPanel from './components/EmailRelanceNumeroMaisonPanel.jsx';
import EmailRelanceTrackingPanel from './components/EmailRelanceTrackingPanel.jsx';
import EmailRelancePlaceholderPanel from './components/EmailRelancePlaceholderPanel.jsx';
import EmailRelanceEmailPreviewModal from './components/EmailRelanceEmailPreviewModal.jsx';
import EmailRelanceSmsPreviewModal from './components/EmailRelanceSmsPreviewModal.jsx';

async function readJson(resp) {
  const text = await resp.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { ok: false, error: 'invalid_json', raw: text };
  }
}

async function adminFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const merged = attachAdminHeaders(Object.fromEntries(headers.entries()));
  return fetch(path, { credentials: 'include', ...options, headers: merged });
}

function normalizePhoneCandidate(row) {
  const m = String(row?.mobile_e164 || '').trim();
  const p = String(row?.phone_e164 || '').trim();
  const m2 = String(row?.mobile || '').trim();
  const p2 = String(row?.phone || '').trim();
  return m || p || m2 || p2 || '';
}

function normalizeSmsToNumber(row) {
  try {
    const raw = String(normalizePhoneCandidate(row) || '').trim();
    const callPrefix = String(row?.call_prefix || '').trim().replace(/\D/g, '');

    const to00 = (s) => {
      const v = String(s || '').trim();
      if (!v) return '';
      if (v.startsWith('00')) return v.replace(/[^\d]/g, '');
      if (v.startsWith('+')) return `00${v.slice(1).replace(/[^\d]/g, '')}`;
      return v.replace(/[^\d]/g, '');
    };

    let s = raw.replace(/[^\d+]/g, '');
    if (!s) return '';
    if (s.startsWith('00') || s.startsWith('+')) return to00(s);

    // National number without international prefix -> use call_prefix if present.
    let digits = s.replace(/\D/g, '');
    if (!digits) return '';
    if (callPrefix) {
      digits = digits.replace(/^0+/, '');
      return `00${callPrefix}${digits}`;
    }
    return digits;
  } catch {
    return '';
  }
}

function escapeHtml(s = '') {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function textToSimpleHtml(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const chunks = raw.split(/\n\s*\n/g).map((p) => p.trim()).filter(Boolean);
  if (!chunks.length) return '';
  return chunks.map((p) => `<p>${escapeHtml(p).replace(/\r?\n/g, '<br />')}</p>`).join('\n');
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
        active ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white hover:bg-gray-50 border-gray-200'
      }`}
    >
      {children}
    </button>
  );
}

function Field({ label, children }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-gray-500 mb-1">{label}</div>
      {children}
    </div>
  );
}

export default function EmailRelance() {
  const [tab, setTab] = useState(() => {
    try {
      return String(localStorage.getItem('tools_relance_tab') || 'virement').trim() || 'virement';
    } catch {
      return 'virement';
    }
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [itemsVirement, setItemsVirement] = useState([]);
  const [itemsMaison, setItemsMaison] = useState([]);
  const [itemsTracking, setItemsTracking] = useState([]);

  const [filter, setFilter] = useState('');

  const [rowBusy, setRowBusy] = useState({});
  const [rowMsg, setRowMsg] = useState({});
  const [rowSmsDraft, setRowSmsDraft] = useState({});
  const [rowMaisonEmail, setRowMaisonEmail] = useState({});
  const [rowTrackingSmsDraft, setRowTrackingSmsDraft] = useState({});
  const [rowTrackingEmail, setRowTrackingEmail] = useState({});
  const [rowTrackingMeta, setRowTrackingMeta] = useState({});
  const [rowTrackingOpenAiDebug, setRowTrackingOpenAiDebug] = useState({});
  const [virementGenerated, setVirementGenerated] = useState({});
  const [preview, setPreview] = useState(null); // { kind:'virement'|'maison'|'tracking', id, item }
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [smsPreview, setSmsPreview] = useState(null); // { kind:'maison'|'tracking', id, item }
  const [smsPreviewBusy, setSmsPreviewBusy] = useState(false);
  const [smsPreviewError, setSmsPreviewError] = useState('');

  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [settingsFilter, setSettingsFilter] = useState('');
  const [settings, setSettings] = useState({
    virement_prompt_config_id: null,
    virement_email_prompt_config_id: null,
    virement_bank_details: null,
    numero_maison_prompt_config_id: null,
    numero_telephone_prompt_config_id: null,
    tracking_mcp2_server_ids: [],
    tracking_prompt_config_id: null,
    gateway_default_subscription_id: null,
    signature_cache_updated_at: null,
    signature_cache_shop_count: 0,
    signature_cache_entry_count: 0,
  });
  const [signatureUpdating, setSignatureUpdating] = useState(false);
  const [signatureUpdateMsg, setSignatureUpdateMsg] = useState('');

  const [promptConfigs, setPromptConfigs] = useState([]);
  const [mcp2Servers, setMcp2Servers] = useState([]);
  const [gatewayLines, setGatewayLines] = useState([]);
  const [gatewayShopMap, setGatewayShopMap] = useState({});
  const [gatewayStatus, setGatewayStatus] = useState({
    socket_connected: false,
    socket_count: 0,
    device_socket_connected: false,
    device_socket_count: 0,
    temp_socket_count: 0,
    last_activity_at: null,
  });
  const [listsLoading, setListsLoading] = useState(false);
  const [listsError, setListsError] = useState('');

  useEffect(() => {
    try { localStorage.setItem('tools_relance_tab', tab); } catch {}
  }, [tab]);

  const loadSettings = async () => {
    setSettingsLoading(true);
    setSettingsError('');
    try {
      const resp = await adminFetch('/api/tools/relance/settings');
      const data = await readJson(resp);
      if (!resp.ok || !data?.ok) throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
      const s = data?.settings || {};
      setSettings({
        virement_prompt_config_id: s.virement_prompt_config_id ?? null,
        virement_email_prompt_config_id: s.virement_email_prompt_config_id ?? null,
        virement_bank_details: s.virement_bank_details ?? null,
        numero_maison_prompt_config_id: s.numero_maison_prompt_config_id ?? null,
        numero_telephone_prompt_config_id: s.numero_telephone_prompt_config_id ?? null,
        tracking_mcp2_server_ids: Array.isArray(s.tracking_mcp2_server_ids) ? s.tracking_mcp2_server_ids : [],
        tracking_prompt_config_id: s.tracking_prompt_config_id ?? null,
        gateway_default_subscription_id: s.gateway_default_subscription_id ?? null,
        signature_cache_updated_at: s.signature_cache_updated_at ?? null,
        signature_cache_shop_count: Number(s.signature_cache_shop_count || 0) || 0,
        signature_cache_entry_count: Number(s.signature_cache_entry_count || 0) || 0,
      });
    } catch (e) {
      setSettingsError(String(e?.message || e));
    } finally {
      setSettingsLoading(false);
    }
  };

  const saveSettings = async () => {
    setSettingsSaving(true);
    setSettingsError('');
    try {
      const resp = await adminFetch('/api/tools/relance/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          virement_prompt_config_id: settings.virement_prompt_config_id,
          virement_email_prompt_config_id: settings.virement_email_prompt_config_id,
          virement_bank_details: settings.virement_bank_details,
          numero_maison_prompt_config_id: settings.numero_maison_prompt_config_id,
          numero_telephone_prompt_config_id: settings.numero_telephone_prompt_config_id,
          tracking_mcp2_server_ids: Array.isArray(settings.tracking_mcp2_server_ids) ? settings.tracking_mcp2_server_ids : [],
          tracking_prompt_config_id: settings.tracking_prompt_config_id,
          gateway_default_subscription_id: settings.gateway_default_subscription_id,
        }),
      });
      const data = await readJson(resp);
      if (!resp.ok || !data?.ok) throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
      const s = data?.settings || {};
      setSettings({
        virement_prompt_config_id: s.virement_prompt_config_id ?? null,
        virement_email_prompt_config_id: s.virement_email_prompt_config_id ?? null,
        virement_bank_details: s.virement_bank_details ?? null,
        numero_maison_prompt_config_id: s.numero_maison_prompt_config_id ?? null,
        numero_telephone_prompt_config_id: s.numero_telephone_prompt_config_id ?? null,
        tracking_mcp2_server_ids: Array.isArray(s.tracking_mcp2_server_ids) ? s.tracking_mcp2_server_ids : [],
        tracking_prompt_config_id: s.tracking_prompt_config_id ?? null,
        gateway_default_subscription_id: s.gateway_default_subscription_id ?? null,
        // Preserve cache metadata from last load.
        signature_cache_updated_at: settings.signature_cache_updated_at ?? null,
        signature_cache_shop_count: settings.signature_cache_shop_count ?? 0,
        signature_cache_entry_count: settings.signature_cache_entry_count ?? 0,
      });
    } catch (e) {
      setSettingsError(String(e?.message || e));
    } finally {
      setSettingsSaving(false);
    }
  };

  const updateSignatureCache = async () => {
    setSignatureUpdating(true);
    setSignatureUpdateMsg('');
    try {
      const resp = await adminFetch('/api/tools/relance/signature/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await readJson(resp);
      if (!resp.ok || !data?.ok) throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
      const updatedAt = data?.cache?.updated_at || null;
      const shops = data?.cache?.shopCount ?? data?.cache?.shop_count ?? null;
      const entries = data?.cache?.entryCount ?? data?.cache?.entry_count ?? null;
      setSignatureUpdateMsg(`OK${updatedAt ? ` · ${updatedAt}` : ''}${shops != null ? ` · shops:${shops}` : ''}${entries != null ? ` · entries:${entries}` : ''}`);
      try { await loadSettings(); } catch {}
    } catch (e) {
      setSignatureUpdateMsg(`Erreur: ${String(e?.message || e)}`);
    } finally {
      setSignatureUpdating(false);
    }
  };

  const loadLists = async () => {
    setListsLoading(true);
    setListsError('');
    try {
      const [r1, r2, r3, r4] = await Promise.all([
        adminFetch('/api/automation-suite/prompt-configs?limit=200'),
        adminFetch('/api/mcp2/servers'),
        adminFetch('/api/admin/gateway/lines'),
        adminFetch('/api/admin/gateway/shop-subscriptions'),
      ]);
      const j1 = await readJson(r1);
      const j2 = await readJson(r2);
      const j3 = await readJson(r3);
      const j4 = await readJson(r4);
      if (!r1.ok || !j1?.ok) throw new Error(j1?.message || j1?.error || `HTTP ${r1.status}`);
      if (!r2.ok || !j2?.ok) throw new Error(j2?.message || j2?.error || `HTTP ${r2.status}`);
      if (!r3.ok || !j3?.ok) throw new Error(j3?.message || j3?.error || `HTTP ${r3.status}`);
      if (!r4.ok || !j4?.ok) throw new Error(j4?.message || j4?.error || `HTTP ${r4.status}`);
      setPromptConfigs(Array.isArray(j1.items) ? j1.items : []);
      setMcp2Servers(Array.isArray(j2.items) ? j2.items : []);
      setGatewayLines(Array.isArray(j3.items) ? j3.items : []);
      setGatewayShopMap((j4 && j4.mapping && typeof j4.mapping === 'object') ? j4.mapping : {});
    } catch (e) {
      setPromptConfigs([]);
      setMcp2Servers([]);
      setGatewayLines([]);
      setGatewayShopMap({});
      setListsError(String(e?.message || e));
    } finally {
      setListsLoading(false);
    }
  };

  const loadGatewayStatus = async () => {
    try {
      const r = await adminFetch('/api/admin/gateway/status');
      const j = await readJson(r);
      if (!r.ok || !j?.ok) throw new Error(j?.message || j?.error || `HTTP ${r.status}`);
      setGatewayStatus({
        socket_connected: !!j.socket_connected,
        socket_count: Number(j.socket_count || 0) || 0,
        device_socket_connected: !!(j.device_socket_connected ?? j.socket_connected),
        device_socket_count: Number(j.device_socket_count || 0) || 0,
        temp_socket_count: Number(j.temp_socket_count || 0) || 0,
        last_activity_at: j.last_activity_at || null,
      });
    } catch {
      setGatewayStatus({
        socket_connected: false,
        socket_count: 0,
        device_socket_connected: false,
        device_socket_count: 0,
        temp_socket_count: 0,
        last_activity_at: null,
      });
    }
  };

  const loadVirement = async () => {
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams();
      qs.set('limit', '50');
      const resp = await adminFetch(`/api/tools/relance/virement-bancaire?${qs.toString()}`);
      const data = await readJson(resp);
      if (!resp.ok || !data?.ok) throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
      setItemsVirement(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setItemsVirement([]);
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const loadMaison = async () => {
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams();
      qs.set('limit', '50');
      const resp = await adminFetch(`/api/tools/relance/numero-de-maison?${qs.toString()}`);
      const data = await readJson(resp);
      if (!resp.ok || !data?.ok) throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
      setItemsMaison(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setItemsMaison([]);
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const loadTracking = async () => {
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams();
      qs.set('limit', '50');
      const resp = await adminFetch(`/api/tools/relance/tracking?${qs.toString()}`);
      const data = await readJson(resp);
      if (!resp.ok || !data?.ok) throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
      setItemsTracking(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setItemsTracking([]);
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const refreshCurrentTab = async () => {
    if (tab === 'virement') return loadVirement();
    if (tab === 'maison') return loadMaison();
    if (tab === 'tracking') return loadTracking();
    if (tab === 'settings') {
      await loadSettings();
      return loadLists();
    }
    return null;
  };

  const headerBusy = !!(loading || settingsLoading || settingsSaving || listsLoading);

  useEffect(() => {
    loadSettings();
    if (tab === 'virement') loadVirement();
    else if (tab === 'maison') loadMaison();
    else if (tab === 'tracking') loadTracking();
    loadGatewayStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab === 'virement') loadVirement();
    else if (tab === 'maison') loadMaison();
    else if (tab === 'tracking') loadTracking();
    if (tab === 'maison' || tab === 'tracking') loadGatewayStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (tab !== 'maison' && tab !== 'tracking') return undefined;
    const t = setInterval(loadGatewayStatus, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (tab !== 'settings' && tab !== 'maison') return;
    if (listsLoading || (promptConfigs.length && mcp2Servers.length)) return;
    loadLists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const filteredVirement = useMemo(() => {
    const f = String(filter || '').trim().toLowerCase();
    if (!f) return itemsVirement;
    const includes = (v) => String(v || '').toLowerCase().includes(f);
    return (Array.isArray(itemsVirement) ? itemsVirement : []).filter((r) =>
      includes(r.id_order) ||
      includes(r.reference) ||
      includes(r.customer_email) ||
      includes(r.customer_name) ||
      includes(r.shop_domain_no_www) ||
      includes(r.payment) ||
      includes(r.order_state)
    );
  }, [itemsVirement, filter]);

  const filteredMaison = useMemo(() => {
    const f = String(filter || '').trim().toLowerCase();
    if (!f) return itemsMaison;
    const includes = (v) => String(v || '').toLowerCase().includes(f);
    return (Array.isArray(itemsMaison) ? itemsMaison : []).filter((r) =>
      includes(r.id_order) ||
      includes(r.reference) ||
      includes(r.customer_email) ||
      includes(r.customer_name) ||
      includes(r.country) ||
      includes(r.phone) ||
      includes(r.mobile) ||
      includes(r.phone_e164) ||
      includes(r.mobile_e164)
    );
  }, [itemsMaison, filter]);

  const filteredTracking = useMemo(() => {
    const f = String(filter || '').trim().toLowerCase();
    if (!f) return itemsTracking;
    const includes = (v) => String(v || '').toLowerCase().includes(f);
    return (Array.isArray(itemsTracking) ? itemsTracking : []).filter((r) =>
      includes(r.id_order) ||
      includes(r.reference) ||
      includes(r.customer_email) ||
      includes(r.customer_name) ||
      includes(r.country) ||
      includes(r.phone) ||
      includes(r.mobile) ||
      includes(r.phone_e164) ||
      includes(r.mobile_e164) ||
      includes(r.tracking_url) ||
      includes(r.tracking_number) ||
      includes(r.carrier)
    );
  }, [itemsTracking, filter]);

  const setBusyFor = (id, value) => setRowBusy((prev) => ({ ...(prev || {}), [String(id)]: !!value }));
  const setMsgFor = (id, msg) => setRowMsg((prev) => ({ ...(prev || {}), [String(id)]: String(msg || '') }));

  const generateVirementEmail = async (row) => {
    const id = row?.id_order;
    if (!id) return;
    setBusyFor(id, true);
    setMsgFor(id, '');
    try {
      const resp = await adminFetch(`/api/tools/relance/virement-bancaire/${encodeURIComponent(id)}/email-generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await readJson(resp);
      if (!resp.ok || !data?.ok) throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
      const email = data?.email || {};
      const item = data?.item || row || {};
      const out = { subject: email.subject || '', html: email.html || '', text: email.text || '', item };
      setVirementGenerated((prev) => ({ ...(prev || {}), [String(id)]: out }));
      setPreview({
        kind: 'virement',
        id: String(id),
        item: item || null,
      });
      setPreviewError('');
    } catch (e) {
      setMsgFor(id, `Erreur: ${String(e?.message || e)}`);
    } finally {
      setBusyFor(id, false);
    }
  };

  const openVirementEdit = (row) => {
    const id = row?.id_order;
    if (!id) return;
    const saved = virementGenerated[String(id)];
    if (!saved || !String(saved.html || '').trim()) {
      setMsgFor(id, 'Générer l’email d’abord.');
      return;
    }
    const item = saved.item || row || {};
    setPreview({
      kind: 'virement',
      id: String(id),
      item: item || null,
    });
    setPreviewError('');
  };

  const createVirementDraft = async (row) => {
    const id = row?.id_order;
    if (!id) return;
    setBusyFor(id, true);
    setMsgFor(id, '');
    try {
      const generated = virementGenerated[String(id)] || null;
      if (!generated || !String(generated.html || '').trim()) throw new Error('Générer l’email d’abord.');
      const payloadEmail = { subject: generated.subject || '', html: generated.html || '', text: generated.text || '' };
      const resp = await adminFetch(`/api/tools/relance/virement-bancaire/${encodeURIComponent(id)}/email-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: payloadEmail }),
      });
      const data = await readJson(resp);
      if (!resp.ok || !data?.ok) throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
      const subj = data?.subject || '';
      const fromUsed = data?.sender?.from_used;
      const fallback = !!data?.sender?.fallback_used;
      setMsgFor(id, `Brouillon Gmail créé. ${subj ? `Sujet: ${subj}` : ''}${fromUsed ? ` · From: ${fromUsed}` : (fallback ? ' · From: (fallback Gmail)' : '')}`);
    } catch (e) {
      setMsgFor(id, `Erreur: ${String(e?.message || e)}`);
    } finally {
      setBusyFor(id, false);
    }
  };

  const saveGeneratedFromComposer = (id, draft, item) => {
    try {
      const key = String(id);
      setVirementGenerated((prev) => ({
        ...(prev || {}),
        [key]: {
          subject: String(draft?.subject || ''),
          html: String(draft?.html || ''),
          text: String(draft?.text || ''),
          item: item || prev?.[key]?.item || null,
        },
      }));
    } catch {}
  };

  const generateSmsDraft = async (row) => {
    const id = row?.id_order;
    if (!id) return;
    setBusyFor(id, true);
    setMsgFor(id, '');
    try {
      const resp = await adminFetch(`/api/tools/relance/numero-de-maison/${encodeURIComponent(id)}/sms-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await readJson(resp);
      if (!resp.ok || !data?.ok) throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
      setRowSmsDraft((prev) => ({ ...(prev || {}), [String(id)]: String(data.sms_text || '') }));
      const to = normalizeSmsToNumber(row);
      setMsgFor(id, `SMS généré.${to ? ` To: ${to}` : ''}`);
    } catch (e) {
      setMsgFor(id, `Erreur: ${String(e?.message || e)}`);
    } finally {
      setBusyFor(id, false);
    }
  };

  const generateMaisonSmsDraft = async (row) => {
    const id = row?.id_order;
    if (!id) return '';
    setBusyFor(id, true);
    setMsgFor(id, '');
    try {
      const resp = await adminFetch(`/api/tools/relance/numero-de-maison/${encodeURIComponent(id)}/sms-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await readJson(resp);
      if (!resp.ok || !data?.ok) throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
      const smsText = String(data.sms_text || '');
      setRowSmsDraft((prev) => ({ ...(prev || {}), [String(id)]: smsText }));
      const to = normalizeSmsToNumber(row);
      setMsgFor(id, `SMS généré.${to ? ` To: ${to}` : ''}`);
      return smsText;
    } catch (e) {
      setMsgFor(id, `Erreur: ${String(e?.message || e)}`);
      return '';
    } finally {
      setBusyFor(id, false);
    }
  };

  const generateMaisonEmailDraft = async (row) => {
    const id = row?.id_order;
    if (!id) return;
    setBusyFor(id, true);
    setMsgFor(id, '');
    try {
      const resp = await adminFetch(`/api/tools/relance/numero-de-maison/${encodeURIComponent(id)}/email-generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await readJson(resp);
      if (!resp.ok || !data?.ok) throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
      const email = data?.email || {};
      const itemFromServer = (data?.item && typeof data.item === 'object') ? data.item : null;
      const html = String(email.html || '').trim() || (String(email.text || '').trim() ? textToSimpleHtml(String(email.text || '').trim()) : '');
      setRowMaisonEmail((prev) => ({
        ...(prev || {}),
        [String(id)]: {
          subject: String(email.subject || ''),
          html,
          text: String(email.text || ''),
          to: String(row?.customer_email || '').trim(),
          from: String(itemFromServer?.shop_email || row?.shop_email || '').trim(),
        },
      }));
      // Open the modal only after we have generated content (matches virement-bancaire UX).
      setPreview({ kind: 'maison', id: String(id), item: itemFromServer || row || null });
      setPreviewError('');
      const subj = String(email.subject || '').trim();
      setMsgFor(id, `Email généré.${subj ? ` · Sujet: ${subj}` : ''}`);
    } catch (e) {
      setMsgFor(id, `Erreur: ${String(e?.message || e)}`);
    } finally {
      setBusyFor(id, false);
    }
  };

  const generateSmsAndEmailDrafts = async (row) => {
    const id = row?.id_order;
    if (!id) return;
    setBusyFor(id, true);
    setMsgFor(id, '');
    try {
      const [rSms, rEmail] = await Promise.all([
        adminFetch(`/api/tools/relance/numero-de-maison/${encodeURIComponent(id)}/sms-draft`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
        adminFetch(`/api/tools/relance/numero-de-maison/${encodeURIComponent(id)}/email-generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      ]);
      const smsData = await readJson(rSms);
      const emailData = await readJson(rEmail);
      if (!rSms.ok || !smsData?.ok) throw new Error(smsData?.message || smsData?.error || `HTTP ${rSms.status}`);
      if (!rEmail.ok || !emailData?.ok) throw new Error(emailData?.message || emailData?.error || `HTTP ${rEmail.status}`);

      setRowSmsDraft((prev) => ({ ...(prev || {}), [String(id)]: String(smsData.sms_text || '') }));
      const email = emailData?.email || {};
      const itemFromServer = (emailData?.item && typeof emailData.item === 'object') ? emailData.item : null;
      const html = String(email.html || '').trim() || (String(email.text || '').trim() ? textToSimpleHtml(String(email.text || '').trim()) : '');
      setRowMaisonEmail((prev) => ({
        ...(prev || {}),
        [String(id)]: {
          subject: String(email.subject || ''),
          html,
          text: String(email.text || ''),
          to: String(row?.customer_email || '').trim(),
          from: String(itemFromServer?.shop_email || row?.shop_email || '').trim(),
        },
      }));
      const toSms = normalizeSmsToNumber(row);
      const subj = String(email.subject || '').trim();
      setMsgFor(id, `SMS + email générés.${toSms ? ` To(SMS): ${toSms}` : ''}${subj ? ` · Sujet: ${subj}` : ''}`);
    } catch (e) {
      setMsgFor(id, `Erreur: ${String(e?.message || e)}`);
    } finally {
      setBusyFor(id, false);
    }
  };

  const openMaisonSmsModal = (row) => {
    const id = row?.id_order;
    if (!id) return;
    setSmsPreview({ kind: 'maison', id: String(id), item: row || null });
    setSmsPreviewError('');
  };

  const openMaisonEmailModal = (row) => {
    const id = row?.id_order;
    if (!id) return;
    setPreview({ kind: 'maison', id: String(id), item: row || null });
    setPreviewError('');
  };

  const sendSms = async (row) => {
    const id = row?.id_order;
    if (!id) return;
    const to = normalizeSmsToNumber(row);
    const msg = String(rowSmsDraft[String(id)] || '').trim();
    if (!to) { setMsgFor(id, 'Numéro manquant.'); return; }
    if (!msg) { setMsgFor(id, 'Générer le SMS d’abord.'); return; }
    const idShop = row?.id_shop != null ? Number(row.id_shop) : null;
    const mapped = (idShop != null && gatewayShopMap && gatewayShopMap[String(idShop)] != null) ? Number(gatewayShopMap[String(idShop)]) : null;
    const fallback = settings?.gateway_default_subscription_id;
    const subId = Number.isFinite(mapped) && mapped > 0
      ? mapped
      : (Number.isFinite(Number(fallback)) && Number(fallback) > 0 ? Number(fallback) : null);
    if (!subId) { setMsgFor(id, 'Aucune ligne Gateway: associer id_shop → subscription (Gateway) ou définir une ligne par défaut (Paramètres).'); return; }

    // Avoid sending if the Gateway has no connected device.
    try {
      const stResp = await adminFetch('/api/admin/gateway/status');
      const st = await readJson(stResp);
      const deviceConnected = !!(stResp.ok && st?.ok && (st?.device_socket_connected ?? st?.socket_connected));
      if (!deviceConnected) {
        setMsgFor(
          id,
          'Gateway Android non connecté. Ouvrir #/gateway et vérifier la connexion (token + Socket.IO).'
        );
        return;
      }
    } catch {}

    if (typeof window !== 'undefined') {
      const ok = window.confirm(`Envoyer ce SMS maintenant ?\nTo: ${to}\nFrom: sub:${subId}`);
      if (!ok) return;
    }
    setBusyFor(id, true);
    setMsgFor(id, '');
    try {
      const payload = {
        to,
        message: msg,
        subscription_id: Math.trunc(Number(subId)),
      };
      const resp = await adminFetch('/api/admin/gateway/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await readJson(resp);
      if (!resp.ok || !data?.ok) throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
      setMsgFor(id, `SMS envoyé (to: ${to}${data?.message_id ? ` · message_id: ${data.message_id}` : ''}).`);
    } catch (e) {
      const em = String(e?.message || e);
      if (em === 'no_client' || em === 'no_device') {
        setMsgFor(id, 'Erreur SMS: no_device (Gateway Android non connecté). Aller sur #/gateway et vérifier la connexion (token + Socket.IO).');
      } else if (em === 'loopback_client') {
        setMsgFor(id, 'Erreur SMS: loopback_client (client navigateur). Le Gateway Android n’a pas reçu la commande. Fermer le client temp et connecter l’app Android.');
      } else {
        setMsgFor(id, `Erreur SMS: ${em}`);
      }
    } finally {
      setBusyFor(id, false);
    }
  };

  const sendSmsNow = async (row, message) => {
    const id = row?.id_order;
    const to = normalizeSmsToNumber(row);
    const msg = String(message || '').trim();
    if (!id) throw new Error('missing_id_order');
    if (!to) throw new Error('Numéro manquant.');
    if (!msg) throw new Error('Message vide.');
    const idShop = row?.id_shop != null ? Number(row.id_shop) : null;
    const mapped = (idShop != null && gatewayShopMap && gatewayShopMap[String(idShop)] != null) ? Number(gatewayShopMap[String(idShop)]) : null;
    const fallback = settings?.gateway_default_subscription_id;
    const subId = Number.isFinite(mapped) && mapped > 0
      ? mapped
      : (Number.isFinite(Number(fallback)) && Number(fallback) > 0 ? Number(fallback) : null);
    if (!subId) throw new Error('Aucune ligne Gateway: associer id_shop → subscription (Gateway) ou définir une ligne par défaut (Paramètres).');

    try {
      const stResp = await adminFetch('/api/admin/gateway/status');
      const st = await readJson(stResp);
      const deviceConnected = !!(stResp.ok && st?.ok && (st?.device_socket_connected ?? st?.socket_connected));
      if (!deviceConnected) throw new Error('Gateway Android non connecté. Ouvrir #/gateway et vérifier la connexion (token + Socket.IO).');
    } catch (e) {
      if (String(e?.message || e).includes('Gateway Android')) throw e;
    }

    const payload = { to, message: msg, subscription_id: Math.trunc(Number(subId)) };
    const resp = await adminFetch('/api/admin/gateway/sms/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await readJson(resp);
    if (!resp.ok || !data?.ok) throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
    return { ok: true, to, subId, message_id: data?.message_id || null };
  };

  const sendMaisonEmail = async (row) => {
    const id = row?.id_order;
    if (!id) return;
    const email = rowMaisonEmail[String(id)] || null;
    if (!email || !String(email.html || '').trim() || !String(email.subject || '').trim()) {
      setMsgFor(id, 'Générer SMS + email d’abord.');
      return;
    }
    if (typeof window !== 'undefined') {
      const ok = window.confirm(`Envoyer cet email maintenant ?\nTo: ${row?.customer_email || ''}\nSujet: ${email.subject || ''}`);
      if (!ok) return;
    }
    setBusyFor(id, true);
    setMsgFor(id, '');
    try {
      const resp = await adminFetch(`/api/tools/relance/numero-de-maison/${encodeURIComponent(id)}/email-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: { subject: email.subject || '', html: email.html || '', text: email.text || '' } }),
      });
      const data = await readJson(resp);
      if (!resp.ok || !data?.ok) throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
      const fromUsed = data?.sender?.from_used;
      const fallback = !!data?.sender?.fallback_used;
      setMsgFor(id, `Email envoyé.${data?.message_id ? ` message_id: ${data.message_id}` : ''}${fromUsed ? ` · From: ${fromUsed}` : (fallback ? ' · From: (fallback Gmail)' : '')}`);
    } catch (e) {
      setMsgFor(id, `Erreur: ${String(e?.message || e)}`);
    } finally {
      setBusyFor(id, false);
    }
  };

  const generateTrackingSmsDraft = async (row) => {
    const id = row?.id_order;
    if (!id) return;
    setBusyFor(id, true);
    setMsgFor(id, '');
    try {
      const rSms = await adminFetch(`/api/tools/relance/tracking/${encodeURIComponent(id)}/sms-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const smsData = await readJson(rSms);
      if (!rSms.ok || !smsData?.ok) throw new Error(smsData?.message || smsData?.error || `HTTP ${rSms.status}`);
      const smsText = String(smsData.sms_text || '');
      setRowTrackingSmsDraft((prev) => ({ ...(prev || {}), [String(id)]: smsText }));
      setRowTrackingOpenAiDebug((prev) => ({
        ...(prev || {}),
        [String(id)]: { ...(prev?.[String(id)] || {}), sms: smsData?.openai_debug || null },
      }));
      const trackingUrl = String((smsData?.tracking?.tracking_url || smsData?.item?.tracking_url || '')).trim();
      setRowTrackingMeta((prev) => ({
        ...(prev || {}),
        [String(id)]: { ...(prev?.[String(id)] || {}), tracking_url: trackingUrl || null },
      }));
      const toSms = normalizeSmsToNumber(row);
      setMsgFor(id, `SMS généré.${toSms ? ` To: ${toSms}` : ''}${trackingUrl ? ' · tracking ok' : ''}`);
    } catch (e) {
      setMsgFor(id, `Erreur: ${String(e?.message || e)}`);
    } finally {
      setBusyFor(id, false);
    }
  };

  const generateTrackingEmailDraft = async (row) => {
    const id = row?.id_order;
    if (!id) return;
    setBusyFor(id, true);
    setMsgFor(id, '');
    try {
      const rEmail = await adminFetch(`/api/tools/relance/tracking/${encodeURIComponent(id)}/email-generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const emailData = await readJson(rEmail);
      if (!rEmail.ok || !emailData?.ok) throw new Error(emailData?.message || emailData?.error || `HTTP ${rEmail.status}`);
      const email = emailData?.email || {};
      const itemFromServer = (emailData?.item && typeof emailData.item === 'object') ? emailData.item : null;
      const html = String(email.html || '').trim() || (String(email.text || '').trim() ? textToSimpleHtml(String(email.text || '').trim()) : '');
      setRowTrackingEmail((prev) => ({
        ...(prev || {}),
        [String(id)]: {
          subject: String(email.subject || ''),
          html,
          text: String(email.text || ''),
          to: String(row?.customer_email || '').trim(),
          from: String(itemFromServer?.shop_email || row?.shop_email || '').trim(),
        },
      }));
      setRowTrackingOpenAiDebug((prev) => ({
        ...(prev || {}),
        [String(id)]: {
          ...(prev?.[String(id)] || {}),
          email: {
            ...(emailData?.openai_debug && typeof emailData.openai_debug === 'object' ? emailData.openai_debug : {}),
            signature_debug: emailData?.signature_debug || null,
          },
        },
      }));
      const trackingUrl = String((emailData?.tracking?.tracking_url || emailData?.item?.tracking_url || '')).trim();
      setRowTrackingMeta((prev) => ({
        ...(prev || {}),
        [String(id)]: { ...(prev?.[String(id)] || {}), tracking_url: trackingUrl || null },
      }));
      // Open the modal only after we have generated content (matches virement-bancaire UX).
      setPreview({ kind: 'tracking', id: String(id), item: itemFromServer || row || null });
      setPreviewError('');
      const subj = String(email.subject || '').trim();
      setMsgFor(id, `Email généré.${subj ? ` · Sujet: ${subj}` : ''}${trackingUrl ? ' · tracking ok' : ''}`);
    } catch (e) {
      setMsgFor(id, `Erreur: ${String(e?.message || e)}`);
    } finally {
      setBusyFor(id, false);
    }
  };

  const generateTrackingSmsAndEmailDrafts = async (row) => {
    const id = row?.id_order;
    if (!id) return;
    setBusyFor(id, true);
    setMsgFor(id, '');
    try {
      const [rSms, rEmail] = await Promise.all([
        adminFetch(`/api/tools/relance/tracking/${encodeURIComponent(id)}/sms-draft`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
        adminFetch(`/api/tools/relance/tracking/${encodeURIComponent(id)}/email-generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      ]);
      const smsData = await readJson(rSms);
      const emailData = await readJson(rEmail);
      if (!rSms.ok || !smsData?.ok) throw new Error(smsData?.message || smsData?.error || `HTTP ${rSms.status}`);
      if (!rEmail.ok || !emailData?.ok) throw new Error(emailData?.message || emailData?.error || `HTTP ${rEmail.status}`);

      setRowTrackingSmsDraft((prev) => ({ ...(prev || {}), [String(id)]: String(smsData.sms_text || '') }));
      const email = emailData?.email || {};
      const itemFromServer = (emailData?.item && typeof emailData.item === 'object') ? emailData.item : null;
      const html = String(email.html || '').trim() || (String(email.text || '').trim() ? textToSimpleHtml(String(email.text || '').trim()) : '');
      setRowTrackingEmail((prev) => ({
        ...(prev || {}),
        [String(id)]: {
          subject: String(email.subject || ''),
          html,
          text: String(email.text || ''),
          to: String(row?.customer_email || '').trim(),
          from: String(itemFromServer?.shop_email || row?.shop_email || '').trim(),
        },
      }));
      setRowTrackingOpenAiDebug((prev) => ({
        ...(prev || {}),
        [String(id)]: {
          sms: smsData?.openai_debug || null,
          email: {
            ...(emailData?.openai_debug && typeof emailData.openai_debug === 'object' ? emailData.openai_debug : {}),
            signature_debug: emailData?.signature_debug || null,
          },
        },
      }));
      const trackingUrl = String((emailData?.tracking?.tracking_url || smsData?.tracking?.tracking_url || emailData?.item?.tracking_url || smsData?.item?.tracking_url || '')).trim();
      setRowTrackingMeta((prev) => ({
        ...(prev || {}),
        [String(id)]: {
          tracking_url: trackingUrl || null,
          server_name: emailData?.tracking?.server_name || smsData?.tracking?.server_name || null,
          tool_name: emailData?.tracking?.tool_name || smsData?.tracking?.tool_name || null,
        },
      }));

      const toSms = normalizeSmsToNumber(row);
      const subj = String(email.subject || '').trim();
      setMsgFor(id, `SMS + email générés.${toSms ? ` To(SMS): ${toSms}` : ''}${subj ? ` · Sujet: ${subj}` : ''}${trackingUrl ? ' · tracking ok' : ''}`);
    } catch (e) {
      setMsgFor(id, `Erreur: ${String(e?.message || e)}`);
    } finally {
      setBusyFor(id, false);
    }
  };

  const sendTrackingSms = async (row) => {
    const id = row?.id_order;
    if (!id) return;
    const to = normalizeSmsToNumber(row);
    const msg = String(rowTrackingSmsDraft[String(id)] || '').trim();
    if (!to) { setMsgFor(id, 'Numéro manquant.'); return; }
    if (!msg) { setMsgFor(id, 'Générer SMS + email d’abord.'); return; }
    const idShop = row?.id_shop != null ? Number(row.id_shop) : null;
    const mapped = (idShop != null && gatewayShopMap && gatewayShopMap[String(idShop)] != null) ? Number(gatewayShopMap[String(idShop)]) : null;
    const fallback = settings?.gateway_default_subscription_id;
    const subId = Number.isFinite(mapped) && mapped > 0
      ? mapped
      : (Number.isFinite(Number(fallback)) && Number(fallback) > 0 ? Number(fallback) : null);
    if (!subId) { setMsgFor(id, 'Aucune ligne Gateway: associer id_shop → subscription (Gateway) ou définir une ligne par défaut (Paramètres).'); return; }

    try {
      const stResp = await adminFetch('/api/admin/gateway/status');
      const st = await readJson(stResp);
      const deviceConnected = !!(stResp.ok && st?.ok && (st?.device_socket_connected ?? st?.socket_connected));
      if (!deviceConnected) {
        setMsgFor(id, 'Gateway Android non connecté. Ouvrir #/gateway et vérifier la connexion (token + Socket.IO).');
        return;
      }
    } catch {}

    if (typeof window !== 'undefined') {
      const ok = window.confirm(`Envoyer ce SMS maintenant ?\nTo: ${to}\nFrom: sub:${subId}`);
      if (!ok) return;
    }
    setBusyFor(id, true);
    setMsgFor(id, '');
    try {
      const payload = { to, message: msg, subscription_id: Math.trunc(Number(subId)) };
      const resp = await adminFetch('/api/admin/gateway/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await readJson(resp);
      if (!resp.ok || !data?.ok) throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
      setMsgFor(id, `SMS envoyé (to: ${to}${data?.message_id ? ` · message_id: ${data.message_id}` : ''}).`);
    } catch (e) {
      const em = String(e?.message || e);
      if (em === 'no_client' || em === 'no_device') {
        setMsgFor(id, 'Erreur SMS: no_device (Gateway Android non connecté). Aller sur #/gateway et vérifier la connexion (token + Socket.IO).');
      } else if (em === 'loopback_client') {
        setMsgFor(id, 'Erreur SMS: loopback_client (client navigateur). Le Gateway Android n’a pas reçu la commande. Fermer le client temp et connecter l’app Android.');
      } else {
        setMsgFor(id, `Erreur SMS: ${em}`);
      }
    } finally {
      setBusyFor(id, false);
    }
  };

  const sendTrackingEmail = async (row) => {
    const id = row?.id_order;
    if (!id) return;
    const email = rowTrackingEmail[String(id)] || null;
    if (!email || !String(email.html || '').trim() || !String(email.subject || '').trim()) {
      setMsgFor(id, 'Générer SMS + email d’abord.');
      return;
    }
    if (typeof window !== 'undefined') {
      const ok = window.confirm(`Envoyer cet email maintenant ?\nTo: ${row?.customer_email || ''}\nSujet: ${email.subject || ''}`);
      if (!ok) return;
    }
    setBusyFor(id, true);
    setMsgFor(id, '');
    try {
      const resp = await adminFetch(`/api/tools/relance/tracking/${encodeURIComponent(id)}/email-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: { subject: email.subject || '', html: email.html || '', text: email.text || '' } }),
      });
      const data = await readJson(resp);
      if (!resp.ok || !data?.ok) throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
      const fromUsed = data?.sender?.from_used;
      const fallback = !!data?.sender?.fallback_used;
      setMsgFor(id, `Email envoyé.${data?.message_id ? ` message_id: ${data.message_id}` : ''}${fromUsed ? ` · From: ${fromUsed}` : (fallback ? ' · From: (fallback Gmail)' : '')}`);
    } catch (e) {
      setMsgFor(id, `Erreur: ${String(e?.message || e)}`);
    } finally {
      setBusyFor(id, false);
    }
  };

  const openTrackingSmsModal = (row) => {
    const id = row?.id_order;
    if (!id) return;
    setSmsPreview({ kind: 'tracking', id: String(id), item: row || null });
    setSmsPreviewError('');
  };

  const openTrackingEmailModal = (row) => {
    const id = row?.id_order;
    if (!id) return;
    setPreview({ kind: 'tracking', id: String(id), item: row || null });
    setPreviewError('');
  };

  return (
    <div className="p-4">
      <div className="panel">
        <div className="panel__header flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold">Email relance</div>
            <div className="text-xs text-gray-500">Relances (MySQL views) + drafts Gmail + SMS Gateway</div>
          </div>
          <div className="flex items-center gap-2">
            <div
              className={`inline-flex items-center gap-2 text-xs px-2 py-1 rounded border ${
                gatewayStatus.device_socket_connected ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'
              }`}
              title={gatewayStatus.last_activity_at ? `Last activity: ${gatewayStatus.last_activity_at}` : undefined}
            >
              <span className={`inline-block h-2 w-2 rounded-full ${gatewayStatus.device_socket_connected ? 'bg-emerald-600' : 'bg-rose-600'}`} />
              Gateway: {gatewayStatus.device_socket_connected ? `Device connected (${gatewayStatus.device_socket_count || 0})` : 'Device disconnected'}
              {gatewayStatus.temp_socket_count ? <span className="text-gray-500">temp:{gatewayStatus.temp_socket_count}</span> : null}
            </div>
                <button
                  type="button"
                  className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
                  onClick={refreshCurrentTab}
                  disabled={headerBusy}
                >
                  {headerBusy ? 'Chargement…' : 'Rafraîchir'}
                </button>
          </div>
        </div>
        <div className="panel__body space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <TabButton active={tab === 'virement'} onClick={() => setTab('virement')}>Virement bancaire</TabButton>
            <TabButton active={tab === 'maison'} onClick={() => setTab('maison')}>Numero de maison</TabButton>
            <TabButton active={tab === 'tracking'} onClick={() => setTab('tracking')}>Send Tracking link</TabButton>
            <TabButton active={tab === 'telephone'} onClick={() => setTab('telephone')}>Numero de telephone</TabButton>
            <TabButton active={tab === 'settings'} onClick={() => setTab('settings')}>Paramètres</TabButton>
          </div>

          {(tab === 'virement' || tab === 'maison' || tab === 'tracking') && (
            <div className="flex items-end gap-3 flex-wrap">
              <Field label="Filtre">
                <input
                  className="w-[320px] max-w-full rounded border px-2 py-1 text-sm"
                  placeholder="id_order, email, nom, tel…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </Field>
              {error && <div className="text-sm text-red-600">{error}</div>}
            </div>
          )}

          {tab === 'virement' && (
            <EmailRelanceVirementPanel
              loading={loading}
              rows={filteredVirement}
              rowBusy={rowBusy}
              rowMsg={rowMsg}
              generatedById={virementGenerated}
              onGenerateEmail={generateVirementEmail}
              onEditEmail={openVirementEdit}
              onCreateDraft={createVirementDraft}
            />
          )}

          {tab === 'maison' && (
            <EmailRelanceNumeroMaisonPanel
              loading={loading}
              rows={filteredMaison}
              rowBusy={rowBusy}
              rowMsg={rowMsg}
              rowSmsDraft={rowSmsDraft}
              rowEmailGenerated={rowMaisonEmail}
              gatewayLines={gatewayLines}
              shopSubscriptionMap={gatewayShopMap}
              defaultSubscriptionId={settings?.gateway_default_subscription_id ?? null}
              onGenerateSms={generateMaisonSmsDraft}
              onGenerateEmail={generateMaisonEmailDraft}
              onOpenSmsModal={openMaisonSmsModal}
              onOpenEmailModal={openMaisonEmailModal}
            />
          )}

          {tab === 'tracking' && (
            <EmailRelanceTrackingPanel
              loading={loading}
              rows={filteredTracking}
              rowBusy={rowBusy}
              rowMsg={rowMsg}
              rowSmsDraft={rowTrackingSmsDraft}
              rowEmailGenerated={rowTrackingEmail}
              rowTrackingMeta={rowTrackingMeta}
              rowOpenAiDebug={rowTrackingOpenAiDebug}
              gatewayLines={gatewayLines}
              shopSubscriptionMap={gatewayShopMap}
              defaultSubscriptionId={settings?.gateway_default_subscription_id ?? null}
              onGenerateSms={generateTrackingSmsDraft}
              onGenerateEmail={generateTrackingEmailDraft}
              onOpenSmsModal={openTrackingSmsModal}
              onOpenEmailModal={openTrackingEmailModal}
            />
          )}

          {tab === 'telephone' && (
            <EmailRelancePlaceholderPanel title="Numero de telephone">
              À implémenter: relance pour demander le numéro de téléphone + draft email/SMS (prompt configuré dans Paramètres).
            </EmailRelancePlaceholderPanel>
          )}

          {tab === 'settings' && (
            <EmailRelanceSettingsPanel
              settings={settings}
              setSettings={setSettings}
              settingsFilter={settingsFilter}
              setSettingsFilter={setSettingsFilter}
              promptConfigs={promptConfigs}
              mcp2Servers={mcp2Servers}
              listsLoading={listsLoading}
              listsError={listsError}
              settingsLoading={settingsLoading}
              settingsSaving={settingsSaving}
              settingsError={settingsError}
              signatureUpdating={signatureUpdating}
              signatureUpdateMsg={signatureUpdateMsg}
              onUpdateSignatureCache={updateSignatureCache}
              onReloadSettings={loadSettings}
              onSaveSettings={saveSettings}
              onReloadLists={loadLists}
            />
          )}
        </div>
      </div>

      <EmailRelanceSmsPreviewModal
        open={!!smsPreview}
        title={smsPreview?.kind === 'tracking' ? 'SMS - Tracking link' : 'SMS - Numero de maison'}
        meta={
          smsPreview?.item?.reference
            ? `Commande ${smsPreview.item.reference}`
            : (smsPreview?.item?.id_order ? `Commande ${smsPreview.item.id_order}` : (smsPreview?.id ? `Commande ${smsPreview.id}` : ''))
        }
        to={smsPreview?.item ? normalizeSmsToNumber(smsPreview.item) : ''}
        fromLabel={(() => {
          const row = smsPreview?.item || null;
          if (!row) return '';
          const idShop = row?.id_shop != null ? Number(row.id_shop) : null;
          const mapped = (idShop != null && gatewayShopMap && gatewayShopMap[String(idShop)] != null) ? Number(gatewayShopMap[String(idShop)]) : null;
          const fallback = settings?.gateway_default_subscription_id;
          const chosenSub = Number.isFinite(mapped) && mapped > 0
            ? mapped
            : (Number.isFinite(Number(fallback)) && Number(fallback) > 0 ? Number(fallback) : null);
          if (!chosenSub) return '';
          const line = (Array.isArray(gatewayLines) ? gatewayLines : []).find((li) => Number(li?.subscription_id) === Number(chosenSub)) || null;
          return `sub:${chosenSub}${line?.msisdn ? ` · ${String(line.msisdn)}` : ''}${line?.carrier ? ` · ${String(line.carrier)}` : ''}`;
        })()}
        text={(() => {
          const id = smsPreview?.id;
          if (!id) return '';
          if (smsPreview?.kind === 'tracking') return String(rowTrackingSmsDraft[String(id)] || '');
          return String(rowSmsDraft[String(id)] || '');
        })()}
        busy={smsPreviewBusy}
        error={smsPreviewError}
        onChangeText={(next) => {
          const id = smsPreview?.id;
          if (!id) return;
          if (smsPreview?.kind === 'tracking') setRowTrackingSmsDraft((prev) => ({ ...(prev || {}), [String(id)]: String(next || '') }));
          else setRowSmsDraft((prev) => ({ ...(prev || {}), [String(id)]: String(next || '') }));
        }}
        onGenerate={async () => {
          const row = smsPreview?.item || null;
          if (!row) return;
          if (smsPreview?.kind === 'tracking') return generateTrackingSmsDraft(row);
          return generateMaisonSmsDraft(row);
        }}
        onSend={async ({ text }) => {
          const row = smsPreview?.item || null;
          const id = smsPreview?.id;
          if (!row || !id) return;
          if (typeof window !== 'undefined') {
            const ok = window.confirm('Envoyer ce SMS maintenant ?');
            if (!ok) return;
          }
          try {
            setSmsPreviewBusy(true);
            setSmsPreviewError('');
            const out = await sendSmsNow(row, text);
            setMsgFor(id, `SMS envoyé (to: ${out.to}${out?.message_id ? ` · message_id: ${out.message_id}` : ''}).`);
            setSmsPreview(null);
          } catch (e) {
            setSmsPreviewError(String(e?.message || e));
          } finally {
            setSmsPreviewBusy(false);
          }
        }}
        onClose={() => { setSmsPreview(null); setSmsPreviewError(''); }}
      />

      <EmailRelanceEmailPreviewModal
        open={!!preview}
        title={
          preview?.kind === 'tracking'
            ? 'Email - Tracking link'
            : (preview?.kind === 'maison' ? 'Email - Numero de maison' : 'Email virement bancaire')
        }
        meta={preview?.item?.reference ? `Commande ${preview.item.reference}` : (preview?.item?.id_order ? `Commande ${preview.item.id_order}` : (preview?.id ? `Commande ${preview.id}` : ''))}
        email={(() => {
          if (!preview) return null;
          const kind = preview.kind;
          const id = String(preview.id || '');
          const item = preview.item || {};
          if (!id) return null;
          if (kind === 'virement') {
            const saved = virementGenerated[id] || {};
            const it = saved?.item || item || {};
            return {
              to: String(it.customer_email || '').trim(),
              from: String(it.shop_email || '').trim(),
              subject: String(saved.subject || ''),
              html: String(saved.html || ''),
              text: String(saved.text || ''),
            };
          }
          if (kind === 'maison') {
            const e = rowMaisonEmail[id] || {};
            return {
              to: String(e.to || item.customer_email || '').trim(),
              from: String(e.from || item.shop_email || '').trim(),
              subject: String(e.subject || ''),
              html: String(e.html || ''),
              text: String(e.text || ''),
            };
          }
          if (kind === 'tracking') {
            const e = rowTrackingEmail[id] || {};
            return {
              to: String(e.to || item.customer_email || '').trim(),
              from: String(e.from || item.shop_email || '').trim(),
              subject: String(e.subject || ''),
              html: String(e.html || ''),
              text: String(e.text || ''),
            };
          }
          return null;
        })()}
        busy={previewBusy}
        error={previewError}
        onSave={(draft) => {
          if (!preview) return;
          const id = preview.id;
          if (!id) return;
          if (preview.kind === 'virement') {
            saveGeneratedFromComposer(id, draft, preview?.item);
            return;
          }
          const patch = {
            to: String(draft?.to || ''),
            subject: String(draft?.subject || ''),
            html: String(draft?.html || ''),
            text: String(draft?.text || ''),
          };
          if (preview.kind === 'maison') {
            setRowMaisonEmail((prev) => ({ ...(prev || {}), [String(id)]: { ...(prev?.[String(id)] || {}), ...patch } }));
          } else if (preview.kind === 'tracking') {
            setRowTrackingEmail((prev) => ({ ...(prev || {}), [String(id)]: { ...(prev?.[String(id)] || {}), ...patch } }));
          }
        }}
        onClose={() => { setPreview(null); setPreviewError(''); }}
        onCreateDraft={
          preview
            ? async (draft) => {
                try {
                  setPreviewBusy(true);
                  setPreviewError('');
                  const id = preview?.item?.id_order || preview?.id;
                  if (!id) throw new Error('missing_id_order');
                  const email = draft || {};
                  const base =
                    preview.kind === 'tracking'
                      ? `/api/tools/relance/tracking/${encodeURIComponent(id)}/email-draft`
                      : (preview.kind === 'maison'
                        ? `/api/tools/relance/numero-de-maison/${encodeURIComponent(id)}/email-draft`
                        : `/api/tools/relance/virement-bancaire/${encodeURIComponent(id)}/email-draft`);
                  const resp = await adminFetch(base, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ to: email.to || undefined, email: { subject: email.subject || '', html: email.html || '', text: email.text || '' } }),
                  });
                  const data = await readJson(resp);
                  if (!resp.ok || !data?.ok) throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
                  if (preview.kind === 'virement') saveGeneratedFromComposer(id, email, preview?.item);
                  else if (preview.kind === 'maison') setRowMaisonEmail((prev) => ({ ...(prev || {}), [String(id)]: { ...(prev?.[String(id)] || {}), ...email } }));
                  else if (preview.kind === 'tracking') setRowTrackingEmail((prev) => ({ ...(prev || {}), [String(id)]: { ...(prev?.[String(id)] || {}), ...email } }));
                  setMsgFor(id, `Brouillon Gmail créé.${data?.subject ? ` Sujet: ${data.subject}` : ''}`);
                } catch (e) {
                  setPreviewError(String(e?.message || e));
                } finally {
                  setPreviewBusy(false);
                }
              }
            : null
        }
        onSend={
          preview
            ? async (draft) => {
                try {
                  if (typeof window !== 'undefined') {
                    const ok = window.confirm('Envoyer cet email maintenant ?');
                    if (!ok) return;
                  }
                  setPreviewBusy(true);
                  setPreviewError('');
                  const id = preview?.item?.id_order || preview?.id;
                  if (!id) throw new Error('missing_id_order');
                  const email = draft || {};
                  const base =
                    preview.kind === 'tracking'
                      ? `/api/tools/relance/tracking/${encodeURIComponent(id)}/email-send`
                      : (preview.kind === 'maison'
                        ? `/api/tools/relance/numero-de-maison/${encodeURIComponent(id)}/email-send`
                        : `/api/tools/relance/virement-bancaire/${encodeURIComponent(id)}/email-send`);
                  const resp = await adminFetch(base, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ to: email.to || undefined, email: { subject: email.subject || '', html: email.html || '', text: email.text || '' } }),
                  });
                  const data = await readJson(resp);
                  if (!resp.ok || !data?.ok) throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
                  if (preview.kind === 'virement') saveGeneratedFromComposer(id, email, preview?.item);
                  else if (preview.kind === 'maison') setRowMaisonEmail((prev) => ({ ...(prev || {}), [String(id)]: { ...(prev?.[String(id)] || {}), ...email } }));
                  else if (preview.kind === 'tracking') setRowTrackingEmail((prev) => ({ ...(prev || {}), [String(id)]: { ...(prev?.[String(id)] || {}), ...email } }));
                  setMsgFor(id, `Email envoyé. ${data?.message_id ? `message_id: ${data.message_id}` : ''}`);
                  setPreview(null);
                } catch (e) {
                  setPreviewError(String(e?.message || e));
                } finally {
                  setPreviewBusy(false);
                }
              }
            : null
        }
      />
    </div>
  );
}
