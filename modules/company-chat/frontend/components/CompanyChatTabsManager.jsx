import React, { useMemo, useState } from 'react';

function normalizePromptOptions(items) {
  const arr = Array.isArray(items) ? items : [];
  return arr
    .map((p) => ({ id: String(p?.id || '').trim(), name: String(p?.name || '').trim() }))
    .filter((p) => p.id);
}

function normalizeChatbotOptions(items) {
  const arr = Array.isArray(items) ? items : [];
  return arr
    .map((b) => ({ id: String(b?.id_bot || b?.id || '').trim(), name: String(b?.name || '').trim() }))
    .filter((b) => b.id);
}

export function CompanyChatTabsBar({ tabs, activeId, onSelect, onAdd }) {
  const list = Array.isArray(tabs) ? tabs : [];
  return (
    <div className="flex items-center gap-2 overflow-x-auto py-1">
      {list.map((t) => {
        const id = String(t.id || '');
        const active = id && id === activeId;
        const botIds = Array.isArray(t.chatbot_ids) ? t.chatbot_ids.map(String).filter(Boolean) : [];
        const hint = botIds.length
          ? `Bot: ${botIds.join(', ')}`
          : (t.prompt_config_id ? `Prompt: ${t.prompt_config_id}` : 'No chatbot/prompt');
        return (
          <button
            key={id}
            className={`px-3 py-2 rounded-lg border text-left min-w-[130px] max-w-[220px] ${active ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm' : 'bg-white border-gray-200 text-gray-800 hover:bg-gray-50'}`}
            onClick={() => onSelect?.(id)}
            title={hint}
          >
            <div className="text-xs font-medium truncate">{t.title || 'Untitled'}</div>
            <div className={`text-[10px] truncate ${active ? 'text-indigo-100' : 'text-gray-500'}`}>{hint}</div>
          </button>
        );
      })}
      <button
        className="text-xs px-3 py-2 rounded-lg border bg-white hover:bg-gray-50 text-gray-800 whitespace-nowrap"
        onClick={() => onAdd?.()}
        title="Add a tab"
      >
        + Tab
      </button>
    </div>
  );
}

export default function CompanyChatTabsManager({
  tabs,
  activeId,
  promptOptions,
  chatbotOptions,
  busy,
  error,
  onAdd,
  onSelect,
  onUpdate,
  onDelete,
}) {
  const list = Array.isArray(tabs) ? tabs : [];
  const prompts = useMemo(() => normalizePromptOptions(promptOptions), [promptOptions]);
  const chatbots = useMemo(() => normalizeChatbotOptions(chatbotOptions), [chatbotOptions]);
  const [savingId, setSavingId] = useState('');

  const saveRow = async (id, patch) => {
    if (!id) return;
    setSavingId(id);
    try { await onUpdate?.(id, patch); }
    finally { setSavingId(''); }
  };

  return (
    <div className="border rounded bg-white">
      <div className="flex items-center justify-between px-3 py-2 border-b bg-gray-50">
        <div className="text-sm font-medium">Question types (tabs)</div>
        <div className="flex items-center gap-2">
          <button className="text-xs px-2 py-0.5 border rounded bg-white" onClick={() => onAdd?.()} disabled={busy}>+ Tab</button>
        </div>
      </div>

      {!!error && <div className="px-3 py-2 text-xs text-red-600">{error}</div>}

      <div className="max-h-64 overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-white border-b">
            <tr>
              <th className="text-left px-3 py-2 w-48">Tab name</th>
              <th className="text-left px-3 py-2 w-72">Chatbot (Automation Suite)</th>
              <th className="text-left px-3 py-2">Prompt profile (fallback)</th>
              <th className="text-left px-3 py-2 w-40">Model override</th>
              <th className="text-left px-3 py-2 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {list.map((t) => {
              const id = String(t.id || '');
              const isActive = id && id === activeId;
              const saving = savingId === id;
              const botIds = Array.isArray(t.chatbot_ids) ? t.chatbot_ids.map(String).filter(Boolean) : [];
              const botId = botIds.length ? botIds[0] : '';
              const hasBot = !!botId;
              return (
                <tr key={id} className={`border-b ${isActive ? 'bg-blue-50/40' : ''}`}>
                  <td className="px-3 py-2">
                    <button className="text-xs px-1.5 py-0.5 rounded border bg-white mr-2" onClick={() => onSelect?.(id)} title="Select tab">
                      {isActive ? '●' : '○'}
                    </button>
                    <input
                      className="border rounded px-2 py-1 text-xs w-36"
                      value={t.title || ''}
                      onChange={(e) => onUpdate?.(id, { title: e.target.value }, { optimistic: true })}
                      onBlur={(e) => saveRow(id, { title: e.target.value })}
                      placeholder="e.g. Sales, Support..."
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      className="border rounded px-2 py-1 text-xs w-full"
                      value={botId}
                      onChange={(e) => {
                        const v = String(e.target.value || '').trim();
                        const patch = v ? { chatbot_ids: [v], prompt_config_id: '' } : { chatbot_ids: [] };
                        onUpdate?.(id, patch, { optimistic: true });
                        saveRow(id, patch);
                      }}
                    >
                      <option value="">(no chatbot selected)</option>
                      {chatbots.map((b) => (
                        <option key={b.id} value={b.id}>{b.name ? `${b.name} (${b.id})` : b.id}</option>
                      ))}
                    </select>
                    <div className="text-[11px] text-gray-500 mt-1">
                      {hasBot ? 'Uses the chatbot’s prompt/tools.' : 'If empty, the prompt profile below is used.'}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      className="border rounded px-2 py-1 text-xs w-full"
                      value={t.prompt_config_id || ''}
                      disabled={hasBot}
                      onChange={(e) => {
                        const v = e.target.value;
                        onUpdate?.(id, { prompt_config_id: v }, { optimistic: true });
                        saveRow(id, { prompt_config_id: v });
                      }}
                    >
                      <option value="">{hasBot ? '(disabled: using chatbot)' : '(no prompt selected)'}</option>
                      {prompts.map((p) => (
                        <option key={p.id} value={p.id}>{p.name ? `${p.name} (${p.id})` : p.id}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      className="border rounded px-2 py-1 text-xs w-full"
                      value={t.model || ''}
                      onChange={(e) => onUpdate?.(id, { model: e.target.value }, { optimistic: true })}
                      onBlur={(e) => saveRow(id, { model: e.target.value })}
                      placeholder="gpt-4o-mini"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      className="text-xs px-2 py-0.5 border rounded bg-white"
                      disabled={saving || busy}
                      onClick={() => saveRow(id, { title: t.title, prompt_config_id: t.prompt_config_id, model: t.model })}
                    >
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      className="ml-2 text-xs px-2 py-0.5 border rounded bg-white text-red-600"
                      onClick={async () => {
                        const ok = window.confirm('Delete this tab?');
                        if (!ok) return;
                        await onDelete?.(id);
                      }}
                      disabled={busy}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
            {!list.length && (
              <tr><td className="px-3 py-3 text-sm text-gray-500" colSpan={4}>No tabs yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
