import { useCallback, useEffect, useRef, useState } from 'react';

function getApiErrorMessage(data, fallback) {
  const msg = data?.message || data?.error || '';
  return typeof msg === 'string' && msg.trim() ? msg.trim() : fallback;
}

export function useMySqlProfilesLanguagesAll({ headers = {}, limit = 200, prefix = 'ps_' } = {}) {
  const headersRef = useRef(headers);
  useEffect(() => {
    headersRef.current = headers && typeof headers === 'object' ? headers : {};
  }, [headers]);

  const [profileId, setProfileId] = useState('');
  const [profiles, setProfiles] = useState([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [profilesError, setProfilesError] = useState('');

  const [languages, setLanguages] = useState([]);
  const [languagesLoading, setLanguagesLoading] = useState(false);
  const [languagesError, setLanguagesError] = useState('');

  const loadProfiles = useCallback(async () => {
    setProfilesLoading(true);
    setProfilesError('');
    try {
      const resp = await fetch(`/api/db-mysql/profiles?limit=${encodeURIComponent(String(limit))}`, {
        credentials: 'include',
        headers: headersRef.current,
      });
      const data = await resp.json().catch(() => ({}));
      const ok = resp.ok && (data?.ok === undefined || data?.ok === true);
      if (!ok) {
        setProfiles([]);
        if (resp.status === 401 || resp.status === 403) setProfilesError('Admin required to list MySQL profiles.');
        else setProfilesError(getApiErrorMessage(data, 'Failed to load MySQL profiles.'));
        return;
      }

      const items = Array.isArray(data.items) ? data.items : [];
      setProfiles(items);
      if (items.length) {
        const preferred = items.find((p) => p && p.is_default) || items[0];
        const nextId = String(preferred?.id || items[0]?.id || '');
        if (nextId) setProfileId((prev) => (String(prev || '').trim() ? prev : nextId));
      }
    } catch (error) {
      setProfiles([]);
      setProfilesError(error?.message || 'Failed to load MySQL profiles.');
    } finally {
      setProfilesLoading(false);
    }
  }, [limit]);

  const loadLanguages = useCallback(
    async (pid) => {
      const profile = String(pid || '').trim();
      if (!profile) return;
      setLanguagesLoading(true);
      setLanguagesError('');
      try {
        const qs = new URLSearchParams({
          profile_id: profile,
          id_shop: '0',
          limit: String(limit),
          prefix: String(prefix || 'ps_'),
        });
        const resp = await fetch(`/api/product-search-index/mysql/languages?${qs.toString()}`, {
          credentials: 'include',
          headers: headersRef.current,
        });
        const data = await resp.json().catch(() => ({}));
        const ok = resp.ok && (data?.ok === undefined || data?.ok === true);
        if (!ok) {
          setLanguages([]);
          setLanguagesError(getApiErrorMessage(data, 'Failed to load languages.'));
          return;
        }
        const items = Array.isArray(data.items) ? data.items : [];
        setLanguages(items);
      } catch (error) {
        setLanguages([]);
        setLanguagesError(error?.message || 'Failed to load languages.');
      } finally {
        setLanguagesLoading(false);
      }
    },
    [limit, prefix]
  );

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    setLanguages([]);
    setLanguagesError('');
    if (String(profileId || '').trim()) loadLanguages(profileId);
  }, [loadLanguages, profileId]);

  return {
    profileId,
    setProfileId,
    profiles,
    profilesLoading,
    profilesError,
    languages,
    languagesLoading,
    languagesError,
    reloadProfiles: loadProfiles,
    reloadLanguages: () => loadLanguages(profileId),
  };
}

