// Restored ChatWindow (12 days ago style) adapted for standalone module
import { useEffect, useMemo, useRef, useState } from "react";
import { socket } from "../utils/socket.js";
import { loadUIState, loadModuleState, saveModuleState } from "@app-lib/uiState";

function capText(s, maxChars = 2000) {
  const t = String(s || "");
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars) + "…";
}

function pickVisitorContext(info, visits, visitorId) {
  const v = (info && typeof info === "object") ? info : {};
  const safe = {};
  safe.visitor_id = visitorId || (v.visitor_id ?? v.visitorId ?? v.id ?? null);
  const keys = [
    "id_shop", "id_lang", "shop_name", "lang_iso",
    "customer_firstname", "customer_lastname", "customer_email",
    "ip", "country_code", "city", "postcode",
    "time_zone", "lang", "language",
    "origin", "referrer", "page_url", "page_url_last", "title",
    "first_seen", "last_seen", "last_action", "last_action_at",
    "user_agent",
    "currency", "id_currency",
    "id_customer", "id_cart",
    "assistant_id", "chatbot_id",
  ];
  for (const k of keys) {
    const val = v[k];
    if (val == null) continue;
    if (typeof val === "string" && !val.trim()) continue;
    safe[k] = (typeof val === "string") ? capText(val, 500) : val;
  }

  const list = Array.isArray(visits) ? visits : [];
  const slim = list.slice(0, 12).map((it) => {
    const o = (it && typeof it === "object") ? it : {};
    const out = {};
    const vk = ["occurred_at", "page_url", "title", "origin", "referrer", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
    for (const k of vk) {
      const val = o[k];
      if (val == null) continue;
      if (typeof val === "string" && !val.trim()) continue;
      out[k] = (typeof val === "string") ? capText(val, 500) : val;
    }
    return out;
  }).filter((x) => Object.keys(x).length > 0);

  return { visitor: safe, visits: slim };
}

function formatTs(ts) {
  if (!ts) return '';
  try {
    return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(ts));
  } catch { return ''; }
}

function escapeHtml(s = "") { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
function escapeHtmlWithAutolink(s = "") {
  const text = String(s || "");
  const urlRe = /\b((?:https?:\/\/|www\.)[^\s<>"']+)/gi;
  let out = "";
  let lastIdx = 0;
  let match;
  while ((match = urlRe.exec(text)) !== null) {
    const idx = match.index || 0;
    const rawMatch = String(match[1] || "");
    out += escapeHtml(text.slice(lastIdx, idx));
    lastIdx = idx + rawMatch.length;

    // Trim common trailing punctuation / brackets from the URL, but keep it in output.
    let url = rawMatch;
    let trail = "";
    while (url && /[)\].,!?;:]+$/.test(url)) {
      trail = url.slice(-1) + trail;
      url = url.slice(0, -1);
    }
    if (!url) {
      out += escapeHtml(rawMatch);
      continue;
    }
    const href = url.toLowerCase().startsWith("http") ? url : `https://${url}`;
    out += `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>${escapeHtml(trail)}`;
  }
  out += escapeHtml(text.slice(lastIdx));
  return out;
}
function sanitizeAgentHtml(html = "") {
  let s = html.replace(/<\s*(script|iframe|object|embed|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "");
  s = s.replace(/\son\w+="[^"]*"/gi, "").replace(/\son\w+='[^']*'/gi, "");
  s = s.replace(/<\/?([a-z0-9-]+)([^>]*)>/gi, (m, tag, attrs) => {
    const ALLOWED = ["a","br","strong","em","ul","ol","li","p","b","i","u","s","code","pre","blockquote","span"]; const t = tag.toLowerCase(); if (!ALLOWED.includes(t)) return ""; const isClose = /^<\//.test(m); if (t === "a") { if (isClose) return `</a>`; const hrefMatch = attrs.match(/\shref\s*=\s*(".*?"|'[^']*'|[^\s>]+)/i); const href = hrefMatch ? hrefMatch[0] : ""; return `<a ${href} target="_blank" rel="noopener noreferrer">`; } return isClose ? `</${t}>` : `<${t}>`; });
  return s;
}
function decodeEscapedHtml(s = "") { return String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;/g, "'"); }
function mdToHtmlLite(md = "") {
  const text = String(md || ""); const esc = escapeHtml(text); const lines = esc.split(/\r?\n/);
  const blocks = []; let ul = []; let ol = [];
  const flushUl = () => { if (ul.length) { blocks.push(`<ul>${ul.join("")}</ul>`); ul = []; } };
  const flushOl = () => { if (ol.length) { blocks.push(`<ol>${ol.join("")}</ol>`); ol = []; } };
  const cleanUrl = (u) => String(u || '').replace(/(?:&quot;|&#0*39;|&apos;)+$/gi, '').replace(/[,.;:!?]+$/g, '');
  const linkify = (s) => s.replace(/\b(https?:\/\/[^\s<>()]+)([)\]\.,!?;:]?)/g, (m, u, trail) => { const clean = cleanUrl(u); return `<a href="${clean}" target="_blank" rel="noopener noreferrer">${clean}</a>${trail||''}`; });
  for (const raw of lines) {
    const l = raw.trim(); if (!l) { flushUl(); flushOl(); continue; }
    const hMatch = l.match(/^#{1,6}\s+(.+)/); if (hMatch) { flushUl(); flushOl(); blocks.push(`<p><strong>${hMatch[1]}</strong></p>`); continue; }
    const bMatch = l.match(/^([\-*•])\s+(.+)/); if (bMatch) { flushOl(); ul.push(`<li>${linkify(bMatch[2])}</li>`); continue; }
    const oMatch = l.match(/^(\d+)[\.)]\s+(.+)/); if (oMatch) { flushUl(); ol.push(`<li>${linkify(oMatch[2])}</li>`); continue; }
    const lu = l.replace(/([^:]+):\s*(https?:\/\/[^\s<>()]+)/g, (m, label, url) => { const cu = cleanUrl(url); return `${escapeHtml(label)}: <a href="${cu}" target="_blank" rel="noopener noreferrer">${cu}</a>`; });
    if (/https?:\/\//.test(l)) { flushOl(); ul.push(`<li>${linkify(lu)}</li>`); } else { flushUl(); flushOl(); blocks.push(`<p>${linkify(lu)}</p>`); }
  }
  flushUl(); flushOl();
  let html = blocks.join(""); html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*([^*]+)\*/g, "<em>$1</em>"); return html;
}

function stripHtmlToText(html = "") {
  try {
    return String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return '';
  }
}

function looksLikeHtmlText(s = "") {
  const t = String(s || '');
  return /<\s*\/?\s*[a-z][^>]*>/i.test(t) || /&lt;\s*\/?\s*[a-z][^>]*&gt;/i.test(t);
}

function looksLikeBrokenAnchors(html = "") {
  const s = String(html || '');
  return (
    /href\s*=\s*["']\s*(?:<a|&lt;\s*a)\s+href=/i.test(s) ||
    /<a[^>]+href\s*=\s*["']\s*&lt;\s*a/i.test(s)
  );
}

function normalizeAssistantDraftText(raw = "") {
  const s = String(raw || '').trim();
  if (!s) return '';
  let t = s;
  if (/&lt;\s*\/?\s*[a-z][^>]*&gt;/i.test(t)) t = decodeEscapedHtml(t);
  if (looksLikeHtmlText(t)) return stripHtmlToText(t);
  return t;
}

function normalizeDraftFromText(text) {
  const t = normalizeAssistantDraftText(text);
  if (!t) return { html: '', text: '' };
  return { html: mdToHtmlLite(t), text: t };
}

function isAgentMessage(m) {
  const o = (m && typeof m === "object") ? m : {};
  const fromVal = String(o.from || o.sender || o.author || o.role || "").toLowerCase().trim();
  if (fromVal === "agent" || fromVal === "assistant") return true;
  if (o.agent_id != null || o.agentId != null) return true;
  if (String(o.type || "").toLowerCase().includes("agent")) return true;
  if (String(o.action || "").toLowerCase().includes("agent")) return true;
  return false;
}

import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Picker from "@emoji-mart/react";
import data from "@emoji-mart/data";

function ToolbarButton({ active, onClick, children, title }) {
  return (
    <button type="button" onClick={onClick} title={title} className={`text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50 ${active ? "ring-2 ring-indigo-400" : ""}`}>{children}</button>
  );
}

function InlineRichEditor({ valueHtml = "", onChange, disabled = false, minRows = 5 }) {
  const [showEmoji, setShowEmoji] = useState(false);
  const pickerRef = useRef(null);
  const editor = useEditor({ editable: !disabled, content: valueHtml || "", extensions: [ StarterKit.configure({ bulletList: { keepMarks: true, keepAttributes: true }, orderedList: { keepMarks: true, keepAttributes: true }, }), Link.configure({ autolink: true, openOnClick: false, HTMLAttributes: { target: "_blank", rel: "noreferrer" } }), Placeholder.configure({ placeholder: "Écrivez votre message (vous pouvez éditer le brouillon proposé)…", }), ], onUpdate({ editor }) { const html = editor.getHTML(); const text = editor.getText(); onChange?.(html, text); }, });
  useEffect(() => { if (editor) editor.setEditable(!disabled); }, [disabled, editor]);
  useEffect(() => { if (!editor) return; const current = editor.getHTML(); if (valueHtml !== current) { editor.commands.setContent(valueHtml || "", false); } }, [valueHtml, editor]);
  useEffect(() => { const onDocClick = (e) => { if (!pickerRef.current) return; if (!pickerRef.current.contains(e.target)) setShowEmoji(false); }; document.addEventListener("click", onDocClick); return () => document.removeEventListener("click", onDocClick); }, []);
  const insertLink = () => { const url = window.prompt("Entrez l’URL du lien :", "https://"); if (!url) return; editor?.chain().focus().extendMarkRange("link").setLink({ href: url }).run(); };
  const clearLink = () => editor?.chain().focus().unsetLink().run();
  const insertEmoji = (emoji) => { editor?.chain().focus().insertContent(emoji.native).run(); setShowEmoji(false); };
  const minHeight = Math.max(52, minRows * 22 + 16);
  return (
    <div className="w-full">
      <div className="flex items-center gap-1 mb-2">
        <ToolbarButton title="Gras" active={editor?.isActive("bold")} onClick={() => editor?.chain().focus().toggleBold().run()}>G</ToolbarButton>
        <ToolbarButton title="Italique" active={editor?.isActive("italic")} onClick={() => editor?.chain().focus().toggleItalic().run()}>I</ToolbarButton>
        <ToolbarButton title="Lien" onClick={insertLink}>🔗</ToolbarButton>
        <ToolbarButton title="Supprimer le lien" onClick={clearLink}>⛔</ToolbarButton>
        <div className="mx-2 h-5 w-px bg-gray-300" />
        <ToolbarButton title="Annuler" onClick={() => editor?.chain().focus().undo().run()}>⟲</ToolbarButton>
        <ToolbarButton title="Rétablir" onClick={() => editor?.chain().focus().redo().run()}>⟳</ToolbarButton>
        <div className="ml-auto relative" ref={pickerRef}>
          <ToolbarButton title="Emoji" onClick={() => setShowEmoji((s) => !s)}>😊</ToolbarButton>
          {showEmoji && (<div className="absolute right-0 top-8 z-50 shadow-xl border bg-white rounded"><Picker data={data} onEmojiSelect={insertEmoji} theme="light" /></div>)}
        </div>
      </div>
      <div className={`border rounded bg-white max-h-60 overflow-y-auto scroll-area ${disabled ? "opacity-60" : ""}`} style={{ minHeight }}>
        <EditorContent editor={editor} className="prose prose-sm max-w-none p-2 outline-none" />
      </div>
    </div>
  );
}

function safeHttpUrl(url) {
  const s = String(url || '').trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
    return null;
  } catch {
    return null;
  }
}

export default function ChatWindow({ messages, visitor, visitorInfo, visits, onSend }) {
  const currentVisitorId = (() => {
    if (visitor == null) return null;
    if (typeof visitor === 'string' || typeof visitor === 'number') return String(visitor);
    const fromObj = visitor && (visitor.visitorId ?? visitor.visitor_id ?? visitor.id);
    const s = fromObj != null ? String(fromObj).trim() : '';
    return s ? s : null;
  })();
  const [composerHtml, setComposerHtml] = useState("");
  const [composerText, setComposerText] = useState("");
  const [genLoading, setGenLoading] = useState(false);
  const [genReq, setGenReq] = useState("");
  const [genError, setGenError] = useState("");
  const [botBehavior, setBotBehavior] = useState('manual');
  const [chatbotId, setChatbotId] = useState(null);
  const [shopCtx, setShopCtx] = useState({ id_shop: null, id_lang: null, prompt_config_id: null });
  const visitorCtx = useMemo(() => pickVisitorContext(visitorInfo, visits, currentVisitorId), [visitorInfo, visits, currentVisitorId]);
  const currentPageUrl = useMemo(() => {
    const v = visitorCtx?.visitor || {};
    return safeHttpUrl(v.current_url || v.page_url_last || v.page_url);
  }, [visitorCtx]);
  const currentPageLabel = useMemo(() => {
    try {
      if (!currentPageUrl) return '';
      const u = new URL(currentPageUrl);
      const path = (u.pathname || '/') + (u.search || '') + (u.hash || '');
      return (u.host || '') + (path.length > 80 ? path.slice(0, 80) + '…' : path);
    } catch {
      return String(currentPageUrl || '');
    }
  }, [currentPageUrl]);
  const [draft, setDraft] = useState({ html: "", text: "" });
  const listRef = useRef(null);
  const restorePendingRef = useRef(false);
  const msgs = useMemo(() => (messages || []).filter((m) => m.visitorId === currentVisitorId), [messages, currentVisitorId]);
  useEffect(() => { try { window.__lastMsgs = msgs; } catch {} }, [msgs]);
  useEffect(() => { if (!listRef.current) return; if (restorePendingRef.current) return; listRef.current.scrollTop = listRef.current.scrollHeight + 999; }, [messages, currentVisitorId, draft]);
  useEffect(() => { const flags = (loadUIState() && loadUIState().flags) || {}; const st = loadModuleState('chat') || {}; if (!currentVisitorId) return; if (flags.persist_drafts && st.draftByVisitor && st.draftByVisitor[currentVisitorId]) { const d = st.draftByVisitor[currentVisitorId]; if (typeof d.html === 'string') setComposerHtml(d.html); if (typeof d.text === 'string') setComposerText(d.text); } if (flags.restore_scroll && st.scrollByVisitor && st.scrollByVisitor[currentVisitorId] != null) { try { restorePendingRef.current = true; const top = Number(st.scrollByVisitor[currentVisitorId] || 0); setTimeout(() => { if (listRef.current) listRef.current.scrollTop = top; restorePendingRef.current = false; }, 0); } catch { restorePendingRef.current = false; } } }, [currentVisitorId]);
  useEffect(() => { const flags = (loadUIState() && loadUIState().flags) || {}; if (!flags.persist_drafts || !currentVisitorId) return; try { const st = loadModuleState('chat') || {}; const drafts = { ...(st.draftByVisitor || {}) }; drafts[currentVisitorId] = { html: composerHtml, text: composerText }; saveModuleState('chat', { draftByVisitor: drafts }); } catch {} }, [composerHtml, composerText, currentVisitorId]);
  useEffect(() => { const onScroll = () => { const flags = (loadUIState() && loadUIState().flags) || {}; if (!flags.restore_scroll || !currentVisitorId) return; try { const st = loadModuleState('chat') || {}; const map = { ...(st.scrollByVisitor || {}) }; map[currentVisitorId] = (listRef.current && listRef.current.scrollTop) || 0; saveModuleState('chat', { scrollByVisitor: map }); } catch {} }; const el = listRef.current; if (!el) return; el.addEventListener('scroll', onScroll); return () => el.removeEventListener('scroll', onScroll); }, [currentVisitorId]);
  const handleSend = () => { const htmlCandidate = (composerHtml || "").trim(); const textCandidate = (composerText || "").trim(); if (!currentVisitorId || (!htmlCandidate && !textCandidate)) return; const finalHtml = htmlCandidate || `<p>${escapeHtmlWithAutolink(textCandidate).replace(/\n/g, "<br>")}</p>`; onSend(finalHtml); setComposerHtml(""); setComposerText(""); setDraft({ html: "", text: "" }); };
  const handleKey = (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleSend(); } };
  useEffect(() => {
    let abort = false;
    async function loadBehavior() {
      try {
        if (!currentVisitorId) return;
        const r = await fetch(`/api/conversation-hub/assistant/config?visitorId=${encodeURIComponent(currentVisitorId)}`, { credentials: 'include' });
        const j = await r.json().catch(() => ({}));
        if (abort) return;
        setBotBehavior((j && (j.bot_behavior || j.bot_behavior === '')) ? (j.bot_behavior || 'manual') : 'manual');
        setChatbotId(j?.chatbot_id ? String(j.chatbot_id) : null);
        setShopCtx({
          id_shop: (j && j.id_shop != null) ? Number(j.id_shop) : null,
          id_lang: (j && j.id_lang != null) ? Number(j.id_lang) : null,
          prompt_config_id: j?.prompt_config_id || null,
        });
      } catch {
        if (!abort) {
          setBotBehavior('manual');
          setChatbotId(null);
          setShopCtx({ id_shop: null, id_lang: null, prompt_config_id: null });
        }
      }
    }
    loadBehavior();
    return () => { abort = true; };
  }, [currentVisitorId]);
  useEffect(() => { const onAssistantDraft = (payload) => { try { const vid = payload && (payload.visitorId || payload.visitor_id); const text = payload && (payload.draft || payload.text || ""); if (!vid || vid !== currentVisitorId || !text) return; const norm = normalizeDraftFromText(String(text)); if (!norm?.html) return; setDraft(norm); setComposerHtml(norm.html); setComposerText(""); } catch {} }; socket.on('assistant_draft', onAssistantDraft); return () => { socket.off('assistant_draft', onAssistantDraft); }; }, [currentVisitorId]);
	  const askAssistantDraft = async () => {
	    if (!currentVisitorId || genLoading) return;
	    setGenError(""); setGenReq(""); setGenLoading(true);
	    try {
	      const botId = (chatbotId || '').toString().trim();
	      if (!botId) throw new Error('No chatbot configured for this visitor.');

      const items = Array.isArray(msgs) ? msgs : [];
      const lastVisitorIdx = (() => {
        for (let i = items.length - 1; i >= 0; i -= 1) {
          if (!isAgentMessage(items[i])) return i;
        }
        return -1;
      })();
      if (lastVisitorIdx < 0) throw new Error('No visitor message found to reply to.');

      const lastVisitor = items[lastVisitorIdx] || {};
      const inputRaw = String(lastVisitor.message || lastVisitor.content || lastVisitor.text || '');
      const inputHtml = String(lastVisitor.content_html || lastVisitor.html || '');
      const input = (inputRaw && inputRaw.trim()) ? inputRaw.trim() : stripHtmlToText(inputHtml);
      if (!input) throw new Error('Visitor message is empty.');

      const history = [];
      for (let i = 0; i < items.length; i += 1) {
        if (i === lastVisitorIdx) continue;
        const m = items[i] || {};
        const isAgent = isAgentMessage(m);
        const raw = String(m.message || m.content || m.text || '');
        const html = String(m.content_html || m.html || '');
        const content = (raw && raw.trim()) ? raw.trim() : stripHtmlToText(html);
        if (!content) continue;
        history.push({ role: isAgent ? 'assistant' : 'user', content });
      }

	      const idShopFinal = (shopCtx?.id_shop ?? visitorCtx?.visitor?.id_shop ?? null);
	      const idLangFinal = (shopCtx?.id_lang ?? visitorCtx?.visitor?.id_lang ?? null);
	      const r = await fetch(`/api/automation-suite/chatbots/${encodeURIComponent(botId)}/respond`, {
	        method: 'POST',
	        headers: { 'Content-Type': 'application/json' },
	        credentials: 'include',
	        body: JSON.stringify({
	          input,
	          history,
	          // Always include id_shop/id_lang in the OpenAI request payload (null when unknown).
	          id_shop: idShopFinal,
	          id_lang: idLangFinal,
	          visitor: visitorCtx?.visitor || undefined,
	          visits: visitorCtx?.visits || undefined,
	        }),
	      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || data?.ok === false) throw new Error(data?.message || data?.error || 'assistant_failed');
      try { setGenReq(JSON.stringify(data?.request_body || data?.request || {}, null, 2)); } catch { setGenReq(''); }
      try {
        fetch('/api/conversation-hub/openai-log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            visitorId: currentVisitorId,
            id_bot: botId,
            prompt_config_id: shopCtx?.prompt_config_id || undefined,
            request: data?.request_body || data?.request || null,
            response: {
              ok: true,
              text: data?.text || '',
              response_id: data?.response_id || null,
              openai_request_id: data?.openai_request_id || null,
              ms: data?.ms || null,
            },
          }),
        }).catch(() => {});
      } catch {}
      const norm = normalizeDraftFromText(data?.text || '');
      if (norm.html) {
        setDraft(norm);
        setComposerHtml(norm.html);
        setComposerText("");
      }
    } catch (e) {
      setGenError(e?.message || String(e));
    } finally {
      setGenLoading(false);
    }
  };
  return (
    <div className="chat-window" style={{ display: 'flex', flex: 1, minHeight: 0, flexDirection: 'column' }}>
      <div
        ref={listRef}
        className="px-4 py-3 space-y-3"
        style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}
      >
        {(!currentVisitorId) && (<div className="text-center text-sm text-gray-500">Sélectionnez une conversation</div>)}
        {currentVisitorId && currentPageUrl && (
          <div className="text-xs text-gray-600">
            <span className="font-medium">Page actuelle :</span>{' '}
            <a href={currentPageUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 underline break-all">
              {currentPageLabel || currentPageUrl}
            </a>
          </div>
        )}
        {currentVisitorId && msgs.length === 0 && (<div className="text-sm text-gray-500">Aucun message pour ce visiteur.</div>)}
        {msgs.map((m, i) => {
          const fromVal = String(m.from || m.sender || m.author || '').toLowerCase();
          const isVisitor = ["visitor", "client", "user", "customer"].includes(fromVal);
          const hasHtml = ((typeof m.html === 'string' && m.html.trim().length > 0) || (typeof m.content_html === 'string' && m.content_html.trim().length > 0) || /<\s*\w+[^>]*>/.test(String(m.message || m.content || '')));
          const mine = (String(m.role || '').toLowerCase() === 'agent' || String(m.sender || '').toLowerCase() === 'agent' || fromVal === 'agent' || (m.agentId != null) || String(m.action || '').toLowerCase().includes('agent') || String(m.type || '').toLowerCase().includes('agent') || (!isVisitor && hasHtml));
          const ts = m.timestamp ? new Date(m.timestamp).toLocaleString() : "";
          const showIA = !mine && i === (function(){ for (let k=msgs.length-1;k>=0;k--){ if (msgs[k]?.from !== 'agent') return k; } return -1; })() && (botBehavior === 'manual' || botBehavior === 'auto_draft') && !!currentVisitorId;
          return (
            <div key={i} className={`w-full flex ${mine ? "pr-3" : "pl-3"}`} style={{ justifyContent: mine ? 'flex-end' : 'flex-start' }}>
              <div className={`chat-row ${mine ? "mine" : "theirs"}`} style={mine ? { marginLeft: 'auto' } : null}>
                <div className={`chat-bubble ${mine ? "agent self-end" : "visitor"}`} title={ts}>
                  {mine ? (
                    <div
                      className="prose prose-invert prose-sm max-w-none chat-html"
                      dangerouslySetInnerHTML={{
                        __html: (() => {
                          const raw0 = m.html || m.content_html || m.message || '';
                          let raw = /&lt;\s*\w+[^>]*>/i.test(String(raw0 || '')) ? decodeEscapedHtml(String(raw0 || '')) : String(raw0 || '');
                          if (looksLikeBrokenAnchors(raw)) {
                            const txt = stripHtmlToText(raw);
                            return sanitizeAgentHtml(mdToHtmlLite(txt || ''));
                          }
                          return sanitizeAgentHtml(raw);
                        })(),
                      }}
                    />
                  ) : (
                    <div
                      className="chat-html"
                      dangerouslySetInnerHTML={{
                        __html: (() => {
                          const raw0 = m.html || m.content_html || '';
                          if (raw0 && String(raw0).trim()) {
                            let raw = /&lt;\s*\w+[^>]*>/i.test(String(raw0 || '')) ? decodeEscapedHtml(String(raw0 || '')) : String(raw0 || '');
                            if (looksLikeBrokenAnchors(raw)) {
                              const txt = stripHtmlToText(raw);
                              return sanitizeAgentHtml(mdToHtmlLite(txt || ''));
                            }
                            return sanitizeAgentHtml(raw);
                          }
                          return escapeHtmlWithAutolink(String(m.message || m.content || '')).replace(/\n/g, "<br/>");
                        })(),
                      }}
                    />
                  )}
                </div>
                <div className={`msg-ts ${mine ? "text-right" : "text-left"}`}>{formatTs(m.timestamp)}</div>
                {showIA && (
                  <div className="mt-1">
                    <button onClick={askAssistantDraft} className="text-[11px] px-2 py-0.5 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50" disabled={genLoading} title="Demander à l’IA de proposer une réponse">{genLoading ? "Génération…" : "Proposer une réponse (IA)"}</button>
                    {genError && (<div className="mt-1 text-[11px] text-red-600">{genError}</div>)}
                    {!!genReq && (<div className="mt-1"><div className="text-[11px] text-gray-600">OpenAI Request (effective)</div><pre className="text-[11px] bg-gray-50 border rounded p-2 whitespace-pre-wrap max-h-48 overflow-auto">{genReq}</pre></div>)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <footer
        className="chat-window__composer"
        style={{ position: 'sticky', bottom: 0, background: '#fff', borderTop: '1px solid rgba(0,0,0,0.06)', zIndex: 1 }}
      >
        <InlineRichEditor valueHtml={composerHtml} onChange={(html, text) => { setComposerHtml(html); setComposerText(text); }} disabled={!currentVisitorId} minRows={5} />
        <div className="mt-2 flex justify-end">
          <button onClick={handleSend} className="chat-window__send" disabled={!currentVisitorId || (!composerText.trim() && !composerHtml.trim())} title="Ctrl/Cmd + Enter to Envoyer">Envoyer</button>
        </div>
      </footer>
    </div>
  );
}
