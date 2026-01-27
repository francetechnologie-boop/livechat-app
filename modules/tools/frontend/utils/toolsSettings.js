import { useCallback, useEffect, useState } from 'react';
import { attachAdminHeaders } from './adminHeaders.js';

function buildOrgParams(orgId) {
  const cleaned = String(orgId ?? '').trim();
  const query = new URLSearchParams();
  const headers = {};
  if (cleaned) {
    query.set('org_id', cleaned);
    headers['X-Org-Id'] = cleaned;
  }
  return { query, headers };
}

function handleApiResponse(resp, data) {
  if (resp.ok) return data;
  const message = data?.message || data?.error || `HTTP ${resp.status}`;
  throw new Error(message);
}

export async function fetchMySqlProfileSetting({ orgId } = {}) {
  const { query, headers } = buildOrgParams(orgId);
  const url = `/api/tools/settings/mysql-profile${query.toString() ? `?${query.toString()}` : ''}`;
  const resp = await fetch(url, { credentials: 'include', headers: attachAdminHeaders(headers) });
  const data = await resp.json().catch(() => ({}));
  return handleApiResponse(resp, data);
}

export async function saveMySqlProfileSetting({ orgId, profileId } = {}) {
  const { query, headers } = buildOrgParams(orgId);
  const url = `/api/tools/settings/mysql-profile${query.toString() ? `?${query.toString()}` : ''}`;
  const resp = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: attachAdminHeaders({ 'Content-Type': 'application/json', ...headers }),
    body: JSON.stringify({ profile_id: profileId ?? null }),
  });
  const data = await resp.json().catch(() => ({}));
  return handleApiResponse(resp, data);
}

export async function fetchDevisLanguagePromptSetting({ orgId } = {}) {
  const { query, headers } = buildOrgParams(orgId);
  const url = `/api/tools/settings/devis-language-prompt${query.toString() ? `?${query.toString()}` : ''}`;
  const resp = await fetch(url, { credentials: 'include', headers: attachAdminHeaders(headers) });
  const data = await resp.json().catch(() => ({}));
  return handleApiResponse(resp, data);
}

export async function saveDevisLanguagePromptSetting({ orgId, promptConfigId } = {}) {
  const { query, headers } = buildOrgParams(orgId);
  const url = `/api/tools/settings/devis-language-prompt${query.toString() ? `?${query.toString()}` : ''}`;
  const resp = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: attachAdminHeaders({ 'Content-Type': 'application/json', ...headers }),
    body: JSON.stringify({ prompt_config_id: promptConfigId ?? null }),
  });
  const data = await resp.json().catch(() => ({}));
  return handleApiResponse(resp, data);
}

const EMPTY_SETTING = { profileId: null, orgId: null, updatedAt: null };

export function useMySqlProfileSetting({ orgId } = {}) {
  const [setting, setSetting] = useState(EMPTY_SETTING);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchMySqlProfileSetting({ orgId });
      setSetting({
        profileId: data?.profile_id ?? null,
        orgId: data?.org_id ?? null,
        updatedAt: data?.updated_at ?? null,
      });
    } catch (err) {
      setSetting(EMPTY_SETTING);
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  const save = useCallback(
    async (profileIdValue, targetOrgId) => {
      setLoading(true);
      setError('');
      try {
        const result = await saveMySqlProfileSetting({ orgId: targetOrgId ?? orgId, profileId: profileIdValue });
        const next = {
          profileId: result?.profile_id ?? null,
          orgId: result?.org_id ?? null,
          updatedAt: result?.updated_at ?? null,
        };
        setSetting(next);
        return next;
      } catch (err) {
        setError(String(err?.message || err));
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [orgId]
  );

  useEffect(() => {
    reload();
  }, [reload]);

  return { setting, loading, error, reload, save };
}

const EMPTY_PROMPT_SETTING = { promptConfigId: null, orgId: null, updatedAt: null };

export function useDevisLanguagePromptSetting({ orgId } = {}) {
  const [setting, setSetting] = useState(EMPTY_PROMPT_SETTING);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchDevisLanguagePromptSetting({ orgId });
      setSetting({
        promptConfigId: data?.prompt_config_id ?? null,
        orgId: data?.org_id ?? null,
        updatedAt: data?.updated_at ?? null,
      });
    } catch (err) {
      setSetting(EMPTY_PROMPT_SETTING);
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  const save = useCallback(
    async (promptConfigIdValue, targetOrgId) => {
      setLoading(true);
      setError('');
      try {
        const result = await saveDevisLanguagePromptSetting({
          orgId: targetOrgId ?? orgId,
          promptConfigId: promptConfigIdValue,
        });
        const next = {
          promptConfigId: result?.prompt_config_id ?? null,
          orgId: result?.org_id ?? null,
          updatedAt: result?.updated_at ?? null,
        };
        setSetting(next);
        return next;
      } catch (err) {
        setError(String(err?.message || err));
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [orgId]
  );

  useEffect(() => {
    reload();
  }, [reload]);

  return { setting, loading, error, reload, save };
}
