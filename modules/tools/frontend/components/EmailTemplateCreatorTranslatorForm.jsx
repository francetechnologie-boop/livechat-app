import React from 'react';

export default function EmailTemplateCreatorTranslatorForm({
  orgId,
  setOrgId,
  profileId,
  setProfileId,
  profiles,
  profilesLoading,
  profilesError,
  promptConfigId,
  promptConfigs,
  promptConfigsLoading,
  promptConfigsError,
  reloadPromptConfigs,
  templateTypesQuery,
  setTemplateTypesQuery,
  templateTypes,
  templateTypesLoading,
  templateTypesError,
  reloadTemplateTypes,
  templateType,
  setTemplateType,
  idShop,
  setIdShop,
  shops,
  shopsLoading,
  shopsError,
  targetShopId,
  setTargetShopId,
  reloadShops,
  reloadLanguages,
  sourceLangId,
  setSourceLangId,
  targetLangIds,
  setTargetLangIds,
  activeTargetLangId,
  setActiveTargetLangId,
  allLanguages,
  allLanguagesLoading,
  languages,
  languagesLoading,
  languagesError,
  promptStoreLoading,
  promptStoreMessage,
  promptStoreError,
  onPromptConfigChange,

  canRender,
  canSave,
  canTranslate,
  canBatchTranslate,
  hasSource,

  sourceLoading,
  targetLoading,
  translateLoading,

  loadSource,
  loadTarget,
  loadTemplate,
  canLoadTemplate,
  loadTemplateLoading,
  copySourceToTarget,
  translateSourceToTarget,
  translateAndSaveSelectedTargets,
  saveTarget,

  errorMessage,
  recipientEmail,
  setRecipientEmail,
  draftLoading,
  draftError,
  draftMessage,
  createDraft,
  canCreateDraft,
}) {
  const selectedTargets = Array.isArray(targetLangIds) ? targetLangIds.map(String).filter(Boolean) : [];

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        <div>
          <label className="text-xs text-gray-600">Org ID (optional)</label>
          <input
            className="w-full border rounded px-2 py-1 bg-white"
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            placeholder="(empty = global)"
          />
        </div>
        <div>
          <label className="text-xs text-gray-600">MySQL profile (for shop/lang labels)</label>
          <select
            className="w-full border rounded px-2 py-1 bg-white"
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
            disabled={profilesLoading}
          >
            {profiles.length === 0 ? (
              <option value="">{profilesLoading ? 'Loading.' : 'No profiles.'}</option>
            ) : (
              profiles.map((p) => (
                <option key={String(p.id)} value={String(p.id)}>
                  {p.name ? `${p.name} (ID ${p.id})` : `Profile ${p.id}`}
                </option>
              ))
            )}
          </select>
          {profilesError && <div className="text-xs text-red-600 mt-1">{profilesError}</div>}
        </div>
        <div>
          <label className="text-xs text-gray-600">Translation prompt (Automation Suite)</label>
          <select
            className="w-full border rounded px-2 py-1 bg-white"
            value={promptConfigId}
            onChange={(e) => onPromptConfigChange(e.target.value)}
            disabled={promptConfigsLoading}
          >
            <option value="">{promptConfigsLoading ? 'Loading.' : 'Select a prompt config.'}</option>
            {(promptConfigs || []).map((pc) => (
              <option key={String(pc.id)} value={String(pc.id)}>
                {pc.name ? `${pc.name} (${pc.id})` : String(pc.id)}
              </option>
            ))}
          </select>
          <div className="mt-1 flex items-center justify-between gap-2">
            <a className="text-[11px] text-blue-700 hover:underline" href="#/automation-suite/prompts">
              Open prompts
            </a>
            <button
              type="button"
              className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
              onClick={reloadPromptConfigs}
              disabled={promptConfigsLoading}
            >
              {promptConfigsLoading ? 'Loading.' : 'Refresh'}
            </button>
          </div>
          {promptStoreLoading && <div className="text-[11px] text-gray-500 mt-1">Loading saved prompt…</div>}
          {promptStoreMessage && <div className="text-[11px] text-green-700 mt-1">{promptStoreMessage}</div>}
          {promptStoreError && <div className="text-[11px] text-red-600 mt-1">{promptStoreError}</div>}
          {promptConfigsError && <div className="text-xs text-red-600 mt-1">{promptConfigsError}</div>}
        </div>

        <div className="md:col-span-2">
          <label className="text-xs text-gray-600">Template</label>
          <div className="flex items-center gap-2 mb-1">
            <input
              className="flex-1 border rounded px-2 py-1"
              value={templateTypesQuery || ''}
              onChange={(e) => setTemplateTypesQuery(e.target.value)}
              placeholder="Search template type"
            />
            <button
              type="button"
              className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
              onClick={reloadTemplateTypes}
              disabled={templateTypesLoading}
              title="Loads template types from Postgres (mod_tools_email_template)."
            >
              {templateTypesLoading ? 'Loading.' : 'Load'}
            </button>
          </div>
          <select
            className="w-full border rounded px-2 py-1 bg-white"
            value={templateType}
            onChange={(e) => setTemplateType(e.target.value)}
            disabled={templateTypesLoading || !Array.isArray(templateTypes) || !templateTypes.length}
          >
            {(!Array.isArray(templateTypes) || !templateTypes.length) ? (
              <option value="">{templateTypesLoading ? 'Loading.' : 'Load templates first.'}</option>
            ) : (
              <>
                <option value="">Select a template.</option>
                {templateTypes.map((t) => (
                  <option key={String(t.template_type)} value={String(t.template_type)}>
                    {String(t.template_type)}{Number(t.variants_count || 0) > 1 ? ` (${t.variants_count})` : ''}
                  </option>
                ))}
              </>
            )}
          </select>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              className="text-xs px-3 py-1.5 rounded border bg-white hover:bg-gray-50"
              onClick={loadTemplate}
              disabled={!canLoadTemplate || loadTemplateLoading}
            >
              {loadTemplateLoading ? 'Loading template…' : 'Load template'}
            </button>
            <span className="text-[11px] text-gray-500">
              Click to fetch the template content for the source preview.
            </span>
          </div>
          {templateTypesError && <div className="text-xs text-red-600 mt-1">{templateTypesError}</div>}
        </div>
        <div>
          <label className="text-xs text-gray-600">Shop</label>
          <select
            className="w-full border rounded px-2 py-1 bg-white"
            value={idShop}
            onChange={(e) => setIdShop(e.target.value)}
            disabled={shopsLoading || !String(profileId || '').trim()}
          >
            {shops.length === 0 ? (
              <option value="">{shopsLoading ? 'Loading.' : 'Select a profile.'}</option>
            ) : (
              shops.map((s) => (
                <option key={String(s.id_shop)} value={String(s.id_shop)}>
                  {s.name ? `${s.name} (ID ${s.id_shop})` : `ID ${s.id_shop}`}
                </option>
              ))
            )}
          </select>
          {shopsError && <div className="text-xs text-red-600 mt-1">{shopsError}</div>}
        </div>

        <div>
          <label className="text-xs text-gray-600">Target shop</label>
          <select
            className="w-full border rounded px-2 py-1 bg-white"
            value={targetShopId}
            onChange={(e) => setTargetShopId(e.target.value)}
            disabled={shopsLoading || !String(profileId || '').trim()}
          >
            {shops.length === 0 ? (
              <option value="">{shopsLoading ? 'Loading.' : 'Select a profile.'}</option>
            ) : (
              shops.map((s) => (
                <option key={String(s.id_shop)} value={String(s.id_shop)}>
                  {s.name ? `${s.name} (ID ${s.id_shop})` : `ID ${s.id_shop}`}
                </option>
              ))
            )}
          </select>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="text-[11px] text-gray-400">Pick the shop where translations should be saved.</span>
            <button
              type="button"
              className="text-[11px] px-2 py-1 rounded border bg-white hover:bg-gray-50"
              onClick={reloadShops}
            >
              {shopsLoading ? 'Loading.' : 'Refresh shops'}
            </button>
          </div>
          {shopsError && <div className="text-xs text-red-600 mt-1">{shopsError}</div>}
        </div>

        <div>
          <label className="text-xs text-gray-600">Source language</label>
          <select
            className="w-full border rounded px-2 py-1 bg-white"
            value={sourceLangId}
            onChange={(e) => setSourceLangId(e.target.value)}
            disabled={languagesLoading || !String(profileId || '').trim() || !String(idShop || '').trim()}
          >
            {languages.length === 0 ? (
              <option value="">{languagesLoading ? 'Loading.' : 'Select a shop.'}</option>
            ) : (
              languages.map((l) => (
                <option key={String(l.id_lang)} value={String(l.id_lang)}>
                  {l.iso_code ? `${l.iso_code} — ${l.name || ''} (ID ${l.id_lang})` : `${l.name || ''} (ID ${l.id_lang})`}
                </option>
              ))
            )}
          </select>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="text-[11px] text-gray-400">Use languages from `ps_lang`.</span>
            <button
              type="button"
              className="text-[11px] px-2 py-1 rounded border bg-white hover:bg-gray-50"
              onClick={reloadLanguages}
              disabled={languagesLoading || !String(profileId || '').trim() || !String(idShop || '').trim()}
            >
              {languagesLoading ? 'Refreshing' : 'Refresh languages'}
            </button>
          </div>
        </div>
        <div>
          <label className="text-xs text-gray-600">Target languages (all)</label>
          <select
            multiple
            size={6}
            className="w-full border rounded px-2 py-1 bg-white"
            value={selectedTargets}
            onChange={(e) => {
              const next = Array.from(e.target.selectedOptions).map((o) => String(o.value));
              setTargetLangIds(next);
              if (!String(activeTargetLangId || '').trim()) setActiveTargetLangId(next[0] || '');
              else if (next.length && !next.includes(String(activeTargetLangId))) setActiveTargetLangId(next[0] || '');
            }}
            disabled={allLanguagesLoading || !String(profileId || '').trim()}
          >
            {(Array.isArray(allLanguages) ? allLanguages : []).map((l) => (
              <option key={String(l.id_lang)} value={String(l.id_lang)}>
                {l.iso_code ? `${l.iso_code} - ${l.name || ''} (ID ${l.id_lang})` : `${l.name || ''} (ID ${l.id_lang})`}
              </option>
            ))}
          </select>
          <div className="text-[11px] text-gray-400 mt-1">Tip: Ctrl/Shift-click to select multiple.</div>
          {!!languagesError && <div className="text-xs text-gray-500 mt-1">Source languages error: {languagesError}</div>}
          {allLanguagesLoading && <div className="text-xs text-gray-500 mt-1">Loading languages.</div>}
        </div>

        <div className="md:col-span-3">
          <label className="text-xs text-gray-600">Editor target language</label>
          <select
            className="w-full border rounded px-2 py-1 bg-white"
            value={activeTargetLangId}
            onChange={(e) => setActiveTargetLangId(e.target.value)}
            disabled={!selectedTargets.length}
          >
            {!selectedTargets.length ? (
              <option value="">Select target languages above.</option>
            ) : (
              selectedTargets.map((id) => {
                const l = (Array.isArray(allLanguages) ? allLanguages : []).find((x) => String(x?.id_lang) === String(id)) || null;
                const label = l
                  ? (l.iso_code ? `${l.iso_code} - ${l.name || ''} (ID ${l.id_lang})` : `${l.name || ''} (ID ${l.id_lang})`)
                  : `ID ${id}`;
                return (
                  <option key={String(id)} value={String(id)}>
                    {label}
                  </option>
                );
              })
            )}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button
          type="button"
          className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
          onClick={loadSource}
          disabled={sourceLoading || !canRender}
          title="Loads the source template from Postgres (mod_tools_email_template)."
        >
          {sourceLoading ? 'Loading.' : 'Load source'}
        </button>
        <button
          type="button"
          className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
          onClick={copySourceToTarget}
          disabled={!hasSource}
        >
          Copy source → target
        </button>
        <button
          type="button"
          className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
          onClick={translateSourceToTarget}
          disabled={!canTranslate || translateLoading}
          title="Uses /api/tools/email-template/translate (requires a selected prompt config + OpenAI credentials on that config or server settings)."
        >
          {translateLoading ? 'Translating.' : 'Translate (OpenAI)'}
        </button>
        <button
          type="button"
          className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
          onClick={translateAndSaveSelectedTargets}
          disabled={!canBatchTranslate || translateLoading}
          title="Batch: translates and saves templates for all selected target languages."
        >
          {translateLoading ? 'Translating.' : `Translate + save selected (${selectedTargets.length || 0})`}
        </button>
        <span className="flex-1" />
        <button
          type="button"
          className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
          onClick={loadTarget}
          disabled={targetLoading || !canSave}
          title="Loads the target template from Postgres into the editor."
        >
          {targetLoading ? 'Loading.' : 'Load target'}
        </button>
        <button
          type="button"
          className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
          onClick={saveTarget}
          disabled={targetLoading || !canSave}
          title="Upserts into Postgres mod_tools_email_template."
        >
          {targetLoading ? 'Saving.' : 'Save target'}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          className="flex-1 border rounded px-2 py-1"
          value={recipientEmail || ''}
          onChange={(e) => setRecipientEmail(e.target.value)}
          placeholder="Recipient email for Gmail draft"
        />
        <button
          type="button"
          className="text-xs px-3 py-1.5 rounded border bg-white hover:bg-gray-50"
          onClick={createDraft}
          disabled={!canCreateDraft || draftLoading}
          title="Creates a Gmail draft through the Google API module."
        >
          {draftLoading ? 'Creating Gmail draft…' : 'Create Gmail draft'}
        </button>
        <span className="text-[11px] text-gray-500">Requires configured Google API credentials.</span>
      </div>
      {draftMessage && <div className="text-[11px] text-green-700 mb-1">{draftMessage}</div>}
      {draftError && <div className="text-[11px] text-red-600 mb-1">{draftError}</div>}

      {errorMessage && <div className="text-xs text-red-600 mb-3">{errorMessage}</div>}
    </>
  );
}
