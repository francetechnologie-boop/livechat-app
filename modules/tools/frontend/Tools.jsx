import React, { useEffect, useState } from "react";
// import Connectors from "./Connectors.jsx";
import Email from "./Email.jsx";
import EmailRelance from "./EmailRelance.jsx";
import EmailTemplate from "./EmailTemplate.jsx";
import Contact from "./Contact.jsx";
import Sms from "./Sms.jsx";
import Call from "./Call.jsx";
import Devis from "./Devis.jsx";
import Ticket from "./Ticket.jsx";
import GeneralSettings from "./GeneralSettings.jsx";
import PurchaseOrder from "./PurchaseOrder.jsx";
import Information from "./Information.jsx";
import { loadModuleState, saveModuleState } from "@app-lib/uiState";

// Local icon set (inline SVG, consistent stroke with Sidebar)
function IconBase({ className = "", children, ...props }) {
  const combined = ["h-4 w-4", className].filter(Boolean).join(" ");
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={combined}
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

function IconEmail(props) {
  return (
    <IconBase {...props}>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M3 8l9 6 9-6" />
    </IconBase>
  );
}

function IconEmailTemplate(props) {
  return (
    <IconBase {...props}>
      <rect x="4" y="3.5" width="16" height="17" rx="2" />
      <path d="M8 8h8" />
      <path d="M8 12h8" />
      <path d="M8 16h5" />
    </IconBase>
  );
}

function IconRelance(props) {
  return (
    <IconBase {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
      <path d="M8 20h8" />
    </IconBase>
  );
}

function IconContacts(props) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="9" r="3.2" />
      <path d="M5 20c1.4-3.4 4-5.2 7-5.2s5.6 1.8 7 5.2" />
    </IconBase>
  );
}

function IconSms(props) {
  return (
    <IconBase {...props}>
      <rect x="3" y="4" width="18" height="12" rx="2.5" />
      <polyline points="8 16 8 20 12 16" />
    </IconBase>
  );
}

function IconCall(props) {
  return (
    <IconBase {...props}>
      <path d="M22 16.9v2a2 2 0 0 1-2.2 2 19 19 0 0 1-8.3-3.2 19 19 0 0 1-6-6A19 19 0 0 1 2.1 3.3 2 2 0 0 1 4.1 1h2a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.45 2.11L7 8.7a16 16 0 0 0 6 6l1.28-1.25A2 2 0 0 1 16.4 13c.86.28 1.76.49 2.67.6A2 2 0 0 1 22 16.9z" />
    </IconBase>
  );
}

function IconQuote(props) { // Devis
  return (
    <IconBase {...props}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 8h7" />
      <path d="M8 12h7" />
      <path d="M8 16h4" />
    </IconBase>
  );
}

function IconTicket(props) {
  return (
    <IconBase {...props}>
      <rect x="4" y="6" width="16" height="12" rx="2" />
      <path d="M4 9h16" />
      <path d="M10 6v3" />
      <path d="M14 6v3" />
    </IconBase>
  );
}

function IconSettings(props) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 4v2" />
      <path d="M12 18v2" />
      <path d="M18 12h2" />
      <path d="M4 12H2" />
      <path d="M17 7l1.5-1.5" />
      <path d="M7 17l-1.5 1.5" />
      <path d="M17 17l1.5 1.5" />
      <path d="M7 7l-1.5-1.5" />
    </IconBase>
  );
}

function IconPurchaseOrder(props) {
  return (
    <IconBase {...props}>
      <path d="M7 7h10" />
      <path d="M7 11h10" />
      <path d="M7 15h6" />
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </IconBase>
  );
}

function IconInfo(props) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10.5v5" />
      <path d="M12 8h.01" />
    </IconBase>
  );
}

const ALLOWED_TABS = new Set(['email', 'email-relance', 'email-template', 'information', 'contact', 'sms', 'call', 'devis', 'ticket', 'purchase-order', 'settings']);
const TAB_TO_ROUTE = {
  email: 'Email',
  'email-relance': 'EmailRelance',
  'email-template': 'EmailTemplate',
  information: 'Information',
  contact: 'Contacts',
  sms: 'SMS',
  call: 'Call',
  devis: 'Devis',
  ticket: 'Ticket',
  'purchase-order': 'PurchaseOrder',
  settings: 'Settings',
};
const ROUTE_TO_TAB = {
  email: 'email',
  emails: 'email',
  emailrelance: 'email-relance',
  'email-relance': 'email-relance',
  emailtemplate: 'email-template',
  'email-template': 'email-template',
  emailfromtemplate: 'email-template',
  information: 'information',
  info: 'information',
  contact: 'contact',
  contacts: 'contact',
  sms: 'sms',
  call: 'call',
  devis: 'devis',
  ticket: 'ticket',
  tickets: 'ticket',
  purchaseorder: 'purchase-order',
  'purchase-order': 'purchase-order',
  settings: 'settings',
};

function parseToolsSubTabFromHash() {
  try {
    const raw = String(window.location.hash || '').replace(/^#\/?/, '');
    const parts = raw.split('/').filter(Boolean);
    if (!parts.length) return '';
    const isModulesPrefix = parts[0] === 'modules';
    const modId = isModulesPrefix ? (parts[1] || '') : (parts[0] || '');
    if (String(modId).toLowerCase() !== 'tools') return '';
    const seg = isModulesPrefix ? (parts[2] || '') : (parts[1] || '');
    const cleaned = String(seg || '').split('?')[0].trim();
    if (!cleaned) return '';
    const lowered = cleaned.toLowerCase();
    const mapped = ROUTE_TO_TAB[lowered] || '';
    if (mapped && ALLOWED_TABS.has(mapped)) return mapped;
    if (ALLOWED_TABS.has(lowered)) return lowered;
    return '';
  } catch {
    return '';
  }
}

function setToolsHashForSubTab(subTab) {
  try {
    const id = String(subTab || '').toLowerCase();
    if (!ALLOWED_TABS.has(id)) return;
    const seg = TAB_TO_ROUTE[id] || id;
    const next = `#/tools/${encodeURIComponent(seg)}`;
    if (window.location.hash !== next) window.history.replaceState(null, '', next);
  } catch {}
}

function Subnav({ subTab, setSubTab, collapsed, onToggle }) {
  const Item = ({ id, label, icon }) => (
    <button
      onClick={() => setSubTab(id)}
      title={collapsed ? label : undefined}
      className={`w-full flex items-center ${collapsed ? 'justify-center' : 'gap-2'} px-3 py-2 rounded-lg text-left transition-colors ${
        subTab === id ? "bg-blue-50 text-blue-700 border border-blue-200" : "hover:bg-gray-50"
      }`}
    >
      <span className="w-5 h-5 flex items-center justify-center" aria-hidden>{icon}</span>
      {!collapsed && <span className="text-sm">{label}</span>}
    </button>
  );

  return (
    <aside className={`${collapsed ? 'w-16' : 'w-64'} border-r bg-white p-3 flex flex-col min-h-0`}>
      <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between'} mb-2`}>
        {!collapsed && <div className="text-xs uppercase tracking-wide text-gray-400">Tools</div>}
        <button
          aria-label={collapsed ? 'Expand tools' : 'Collapse tools'}
          title={collapsed ? 'Expand' : 'Collapse'}
          onClick={onToggle}
          className="px-2 py-1 rounded border bg-white hover:bg-gray-50 text-xs"
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>
      <nav className="space-y-1 overflow-auto">
        <Item id="email" label="Email" icon={<IconEmail />} />
        <Item id="email-relance" label="Email relance" icon={<IconRelance />} />
        <Item id="email-template" label="Email template" icon={<IconEmailTemplate />} />
        <Item id="information" label="Information" icon={<IconInfo />} />
        <Item id="contact" label="Contacts" icon={<IconContacts />} />
        <Item id="sms" label="SMS" icon={<IconSms />} />
        <Item id="call" label="Call" icon={<IconCall />} />
        <Item id="devis" label="Devis" icon={<IconQuote />} />
        <Item id="ticket" label="Tickets" icon={<IconTicket />} />
        <Item id="purchase-order" label="Purchase Order" icon={<IconPurchaseOrder />} />
        <Item id="settings" label="Settings" icon={<IconSettings />} />
      </nav>
    </aside>
  );
}

function Placeholder({ title, children }) {
  return (
    <div className="p-4">
      <div className="panel max-w-3xl">
        <div className="panel__header">{title}</div>
        <div className="panel__body">
          {children || (
            <div className="text-sm text-gray-500">� venir.</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Tools() {
  const [subTab, setSubTab] = useState(() => {
    const fromHash = parseToolsSubTabFromHash();
    if (fromHash) return fromHash;
    try { const st = loadModuleState('tools'); return st.subTab || 'email'; } catch { return 'email'; }
  });
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try { const st = loadModuleState('tools'); return !!st.collapsed; } catch { return false; }
  });
  const [queueItems, setQueueItems] = useState([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState('');
  const [queueInfo, setQueueInfo] = useState('');
  const [queueFilters, setQueueFilters] = useState({
    subject: '',
    email: '',
    language: '',
    name: '',
    company: '',
  });

  // Save selection
  useEffect(() => { try { const st = loadModuleState('tools') || {}; saveModuleState('tools', { ...st, subTab }); } catch {} }, [subTab]);
  useEffect(() => { try { const st = loadModuleState('tools') || {}; saveModuleState('tools', { ...st, collapsed: navCollapsed }); } catch {} }, [navCollapsed]);

  // Guard: ignore deprecated/removed tabs
  useEffect(() => {
    if (!ALLOWED_TABS.has(subTab)) setSubTab('email');
  }, [subTab]);

  // Keep URL hash in sync with the selected tab (so the module is deep-linkable).
  useEffect(() => {
    setToolsHashForSubTab(subTab);
  }, [subTab]);

  // React to back/forward or manual hash edits.
  useEffect(() => {
    const onHash = () => {
      const parsed = parseToolsSubTabFromHash();
      if (parsed && parsed !== subTab) setSubTab(parsed);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [subTab]);

  // Breadcrumb
  useEffect(() => {
    const base = ['Tools'];
    let sec = null;
    if (subTab === 'email') sec = 'Email';
    else if (subTab === 'email-relance') sec = 'Email relance';
    else if (subTab === 'email-template') sec = 'Email template';
    else if (subTab === 'information') sec = 'Information';
    else if (subTab === 'contact') sec = 'Contacts';
    else if (subTab === 'sms') sec = 'SMS';
    else if (subTab === 'call') sec = 'Call';
    else if (subTab === 'devis') sec = 'Devis';
    else if (subTab === 'ticket') sec = 'Tickets';
    else if (subTab === 'purchase-order') sec = 'Purchase Order';
    // 'google-api' moved to Automation Suite
    try { window.dispatchEvent(new CustomEvent('app-breadcrumb', { detail: sec ? [...base, sec] : base })); } catch {}
  }, [subTab]);

  // Restore on login
  useEffect(() => {
    const onRestore = (e) => {
      try {
        const tab = e?.detail?.modules?.['tools']?.subTab;
        if (tab && ALLOWED_TABS.has(tab)) setSubTab(tab);
      } catch {}
    };
    window.addEventListener('app-restore', onRestore);
    return () => window.removeEventListener('app-restore', onRestore);
  }, []);

  const loadQueue = async () => {
    setQueueLoading(true);
    setQueueError('');
    try {
      const resp = await fetch('/api/tools/devis/queue?limit=80', { credentials: 'include' });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data?.ok) {
        setQueueItems(Array.isArray(data.items) ? data.items : []);
      } else {
        setQueueItems([]);
        setQueueError(data?.message || data?.error || 'Impossible de charger la file devis.');
      }
    } catch (error) {
      setQueueItems([]);
      setQueueError(error?.message || 'Erreur réseau');
    } finally {
      setQueueLoading(false);
    }
  };

  useEffect(() => {
    if (subTab === 'devis') loadQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab]);

  const prefillDevisFromQueue = (item) => {
    try {
      try {
        const msgId = String(item?.message_id || '').trim();
        if (msgId && !String(item?.customer_language || '').trim()) {
          setQueueItems((prev) =>
            (Array.isArray(prev) ? prev : []).map((it) =>
              String(it?.message_id || '').trim() === msgId ? { ...it, __lang_detecting: true } : it
            )
          );
        }
      } catch {}
      const payload = {
        customer_email_text: item.customer_email || '',
        customer_name_text: [item.customer_first_name, item.customer_last_name].filter(Boolean).join(' ').trim(),
        customer_company_text: item.customer_company || '',
        // Keep empty: "Remarques" is for quote footer notes, not for the email subject.
        remarques_text: '',
        customer_language_text: item.customer_language || '',
        // Prefer the shop-side email (to_email / PS_SHOP_EMAIL) for auto-matching ps_shop
        shop_email_text: item.to_email || item.from_email || item.customer_email || '',
        message_id: item.message_id || '',
      };
      localStorage.setItem('tools_devis_prefill', JSON.stringify(payload));
      try {
        window.dispatchEvent(new CustomEvent('tools-devis-prefill', { detail: payload }));
      } catch {}
      setSubTab('devis');
    } catch {}
  };

  useEffect(() => {
    const onDetected = (event) => {
      try {
        const detail = event?.detail || {};
        const messageId = String(detail.message_id || '').trim();
        const iso = String(detail.iso_code || '').trim().toLowerCase();
        if (!messageId) return;
        if (iso) setQueueInfo(`Langue détectée (${messageId}) : ${iso}`);
        setQueueItems((prev) =>
          (Array.isArray(prev) ? prev : []).map((it) =>
            String(it?.message_id || '').trim() === messageId
              ? { ...it, customer_language: iso || it.customer_language || '', __lang_detecting: false }
              : it
          )
        );
      } catch {}
    };
    const onDetecting = (event) => {
      try {
        const detail = event?.detail || {};
        const messageId = String(detail.message_id || '').trim();
        if (!messageId) return;
        setQueueItems((prev) =>
          (Array.isArray(prev) ? prev : []).map((it) =>
            String(it?.message_id || '').trim() === messageId ? { ...it, __lang_detecting: true } : it
          )
        );
      } catch {}
    };
    const onFailed = (event) => {
      try {
        const detail = event?.detail || {};
        const messageId = String(detail.message_id || '').trim();
        const msg = String(detail.error || '').trim();
        if (messageId && msg) setQueueInfo(`Détection langue échouée (${messageId}) : ${msg}`);
        if (!messageId) return;
        setQueueItems((prev) =>
          (Array.isArray(prev) ? prev : []).map((it) =>
            String(it?.message_id || '').trim() === messageId ? { ...it, __lang_detecting: false } : it
          )
        );
      } catch {}
    };
    window.addEventListener('tools-devis-language-detected', onDetected);
    window.addEventListener('tools-devis-language-detecting', onDetecting);
    window.addEventListener('tools-devis-language-detect-failed', onFailed);
    return () => {
      window.removeEventListener('tools-devis-language-detected', onDetected);
      window.removeEventListener('tools-devis-language-detecting', onDetecting);
      window.removeEventListener('tools-devis-language-detect-failed', onFailed);
    };
  }, []);

  const filteredQueueItems = (() => {
    const subjectFilter = String(queueFilters.subject || '').trim().toLowerCase();
    const emailFilter = String(queueFilters.email || '').trim().toLowerCase();
    const langFilter = String(queueFilters.language || '').trim().toLowerCase();
    const nameFilter = String(queueFilters.name || '').trim().toLowerCase();
    const companyFilter = String(queueFilters.company || '').trim().toLowerCase();

    if (!subjectFilter && !emailFilter && !langFilter && !nameFilter && !companyFilter) return queueItems;
    const includes = (hay, needle) => String(hay || '').toLowerCase().includes(needle);

    return (Array.isArray(queueItems) ? queueItems : []).filter((item) => {
      if (subjectFilter && !includes(item.subject, subjectFilter)) return false;
      if (emailFilter && !(includes(item.customer_email, emailFilter) || includes(item.from_email, emailFilter) || includes(item.to_email, emailFilter))) return false;
      if (langFilter && !includes(item.customer_language, langFilter)) return false;
      if (nameFilter && !(includes(item.customer_first_name, nameFilter) || includes(item.customer_last_name, nameFilter))) return false;
      if (companyFilter && !includes(item.customer_company, companyFilter)) return false;
      return true;
    });
  })();

  return (
    <div className="h-full w-full flex min-h-0">
      <Subnav subTab={subTab} setSubTab={setSubTab} collapsed={navCollapsed} onToggle={()=>setNavCollapsed(c=>!c)} />
      <main className="flex-1 min-h-0 flex flex-col">
        {subTab === 'devis' && (
          <div className="p-3">
            <div className="panel">
              <div className="panel__header flex items-center justify-between">
                <span>File devis (emails)</span>
                <button
                  type="button"
                  className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
                  onClick={loadQueue}
                  disabled={queueLoading}
                >
                  {queueLoading ? 'Rafraîchissement…' : 'Rafraîchir'}
                </button>
              </div>
	              <div className="panel__body">
	                {queueError && <div className="text-xs text-red-600 mb-2">{queueError}</div>}
	                {queueInfo && <div className="text-xs text-emerald-700 mb-2">{queueInfo}</div>}
                  <div className="flex items-center justify-between gap-3 mb-2 text-[11px] text-gray-500">
                    <div>
                      Affichés: <span className="font-semibold text-gray-700">{filteredQueueItems.length}</span> / {queueItems.length}
                    </div>
                    <button
                      type="button"
                      className="px-2 py-1 rounded border bg-white hover:bg-gray-50"
                      onClick={() => setQueueFilters({ subject: '', email: '', language: '', name: '', company: '' })}
                      disabled={queueLoading}
                    >
                      Reset filtres
                    </button>
                  </div>
		                <div
		                  className="relative overflow-x-auto overflow-y-auto"
		                  style={{ height: 320, '--queueHeaderH': '38px' }}
		                >
	                  <table className="min-w-full text-sm border border-separate border-spacing-0">
	                    <thead className="bg-gray-50 text-[11px] uppercase text-gray-600">
	                      <tr>
	                        <th className="sticky top-0 z-10 bg-gray-50 px-2 py-2 text-left border-r">Date</th>
	                        <th className="sticky top-0 z-10 bg-gray-50 px-2 py-2 text-left border-r">Sujet</th>
	                        <th className="sticky top-0 z-10 bg-gray-50 px-2 py-2 text-left border-r">Email client</th>
	                        <th className="sticky top-0 z-10 bg-gray-50 px-2 py-2 text-left border-r">Langue</th>
	                        <th className="sticky top-0 z-10 bg-gray-50 px-2 py-2 text-left border-r">Nom</th>
	                        <th className="sticky top-0 z-10 bg-gray-50 px-2 py-2 text-left border-r">Société</th>
	                        <th className="sticky top-0 z-10 bg-gray-50 px-2 py-2 text-left">Statut</th>
	                        <th className="sticky top-0 z-10 bg-gray-50 px-2 py-2 text-left">Actions</th>
	                      </tr>
                        <tr className="text-[11px] normal-case tracking-normal text-gray-600">
                          <th className="sticky z-10 bg-gray-50 border-b border-r px-2 py-1" style={{ top: 'var(--queueHeaderH)' }} />
                          <th className="sticky z-10 bg-gray-50 border-b border-r px-2 py-1" style={{ top: 'var(--queueHeaderH)' }}>
                            <input
                              className="w-full rounded border px-2 py-1 text-[11px] bg-white"
                              placeholder="Filtrer sujet…"
                              value={queueFilters.subject}
                              onChange={(e) => setQueueFilters((prev) => ({ ...prev, subject: e.target.value }))}
                            />
                          </th>
                          <th className="sticky z-10 bg-gray-50 border-b border-r px-2 py-1" style={{ top: 'var(--queueHeaderH)' }}>
                            <input
                              className="w-full rounded border px-2 py-1 text-[11px] bg-white"
                              placeholder="Filtrer email…"
                              value={queueFilters.email}
                              onChange={(e) => setQueueFilters((prev) => ({ ...prev, email: e.target.value }))}
                            />
                          </th>
                          <th className="sticky z-10 bg-gray-50 border-b border-r px-2 py-1" style={{ top: 'var(--queueHeaderH)' }}>
                            <input
                              className="w-full rounded border px-2 py-1 text-[11px] bg-white"
                              placeholder="ex: fr, gb"
                              value={queueFilters.language}
                              onChange={(e) => setQueueFilters((prev) => ({ ...prev, language: e.target.value }))}
                            />
                          </th>
                          <th className="sticky z-10 bg-gray-50 border-b border-r px-2 py-1" style={{ top: 'var(--queueHeaderH)' }}>
                            <input
                              className="w-full rounded border px-2 py-1 text-[11px] bg-white"
                              placeholder="Filtrer nom…"
                              value={queueFilters.name}
                              onChange={(e) => setQueueFilters((prev) => ({ ...prev, name: e.target.value }))}
                            />
                          </th>
                          <th className="sticky z-10 bg-gray-50 border-b border-r px-2 py-1" style={{ top: 'var(--queueHeaderH)' }}>
                            <input
                              className="w-full rounded border px-2 py-1 text-[11px] bg-white"
                              placeholder="Filtrer société…"
                              value={queueFilters.company}
                              onChange={(e) => setQueueFilters((prev) => ({ ...prev, company: e.target.value }))}
                            />
                          </th>
                          <th className="sticky z-10 bg-gray-50 border-b px-2 py-1" style={{ top: 'var(--queueHeaderH)' }} />
                          <th className="sticky z-10 bg-gray-50 border-b px-2 py-1" style={{ top: 'var(--queueHeaderH)' }} />
                        </tr>
	                    </thead>
	                    <tbody>
	                      {filteredQueueItems.length === 0 && (
	                        <tr>
	                          <td colSpan={8} className="px-3 py-3 text-center text-xs text-gray-500">
	                            {queueLoading ? 'Chargement…' : 'Aucun élément.'}
	                          </td>
	                        </tr>
	                      )}
	                      {filteredQueueItems.map((item) => (
	                        <tr key={item.id} className="border-t">
	                          <td className="px-2 py-1 text-xs text-gray-600">
	                            {item.created_at ? new Date(item.created_at).toLocaleString() : ''}
	                          </td>
                          <td className="px-2 py-1 text-xs text-gray-800 truncate max-w-[220px]">
                            {item.subject || '(Sans sujet)'}
                          </td>
                          <td className="px-2 py-1 text-xs text-gray-700">{item.customer_email || ''}</td>
                          <td className="px-2 py-1 text-xs text-gray-700">
                            {item.__lang_detecting ? 'détection…' : (item.customer_language || '')}
                          </td>
                          <td className="px-2 py-1 text-xs text-gray-700">
                            {item.customer_first_name || ''} {item.customer_last_name || ''}
                          </td>
                          <td className="px-2 py-1 text-xs text-gray-700">{item.customer_company || ''}</td>
                          <td className="px-2 py-1 text-xs">
                            <span className="inline-flex items-center rounded px-2 py-0.5 text-[11px] bg-blue-50 text-blue-700 border border-blue-100">
                              {item.status || 'queued'}
                            </span>
                          </td>
                          <td className="px-2 py-1 text-xs">
                            <button
                              type="button"
                              className="px-2 py-1 rounded border bg-white hover:bg-gray-50"
                              onClick={() => prefillDevisFromQueue(item)}
                            >
                              Pré-remplir devis
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}
        {subTab === 'email' && (<Email />)}
        {subTab === 'email-relance' && (<EmailRelance />)}
        {subTab === 'email-template' && (<EmailTemplate />)}
        {subTab === 'information' && (<Information />)}
        {subTab === 'contact' && (<Contact />)}
        {subTab === 'sms' && (<Sms />)}
        {subTab === 'call' && (<Call />)}
        {subTab === 'devis' && <Devis />}
        {subTab === 'ticket' && <Ticket />}
        {subTab === 'purchase-order' && <PurchaseOrder />}
        {subTab === 'settings' && <GeneralSettings />}
        {/* Google API moved to Automation Suite */}
      </main>
    </div>
  );
}
