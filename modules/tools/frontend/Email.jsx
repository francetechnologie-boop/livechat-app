import React, { useEffect, useMemo, useState } from 'react';

function ListItem({ item, selected, onClick }) {
  const when = useMemo(() => {
    try { return new Date(item.date).toLocaleString(); } catch { return item.date || ''; }
  }, [item.date]);
  return (
    <button onClick={onClick} className={`w-full text-left px-3 py-2 rounded mb-1 hover:bg-gray-50 ${selected ? 'bg-blue-50' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium truncate">{item.subject || '(No subject)'}</div>
        <div className="text-[11px] text-gray-500 whitespace-nowrap">{when}</div>
      </div>
      <div className="text-[12px] text-gray-600 truncate">{item.from}</div>
      <div className="text-[12px] text-gray-500 truncate">{item.snippet}</div>
    </button>
  );
}

function buildEmailSrcDoc(html) {
  const raw = String(html || '');
  const injected = [
    '<base target="_blank" />',
    '<meta name="referrer" content="no-referrer" />',
    '<style>',
    'html,body{margin:0;padding:0;background:#fff;}',
    'body{padding:12px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.35;}',
    'img{max-width:100%;height:auto;}',
    'table{max-width:100%;}',
    '</style>',
  ].join('');

  if (/<html[\s>]/i.test(raw)) {
    if (/<head[\s>]/i.test(raw)) {
      return raw.replace(/<head([^>]*)>/i, (m) => `${m}${injected}`);
    }
    return raw.replace(/<html([^>]*)>/i, (m) => `${m}<head>${injected}</head>`);
  }

  return `<!doctype html><html><head><meta charset="utf-8" />${injected}</head><body>${raw}</body></html>`;
}

function EmailHtmlFrame({ html }) {
  if (!html) return null;
  return (
    <iframe
      title="email_html"
      className="w-full h-[560px] border rounded bg-white"
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      srcDoc={buildEmailSrcDoc(html)}
    />
  );
}

function formatBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let x = v;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i++; }
  return `${x.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function AttachmentList({ messageId, attachments }) {
  const list = Array.isArray(attachments) ? attachments : [];
  const visible = list.filter(a => a && a.attachmentId);
  if (!messageId || !visible.length) return null;

  return (
    <div className="border rounded bg-white p-3">
      <div className="text-xs uppercase text-gray-500 mb-2">Attachments</div>
      <div className="space-y-1">
        {visible.map((a, idx) => {
          const filename = a.filename || 'attachment';
          const qs = new URLSearchParams();
          if (a.filename) qs.set('filename', a.filename);
          if (a.mimeType) qs.set('mimeType', a.mimeType);
          const href = `/api/google-api/oauth/gmail/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(a.attachmentId)}?${qs.toString()}`;
          const qsInline = new URLSearchParams(qs);
          qsInline.set('inline', '1');
          const hrefInline = `/api/google-api/oauth/gmail/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(a.attachmentId)}?${qsInline.toString()}`;
          const mime = String(a.mimeType || '').toLowerCase();
          const isImage = mime.startsWith('image/');
          const isPdf = mime === 'application/pdf';
          return (
            <div key={`${a.attachmentId}-${idx}`} className="border rounded p-2 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  {(isImage || isPdf) ? (
                    <a href={hrefInline} target="_blank" rel="noreferrer" className="shrink-0">
                      {isImage ? (
                        <img
                          src={hrefInline}
                          alt={filename}
                          className="h-16 w-16 object-contain border rounded bg-white"
                          loading="lazy"
                        />
                      ) : (
                        <div className="h-16 w-16 flex items-center justify-center border rounded bg-white text-xs text-gray-600">
                          PDF
                        </div>
                      )}
                    </a>
                  ) : null}

                  <div className="min-w-0">
                    <a className="text-blue-700 hover:underline truncate block" href={hrefInline} target="_blank" rel="noreferrer">
                      {filename}
                    </a>
                    <div className="text-[11px] text-gray-500">
                      {a.mimeType || 'application/octet-stream'}
                      {a.size ? ` · ${formatBytes(a.size)}` : ''}
                      {a.isInline ? ' · inline' : ''}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {(isImage || isPdf) && (
                  <a className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50 whitespace-nowrap" href={hrefInline} target="_blank" rel="noreferrer">
                    Preview
                  </a>
                )}
                <a className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50 whitespace-nowrap" href={href}>
                  Download
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Email() {
  const [status, setStatus] = useState({ loading: true, connected: false, lastError: '' });
  const [labels, setLabels] = useState({}); // id -> {messagesUnread}
  const [items, setItems] = useState([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState(null);
  const [detail, setDetail] = useState(null);
  const [composeMode, setComposeMode] = useState(null); // 'reply' | 'forward' | null
  const [composeTo, setComposeTo] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [split, setSplit] = useState(true); // split-pane vs list-only
  const [full, setFull] = useState(false); // full message view (list hidden)
  const [folder, setFolder] = useState('inbox_unread'); // inbox_unread | inbox | sent
  const [queueBusy, setQueueBusy] = useState(false);
  const [queueMsg, setQueueMsg] = useState('');
  const [queueError, setQueueError] = useState('');
  const [queueInfo, setQueueInfo] = useState(null);
  const [ticketBusy, setTicketBusy] = useState(false);
  const [ticketError, setTicketError] = useState('');
  const [ticketMsg, setTicketMsg] = useState('');
  const [ticketInfo, setTicketInfo] = useState(null);
  const [promptPopup, setPromptPopup] = useState(null);
  const [promptId, setPromptId] = useState('');
  const [promptVersion, setPromptVersion] = useState('');
  const [promptConfigId, setPromptConfigId] = useState('');

  // Load prompt settings stored from Devis page (shared via localStorage)
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('tools_devis_prompt_config') || '{}');
      if (saved.promptId) setPromptId(saved.promptId);
      if (saved.promptVersion) setPromptVersion(saved.promptVersion);
      if (saved.promptConfigId) setPromptConfigId(saved.promptConfigId);
    } catch {}
  }, []);

  const loadStatus = async () => {
    try { const r = await fetch('/api/google-api/oauth/debug', { credentials:'include' }); const j = await r.json(); setStatus({ loading:false, connected:!!j?.connected, lastError: j?.last_error||'' }); } catch { setStatus({ loading:false, connected:false, lastError:'' }); }
  };
  useEffect(() => { loadStatus(); }, []);
  useEffect(() => {
    if (!status.connected) return;
    (async () => {
      try { const r = await fetch('/api/google-api/oauth/gmail', { credentials:'include' }); const j = await r.json(); if (r.ok && j && (j.ok===undefined || j.ok)) { const map={}; (j.labels||[]).forEach(l=>{ map[l.id]={ unread: l.messagesUnread||0, name: l.name}; }); setLabels(map); } }
      catch {}
    })();
  }, [status.connected]);

  const search = async () => {
    setBusy(true); setItems([]); setSel(null); setDetail(null);
    try {
      const qp = new URLSearchParams(); if (q && q.trim()) qp.set('q', q.trim()); qp.set('max','20');
      if (folder === 'inbox_unread') {
        qp.set('labelIds', 'INBOX,UNREAD');
      } else if (folder === 'inbox') {
        qp.set('labelIds', 'INBOX');
      } else if (folder === 'sent') {
        qp.set('labelIds', 'SENT');
      }
      const r = await fetch('/api/google-api/oauth/gmail/messages?'+qp.toString(), { credentials:'include' });
      const j = await r.json();
      if (r.ok && j?.ok) setItems(Array.isArray(j.items)? j.items: []); else setItems([]);
    } catch { setItems([]); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (status.connected) search(); }, [status.connected, folder]);

  const openItem = async (it) => {
    setSel(it?.id || null); setDetail(null);
    setQueueBusy(false); setQueueMsg(''); setQueueError(''); setQueueInfo(null);
    setTicketBusy(false); setTicketMsg(''); setTicketError(''); setTicketInfo(null);
    if (!split) setFull(true);
    try { const r = await fetch(`/api/google-api/oauth/gmail/messages/${encodeURIComponent(it.id)}`, { credentials:'include' }); const j = await r.json(); if (r.ok && j?.ok) setDetail(j); else setDetail(null); } catch { setDetail(null); }
  };

  const addToDevisQueue = async () => {
    if (!detail) return;
    setQueueBusy(true);
    setQueueMsg('');
    setQueueError('');
    try {
      const payload = {
        id: detail.id,
        threadId: detail.threadId,
        subject: detail.subject,
        from: detail.from,
        to: detail.to,
        date: detail.date,
        snippet: detail.snippet,
        body_text: detail.body_text,
        body_html: detail.body_html,
        promptId: promptId || undefined,
        promptVersion: promptVersion || undefined,
        promptConfigId: promptConfigId || undefined,
        request_preview: {
          subject: detail.subject || '',
          from: detail.from || '',
          to: detail.to || '',
          snippet: detail.snippet || '',
          body: detail.body_text || detail.body_html || '',
        },
      };
      const resp = await fetch('/api/tools/devis/queue/from-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data?.ok) {
        setQueueInfo({
          applied: data?.extraction?.applied || null,
          item: data?.item || null,
        });
        const applied = data?.extraction?.applied || {};
        const summary = applied.customer_email
          ? `Ajouté avec ${applied.customer_email}`
          : 'Ajouté à la file devis.';
        setQueueMsg(summary);
        const prompt = data?.extraction?.prompt || {};
        const llm = data?.extraction?.llm || {};
        setPromptPopup({
          email: applied.customer_email || '',
          firstName: applied.customer_first_name || '',
          lastName: applied.customer_last_name || '',
          company: applied.customer_company || '',
          phone: applied.customer_phone || '',
          lang: applied.customer_language || '',
          promptId: prompt.prompt_id || '',
          promptVersion: prompt.prompt_version || '',
          model: prompt.model || llm.model || data?.extraction?.model || '',
          requestPreview: (prompt.request_preview && JSON.stringify(prompt.request_preview, null, 2)) || '',
        });
      } else {
        setQueueError(data?.message || data?.error || 'Impossible d’ajouter ce mail à la file devis.');
      }
      } catch (error) {
        setQueueError(error?.message || 'Erreur réseau');
      } finally {
        setQueueBusy(false);
      }
    };

  const createTicketFromEmail = async () => {
    if (!detail) return;
    setTicketBusy(true);
    setTicketMsg('');
    setTicketError('');
    setTicketInfo(null);
    try {
      const payload = {
        messageId: detail.id,
        threadId: detail.threadId,
        subject: detail.subject,
        from: detail.from,
        to: detail.to,
        date: detail.date,
        snippet: detail.snippet,
        body_text: detail.body_text,
        body_html: detail.body_html,
        attachments: detail.attachments,
        queue: 'Support produit',
        priority: 'normal',
        source: 'gmail',
      };
      const resp = await fetch('/api/tools/email/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data?.ok) {
        setTicketInfo(data.ticket || null);
        setTicketMsg(data.message || 'Ticket créé.');
      } else {
        setTicketError(data?.message || data?.error || 'Impossible de créer le ticket.');
      }
    } catch (error) {
      setTicketError(error?.message || 'Erreur réseau');
    } finally {
      setTicketBusy(false);
    }
  };

  const QueueSummary = () => {
    if (!(queueMsg || queueError || queueInfo?.applied)) return null;
    const applied = queueInfo?.applied || {};
    return (
      <div className="space-y-1 mt-1">
        {(queueMsg || queueError) && (
          <div className={`text-[11px] ${queueError ? 'text-red-600' : 'text-emerald-700'}`}>
            {queueError || queueMsg}
          </div>
        )}
        {queueInfo?.applied && (
          <div className="text-[11px] text-gray-600 flex flex-wrap gap-3">
            {applied.customer_email && (
              <div>Email: <span className="font-semibold text-gray-800">{applied.customer_email}</span></div>
            )}
            {(applied.customer_first_name || applied.customer_last_name) && (
              <div>Nom: <span className="font-semibold text-gray-800">{`${applied.customer_first_name || ''} ${applied.customer_last_name || ''}`.trim()}</span></div>
            )}
            {applied.customer_company && (
              <div>Société: <span className="font-semibold text-gray-800">{applied.customer_company}</span></div>
            )}
            {applied.customer_language && (
              <div>Langue: <span className="font-semibold text-gray-800 uppercase">{applied.customer_language}</span></div>
            )}
            {applied.customer_phone && (
              <div>Téléphone: <span className="font-semibold text-gray-800">{applied.customer_phone}</span></div>
            )}
          </div>
        )}
      </div>
    );
  };

  const TicketSummary = () => {
    if (!(ticketMsg || ticketError || ticketInfo)) return null;
    return (
      <div className="space-y-1 mt-1">
        {(ticketMsg || ticketError) && (
          <div className={`text-[11px] ${ticketError ? 'text-red-600' : 'text-emerald-700'}`}>
            {ticketError || ticketMsg}
          </div>
        )}
        {ticketInfo && (
          <div className="text-[11px] text-gray-600 flex flex-wrap gap-3">
            {ticketInfo.id && (
              <div>
                Ticket: <span className="font-semibold text-gray-800">#{ticketInfo.id}</span>
              </div>
            )}
            {ticketInfo.queue && (
              <div>
                File: <span className="font-semibold text-gray-800">{ticketInfo.queue}</span>
              </div>
            )}
            {ticketInfo.status && (
              <div>
                Statut: <span className="font-semibold text-gray-800">{ticketInfo.status}</span>
              </div>
            )}
            {ticketInfo.customer_email && (
              <div>
                Email: <span className="font-semibold text-gray-800">{ticketInfo.customer_email}</span>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const promptSummary = useMemo(() => {
    const parts = [];
    if (promptConfigId) parts.push(`Config ${promptConfigId}`);
    if (promptId) parts.push(`Prompt ${promptId}`);
    if (promptVersion) parts.push(`v${promptVersion}`);
    if (!parts.length) return 'Prompt non configuré (voir Devis)';
    return parts.join(' · ');
  }, [promptConfigId, promptId, promptVersion]);

  if (status.loading) return <div className="p-4 text-sm text-gray-500">Chargement…</div>;
  if (!status.connected) {
    return (
      <div className="p-4">
        <div className="panel max-w-3xl">
          <div className="panel__header">Email (Gmail)</div>
          <div className="panel__body space-y-3">
            <div className="text-sm text-gray-600">Connectez votre compte Google dans la section “OAuth utilisateur”.</div>
            {status.lastError && <div className="text-xs text-red-600">Dernière erreur: {status.lastError}</div>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex min-h-0">
      <aside className="w-64 border-r bg-white p-3 flex flex-col">
        <button className="mb-3 px-3 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 text-sm" onClick={()=>{ /* compose later */ }}>Compose</button>
        <nav className="space-y-1 mb-3">
          <button className={`w-full text-left px-3 py-2 rounded flex items-center justify-between ${folder==='inbox_unread'?'bg-blue-50 text-blue-700 border border-blue-200':'hover:bg-gray-50'}`} onClick={()=>setFolder('inbox_unread')}>
            <span>Inbox (unread)</span>
            <span className="text-[11px] text-gray-600">{labels.INBOX?.unread || 0}</span>
          </button>
          <button className={`w-full text-left px-3 py-2 rounded ${folder==='inbox'?'bg-blue-50 text-blue-700 border border-blue-200':'hover:bg-gray-50'}`} onClick={()=>setFolder('inbox')}>Inbox</button>
          <button className={`w-full text-left px-3 py-2 rounded ${folder==='sent'?'bg-blue-50 text-blue-700 border border-blue-200':'hover:bg-gray-50'}`} onClick={()=>setFolder('sent')}>Sent</button>
        </nav>
        <div className="flex items-center gap-2">
          <input className="flex-1 border rounded px-2 py-1" placeholder="Rechercher (from:xxx subject:yyy)" value={q} onChange={(e)=>setQ(e.target.value)} onKeyDown={(e)=>{ if(e.key==='Enter') search(); }} />
          <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={search} disabled={busy}>{busy?'…':'Search'}</button>
        </div>
      </aside>
      <main className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 py-2 border-b bg-white">
          <div className="flex items-center gap-2 text-sm text-gray-700">
            {full && (
              <button className="px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={()=>{ setFull(false); setComposeMode(null); }}>&larr;</button>
            )}
            <div>{folder==='inbox_unread'?'Unread':folder==='inbox'?'Inbox':'Sent'}</div>
          </div>
          <div className="flex items-center gap-2">
            <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={()=>setSplit(!split)}>{split? 'List only' : 'Split view'}</button>
            <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={search} disabled={busy}>Refresh</button>
          </div>
        </div>
        {!full ? (
        <div className={`flex-1 overflow-hidden grid grid-cols-12`}>
          <div className={`${split ? 'col-span-6' : 'col-span-12'} overflow-y-auto`}>
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 border-b">
                <tr>
                  <th className="px-3 py-2 w-[36px]"></th>
                  <th className="text-left px-3 py-2 w-[40%]">From</th>
                  <th className="text-left px-3 py-2">Subject</th>
                  <th className="text-right px-3 py-2 w-[120px]">Date</th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => (
                  <tr key={it.id} className={`border-b cursor-pointer hover:bg-gray-50 ${sel===it.id?'bg-blue-50/40':''}`} onClick={()=>openItem(it)}>
                    <td className="px-3 py-2 text-center" onClick={async (e)=>{ e.stopPropagation(); try { const starred = (it.labelIds||[]).includes('STARRED'); const url = `/api/google-api/oauth/gmail/messages/${encodeURIComponent(it.id)}/` + (starred?'unstar':'star'); const r = await fetch(url, { method:'POST', credentials:'include' }); if (r.ok) { it.labelIds = starred ? (it.labelIds||[]).filter(x=>x!=='STARRED') : ([...(it.labelIds||[]),'STARRED']); setItems([...items]); } } catch {} }}>
                      <span className={`text-lg ${ (it.labelIds||[]).includes('STARRED') ? 'text-yellow-500' : 'text-gray-400'}`}>★</span>
                    </td>
                    <td className={`px-3 py-2 truncate ${ (it.labelIds||[]).includes('UNREAD') ? 'font-semibold' : ''}`}>{it.from}</td>
                    <td className="px-3 py-2">
                      <div className={`truncate ${ (it.labelIds||[]).includes('UNREAD') ? 'font-semibold' : 'font-medium'}`}>{it.subject || '(No subject)'}</div>
                      <div className="truncate text-xs text-gray-500">{it.snippet || ''}</div>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{new Date(it.date || Date.now()).toLocaleDateString(undefined, { month:'short', day:'numeric'})}</td>
                  </tr>
                ))}
                {!items.length && !busy && (
                  <tr><td className="px-3 py-4 text-gray-500" colSpan={3}>Aucun message.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {split && (
          <div className="col-span-6 overflow-y-auto p-4">
            {!detail ? (
              <div className="text-sm text-gray-500">Sélectionnez un message.</div>
            ) : (
              <div className="space-y-2">
                <div className="text-lg font-semibold">{detail.subject || '(No subject)'}</div>
                <div className="text-sm text-gray-600">De: {detail.from}</div>
                <div className="text-sm text-gray-600">À: {detail.to}</div>
                <div className="text-sm text-gray-600">Date: {detail.date}</div>
                <div className="text-[11px] text-gray-500">Prompt (Devis): {promptSummary}</div>
                <div className="flex items-center gap-2 mt-1">
                  <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={async()=>{ try{ const r=await fetch(`/api/google-api/oauth/gmail/messages/${encodeURIComponent(detail.id)}/mark-read`, { method:'POST', credentials:'include'}); if(!r.ok){ try{ const j=await r.json(); alert(`Failed: ${j.message||j.error||r.status}`);}catch{ alert('Failed to mark as read'); } return;} setDetail(prev=> prev? {...prev, labelIds:(prev.labelIds||[]).filter(x=>x!=='UNREAD')}:prev); search(); }catch{ alert('Failed to mark as read'); }}}>Mark as read</button>
                  <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={async()=>{ try{ const r=await fetch(`/api/google-api/oauth/gmail/messages/${encodeURIComponent(detail.id)}/mark-unread`, { method:'POST', credentials:'include'}); if(!r.ok){ try{ const j=await r.json(); alert(`Failed: ${j.message||j.error||r.status}`);}catch{ alert('Failed to mark as unread'); } return;} setDetail(prev=> prev? {...prev, labelIds:[...(prev.labelIds||[]),'UNREAD']}:prev); search(); }catch{ alert('Failed to mark as unread'); }}}>Mark as unread</button>
                  <button className="text-xs px-2 py-1 rounded border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-60" onClick={addToDevisQueue} disabled={queueBusy}>{queueBusy?'Ajout…':'Ajouter au devis'}</button>
                  <button className="text-xs px-2 py-1 rounded border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 disabled:opacity-60" onClick={createTicketFromEmail} disabled={ticketBusy}>{ticketBusy ? 'Création…' : 'Créer un ticket'}</button>
                  <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50 text-red-700" onClick={async()=>{ if(!confirm('Delete (move to Trash) this message?')) return; try{ const r=await fetch(`/api/google-api/oauth/gmail/messages/${encodeURIComponent(detail.id)}/delete`, { method:'POST', credentials:'include'}); if(!r.ok){ try{ const j=await r.json(); alert(`Failed: ${j.message||j.error||r.status}`);}catch{ alert('Delete failed'); } return;} setDetail(null); search(); }catch{ alert('Delete failed'); }}}>Delete</button>
                  <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={()=>{ setComposeMode('reply'); setComposeTo(''); setComposeBody(`\n\nOn ${detail.date}, ${detail.from} wrote:`); }}>Reply</button>
                  <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={()=>{ setComposeMode('forward'); setComposeTo(''); setComposeBody(`\n\n---------- Forwarded message ----------\nFrom: ${detail.from}\nDate: ${detail.date}\nSubject: ${detail.subject}\n\n${detail.body_text || ''}`); }}>Forward</button>
                </div>
                <QueueSummary />
                <TicketSummary />
                <AttachmentList messageId={detail.id} attachments={detail.attachments} />
                <hr />
                {detail.body_html ? (
                  <EmailHtmlFrame html={detail.body_html} />
                ) : (
                  <pre className="whitespace-pre-wrap text-sm bg-gray-50 p-3 rounded border">{detail.body_text || detail.snippet || ''}</pre>
                )}

                {composeMode && (
                  <div className="mt-3 p-3 border rounded bg-white">
                    <div className="text-sm font-medium mb-2">{composeMode==='reply'?'Reply':'Forward'}</div>
                    <div className="mb-2">
                      <label className="text-xs text-gray-600 mr-2">To</label>
                      <input className="border rounded px-2 py-1 w-full" placeholder={composeMode==='reply'?(detail.from||''):'dest@example.com'} value={composeTo} onChange={(e)=>setComposeTo(e.target.value)} />
                    </div>
                    <textarea className="w-full border rounded px-2 py-1 min-h-[120px]" value={composeBody} onChange={(e)=>setComposeBody(e.target.value)} />
                    <div className="mt-2 flex items-center gap-2">
                      <button className="text-xs px-3 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700" onClick={async()=>{
                        try {
                          if (composeMode==='reply') {
                            const body = { text: composeBody };
                            if (composeTo && composeTo.trim()) body.to = composeTo.trim();
                            const r = await fetch(`/api/google-api/oauth/gmail/messages/${encodeURIComponent(detail.id)}/reply`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
                            if (r.ok) { setComposeMode(null); setComposeBody(''); search(); }
                          } else if (composeMode==='forward') {
                            const to = composeTo && composeTo.trim()? composeTo.trim(): '';
                            if (!to) { alert('Destinataire requis'); return; }
                            const r = await fetch(`/api/google-api/oauth/gmail/messages/${encodeURIComponent(detail.id)}/forward`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ to, text: composeBody }) });
                            if (r.ok) { setComposeMode(null); setComposeBody(''); }
                          }
                        } catch {}
                      }}>Send</button>
                      <button className="text-xs px-3 py-1 rounded border bg-white hover:bg-gray-50" onClick={()=>{ setComposeMode(null); setComposeBody(''); }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          )}
        </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4">
            {!detail ? (
              <div className="text-sm text-gray-500">Chargement…</div>
            ) : (
              <div className="space-y-2 max-w-4xl">
                <div className="text-2xl font-semibold">{detail.subject || '(No subject)'}</div>
                <div className="text-sm text-gray-600">De: {detail.from}</div>
                <div className="text-sm text-gray-600">À: {detail.to}</div>
                <div className="text-sm text-gray-600">Date: {detail.date}</div>
                <div className="text-[11px] text-gray-500">Prompt (Devis): {promptSummary}</div>
                <div className="flex items-center gap-2 mt-1">
                  <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={async()=>{ try{ await fetch(`/api/google-api/oauth/gmail/messages/${encodeURIComponent(detail.id)}/mark-read`, { method:'POST', credentials:'include'}); setDetail(prev=> prev? {...prev, labelIds:(prev.labelIds||[]).filter(x=>x!=='UNREAD')}:prev); search(); }catch{}}}>Mark as read</button>
                  <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={async()=>{ try{ await fetch(`/api/google-api/oauth/gmail/messages/${encodeURIComponent(detail.id)}/mark-unread`, { method:'POST', credentials:'include'}); setDetail(prev=> prev? {...prev, labelIds:[...(prev.labelIds||[]),'UNREAD']}:prev); search(); }catch{}}}>Mark as unread</button>
                  <button className="text-xs px-2 py-1 rounded border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-60" onClick={addToDevisQueue} disabled={queueBusy}>{queueBusy?'Ajout…':'Ajouter au devis'}</button>
                  <button className="text-xs px-2 py-1 rounded border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 disabled:opacity-60" onClick={createTicketFromEmail} disabled={ticketBusy}>{ticketBusy ? 'Création…' : 'Créer un ticket'}</button>
                  <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={()=>{ setComposeMode('reply'); setComposeTo(''); setComposeBody(`\n\nOn ${detail.date}, ${detail.from} wrote:`); }}>Reply</button>
                  <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={()=>{ setComposeMode('forward'); setComposeTo(''); setComposeBody(`\n\n---------- Forwarded message ----------\nFrom: ${detail.from}\nDate: ${detail.date}\nSubject: ${detail.subject}\n\n${detail.body_text || ''}`); }}>Forward</button>
                </div>
                <QueueSummary />
                <TicketSummary />
                <AttachmentList messageId={detail.id} attachments={detail.attachments} />
                <hr />
                {detail.body_html ? (
                  <EmailHtmlFrame html={detail.body_html} />
                ) : (
                  <pre className="whitespace-pre-wrap text-sm bg-gray-50 p-3 rounded border">{detail.body_text || detail.snippet || ''}</pre>
                )}
                {composeMode && (
                  <div className="mt-3 p-3 border rounded bg-white">
                    <div className="text-sm font-medium mb-2">{composeMode==='reply'?'Reply':'Forward'}</div>
                    <div className="mb-2">
                      <label className="text-xs text-gray-600 mr-2">To</label>
                      <input className="border rounded px-2 py-1 w-full" placeholder={composeMode==='reply'?(detail.from||''):'dest@example.com'} value={composeTo} onChange={(e)=>setComposeTo(e.target.value)} />
                    </div>
                    <textarea className="w-full border rounded px-2 py-1 min-h-[160px]" value={composeBody} onChange={(e)=>setComposeBody(e.target.value)} />
                    <div className="mt-2 flex items-center gap-2">
                      <button className="text-xs px-3 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700" onClick={async()=>{
                        try {
                          if (composeMode==='reply') {
                            const body = { text: composeBody };
                            if (composeTo && composeTo.trim()) body.to = composeTo.trim();
                            const r = await fetch(`/api/google-api/oauth/gmail/messages/${encodeURIComponent(detail.id)}/reply`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
                            if (r.ok) { setComposeMode(null); setComposeBody(''); search(); }
                          } else if (composeMode==='forward') {
                            const to = composeTo && composeTo.trim()? composeTo.trim(): '';
                            if (!to) { alert('Destinataire requis'); return; }
                            const r = await fetch(`/api/google-api/oauth/gmail/messages/${encodeURIComponent(detail.id)}/forward`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ to, text: composeBody }) });
                            if (r.ok) { setComposeMode(null); setComposeBody(''); }
                          }
                        } catch {}
                      }}>Send</button>
                      <button className="text-xs px-3 py-1 rounded border bg-white hover:bg-gray-50" onClick={()=>{ setComposeMode(null); setComposeBody(''); }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
      {promptPopup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-lg p-5 space-y-4 relative">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-sm text-gray-900">Extraction (prompt)</div>
              <button
                className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
                onClick={() => setPromptPopup(null)}
                autoFocus
              >
                Fermer
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-[12px] text-gray-700">
              <div>Email: <span className="font-semibold text-gray-900">{promptPopup.email || '—'}</span></div>
              <div>Langue: <span className="font-semibold text-gray-900 uppercase">{promptPopup.lang || '—'}</span></div>
              <div>Nom: <span className="font-semibold text-gray-900">{`${promptPopup.firstName} ${promptPopup.lastName}`.trim() || '—'}</span></div>
              <div>Société: <span className="font-semibold text-gray-900">{promptPopup.company || '—'}</span></div>
              <div>Téléphone: <span className="font-semibold text-gray-900">{promptPopup.phone || '—'}</span></div>
              <div>Prompt: <span className="font-semibold text-gray-900">{promptPopup.promptId || '—'}</span></div>
              <div>Version: <span className="font-semibold text-gray-900">{promptPopup.promptVersion || '—'}</span></div>
              <div>Modèle: <span className="font-semibold text-gray-900">{promptPopup.model || '—'}</span></div>
            </div>
            {!!promptPopup.requestPreview && (
              <div>
                <div className="text-[11px] uppercase text-gray-500 mb-1">Requête envoyée au prompt</div>
                <pre className="text-[11px] bg-gray-50 border rounded p-2 max-h-48 overflow-auto whitespace-pre-wrap">{promptPopup.requestPreview}</pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
