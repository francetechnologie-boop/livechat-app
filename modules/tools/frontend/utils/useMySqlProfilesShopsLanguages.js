import { useCallback, useEffect, useRef, useState } from 'react';
import { attachAdminHeaders } from './adminHeaders.js';

function getApiErrorMessage(data, fallback) {
  const msg = data?.message || data?.error || '';
  return typeof msg === 'string' && msg.trim() ? msg.trim() : fallback;
}

export function useMySqlProfilesShopsLanguages({ headers = {} } = {}) {
  const headersRef = useRef(headers);
  useEffect(() => {
    headersRef.current = headers && typeof headers === 'object' ? headers : {};
  }, [headers]);

  const [profileId, setProfileId] = useState('');
  const [profiles, setProfiles] = useState([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [profilesError, setProfilesError] = useState('');

  const [idShop, setIdShop] = useState('');
  const [shops, setShops] = useState([]);
  const [shopsLoading, setShopsLoading] = useState(false);
  const [shopsError, setShopsError] = useState('');

  const [languages, setLanguages] = useState([]);
  const [languagesLoading, setLanguagesLoading] = useState(false);
  const [languagesError, setLanguagesError] = useState('');

  const loadProfiles = useCallback(async () => {
    setProfilesLoading(true);
    setProfilesError('');
    try {
      const resp = await fetch('/api/db-mysql/profiles?limit=200', {
        credentials: 'include',
        headers: attachAdminHeaders(headersRef.current),
      });
      const data = await resp.json().catch(() => ({}));
      const ok = resp.ok && (data?.ok === undefined || data?.ok === true);
      if (ok) {
        const items = Array.isArray(data.items) ? data.items : [];
        setProfiles(items);
        if (items.length) {
          const preferred = items.find((p) => p && p.is_default) || items[0];
          const nextId = String(preferred?.id || items[0]?.id || '');
          if (nextId) setProfileId((prev) => (String(prev || '').trim() ? prev : nextId));
        }
      } else {
        setProfiles([]);
        if (resp.status === 401 || resp.status === 403) setProfilesError('Admin required to list MySQL profiles.');
        else setProfilesError(getApiErrorMessage(data, 'Failed to load MySQL profiles.'));
      }
    } catch (error) {
      setProfiles([]);
      setProfilesError(error?.message || 'Failed to load MySQL profiles.');
    } finally {
      setProfilesLoading(false);
    }
  }, []);

  const loadShops = useCallback(async (pId) => {
    const pid = String(pId || '').trim();
    if (!pid) return;
    setShopsLoading(true);
    setShopsError('');
    try {
      const params = new URLSearchParams({ profile_id: pid, limit: '200' });
      const resp = await fetch(`/api/product-search-index/mysql/shops?${params.toString()}`, {
        credentials: 'include',
        headers: attachAdminHeaders(headersRef.current),
      });
      const data = await resp.json().catch(() => ({}));
      const ok = resp.ok && (data?.ok === undefined || data?.ok === true);
      if (ok) {
        const items = Array.isArray(data.items) ? data.items : [];
        setShops(items);
        if (items.length) {
          const nextId = String(items[0]?.id_shop ?? '');
          if (nextId) setIdShop((prev) => (String(prev || '').trim() ? prev : nextId));
        }
      } else {
        setShops([]);
        setShopsError(getApiErrorMessage(data, 'Failed to load shops.'));
      }
    } catch (error) {
      setShops([]);
      setShopsError(error?.message || 'Failed to load shops.');
    } finally {
      setShopsLoading(false);
    }
  }, []);

  const loadLanguages = useCallback(async (pId, sId) => {
    const pid = String(pId || '').trim();
    const sid = String(sId || '').trim();
    if (!pid || !sid) return;
    setLanguagesLoading(true);
    setLanguagesError('');
    try {
      const params = new URLSearchParams({ profile_id: pid, id_shop: sid, limit: '200' });
      const resp = await fetch(`/api/product-search-index/mysql/languages?${params.toString()}`, {
        credentials: 'include',
        headers: attachAdminHeaders(headersRef.current),
      });
      const data = await resp.json().catch(() => ({}));
      const ok = resp.ok && (data?.ok === undefined || data?.ok === true);
      if (ok) {
        const items = Array.isArray(data.items) ? data.items : [];
        setLanguages(items);
      } else {
        setLanguages([]);
        setLanguagesError(getApiErrorMessage(data, 'Failed to load languages.'));
        if (sid !== '0') {
          const fallback = new URLSearchParams({ profile_id: pid, id_shop: '0', limit: '200' });
          const fallbackResp = await fetch(`/api/product-search-index/mysql/languages?${fallback.toString()}`, {
            credentials: 'include',
            headers: headersRef.current,
          });
          const fallbackData = await fallbackResp.json().catch(() => ({}));
          const fallbackOk = fallbackResp.ok && (fallbackData?.ok === undefined || fallbackData?.ok === true);
          if (fallbackOk) {
            const fallbackItems = Array.isArray(fallbackData.items) ? fallbackData.items : [];
            setLanguages(fallbackItems);
            if (!fallbackItems.length) {
              setLanguagesError('Failed to load languages for this shop (fallback returned empty).');
            } else {
              setLanguagesError('');
            }
            return;
          }
        }
      }
    } catch (error) {
      setLanguages([]);
      setLanguagesError(error?.message || 'Failed to load languages.');
    } finally {
      setLanguagesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    setShops([]);
    setLanguages([]);
    setIdShop('');
    if (String(profileId || '').trim()) loadShops(profileId);
  }, [loadShops, profileId]);

  useEffect(() => {
    setLanguages([]);
    if (String(profileId || '').trim() && String(idShop || '').trim()) loadLanguages(profileId, idShop);
  }, [idShop, loadLanguages, profileId]);

  return {
    profileId,
    setProfileId,
    profiles,
    profilesLoading,
    profilesError,
    idShop,
    setIdShop,
    shops,
    shopsLoading,
    shopsError,
    languages,
    languagesLoading,
    languagesError,
    reloadProfiles: loadProfiles,
    reloadShops: useCallback(() => {
      if (String(profileId || '').trim()) loadShops(profileId);
    }, [loadShops, profileId]),
    reloadLanguages: useCallback(() => {
      if (String(profileId || '').trim() && String(idShop || '').trim()) {
        loadLanguages(profileId, idShop);
      }
    }, [loadLanguages, profileId, idShop]),
  };
}
