import React, { useEffect, useMemo, useState } from 'react';
import { RichEditor } from '@shared-modules';
import { renderRichTextHTML } from '@app-utils/rich';

export default function DevTracker({ forceTab, hideTabSwitcher: hideTabsProp }) {
  const [tab, setTab] = useState(() => { try { return localStorage.getItem('devtab') || 'kanban'; } catch { return 'kanban'; } });
  const hideTabs = !!hideTabsProp || !!forceTab;
  // Allow parent to force a tab view (used by Development hub)
  useEffect(() => {
    try {
      const ft = forceTab && String(forceTab);
      if (ft && ft !== tab) setTab(ft);
    } catch {}
  }, [forceTab]);
  useEffect(() => { try { localStorage.setItem('devtab', tab); } catch {} }, [tab]);

  // Kanban
  const [board, setBoard] = useState({ columns: [], cards: [], updatedAt: 0 });
  // Projects management
  const slugify = (name='') => String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  const LS_PROJECTS = 'dev_projects';
  const LS_CUR = 'dev_current_project';
  const lsGet = (k, def) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const lsSetStr = (k, v) => { try { localStorage.setItem(k, String(v)); } catch {} };
  const boardKey = (pid) => `dev_kanban_board__${pid}`;
  const [projects, setProjects] = useState(() => {
    try {
      const arr = lsGet(LS_PROJECTS, []);
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  });
  const [projectId, setProjectId] = useState(() => { try { return localStorage.getItem(LS_CUR) || ''; } catch { return ''; } });
  const [projBusy, setProjBusy] = useState(false);
  const [projMsg, setProjMsg] = useState('');
  const [newProjName, setNewProjName] = useState('');
  const [newProjTpl, setNewProjTpl] = useState('basic');

  const templateBoard = (tpl) => {
    const t = String(tpl||'basic');
    if (t === 'software') {
      const cols = [
        { id:'backlog', title:'Backlog', order:0 },
        { id:'in-progress', title:'En cours', order:1 },
        { id:'review', title:'Revue', order:2 },
        { id:'done', title:'Fait', order:3 },
      ];
      const cards = [
        { id:`c_${Date.now()}a`, columnId:'backlog', title:'Setup repo', description:'Init README, LICENSE, CI.', attachments:[] },
        { id:`c_${Date.now()}b`, columnId:'backlog', title:'Define backlog', description:'Collect initial tasks.', attachments:[] },
      ];
      return { columns: cols, cards, updatedAt: Date.now() };
    }
    if (t === 'bugs') {
      const cols = [
        { id:'triage', title:'Triage', order:0 },
        { id:'fixing', title:'Correction', order:1 },
        { id:'verify', title:'Vérifier', order:2 },
        { id:'done', title:'Fait', order:3 },
      ];
      const cards = [ { id:`c_${Date.now()}a`, columnId:'triage', title:'Example bug', description:'Describe reproduction steps.', attachments:[] } ];
      return { columns: cols, cards, updatedAt: Date.now() };
    }
    // basic
    const cols = [
      { id:'todo', title:'À faire', order:0 },
      { id:'in-progress', title:'En cours', order:1 },
      { id:'done', title:'Fait', order:2 },
    ];
    const cards = [ { id:`c_${Date.now()}`, columnId:'todo', title:'Bienvenue 👋', description:'Créez des colonnes et des cartes.', attachments:[] } ];
    return { columns: cols, cards, updatedAt: Date.now() };
  };

  const saveProjectsLS = (arr) => { setProjects(arr); lsSet(LS_PROJECTS, arr); };
  const setCurrentProject = (pid) => { setProjectId(pid); try { lsSetStr(LS_CUR, pid); } catch {} };

  const ensureInitialProject = () => {
    try {
      if (!projects || projects.length === 0) {
        const name = 'Alex livechat-app';
        const id = slugify(name) || `proj_${Date.now()}`;
        const list = [{ id, name, template:'basic' }];
        saveProjectsLS(list);
        setCurrentProject(id);
        const b = templateBoard('basic');
        setBoard(b);
        try { localStorage.setItem(boardKey(id), JSON.stringify(b)); } catch {}
        didLoadRef.current = true;
      } else if (!projectId) {
        setCurrentProject(projects[0].id);
      }
    } catch {}
  };

  useEffect(() => { ensureInitialProject(); /* once */ }, []);
  // Listen for project changes coming from DevProjects
  useEffect(() => {
    const onChange = (e) => {
      try {
        const id = e?.detail?.id;
        if (id && id !== projectId) setProjectId(id);
      } catch {}
    };
    const onProjects = () => {
      try { const arr = lsGet(LS_PROJECTS, []); setProjects(Array.isArray(arr)?arr:[]); } catch {}
    };
    window.addEventListener('dev-project-change', onChange);
    window.addEventListener('dev-projects-updated', onProjects);
    return () => {
      window.removeEventListener('dev-project-change', onChange);
      window.removeEventListener('dev-projects-updated', onProjects);
    };
  }, [projectId]);
  const [kbBusy, setKbBusy] = useState(false);
  const [kbMsg, setKbMsg] = useState('');
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoMsg, setAutoMsg] = useState('');
  const autoTimerRef = React.useRef(null);
  const didLoadRef = React.useRef(false);
  const [newCol, setNewCol] = useState('');
  const [newCardTitle, setNewCardTitle] = useState('');
  const [newCardDesc, setNewCardDesc] = useState('');
  const [newCardCol, setNewCardCol] = useState('');

  // API base (module first, legacy fallback)
  const KANBAN_BASE = '/api/dev-manager/kanban';
  const KANBAN_FALLBACK_BASE = '/api/dev/kanban';

  const loadKanban = async () => {
    setKbBusy(true); setKbMsg('');
    try {
      const q = projectId ? `?project=${encodeURIComponent(projectId)}` : '';
      let r = await fetch(`${KANBAN_BASE}${q}`, { credentials: 'include' });
      let j = await r.json();
      if (!(r.ok && j?.ok)) {
        try { r = await fetch(`${KANBAN_FALLBACK_BASE}${q}`, { credentials: 'include' }); j = await r.json(); } catch {}
      }
      if (r.ok && j?.ok) {
        setBoard(j.board || { columns: [], cards: [] });
        if ((j.board?.columns || []).length) setNewCardCol(j.board.columns[0].id);
        try { if (projectId) localStorage.setItem(boardKey(projectId), JSON.stringify(j.board || { columns: [], cards: [] })); } catch {}
        didLoadRef.current = true;
      } else {
        // Fallback to localStorage per-project
        try {
          const raw = projectId && localStorage.getItem(boardKey(projectId));
          if (raw) {
            const b = JSON.parse(raw);
            setBoard(b || { columns: [], cards: [] });
            if ((b?.columns || []).length) setNewCardCol(b.columns[0].id);
            didLoadRef.current = true;
          } else {
            setKbMsg(j?.message || j?.error || 'Failed to load');
          }
        } catch { setKbMsg(j?.message || j?.error || 'Failed to load'); }
      }
    } catch (e) { setKbMsg(String(e?.message || e)); }
    finally { setKbBusy(false); }
  };
  useEffect(() => { if (tab==='kanban') loadKanban(); }, [projectId]);
  useEffect(() => { if (tab==='kanban' && !didLoadRef.current) loadKanban(); }, [tab]);

  const saveKanban = async () => {
    setKbBusy(true); setKbMsg('');
    try {
      const payload = { ...(board||{}), project: projectId || undefined };
      let r = await fetch(KANBAN_BASE, { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify(payload) });
      let j = await r.json();
      if (!(r.ok && j?.ok)) {
        try { r = await fetch(KANBAN_FALLBACK_BASE, { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify(payload) }); j = await r.json(); } catch {}
      }
      if (r.ok && j?.ok) {
        setKbMsg('Sauvegardé.');
        try { if (projectId) localStorage.setItem(boardKey(projectId), JSON.stringify(board)); } catch {}
      } else {
        setKbMsg(j?.message || j?.error || 'Save failed');
        try { if (projectId) localStorage.setItem(boardKey(projectId), JSON.stringify(board)); } catch {}
      }
    } catch (e) { setKbMsg(String(e?.message || e)); }
    finally { setKbBusy(false); }
  };

  const saveKanbanAuto = async () => {
    setAutoBusy(true);
    try {
      const payload = { ...(board||{}), project: projectId || undefined };
      let r = await fetch(KANBAN_BASE, { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify(payload) });
      let j = await r.json();
      if (!(r.ok && j?.ok)) {
        try { r = await fetch(KANBAN_FALLBACK_BASE, { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify(payload) }); j = await r.json(); } catch {}
      }
      if (r.ok && j?.ok) setAutoMsg(`Saved ${new Date().toLocaleTimeString()}`); else setAutoMsg(j?.message || j?.error || 'Save failed');
      try { if (projectId) localStorage.setItem(boardKey(projectId), JSON.stringify(board)); } catch {}
    } catch (e) { setAutoMsg(String(e?.message || e)); }
    finally { setAutoBusy(false); }
  };

  useEffect(() => {
    if (!didLoadRef.current) return;
    if (autoTimerRef.current) { try { clearTimeout(autoTimerRef.current); } catch {} }
    autoTimerRef.current = setTimeout(() => { saveKanbanAuto(); }, 1000);
    return () => { if (autoTimerRef.current) { try { clearTimeout(autoTimerRef.current); } catch {} } };
  }, [board]);

  const addColumn = () => {
    const title = (newCol || '').trim();
    if (!title) return;
    const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (board.columns.find(c => c.id === id)) return;
    const order = board.columns.length;
    setBoard(prev => ({ ...prev, columns: [...prev.columns, { id, title, order }] }));
    setNewCol('');
  };

  const deleteColumn = (columnId) => {
    setBoard(prev => {
      const cols = prev.columns.slice();
      const idx = cols.findIndex(c => c.id === columnId);
      if (idx < 0) return prev;
      if (cols.length <= 1) { alert('Impossible de supprimer la dernière colonne.'); return prev; }
      const otherCols = cols.filter(c => c.id !== columnId);
      const cardsInCol = prev.cards.filter(c => c.columnId === columnId);
      let cards = prev.cards.slice();
      if (cardsInCol.length) {
        const dest = otherCols[0];
        const move = confirm(`Supprimer la colonne « ${cols[idx].title} ». Déplacer ${cardsInCol.length} carte(s) vers « ${dest.title} » ? (Annuler = supprimer les cartes)`);
        if (move) {
          cards = cards.map(c => c.columnId === columnId ? { ...c, columnId: dest.id } : c);
        } else {
          cards = cards.filter(c => c.columnId !== columnId);
        }
      }
      const nextCols = cols.filter(c => c.id !== columnId).map((c, i) => ({ ...c, order: i }));
      // If new-card select pointed to deleted column, switch to first remaining
      try { if (newCardCol === columnId && nextCols.length) setNewCardCol(nextCols[0].id); } catch {}
      return { ...prev, columns: nextCols, cards };
    });
  };

  const addCard = () => {
    const title = (newCardTitle || '').trim();
    if (!title) return;
    const id = `c_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    setBoard(prev => ({ ...prev, cards: [...prev.cards, { id, columnId: newCardCol || (prev.columns[0]?.id || 'todo'), title, description: newCardDesc || '' }] }));
    setNewCardTitle(''); setNewCardDesc('');
  };

  const moveCard = (cardId, columnId) => {
    setBoard(prev => ({ ...prev, cards: prev.cards.map(c => c.id === cardId ? { ...c, columnId } : c) }));
  };
  const deleteCard = (cardId) => {
    setBoard(prev => ({ ...prev, cards: prev.cards.filter(c => c.id !== cardId) }));
  };

  // Editing
  const [editId, setEditId] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const startEdit = (card) => { setEditId(card.id); setEditTitle(card.title || ''); setEditDesc(card.description || ''); };
  const cancelEdit = () => { setEditId(''); setEditTitle(''); setEditDesc(''); };
  const saveEdit = () => {
    const t = (editTitle || '').trim();
    setBoard(prev => ({ ...prev, cards: prev.cards.map(c => c.id === editId ? { ...c, title: t || c.title, description: editDesc || '' } : c) }));
    cancelEdit();
  };

  // Attachments
  const addLinkToCard = (cardId, url, name) => {
    const u = (url || '').trim();
    if (!u) return;
    const label = (name || u);
    const att = { id: `link_${Date.now()}_${Math.random().toString(36).slice(2,8)}`, type: 'link', url: u, name: label };
    setBoard(prev => ({ ...prev, cards: prev.cards.map(c => c.id === cardId ? { ...c, attachments: [...(c.attachments||[]), att] } : c) }));
  };
  const removeAttachment = (cardId, attId) => {
    setBoard(prev => ({ ...prev, cards: prev.cards.map(c => c.id === cardId ? { ...c, attachments: (c.attachments||[]).filter(a=>a.id!==attId) } : c) }));
  };
  const deleteFileAttachment = async (att) => {
    try {
      const q = projectId ? `?project=${encodeURIComponent(projectId)}` : '';
      let r = await fetch(`${KANBAN_BASE}/file/${encodeURIComponent(att.id)}${q}`, { method:'DELETE', credentials:'include' });
      if (!r.ok) { try { await fetch(`${KANBAN_FALLBACK_BASE}/file/${encodeURIComponent(att.id)}${q}`, { method:'DELETE', credentials:'include' }); } catch {} }
    } catch {}
  };
  const uploadToCard = async (cardId, file) => {
    if (!file) return;
    try {
      const qp = new URLSearchParams();
      qp.set('filename', file.name);
      qp.set('content_type', file.type || 'application/octet-stream');
      if (projectId) qp.set('project', projectId);
      let r = await fetch(`${KANBAN_BASE}/upload?${qp.toString()}`, { method:'POST', credentials:'include', headers:{ 'Content-Type': file.type || 'application/octet-stream' }, body: file });
      let j; let ct = r.headers.get('content-type') || '';
      if (/application\/json/i.test(ct)) j = await r.json(); else j = { ok:false, error: (await r.text()).slice(0,800) };
      if (!(r.ok && j?.ok)) {
        const arr = await file.arrayBuffer(); const b64 = btoa(String.fromCharCode(...new Uint8Array(arr)));
        const body = { filename: file.name, content_base64: b64, content_type: file.type || 'application/octet-stream' };
        if (projectId) body.project = projectId;
        r = await fetch(`${KANBAN_BASE}/upload/base64`, { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify(body) });
        ct = r.headers.get('content-type') || '';
        j = /application\/json/i.test(ct) ? await r.json() : { ok:false, error: (await r.text()).slice(0,800) };
        if (!(r.ok && j?.ok)) {
          // Try legacy endpoints if module ones are not available
          try {
            let r2 = await fetch(`${KANBAN_FALLBACK_BASE}/upload?${qp.toString()}`, { method:'POST', credentials:'include', headers:{ 'Content-Type': file.type || 'application/octet-stream' }, body: file });
            let j2; let ct2 = r2.headers.get('content-type') || '';
            if (/application\/json/i.test(ct2)) j2 = await r2.json(); else j2 = { ok:false, error: (await r2.text()).slice(0,800) };
            if (!(r2.ok && j2?.ok)) {
              r2 = await fetch(`${KANBAN_FALLBACK_BASE}/upload/base64`, { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify(body) });
              ct2 = r2.headers.get('content-type') || '';
              j2 = /application\/json/i.test(ct2) ? await r2.json() : { ok:false, error: (await r2.text()).slice(0,800) };
            }
            if (r2.ok && j2?.ok) { r = r2; j = j2; }
          } catch {}
        }
      }
      if (r.ok && j?.ok) {
        const type = String(j.content_type||'').startsWith('image/') ? 'image' : 'file';
        const urlQ = projectId ? `?project=${encodeURIComponent(projectId)}` : '';
        const att = { id: j.id, type, name: j.file_name, url: j.url || `${KANBAN_BASE}/file/${j.id}${urlQ}`, contentType: j.content_type, sizeBytes: j.size_bytes };
        setBoard(prev => ({ ...prev, cards: prev.cards.map(c => c.id === cardId ? { ...c, attachments: [...(c.attachments||[]), att] } : c) }));
      } else {
        alert('Upload failed');
      }
    } catch (e) { alert(String(e?.message||e)); }
  };

  // DnD helpers
  const onDragStart = (e, cardId) => {
    try { e.dataTransfer.setData('text/plain', cardId); e.dataTransfer.effectAllowed = 'move'; } catch {}
  };
  const onDragOver = (e) => { try { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } catch {} };
  const moveCardToColumnEnd = (cardId, columnId) => {
    setBoard(prev => {
      const cards = prev.cards.slice();
      const fromIdx = cards.findIndex(c => c.id === cardId);
      if (fromIdx < 0) return prev;
      const [card] = cards.splice(fromIdx, 1);
      card.columnId = columnId;
      cards.push(card);
      return { ...prev, cards };
    });
  };
  const moveCardBefore = (cardId, targetCardId, columnId) => {
    setBoard(prev => {
      const cards = prev.cards.slice();
      const fromIdx = cards.findIndex(c => c.id === cardId);
      const toIdxOrig = cards.findIndex(c => c.id === targetCardId);
      if (fromIdx < 0 || toIdxOrig < 0) return prev;
      let insertIdx = toIdxOrig;
      const [card] = cards.splice(fromIdx, 1);
      if (fromIdx < toIdxOrig) insertIdx = insertIdx - 1;
      card.columnId = columnId;
      cards.splice(Math.max(0, insertIdx), 0, card);
      return { ...prev, cards };
    });
  };

  // Summary
  const [sumBusy, setSumBusy] = useState(false);
  const [sumMsg, setSumMsg] = useState('');
  const [sumOut, setSumOut] = useState('');
  const [sumFolder, setSumFolder] = useState('.');
  const [sumExts, setSumExts] = useState('js,jsx,ts,tsx,md,css,html,json');
  const [sumSave, setSumSave] = useState('');
  const [sumModel, setSumModel] = useState('');
  const [sumMode, setSumMode] = useState('summary');

  const runSummary = async () => {
    setSumBusy(true); setSumMsg(''); setSumOut('');
    try {
      const includeExts = sumExts.split(/[,\s]+/).filter(Boolean);
      const body = { folder: sumFolder, includeExts, mode: sumMode };
      if ((sumSave || '').trim()) body.saveToFile = sumSave.trim();
      if ((sumModel || '').trim()) body.model = sumModel.trim();
      const r = await fetch('/api/dev/summary', { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok || j?.ok === false) {
        setSumMsg(j?.message || j?.error || 'Failed');
      } else {
        setSumOut(j.summary || '');
        setSumMsg(j.savedTo ? `Généré (${(j.files||[]).length} fichiers). Enregistré: ${j.savedTo}` : `Généré (${(j.files||[]).length} fichiers).`);
      }
    } catch (e) { setSumMsg(String(e?.message || e)); }
    finally { setSumBusy(false); }
  };

  const colById = (id) => board.columns.find(c => c.id === id);
  const cardsByCol = (colId) => board.cards.filter(c => c.columnId === colId);

  // Update breadcrumb with project name when on Kanban
  useEffect(() => {
    if (hideTabs) return; // embedded controls breadcrumbs at parent level
    if (tab !== 'kanban') return;
    try {
      const name = (projects.find(p=>p.id===projectId)?.name) || null;
      const base = ['Development', 'Kanban'];
      const detail = name ? [...base, name] : base;
      window.dispatchEvent(new CustomEvent('app-breadcrumb', { detail }));
    } catch {}
  }, [tab, projectId, projects, hideTabs]);

  return (
    <div className="p-4 space-y-4">
      {/* Projects management moved to a dedicated section in Development > Gestion des projets */}
      {!hideTabs && (
        <div className="flex items-center gap-2">
          <button className={`px-3 py-1 rounded border ${tab==='kanban'?'bg-[color:var(--brand-600)] text-white':''}`} onClick={()=>setTab('kanban')}>Kanban</button>
          <button className={`px-3 py-1 rounded border ${tab==='summary'?'bg-[color:var(--brand-600)] text-white':''}`} onClick={()=>setTab('summary')}>Résumé</button>
          <button className={`px-3 py-1 rounded border ${tab==='tech'?'bg-[color:var(--brand-600)] text-white':''}`} onClick={()=>setTab('tech')}>Points techniques</button>
        </div>
      )}

      {tab === 'kanban' && (
        <div className="space-y-4">
          {projectId && (
            <div className="text-sm text-gray-600">Project: <span className="font-medium">{(projects.find(p=>p.id===projectId)?.name)||projectId}</span></div>
          )}
          <div className="flex items-end gap-2 flex-wrap">
            <div>
              <div className="text-xs mb-1">Nouvelle colonne</div>
              <input className="border rounded px-2 py-1" value={newCol} onChange={(e)=>setNewCol(e.target.value)} placeholder="Titre (ex: À faire)" />
            </div>
            <button className="px-3 py-1 rounded border" onClick={addColumn}>Ajouter</button>
            <button className="px-3 py-1 rounded border" onClick={saveKanban} disabled={kbBusy}>{kbBusy ? 'Enregistrement...' : 'Sauvegarder'}</button>
            <button className="px-3 py-1 rounded border" onClick={loadKanban} disabled={kbBusy}>{kbBusy ? 'Chargement...' : 'Recharger'}</button>
            {kbMsg && <span className="text-xs text-gray-600">{kbMsg}</span>}
          </div>

          <div className="flex items-end gap-2 flex-wrap">
            <div className="space-y-1">
              <div className="text-xs">Nouvelle carte</div>
              <input className="border rounded px-2 py-1 min-w-[260px]" placeholder="Titre" value={newCardTitle} onChange={(e)=>setNewCardTitle(e.target.value)} />
              <input className="border rounded px-2 py-1 min-w-[260px]" placeholder="Description (optionnel)" value={newCardDesc} onChange={(e)=>setNewCardDesc(e.target.value)} />
              <select className="border rounded px-2 py-1" value={newCardCol} onChange={(e)=>setNewCardCol(e.target.value)}>
                {board.columns.map((c)=> <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
              <button className="px-3 py-1 rounded border ml-2" onClick={addCard}>Ajouter</button>
            </div>
            <div className="text-xs text-gray-600">
              Auto: {autoBusy ? 'Saving…' : (autoMsg || 'Idle')}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {board.columns.sort((a,b)=>a.order-b.order).map((col) => (
              <div
                key={col.id}
                className="p-3 border rounded bg-white min-h-[200px]"
                onDragOver={(e)=>{ e.preventDefault(); e.dataTransfer.dropEffect='move'; }}
                onDrop={(e)=>{ const dragged = e.dataTransfer.getData('text/plain'); if (dragged) moveCardToColumnEnd(dragged, col.id); }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="font-medium">{col.title}</div>
                  <button
                    className="text-xs px-2 py-0.5 rounded border text-red-700"
                    title="Supprimer la colonne"
                    onClick={() => deleteColumn(col.id)}
                  >Supprimer</button>
                </div>
                <div className="space-y-2">
                  {cardsByCol(col.id).map(card => (
                    <div
                      key={card.id}
                      className="border rounded p-2 bg-gray-50 cursor-move"
                      draggable
                      onDragStart={(e)=>{ try{ e.dataTransfer.setData('text/plain', card.id); e.dataTransfer.effectAllowed='move'; }catch{} }}
                      onDragOver={(e)=>{ e.stopPropagation(); e.preventDefault(); e.dataTransfer.dropEffect='move'; }}
                      onDrop={(e)=>{ e.stopPropagation(); const dragged = e.dataTransfer.getData('text/plain'); if (dragged && dragged !== card.id) moveCardBefore(dragged, card.id, col.id); }}
                    >
                      {editId === card.id ? (
                        <div className="space-y-2">
                          <input className="border rounded px-2 py-1 w-full" value={editTitle} onChange={(e)=>{ const v=e.target.value; setEditTitle(v); setBoard(prev => ({ ...prev, cards: prev.cards.map(c => c.id === editId ? { ...c, title: v } : c) })); }} />
                          <RichEditor
                            valueHtml={editDesc}
                            onChange={(html)=>{ const v = html; setEditDesc(v); setBoard(prev => ({ ...prev, cards: prev.cards.map(c => c.id === editId ? { ...c, description: v } : c) })); }}
                            minRows={5}
                          />
                          <div className="flex items-center gap-2">
                            <button className="text-xs px-2 py-0.5 rounded border" onClick={saveEdit}>Save</button>
                            <button className="text-xs px-2 py-0.5 rounded border" onClick={cancelEdit}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="font-medium">{card.title}</div>
                          {!!card.description && (
                            <div
                              className="prose prose-sm max-w-none text-gray-800 mt-1"
                              dangerouslySetInnerHTML={{ __html: renderRichTextHTML(String(card.description || '')) }}
                            />
                          )}
                        </>
                      )}

                      <div className="mt-2 space-y-1">
                        {(card.attachments||[]).map(att => (
                          <div key={att.id} className="flex items-center gap-2 text-xs">
                            {att.type === 'image' ? (
                              <img src={att.url} alt={att.name} className="h-10 w-10 object-cover rounded border" />
                            ) : (
                              <span className="inline-block rounded border px-1">{att.contentType?.split('/')?.[1] || att.type}</span>
                            )}
                            <a href={att.url} target="_blank" rel="noreferrer noopener" className="text-blue-700 underline break-all">{att.name || att.url}</a>
                            <button className="text-[11px] px-2 py-0.5 rounded border" onClick={() => removeAttachment(card.id, att.id)}>Remove</button>
                            {att.id && (att.type === 'file' || att.type === 'image') && (
                              <button className="text-[11px] px-2 py-0.5 rounded border text-red-700" onClick={async()=>{ await deleteFileAttachment(att); removeAttachment(card.id, att.id); }}>Delete file</button>
                            )}
                          </div>
                        ))}
                      </div>

                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <select className="text-xs border rounded px-2 py-0.5" value={card.columnId} onChange={(e)=>moveCard(card.id, e.target.value)}>
                          {board.columns.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                        </select>
                        {editId === card.id ? (
                          <button className="text-xs px-2 py-0.5 rounded border" onClick={cancelEdit}>Cancel</button>
                        ) : (
                          <button className="text-xs px-2 py-0.5 rounded border" onClick={()=>startEdit(card)}>Edit</button>
                        )}
                        <button className="text-xs px-2 py-0.5 rounded bg-red-600 text-white" onClick={()=>deleteCard(card.id)}>Supprimer</button>
                        <label className="text-xs px-2 py-0.5 rounded border cursor-pointer">
                          Upload file
                          <input type="file" className="hidden" onChange={(e)=>{ const f=e.target.files?.[0]; if (f) { uploadToCard(card.id, f); e.target.value=''; } }} />
                        </label>
                        <button className="text-xs px-2 py-0.5 rounded border" onClick={()=>{
                          const url = prompt('URL (http/https):');
                          if (!url) return;
                          const name = prompt('Nom du lien (optionnel):') || url;
                          addLinkToCard(card.id, url, name);
                        }}>Add link</button>
                      </div>
                    </div>
                  ))}
                  {!cardsByCol(col.id).length && (
                    <div className="text-xs text-gray-400">Aucune carte</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {(tab === 'summary' || tab === 'tech') && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <div className="text-xs mb-1">Dossier à résumer (racine projet)</div>
              <input className="border rounded px-2 py-1 w-full" value={sumFolder} onChange={(e)=>setSumFolder(e.target.value)} placeholder="ex: . / backend / frontend / modules" />
            </div>
            <div>
              <div className="text-xs mb-1">Extensions incluses</div>
              <input className="border rounded px-2 py-1 w-full" value={sumExts} onChange={(e)=>setSumExts(e.target.value)} placeholder="js,jsx,ts,tsx,md,css,html,json" />
            </div>
            <div>
              <div className="text-xs mb-1">Chemin de sauvegarde (optionnel)</div>
              <input className="border rounded px-2 py-1 w-full" value={sumSave} onChange={(e)=>setSumSave(e.target.value)} placeholder="ex: backend/app_files/project-summary.md ou prompt_next_step.txt" />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <div className="text-xs mb-1">Modèle OpenAI (optionnel)</div>
              <input className="border rounded px-2 py-1 w-full" value={sumModel} onChange={(e)=>setSumModel(e.target.value)} placeholder="ex: gpt-4o-mini" />
            </div>
            <div>
              <div className="text-xs mb-1">Mode</div>
              <select className="border rounded px-2 py-1 w-full" value={sumMode} onChange={(e)=>setSumMode(e.target.value)}>
                <option value="summary">Résumé + points clés</option>
                <option value="tech">Points techniques</option>
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="px-3 py-1 rounded border" onClick={runSummary} disabled={sumBusy}>{sumBusy ? 'Analyse en cours...' : 'Générer'}</button>
            {sumMsg && <span className="text-xs text-gray-600">{sumMsg}</span>}
          </div>
          {!!sumOut && (
            <pre className="text-xs bg-white border rounded p-3 whitespace-pre-wrap max-h-[60vh] overflow-auto">{sumOut}</pre>
          )}
        </div>
      )}
    </div>
  );
}



