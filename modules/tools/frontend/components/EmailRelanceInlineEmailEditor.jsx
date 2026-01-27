import React, { useCallback, useEffect, useRef } from 'react';
import tinymce from 'tinymce/tinymce.js';
import 'tinymce/icons/default/index.js';
import 'tinymce/themes/silver/index.js';
import 'tinymce/plugins/autolink/index.js';
import 'tinymce/plugins/link/index.js';
import 'tinymce/plugins/lists/index.js';
import 'tinymce/plugins/code/index.js';
import 'tinymce/plugins/table/index.js';

export default function EmailRelanceInlineEmailEditor({
  title,
  to,
  from,
  subject,
  html,
  msg,
  busy,
  onChange,
  onGenerate,
  onCreateDraft,
  onSend,
  onClose,
}) {
  const editorMountRef = useRef(null);
  const tinymceEditorRef = useRef(null);
  const editorReadyRef = useRef(false);
  const lastSyncedHtmlRef = useRef(String(html || ''));

  const initTinyMce = useCallback(() => {
    if (!editorMountRef.current) return;
    if (tinymceEditorRef.current) return;
    tinymce.init({
      target: editorMountRef.current,
      base_url: '/tinymce',
      suffix: '.min',
      license_key: 'gpl',
      height: 320,
      menubar: false,
      statusbar: false,
      plugins: ['link', 'lists', 'autolink', 'code', 'table'],
      toolbar: 'undo redo | bold italic underline | link | bullist numlist | table | removeformat | code',
      toolbar_mode: 'sliding',
      branding: false,
      skin: 'oxide',
      content_style: 'body{font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.35;}',
      setup(editor) {
        tinymceEditorRef.current = editor;
        editorReadyRef.current = false;
        let ready = false;
        const sync = () => {
          if (!ready) return;
          const nextHtml = editor.getContent() || '';
          if (nextHtml === lastSyncedHtmlRef.current) return;
          lastSyncedHtmlRef.current = nextHtml;
          onChange({ html: nextHtml });
        };
        editor.on('init', () => {
          editor.setContent(String(lastSyncedHtmlRef.current || '') || '', { format: 'raw' });
          ready = true;
          editorReadyRef.current = true;
        });
        editor.on('Change KeyUp Undo Redo SetContent', sync);
        editor.on('Blur', sync);
      },
    });
  }, [onChange]);

  useEffect(() => {
    initTinyMce();
    return () => {
      if (tinymceEditorRef.current) {
        try { tinymceEditorRef.current.remove(); } catch {}
        tinymceEditorRef.current = null;
      }
      editorReadyRef.current = false;
    };
  }, [initTinyMce]);

  // If HTML is regenerated from the prompt, sync it into TinyMCE (without feedback loops).
  useEffect(() => {
    const next = String(html || '');
    const editor = tinymceEditorRef.current;
    if (!editor || !editorReadyRef.current) {
      lastSyncedHtmlRef.current = next;
      return;
    }
    if (next === lastSyncedHtmlRef.current) return;
    const current = editor.getContent() || '';
    if (current !== next) editor.setContent(next || '', { format: 'raw' });
    lastSyncedHtmlRef.current = next;
  }, [html]);

  return (
    <div className="p-3 bg-white border rounded">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-sm truncate">{title || 'Email'}</div>
          <div className="text-[11px] text-gray-500 truncate">
            {to ? `To: ${to}` : 'To: —'}
            {` · From: ${from ? from : '—'}`}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
            onClick={onGenerate}
            disabled={busy}
          >
            {busy ? '…' : 'Regénérer'}
          </button>
          <button
            type="button"
            className="text-xs px-2 py-1 rounded border bg-blue-600 text-white hover:bg-blue-700"
            onClick={onCreateDraft}
            disabled={busy || !String(html || '').trim()}
            title="Créer un brouillon Gmail (sans envoyer)"
          >
            {busy ? '…' : 'Brouillon Gmail'}
          </button>
          <button
            type="button"
            className="text-xs px-2 py-1 rounded border bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={onSend}
            disabled={busy || !String(html || '').trim() || !String(subject || '').trim()}
          >
            {busy ? '…' : 'Send Email'}
          </button>
          <button
            type="button"
            className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
            onClick={onClose}
            disabled={busy}
          >
            Fermer
          </button>
        </div>
      </div>

      {msg ? <div className="mt-2 text-[12px] text-gray-700">{msg}</div> : null}

      <div className="mt-3 grid grid-cols-1 lg:grid-cols-4 gap-3">
        <div>
          <div className="text-xs text-gray-500 mb-1">À</div>
          <input
            className="w-full rounded border px-2 py-1 text-sm"
            value={String(to || '')}
            onChange={(e) => onChange({ to: e.target.value })}
            placeholder="client@email.tld"
          />
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-1">De</div>
          <input
            className="w-full rounded border px-2 py-1 text-sm bg-gray-50"
            value={String(from || '')}
            readOnly
            placeholder="—"
            title="Déduit de PS_SHOP_EMAIL (id_shop)."
          />
        </div>
        <div className="lg:col-span-2">
          <div className="text-xs text-gray-500 mb-1">Sujet</div>
          <input
            className="w-full rounded border px-2 py-1 text-sm"
            value={String(subject || '')}
            onChange={(e) => onChange({ subject: e.target.value })}
            placeholder="[shop] ..."
          />
        </div>
      </div>

      <div className="mt-3">
        <div className="text-xs text-gray-500 mb-1">HTML</div>
        <div ref={editorMountRef} />
      </div>
    </div>
  );
}
