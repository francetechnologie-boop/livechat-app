import React, { useEffect, useState } from 'react';
import EmailFromDbTemplatePanel from './components/EmailFromDbTemplatePanel.jsx';
import EmailTemplateCreatorTranslatorPanel from './components/EmailTemplateCreatorTranslatorPanel.jsx';
import { useMySqlProfileSetting } from './utils/toolsSettings.js';
import { loadModuleState, saveModuleState } from '@app-lib/uiState';

export default function EmailTemplate() {
  const [tab, setTab] = useState(() => {
    try {
      const st = loadModuleState('tools') || {};
      const t = String(st.emailTemplateTab || '').trim();
      if (t === 'creator') return 'creator';
      return 'from-template';
    } catch {
      return 'from-template';
    }
  });
  const { setting: generalSetting } = useMySqlProfileSetting();
  const defaultProfileId = generalSetting.profileId ? String(generalSetting.profileId) : '';

  useEffect(() => {
    try {
      const st = loadModuleState('tools') || {};
      saveModuleState('tools', { ...st, emailTemplateTab: tab });
    } catch {}
  }, [tab]);

  return (
    <div className="p-3">
      <div className="panel">
        <div className="panel__header">
          <div>Email templates</div>
          <div className="text-[12px] text-gray-500">
            Stored in Postgres `mod_tools_email_template` (Shop + Language + Template type). MySQL profile is used only to list available shops/languages.
          </div>
        </div>
        <div className="panel__body">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <button
              type="button"
              onClick={() => setTab('from-template')}
              className={`text-xs px-3 py-1.5 rounded border transition-colors ${
                tab === 'from-template' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white hover:bg-gray-50'
              }`}
            >
              Email from template
            </button>
            <button
              type="button"
              onClick={() => setTab('creator')}
              className={`text-xs px-3 py-1.5 rounded border transition-colors ${
                tab === 'creator' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white hover:bg-gray-50'
              }`}
            >
              Template creator & translator
            </button>
          </div>

          {tab === 'creator' ? (
            <EmailTemplateCreatorTranslatorPanel defaultProfileId={defaultProfileId} />
          ) : (
            <EmailFromDbTemplatePanel defaultOpen defaultProfileId={defaultProfileId} />
          )}
        </div>
      </div>
    </div>
  );
}
