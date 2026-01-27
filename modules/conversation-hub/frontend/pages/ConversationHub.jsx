import React, { useEffect, useState } from 'react';
import { socket } from '../utils/socket.js';
import ConversationList from '../components/ConversationList.jsx';
import VisitorDetails from '../components/VisitorDetails.jsx';
import ChatWindow from '../components/ChatWindow.jsx';
import ConversationHubSettingsPanel from '../components/ConversationHubSettingsPanel.jsx';
import ConversationHubPayloadReportPanel from '../components/ConversationHubPayloadReportPanel.jsx';
import OpenAiLogPanel from '../components/OpenAiLogPanel.jsx';
import { loadModuleState, saveModuleState } from '@app-lib/uiState';

function TabButton({ active, onClick, children, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={[
        'text-xs px-2 py-1 rounded border',
        active ? 'bg-indigo-600 text-white border-indigo-700' : 'bg-white hover:bg-gray-50',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

export default function ConversationHub() {
  const normalizeVisitorId = (id) => {
    if (id == null) return null;
    const s = String(id).trim();
    return s ? s : null;
  };

  const [messages, setMessages] = useState([]);
  const [visitors, setVisitors] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [selectedVisitor, setSelectedVisitor] = useState(null);
  const [visitorInfo, setVisitorInfo] = useState({});
  const [visitsByVisitor, setVisitsByVisitor] = useState({});
  const threadAliasesRef = React.useRef({});
  const selectedVisitorRef = React.useRef(null);
  const visitorInfoRef = React.useRef({});

  useEffect(() => { selectedVisitorRef.current = selectedVisitor; }, [selectedVisitor]);
  useEffect(() => { visitorInfoRef.current = visitorInfo || {}; }, [visitorInfo]);

  const identityKey = (info) => {
    try {
      const v = info && typeof info === 'object' ? info : {};
      const idShop = (v.id_shop ?? v.shop_id ?? v.idShop ?? null);
      const shopPrefix = (idShop != null && String(idShop).trim()) ? `shop:${String(idShop).trim()}|` : '';
      const cid = (v.customer_id ?? v.customerId ?? v.id_customer ?? null);
      if (cid != null && String(cid).trim()) return `${shopPrefix}cid:${String(cid).trim()}`;
      const email = String(v.customer_email ?? v.email ?? '').trim().toLowerCase();
      if (email) return `${shopPrefix}email:${email}`;
      return '';
    } catch {
      return '';
    }
  };
  const [tab, setTab] = useState(() => {
    const st = loadModuleState('conversation-hub');
    const t = String(st.tab || 'chat');
    return (t === 'chat' || t === 'settings' || t === 'payload' || t === 'openai') ? t : 'chat';
  });

  useEffect(() => {
    try { saveModuleState('conversation-hub', { tab }); } catch {}
  }, [tab]);

  const [soundOnAnswer, setSoundOnAnswer] = useState(() => {
    try {
      const st = loadModuleState('conversation-hub');
      // Default ON because this was explicitly requested.
      return st.soundOnAnswer !== false;
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try { saveModuleState('conversation-hub', { soundOnAnswer: !!soundOnAnswer }); } catch {}
  }, [soundOnAnswer]);

  // Simple WebAudio "ding" (unlocked by first user interaction)
  const sfxRef = React.useRef({ ctx: null, unlocked: false });
  useEffect(() => {
    const st = sfxRef.current || { ctx: null, unlocked: false };
    sfxRef.current = st;
    const unlock = async () => {
      try {
        if (st.unlocked) return;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        if (!st.ctx) st.ctx = new AC();
        if (st.ctx.state === 'suspended') await st.ctx.resume();
        st.unlocked = true;
      } catch {}
    };
    const onUser = () => { unlock(); };
    window.addEventListener('pointerdown', onUser, { passive: true, once: true });
    window.addEventListener('keydown', onUser, { once: true });
    return () => {
      try { window.removeEventListener('pointerdown', onUser); } catch {}
      try { window.removeEventListener('keydown', onUser); } catch {}
    };
  }, []);
  const playAnswerDing = () => {
    const st = sfxRef.current;
    const ctx = st && st.ctx;
    if (!st || !st.unlocked || !ctx) return;
    try {
      const now = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(880, now);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(now);
      o.stop(now + 0.36);
    } catch {}
  };

  useEffect(() => {
    try { window.dispatchEvent(new CustomEvent('app-breadcrumb', { detail: ['Conversation Hub'] })); } catch {}
  }, []);

  // Join the agent room to receive live updates (dashboard_message, visitor_update)
  useEffect(() => {
    try { socket.emit('agent_hello', { at: Date.now() }); } catch {}
  }, []);

  // Initial data load (recent visitors + conversations)
  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        const [visRes, convRes] = await Promise.all([
          fetch('/api/conversation-hub/visitors/recent'),
          fetch('/api/conversation-hub/conversations?days=30&limit=500'),
        ]);
        const [visItems, convItems] = await Promise.all([
          visRes.ok ? visRes.json() : [],
          convRes.ok ? convRes.json() : [],
        ]);
        if (aborted) return;
        try {
          const vList = Array.isArray(visItems) ? visItems : [];
          setVisitors(
            vList
              .map((v) => normalizeVisitorId(v?.visitor_id ?? v?.visitorId ?? v?.id ?? v))
              .filter(Boolean)
          );
          const infoMap = {};
          for (const v of vList) {
            const id = normalizeVisitorId(v?.visitor_id ?? v?.visitorId ?? v?.id);
            if (!id) continue;
            infoMap[id] = {
              archived: v.archived,
              conversation_status: v.conversation_status,
              last_seen: v.last_seen,
              page_url_last: v.page_url_last,
              current_url: v.current_url,
              page_url: v.page_url,
              title: v.title,
              referrer: v.referrer,
              origin: v.origin,
              created_at: v.created_at,
              id_shop: v.id_shop,
              shop_name: v.shop_name,
              id_lang: v.id_lang,
              lang_iso: v.lang_iso,
              customer_logged: v.customer_logged,
              customer_id: v.customer_id,
              customer_email: v.customer_email,
              customer_firstname: v.customer_firstname,
              customer_lastname: v.customer_lastname,
              country_code: v.country_code,
              city: v.city,
              postcode: v.postcode,
            };
          }
          setVisitorInfo((prev) => ({ ...infoMap, ...prev }));
        } catch {}
        try { setConversations(Array.isArray(convItems) ? convItems : []); } catch {}
      } catch {}
    })();
    return () => { aborted = true; };
  }, []);

  // Restore last opened conversation (optional)
  useEffect(() => {
    try {
      const st = loadModuleState('conversation-hub');
      const remember = st.rememberLastChat !== false;
      const last = st.lastVisitorId != null ? String(st.lastVisitorId).trim() : '';
      if (remember && last && !selectedVisitor) setSelectedVisitor(last);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      if (!selectedVisitor) return;
      const st = loadModuleState('conversation-hub');
      const remember = st.rememberLastChat !== false;
      if (!remember) return;
      saveModuleState('conversation-hub', { lastVisitorId: selectedVisitor });
    } catch {}
  }, [selectedVisitor]);

  useEffect(() => {
    const onDash = (data) => {
      if (!data || typeof data !== 'object') return;
      const visitorIdRaw = normalizeVisitorId(data.visitorId ?? data.visitor_id);
      const visitorId = (() => {
        const map = threadAliasesRef.current || {};
        if (visitorIdRaw && map[visitorIdRaw]) return normalizeVisitorId(map[visitorIdRaw]) || visitorIdRaw;
        // If viewing a grouped thread, try to attach this message to the current thread when identity matches.
        try {
          const selected = normalizeVisitorId(selectedVisitorRef.current);
          if (selected && visitorIdRaw) {
            const infoMap = visitorInfoRef.current || {};
            const a = identityKey(infoMap[selected] || {});
            const b = identityKey(infoMap[visitorIdRaw] || {});
            if (a && b && a === b) return selected;
          }
        } catch {}
        return visitorIdRaw;
      })();
      const withTs = {
        ...data,
        ...(visitorId ? { visitorId } : {}),
        ...(visitorIdRaw ? { visitorIdSrc: visitorIdRaw } : {}),
        timestamp: data.timestamp || Date.now(),
      };
      try {
        const from = String(withTs.from || withTs.sender || '').toLowerCase().trim();
        if (soundOnAnswer && (from === 'agent' || from === 'assistant' || from === 'bot')) playAnswerDing();
      } catch {}
      setMessages((prev) => [...prev, withTs]);
    };
    socket.off('dashboard_message', onDash);
    socket.on('dashboard_message', onDash);
    return () => socket.off('dashboard_message', onDash);
  }, [soundOnAnswer]);

  // Live visitor info patches
  useEffect(() => {
    const onVisitorUpdate = (patch) => {
      try {
        const vid = normalizeVisitorId(patch?.visitorId ?? patch?.visitor_id);
        if (!vid) return;
        setVisitorInfo((prev) => ({ ...prev, [vid]: { ...(prev[vid] || {}), ...patch } }));
      } catch {}
    };
    socket.off('visitor_update', onVisitorUpdate);
    socket.on('visitor_update', onVisitorUpdate);
    return () => socket.off('visitor_update', onVisitorUpdate);
  }, []);

  // Load message history and visitor details when a conversation is selected
  useEffect(() => {
    if (!selectedVisitor) return;
    let aborted = false;
    try {
      const selectedId = normalizeVisitorId(selectedVisitor);
      if (selectedId) threadAliasesRef.current = { [selectedId]: selectedId };
    } catch {}
    (async () => {
      try {
        const [msgRes, infoRes, visitsRes] = await Promise.all([
          fetch(`/api/conversation-hub/conversations/${encodeURIComponent(selectedVisitor)}/messages?limit=500&scope=email`),
          fetch(`/api/conversation-hub/visitors/${encodeURIComponent(selectedVisitor)}`),
          fetch(`/api/conversation-hub/visitors/${encodeURIComponent(selectedVisitor)}/visits?limit=50&scope=email`),
        ]);
        const [msgItems, infoItem, visitsItems] = await Promise.all([
          msgRes.ok ? msgRes.json() : [],
          infoRes.ok ? infoRes.json() : {},
          visitsRes.ok ? visitsRes.json() : [],
        ]);
        if (aborted) return;
        try {
          const selectedId = normalizeVisitorId(selectedVisitor);
          const normalized = (msgItems || []).map((m) => ({
            visitorId: normalizeVisitorId(m.visitor_id ?? m.visitorId ?? selectedId) || selectedId,
            visitorIdSrc: normalizeVisitorId(m.visitor_id_src ?? m.visitorIdSrc ?? m.visitor_id ?? m.visitorId ?? selectedId) || selectedId,
            from: m.sender || m.from || 'visitor',
            message: m.content || m.message || '',
            timestamp: (() => {
              const parsed = m.created_at ? Date.parse(m.created_at) : NaN;
              return Number.isFinite(parsed) ? parsed : Date.now();
            })(),
            content_html: m.content_html,
          }));
          setMessages(normalized);
        } catch {}
        try {
          if (selectedId) setVisitorInfo((prev) => ({ ...prev, [selectedId]: infoItem || {} }));
        } catch {}
        try {
          if (selectedId) setVisitsByVisitor((prev) => ({ ...prev, [selectedId]: Array.isArray(visitsItems) ? visitsItems : [] }));
        } catch {}
        try {
          // Build alias map for the selected thread: any visitor_id_src should route into selectedId in the UI.
          // This lets real-time messages from other sessions show inside the same thread.
          if (selectedId) {
            const next = {};
            const add = (v) => { const s = normalizeVisitorId(v); if (s) next[s] = selectedId; };
            for (const it of (msgItems || [])) add(it?.visitor_id_src ?? it?.visitorIdSrc ?? it?.visitor_id ?? it?.visitorId);
            for (const it of (visitsItems || [])) add(it?.visitor_id_src ?? it?.visitorIdSrc ?? it?.visitor_id ?? it?.visitorId);
            add(selectedId);
            threadAliasesRef.current = next;
          }
        } catch {}
      } catch {}
    })();
    return () => { aborted = true; };
  }, [selectedVisitor]);

  const sendAgentMessage = (html) => {
    const htmlStr = String(html || '').trim();
    if (!selectedVisitor || !htmlStr) return;
    const visitorId = normalizeVisitorId(selectedVisitor);
    if (!visitorId) return;
    const plain = htmlStr.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    // When viewing a thread grouped by email, the UI thread id may differ from the live visitor room id.
    // Prefer sending to the most recent visitor-side message's visitorIdSrc when available.
    const sendToVisitorId = (() => {
      try {
        const relevant = (messages || []).filter((m) => normalizeVisitorId(m?.visitorId) === visitorId);
        for (let i = relevant.length - 1; i >= 0; i -= 1) {
          const m = relevant[i] || {};
          const from = String(m.from || m.sender || '').toLowerCase().trim();
          if (from === 'agent') continue;
          const src = normalizeVisitorId(m.visitorIdSrc || m.visitor_id_src || m.visitor_id);
          if (src) return src;
        }
      } catch {}
      return visitorId;
    })();
    socket.emit('chat_message', {
      visitorId: sendToVisitorId,
      from: 'agent',
      message: plain,
      content_html: htmlStr,
      timestamp: Date.now(),
    });
  };

  return (
    <div
      className="flex flex-col"
      style={{
        position: 'fixed',
        inset: 'var(--app-content-top, 72px) 0 0 0',
        minHeight: 0,
        overflow: 'hidden',
        width: '100%'
      }}
    >
      <div
        className="px-4 py-2 flex items-center justify-between gap-2"
        style={{ flex: '0 0 auto', borderBottom: '1px solid rgba(0,0,0,0.06)', background: '#fff' }}
      >
        <div className="flex items-center gap-2">
          <TabButton active={tab === 'chat'} onClick={() => setTab('chat')} title="Chat">
            Chat
          </TabButton>
          <TabButton active={tab === 'settings'} onClick={() => setTab('settings')} title="Settings">
            Settings
          </TabButton>
          <TabButton active={tab === 'payload'} onClick={() => setTab('payload')} title="Payload report">
            Payload report
          </TabButton>
          <TabButton active={tab === 'openai'} onClick={() => setTab('openai')} title="OpenAI log">
            OpenAI log
          </TabButton>
        </div>
        {selectedVisitor ? (
          <span className="text-xs text-gray-600" title="Selected visitor">
            {selectedVisitor}
          </span>
        ) : null}
      </div>

      <div className="grid gap-5 md:grid-cols-12" style={{ flex: '1 1 auto', minHeight: 0, overflow: 'hidden' }}>
        <div className="panel col-span-12 flex flex-col md:col-span-4 xl:col-span-3" style={{ minHeight: 0 }}>
	          <div className="panel__header flex items-center justify-between gap-2">
	            <span>Conversations</span>
	            <span
	              className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
	              style={{ background: 'var(--brand-50)', color: 'var(--brand-700)' }}
	            >
	              {visitors.length}
	            </span>
	          </div>
	          <div className="panel__body panel__body--scroll panel__body--flush" style={{ minHeight: 0, overflowY: 'auto' }}>
	            <ConversationList
	              visitors={visitors}
	              messages={messages}
	              conversations={conversations}
	              selectedVisitor={selectedVisitor}
	              setSelectedVisitor={(id) => setSelectedVisitor(normalizeVisitorId(id))}
	              visitorInfo={visitorInfo}
	              onVisitorPatch={(vid, patch) =>
	                setVisitorInfo((prev) => ({
	                  ...prev,
	                  [vid]: { ...(prev[vid] || {}), ...patch },
	                }))
	              }
	            />
	          </div>
	        </div>

	        <div className="panel col-span-12 flex flex-col md:col-span-8 xl:col-span-6" style={{ minHeight: 0 }}>
	          <div
	            className="panel__body panel__body--scroll panel__body--flush"
	            style={{
	              minHeight: 0,
	              flex: 1,
	              display: 'flex',
	              flexDirection: 'column',
	              overflowX: 'hidden',
	              overflowY: tab === 'chat' ? 'hidden' : 'auto',
	            }}
	          >
	            {tab === 'chat' ? (
	              <ChatWindow
	                messages={messages}
	                visitor={selectedVisitor}
	                visitorInfo={visitorInfo[selectedVisitor]}
                visits={visitsByVisitor[selectedVisitor] || []}
                onSend={sendAgentMessage}
              />
            ) : tab === 'settings' ? (
              <ConversationHubSettingsPanel
                soundOnAnswer={soundOnAnswer}
                onSoundOnAnswerChange={setSoundOnAnswer}
              />
            ) : tab === 'openai' ? (
              <OpenAiLogPanel visitorId={selectedVisitor} />
            ) : (
              <ConversationHubPayloadReportPanel visitorId={selectedVisitor} />
            )}
          </div>
        </div>

        {tab !== 'settings' ? (
          <div className="panel hidden xl:flex xl:col-span-3 xl:flex-col" style={{ minHeight: 0 }}>
            <div className="panel__header">
              {selectedVisitor ? 'Visitor details' : 'Pick a conversation'}
            </div>
            <div className="panel__body panel__body--scroll" style={{ minHeight: 0, overflowY: 'auto' }}>
              <VisitorDetails
                visitorId={selectedVisitor}
                messages={messages}
                info={visitorInfo[selectedVisitor]}
                visits={visitsByVisitor[selectedVisitor] || []}
              />
            </div>
          </div>
        ) : (
          <div className="panel hidden xl:flex xl:col-span-3 xl:flex-col" style={{ minHeight: 0 }}>
            <div className="panel__header">Info</div>
            <div className="panel__body panel__body--scroll" style={{ minHeight: 0, overflowY: 'auto' }}>
              <div className="text-sm text-gray-600">
                Configure which chatbots are used in the Conversation Hub, and optionally remember the last opened chat.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
