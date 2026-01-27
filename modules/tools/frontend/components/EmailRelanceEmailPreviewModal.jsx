import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import tinymce from 'tinymce/tinymce.js';
import 'tinymce/icons/default/index.js';
import 'tinymce/themes/silver/index.js';
import 'tinymce/plugins/autolink/index.js';
import 'tinymce/plugins/link/index.js';
import 'tinymce/plugins/lists/index.js';
import 'tinymce/plugins/code/index.js';
import 'tinymce/plugins/table/index.js';
import 'tinymce/plugins/image/index.js';

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

export default function EmailRelanceEmailPreviewModal({
  open,
  onClose,
  onSave,
  title,
  email,
  meta,
  busy,
  error,
  onCreateDraft,
  onSend,
}) {
  const [local, setLocal] = useState({ to: '', from: '', subject: '', html: '', text: '' });
  const editorMountRef = useRef(null);
  const tinymceEditorRef = useRef(null);
  const editorReadyRef = useRef(false);
  const lastSyncedHtmlRef = useRef('');

  const readEditorHtml = useCallback(() => {
    try {
      const editor = tinymceEditorRef.current;
      if (editor && editorReadyRef.current) return String(editor.getContent() || '');
    } catch {}
    return String(local.html || '');
  }, [local.html]);

  useEffect(() => {
    if (!open) return;
    const htmlFromEmail = String(email?.html || '').trim();
    const textFromEmail = String(email?.text || '').trim();
    const html = htmlFromEmail || (textFromEmail ? textToSimpleHtml(textFromEmail) : '');
    setLocal({
      to: String(email?.to || '').trim(),
      from: String(email?.from || '').trim(),
      subject: String(email?.subject || ''),
      html,
      // Text alternative is derived server-side from HTML when omitted.
      text: '',
    });
    lastSyncedHtmlRef.current = html;
    // If the editor is already initialized (modal open, content regenerated), push the new content.
    const editor = tinymceEditorRef.current;
    if (editor && editorReadyRef.current) {
      try {
        const current = editor.getContent() || '';
        if (current !== html) editor.setContent(html || '', { format: 'raw' });
      } catch {}
    }
  // Depend on primitive email fields so parent re-renders don't reset local edits.
  }, [open, email?.to, email?.from, email?.subject, email?.html, email?.text]);

  const initTinyMce = useCallback(() => {
    if (!editorMountRef.current) return;
    if (tinymceEditorRef.current) return;
    tinymce.init({
      target: editorMountRef.current,
      base_url: '/tinymce',
      suffix: '.min',
      license_key: 'gpl',
      height: 520,
      menubar: false,
      statusbar: false,
      plugins: ['link', 'lists', 'autolink', 'code', 'table', 'image'],
      toolbar: 'undo redo | bold italic underline | link | bullist numlist | table | removeformat | code',
      toolbar_mode: 'sliding',
      branding: false,
      skin: 'oxide',
      // Keep signature logos intact (TinyMCE can otherwise drop <img> when plugin/schema config changes).
      extended_valid_elements: 'img[src|alt|title|width|height|style|class]',
      content_style: 'body{font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.35;}',
      setup(editor) {
        tinymceEditorRef.current = editor;
        editorReadyRef.current = false;
        let ready = false;
        const sync = () => {
          if (!ready) return;
          const html = editor.getContent() || '';
          if (html === lastSyncedHtmlRef.current) return;
          lastSyncedHtmlRef.current = html;
          setLocal((prev) => ({ ...prev, html }));
        };
        editor.on('init', () => {
          const initial = String(lastSyncedHtmlRef.current || '');
          editor.setContent(initial || '', { format: 'raw' });
          ready = true;
          editorReadyRef.current = true;
        });
        editor.on('Change KeyUp Undo Redo SetContent', sync);
        editor.on('Blur', sync);
      },
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    if (!editorMountRef.current) return;
    initTinyMce();
  }, [open, initTinyMce]);

  useEffect(() => {
    const editor = tinymceEditorRef.current;
    if (!open || !editor) return;
    if (!editorReadyRef.current) return;
    const next = String(local.html || '');
    if (next === lastSyncedHtmlRef.current) return;
    const current = editor.getContent() || '';
    if (current !== next) editor.setContent(next || '', { format: 'raw' });
    lastSyncedHtmlRef.current = next;
  }, [open, local.html]);

  useEffect(() => {
    if (open) return undefined;
    if (tinymceEditorRef.current) {
      try { tinymceEditorRef.current.remove(); } catch {}
      tinymceEditorRef.current = null;
    }
    editorReadyRef.current = false;
    return undefined;
  }, [open]);

  useEffect(() => {
    return () => {
      if (tinymceEditorRef.current) {
        try { tinymceEditorRef.current.remove(); } catch {}
        tinymceEditorRef.current = null;
      }
      editorReadyRef.current = false;
    };
  }, []);

  // Lock background scroll while the modal is open.
  useEffect(() => {
    if (!open) return undefined;
    if (typeof document === 'undefined') return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  const node = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-6xl max-h-[92vh] bg-white rounded-lg shadow-lg border overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <div className="font-semibold truncate">{title || 'Email'}</div>
            {meta ? <div className="text-xs text-gray-500 truncate">{meta}</div> : null}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onSend ? (
              <button
                type="button"
                className="text-xs px-2 py-1 rounded border bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={() => {
                  const html = readEditorHtml();
                  onSend({ ...local, html, text: '' });
                }}
                disabled={busy || !String(local.subject || '').trim() || !String(readEditorHtml() || '').trim()}
              >
                {busy ? 'Envoi…' : 'Envoyer'}
              </button>
            ) : null}
            {onCreateDraft ? (
              <button
                type="button"
                className="text-xs px-2 py-1 rounded border bg-blue-600 text-white hover:bg-blue-700"
                onClick={() => {
                  const html = readEditorHtml();
                  onCreateDraft({ ...local, html, text: '' });
                }}
                disabled={busy || !String(readEditorHtml() || '').trim()}
              >
                {busy ? 'Création…' : 'Créer brouillon Gmail'}
              </button>
            ) : null}
            <button
              type="button"
              className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
              onClick={() => {
                try {
                  const html = readEditorHtml();
                  if (onSave) onSave({ ...local, html, text: '' });
                } catch {}
                onClose();
              }}
            >
              Fermer
            </button>
          </div>
        </div>

        <div className="px-4 py-3 border-b shrink-0">
          {error ? <div className="text-sm text-red-600 mb-2">{error}</div> : null}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
            <div>
              <div className="text-xs text-gray-500 mb-1">À</div>
              <input
                className="w-full rounded border px-2 py-1 text-sm"
                value={local.to}
                onChange={(e) => setLocal((prev) => ({ ...prev, to: e.target.value }))}
                placeholder="client@email.tld"
              />
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">De</div>
              <input
                className="w-full rounded border px-2 py-1 text-sm bg-gray-50"
                value={local.from}
                readOnly
                placeholder="—"
                title="Déduit de PS_SHOP_EMAIL (id_shop)."
              />
            </div>
            <div className="lg:col-span-2">
              <div className="text-xs text-gray-500 mb-1">Sujet</div>
              <input
                className="w-full rounded border px-2 py-1 text-sm"
                value={local.subject}
                onChange={(e) => setLocal((prev) => ({ ...prev, subject: e.target.value }))}
                placeholder="[shop] ..."
              />
            </div>
          </div>
        </div>

        <div className="p-3 space-y-2 overflow-auto flex-1">
          <div>
            <div className="text-xs text-gray-500 mb-1">HTML</div>
            <textarea ref={editorMountRef} defaultValue={local.html} />
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return node;
  return createPortal(node, document.body);
}
