import React from 'react';
import EmailTemplatePreviewFrame from './EmailTemplatePreviewFrame.jsx';

export default function EmailTemplateCreatorTranslatorEditor({
  source,
  sourceLabel,
  targetLabel,
  targetSubject,
  setTargetSubject,
  targetHtml,
  setTargetHtml,
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <div className="border rounded p-2">
        <div className="text-xs text-gray-600 mb-2">Source ({sourceLabel})</div>
        {source ? (
          <>
            <div className="text-[11px] text-gray-500 mb-1">Subject</div>
            <input className="w-full border rounded px-2 py-1 bg-gray-50 mb-2" value={String(source.subject || '')} readOnly />
            <div className="text-[11px] text-gray-500 mb-1">HTML preview</div>
            <EmailTemplatePreviewFrame html={String(source.html_body || '')} title="source_email_template_preview" height={360} />
          </>
        ) : (
          <div className="text-xs text-gray-500">Load a source template to start translating.</div>
        )}
      </div>

      <div className="border rounded p-2">
        <div className="text-xs text-gray-600 mb-2">Target ({targetLabel})</div>
        <div className="text-[11px] text-gray-500 mb-1">Subject</div>
        <input
          className="w-full border rounded px-2 py-1 bg-white mb-2"
          value={targetSubject}
          onChange={(e) => setTargetSubject(e.target.value)}
          placeholder="Subject"
        />
        <div className="text-[11px] text-gray-500 mb-1">HTML body</div>
        <textarea
          className="w-full border rounded px-2 py-1 bg-white font-mono text-xs h-[220px] mb-2"
          value={targetHtml}
          onChange={(e) => setTargetHtml(e.target.value)}
          placeholder="<p>...</p>"
        />
        <div className="text-[11px] text-gray-500 mb-1">Preview</div>
        <EmailTemplatePreviewFrame html={targetHtml} title="target_email_template_preview" height={360} />
      </div>
    </div>
  );
}

