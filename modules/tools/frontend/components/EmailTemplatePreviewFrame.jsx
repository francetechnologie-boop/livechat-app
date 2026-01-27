import React from 'react';

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

  if (/<html[\\s>]/i.test(raw)) {
    if (/<head[\\s>]/i.test(raw)) {
      return raw.replace(/<head([^>]*)>/i, (m) => `${m}${injected}`);
    }
    return raw.replace(/<html([^>]*)>/i, (m) => `${m}<head>${injected}</head>`);
  }

  return `<!doctype html><html><head><meta charset="utf-8" />${injected}</head><body>${raw}</body></html>`;
}

export default function EmailTemplatePreviewFrame({ html, title = 'email_template_preview', height = 360 }) {
  if (!String(html || '').trim()) return null;
  return (
    <iframe
      title={title}
      className="w-full border rounded bg-white"
      style={{ height }}
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      srcDoc={buildEmailSrcDoc(html)}
    />
  );
}

