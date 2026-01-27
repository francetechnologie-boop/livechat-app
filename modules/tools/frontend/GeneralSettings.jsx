import React, { useCallback, useEffect, useState } from 'react';
import { useDevisLanguagePromptSetting, useMySqlProfileSetting } from './utils/toolsSettings.js';

function formatTimestamp(value) {
  if (!value) return 'Jamais sauvegardé';
  try {
    return new Date(value).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return String(value);
  }
}

function normalizeOrgId(value) {
  const str = String(value || '').trim();
  return str;
}

export default function GeneralSettings() {
  const [orgId, setOrgId] = useState('');
  const normalizedOrgId = normalizeOrgId(orgId);
  const [profiles, setProfiles] = useState([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [profilesError, setProfilesError] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [saveLoading, setSaveLoading] = useState(false);
  const [promptConfigs, setPromptConfigs] = useState([]);
  const [promptConfigsLoading, setPromptConfigsLoading] = useState(false);
  const [promptConfigsError, setPromptConfigsError] = useState('');
  const [selectedLangPromptConfigId, setSelectedLangPromptConfigId] = useState('');
  const [langPromptStatusMessage, setLangPromptStatusMessage] = useState('');
  const [langPromptSaveLoading, setLangPromptSaveLoading] = useState(false);

  const { setting, loading: settingLoading, error: settingError, reload: reloadSetting, save: saveSetting } =
    useMySqlProfileSetting({ orgId: normalizedOrgId });

  const {
    setting: langPromptSetting,
    loading: langPromptSettingLoading,
    error: langPromptSettingError,
    reload: reloadLangPromptSetting,
    save: saveLangPromptSetting,
  } = useDevisLanguagePromptSetting({ orgId: normalizedOrgId });

  useEffect(() => {
    setSelectedProfileId(setting.profileId ? String(setting.profileId) : '');
  }, [setting.profileId]);

  useEffect(() => {
    setSelectedLangPromptConfigId(langPromptSetting.promptConfigId ? String(langPromptSetting.promptConfigId) : '');
  }, [langPromptSetting.promptConfigId]);

  const loadProfiles = useCallback(async () => {
    setProfilesLoading(true);
    setProfilesError('');
    try {
      const resp = await fetch('/api/db-mysql/profiles?limit=200', { credentials: 'include' });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data?.ok === false) {
        throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
      }
      setProfiles(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      setProfiles([]);
      setProfilesError(String(error?.message || error));
    } finally {
      setProfilesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  const loadPromptConfigs = useCallback(async () => {
    setPromptConfigsLoading(true);
    setPromptConfigsError('');
    try {
      const params = new URLSearchParams();
      params.set('limit', '200');
      if (normalizedOrgId) params.set('org_id', normalizedOrgId);
      const resp = await fetch(`/api/automation-suite/prompt-configs?${params.toString()}`, { credentials: 'include' });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data?.ok === false) {
        throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
      }
      setPromptConfigs(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      setPromptConfigs([]);
      setPromptConfigsError(String(error?.message || error));
    } finally {
      setPromptConfigsLoading(false);
    }
  }, [normalizedOrgId]);

  useEffect(() => {
    loadPromptConfigs();
  }, [loadPromptConfigs]);

  const handleSave = async () => {
    setSaveLoading(true);
    setStatusMessage('');
    try {
      const result = await saveSetting(
        selectedProfileId ? String(selectedProfileId) : null,
        normalizedOrgId || undefined
      );
      setStatusMessage(
        result.profileId
          ? `Profil #${result.profileId} sauvegardé ${result.orgId ? `pour org ${result.orgId}` : 'globalement'}`
          : 'Association supprimée.'
      );
      reloadSetting();
    } catch (error) {
      setStatusMessage(String(error?.message || error));
    } finally {
      setSaveLoading(false);
    }
  };

  const handleClear = async () => {
    if (saveLoading) return;
    setSelectedProfileId('');
    await handleSave();
  };

  const statusText = settingLoading
    ? 'Chargement du paramètre…'
    : settingError
    ? `Erreur : ${settingError}`
    : `Dernier profil sauvegardé : ${setting.profileId || 'aucun'} (${formatTimestamp(setting.updatedAt)})`;

  const langPromptStatusText = langPromptSettingLoading
    ? 'Chargement du paramètre…'
    : langPromptSettingError
    ? `Erreur : ${langPromptSettingError}`
    : `Dernier prompt sauvegardé : ${langPromptSetting.promptConfigId || 'aucun'} (${formatTimestamp(langPromptSetting.updatedAt)})`;

  const handleLangPromptSave = async () => {
    setLangPromptSaveLoading(true);
    setLangPromptStatusMessage('');
    try {
      const result = await saveLangPromptSetting(
        selectedLangPromptConfigId ? String(selectedLangPromptConfigId) : null,
        normalizedOrgId || undefined
      );
      setLangPromptStatusMessage(
        result.promptConfigId
          ? `Prompt ${result.promptConfigId} sauvegardé ${result.orgId ? `pour org ${result.orgId}` : 'globalement'}`
          : 'Association supprimée.'
      );
      reloadLangPromptSetting();
    } catch (error) {
      setLangPromptStatusMessage(String(error?.message || error));
    } finally {
      setLangPromptSaveLoading(false);
    }
  };

  const handleLangPromptClear = async () => {
    if (langPromptSaveLoading) return;
    setSelectedLangPromptConfigId('');
    await handleLangPromptSave();
  };

  return (
    <div className="p-3">
      <div className="panel">
        <div className="panel__header flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">General settings</div>
            <p className="text-xs text-gray-500">
              Persist the preferred MySQL profile so every section can start from the same connection.
            </p>
          </div>
          <div className="text-[11px] text-gray-400">{statusText}</div>
        </div>
        <div className="panel__body space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-[11px] uppercase tracking-wide text-gray-500">
              Org ID (optionnel)
              <input
                className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-sm"
                placeholder="Laisser vide pour le global"
                value={orgId}
                onChange={(event) => setOrgId(event.target.value)}
              />
            </label>
            <label className="text-[11px] uppercase tracking-wide text-gray-500">
              Profil MySQL préféré
              <select
                className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-sm"
                value={selectedProfileId}
                onChange={(event) => setSelectedProfileId(event.target.value)}
                disabled={profilesLoading}
              >
                <option value="">{profilesLoading ? 'Chargement…' : 'Sélectionnez un profil'}</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={String(profile.id)}>
                    {profile.name ? `${profile.name} (#${profile.id})` : `Profil #${profile.id}`}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <button
              type="button"
              className="px-3 py-1 rounded border bg-blue-600 text-white text-[11px] font-semibold uppercase tracking-wide disabled:opacity-60"
              onClick={handleSave}
              disabled={saveLoading || profilesLoading}
            >
              {saveLoading ? 'Sauvegarde…' : 'Sauvegarder'}
            </button>
            <button
              type="button"
              className="px-3 py-1 rounded border bg-white text-gray-700 text-[11px] hover:bg-gray-50 disabled:opacity-60"
              onClick={handleClear}
              disabled={saveLoading}
            >
              Effacer
            </button>
            <button
              type="button"
              className="px-3 py-1 rounded border bg-white text-gray-700 text-[11px] hover:bg-gray-50 disabled:opacity-60"
              onClick={loadProfiles}
              disabled={profilesLoading}
            >
              {profilesLoading ? 'Chargement…' : 'Rafraîchir la liste'}
            </button>
            {profilesError && <div className="text-red-600">{profilesError}</div>}
            {statusMessage && <div className="text-green-700">{statusMessage}</div>}
          </div>
        </div>
      </div>

      <div className="panel mt-3">
        <div className="panel__header flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">Devis · Détection langue</div>
            <p className="text-xs text-gray-500">
              Select an Automation Suite prompt config to detect the customer language when using “Pré-remplir devis”.
            </p>
          </div>
          <div className="text-[11px] text-gray-400">{langPromptStatusText}</div>
        </div>
        <div className="panel__body space-y-4">
          <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
            <div className="font-semibold mb-1">Prompt contract (language detection)</div>
            <div>Le prompt doit répondre uniquement en JSON valide, par exemple :</div>
            <pre className="mt-2 whitespace-pre-wrap rounded bg-white/70 border border-amber-200 px-2 py-2 text-[11px] leading-snug">{`{ "iso_code": "fr" }`}</pre>
            <div className="mt-2">
              Règles: `iso_code` = 2 lettres minuscules (`fr`, `en`, `cs`, `de`, `es`, `it`, `nl`). Mettre `\"\"` si inconnu.
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-[11px] uppercase tracking-wide text-gray-500">
              Prompt config (automation-suite)
              <select
                className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-sm"
                value={selectedLangPromptConfigId}
                onChange={(event) => setSelectedLangPromptConfigId(event.target.value)}
                disabled={promptConfigsLoading}
              >
                <option value="">{promptConfigsLoading ? 'Chargement…' : 'Sélectionnez une config'}</option>
                {promptConfigs.map((item) => (
                  <option key={item.id} value={String(item.id)}>
                    {item.name ? `${item.name} (${item.id})` : item.id}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <button
              type="button"
              className="px-3 py-1 rounded border bg-blue-600 text-white text-[11px] font-semibold uppercase tracking-wide disabled:opacity-60"
              onClick={handleLangPromptSave}
              disabled={langPromptSaveLoading || promptConfigsLoading}
            >
              {langPromptSaveLoading ? 'Sauvegarde…' : 'Sauvegarder'}
            </button>
            <button
              type="button"
              className="px-3 py-1 rounded border bg-white text-gray-700 text-[11px] hover:bg-gray-50 disabled:opacity-60"
              onClick={handleLangPromptClear}
              disabled={langPromptSaveLoading}
            >
              Effacer
            </button>
            <button
              type="button"
              className="px-3 py-1 rounded border bg-white text-gray-700 text-[11px] hover:bg-gray-50 disabled:opacity-60"
              onClick={loadPromptConfigs}
              disabled={promptConfigsLoading}
            >
              {promptConfigsLoading ? 'Chargement…' : 'Rafraîchir la liste'}
            </button>
            {promptConfigsError && <div className="text-red-600">{promptConfigsError}</div>}
            {langPromptSettingError && <div className="text-red-600">{langPromptSettingError}</div>}
            {langPromptStatusMessage && <div className="text-green-700">{langPromptStatusMessage}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
