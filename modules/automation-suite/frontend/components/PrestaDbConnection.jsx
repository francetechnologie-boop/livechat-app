import { useEffect, useState } from 'react';

// Presta DB Connection (profiles + base config)
// Wires to backend endpoints under /api/admin/presta-db*
export default function PrestaDbConnection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const [profiles, setProfiles] = useState([]); // array of profile names
  const [activeProfile, setActiveProfile] = useState('');
  const [profileName, setProfileName] = useState('');

  // Connection + defaults
  const [host, setHost] = useState('');
  const [port, setPort] = useState(3306);
  const [database, setDatabase] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [tablePrefix, setTablePrefix] = useState('ps_');
  const [defaultShopId, setDefaultShopId] = useState('');
  const [defaultCategoryId, setDefaultCategoryId] = useState('');
  const [defaultLanguageId, setDefaultLanguageId] = useState('');
  const [shopIds, setShopIds] = useState(''); // comma-separated
  const [taxRulesGroupId, setTaxRulesGroupId] = useState('');
  const [defaultManufacturerId, setDefaultManufacturerId] = useState('');
  const [defaultSupplierId, setDefaultSupplierId] = useState('');
  const [active, setActive] = useState(true);
  const [visibility, setVisibility] = useState('both');
  const [showPassword, setShowPassword] = useState(false);

  const hydrateFromConfig = (cfg = {}) => {
    setHost(cfg.host ?? '');
    setPort(Number(cfg.port ?? 3306));
    setDatabase(cfg.database ?? '');
    setUser(cfg.user ?? '');
    setPassword(cfg.password ?? '');
    setTablePrefix(cfg.table_prefix ?? 'ps_');
    const firstShop = Array.isArray(cfg.default_shop_ids) && cfg.default_shop_ids.length ? String(cfg.default_shop_ids[0]) : String(cfg.default_shop_id || '');
    setDefaultShopId(firstShop);
    setDefaultCategoryId(String(cfg.default_category_id || ''));
    setDefaultLanguageId(String(cfg.default_lang_id ?? ''));
    setShopIds(Array.isArray(cfg.default_shop_ids) ? cfg.default_shop_ids.join(',') : String(cfg.default_shop_ids || cfg.default_shop_id || ''));
    setTaxRulesGroupId(String(cfg.default_tax_rules_group_id ?? ''));
    setDefaultManufacturerId(String(cfg.default_manufacturer_id ?? ''));
    setDefaultSupplierId(String(cfg.default_supplier_id ?? ''));
    setActive(Boolean(cfg.default_active ?? true));
    setVisibility(cfg.default_visibility ?? 'both');
  };

  const loadAll = async () => {
    setLoading(true); setError(''); setMsg('');
    try {
      let items = [];
      let act = '';
      try {
        const r = await fetch('/api/admin/presta-db/profiles', { credentials: 'include' });
        const j = await r.json().catch(() => null);
        if (r.ok && j && j.ok) {
          items = Array.isArray(j.items) ? j.items : [];
          act = j.active || '';
        }
      } catch {}
      setProfiles(items.map(p => p && p.name).filter(Boolean));
      setActiveProfile(act); setProfileName(act);
      let cfg = null;
      if (items.length) {
        const sel = items.find(p => p && p.name === act) || items[0];
        cfg = sel || null;
      }
      if (!cfg) {
        const br = await fetch('/api/admin/presta-db?reveal=1', { credentials: 'include' });
        const bj = await br.json().catch(() => null);
        if (br.ok && bj && bj.ok) cfg = bj.config || null;
      }
      hydrateFromConfig(cfg || {});
    } catch (e) {
      setError(String(e && e.message ? e.message : e));
    } finally { setLoading(false); }
  };

  useEffect(() => { loadAll(); }, []);

  const validate = () => {
    if (!host.trim()) return 'Host is required';
    if (!database.trim()) return 'Database is required';
    if (!user.trim()) return 'User is required';
    if (!String(port).match(/^\d+$/)) return 'Port must be a number';
    if (tablePrefix && !/^[A-Za-z0-9_]*$/.test(tablePrefix)) return 'Table prefix must be alphanumeric/_';
    return '';
  };

  const onSaveProfile = async () => {
    setSaving(true); setError(''); setMsg('');
    const err = validate(); if (err) { setSaving(false); setError(err); return; }
    const name = (profileName || activeProfile || 'default').trim() || 'default';
    try {
      const r = await fetch('/api/admin/presta-db/profile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({
          name,
          host: host.trim(), port: Number(port), database: database.trim(), user: user.trim(), password,
          table_prefix: tablePrefix || 'ps_',
          default_category_id: Number(defaultCategoryId || 0),
          default_lang_id: Number(defaultLanguageId || 1),
          default_shop_ids: (function(){ const arr = String(shopIds||'').split(',').map(s=>Number(s.trim())).filter(n=>!isNaN(n)&&n>0); const d = Number(defaultShopId||0); const out = d>0 ? [d, ...arr.filter(x=>x!==d)] : arr; return Array.from(new Set(out)); })(),
          default_shop_id: Number(defaultShopId||0),
          default_tax_rules_group_id: Number(taxRulesGroupId || 0),
          default_manufacturer_id: Number(defaultManufacturerId || 0),
          default_supplier_id: Number(defaultSupplierId || 0),
          default_active: !!active,
          default_visibility: String(visibility || 'both')
        })
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || (j && j.ok === false)) throw new Error((j && (j.message || j.error)) || 'save_failed');
      setMsg('Saved profile "' + name + '"');
      setActiveProfile(name); setProfileName(name);
      await fetch('/api/admin/presta-db/profile/select', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ name }) });
      await loadAll();
    } catch (e) { setError(String(e && e.message ? e.message : e)); }
    finally { setSaving(false); }
  };

  const onDeleteActive = async () => {
    if (!activeProfile) return;
    try {
      const r = await fetch('/api/admin/presta-db/profile/' + encodeURIComponent(activeProfile), { method: 'DELETE', credentials: 'include' });
      const j = await r.json().catch(() => null);
      if (!r.ok || (j && j.ok === false)) throw new Error((j && (j.message || j.error)) || 'delete_failed');
      setMsg('Deleted profile "' + activeProfile + '"');
      await loadAll();
    } catch (e) { setError(String(e && e.message ? e.message : e)); }
  };

  const onTest = async () => {
    setTesting(true); setError(''); setMsg('');
    const err = validate(); if (err) { setTesting(false); setError(err); return; }
    try {
      const r = await fetch('/api/admin/presta-db/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ host: host.trim(), port: Number(port), database: database.trim(), user: user.trim(), password, table_prefix: tablePrefix || 'ps_' })
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || (j && j.ok === false)) throw new Error((j && (j.message || j.error)) || 'test_failed');
      setMsg('Test OK');
    } catch (e) { setError(String(e && e.message ? e.message : e)); }
    finally { setTesting(false); }
  };

  const onValidate = async () => {
    setTesting(true); setError(''); setMsg('');
    const err = validate(); if (err) { setTesting(false); setError(err); return; }
    try {
      const payload = {
        host: host.trim(), port: Number(port), database: database.trim(), user: user.trim(), password,
        table_prefix: tablePrefix || 'ps_',
        default_category_id: Number(defaultCategoryId || 0),
        default_lang_id: Number(defaultLanguageId || 1),
        default_shop_ids: String(shopIds||'').split(',').map(s=>Number(s.trim())).filter(n=>!isNaN(n)&&n>0),
        default_tax_rules_group_id: Number(taxRulesGroupId || 0)
      };
      const r = await fetch('/api/admin/presta-db/validate', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(payload) });
      const j = await r.json();
      if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || 'validate_failed');
      const det = j.details || {};
      const shops = det.shops || {}; const cat = det.category || {}; const cats = det.category_shop || {}; const tax = det.tax_group || {};
      const msgParts = [];
      msgParts.push(`Shops: ${Array.isArray(shops.exists)? shops.exists.join(','): '-'}${Array.isArray(shops.missing) && shops.missing.length? ` (missing: ${shops.missing.join(',')})`:''}`);
      msgParts.push(`Category ${cat.id||'-'}: ${cat.exists? 'exists':'missing'}`);
      if (Array.isArray(cats.missing) && cats.missing.length) msgParts.push(`category_shop missing for shops: ${cats.missing.join(',')}`);
      msgParts.push(`Tax group ${tax.id||'-'}: ${tax.exists? 'exists':'missing'}`);
      setMsg(`Validation OK. ${msgParts.join(' · ')}`);
    } catch (e) { setError(String(e?.message||e)); }
    finally { setTesting(false); }
  };

  return (
    <div className="border rounded p-3 bg-white">
      <div className="text-sm font-medium mb-2">Presta DB Connection</div>
      {loading ? (
        <div className="text-xs text-gray-500">Loading…</div>
      ) : (
        <div className="space-y-2 text-sm">
          {error && <div className="text-xs text-red-600">{error}</div>}
          {msg && <div className="text-xs text-green-700">{msg}</div>}

          {/* Profiles toolbar */}
          <div className="text-xs flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-gray-600">Profiles</span>
              <select className="border rounded px-2 py-1" value={activeProfile} onChange={async (e) => {
                const name = e.target.value; setActiveProfile(name); setProfileName(name);
                try {
                  const r = await fetch('/api/admin/presta-db/profiles', { credentials: 'include' });
                  const j = await r.json().catch(() => null);
                  const items = (j && Array.isArray(j.items)) ? j.items : [];
                  const prof = items.find(p => p && p.name === name) || null; hydrateFromConfig(prof || {});
                } catch {}
              }}>
                <option value="">-- none --</option>
                {(profiles || []).map(n => (<option key={n} value={n}>{n}{activeProfile === n ? ' (active)' : ''}</option>))}
              </select>
              {!!activeProfile && <span className="text-green-700">Active</span>}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-600">Profile name</span>
              <input className="border rounded px-2 py-1" value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="my-shop" />
              <button className="px-2 py-1 rounded border" onClick={onSaveProfile} disabled={saving}>{saving ? 'Saving…' : 'Save as profile'}</button>
              {!!activeProfile && (
                <button className="px-2 py-1 rounded border" onClick={onDeleteActive}>Delete active</button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="flex flex-col">
              <span className="text-xs text-gray-600">Host</span>
              <input className="border rounded px-2 py-1" value={host} onChange={e => setHost(e.target.value)} placeholder="127.0.0.1" />
            </label>
            <label className="flex flex-col">
              <span className="text-xs text-gray-600">Port</span>
              <input className="border rounded px-2 py-1" value={port} onChange={e => setPort(e.target.value)} placeholder="3306" />
            </label>
            <label className="flex flex-col">
              <span className="text-xs text-gray-600">Database</span>
              <input className="border rounded px-2 py-1" value={database} onChange={e => setDatabase(e.target.value)} placeholder="prestashop" />
            </label>
            <label className="flex flex-col">
              <span className="text-xs text-gray-600">User</span>
              <input className="border rounded px-2 py-1" value={user} onChange={e => setUser(e.target.value)} placeholder="ps_user" />
            </label>
            <label className="flex flex-col">
              <span className="text-xs text-gray-600">Password</span>
              <input type={showPassword ? 'text' : 'password'} className="border rounded px-2 py-1" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••" />
              <label className="inline-flex items-center gap-2 mt-1 text-xs"><input type="checkbox" checked={showPassword} onChange={e => setShowPassword(e.target.checked)} /> Show password</label>
            </label>
            <label className="flex flex-col">
              <span className="text-xs text-gray-600">Table prefix</span>
              <input className="border rounded px-2 py-1" value={tablePrefix} onChange={e => setTablePrefix(e.target.value)} placeholder="ps_" />
            </label>
            <label className="flex flex-col">
              <span className="text-xs text-gray-600">Default Shop (id_shop)</span>
              <input className="border rounded px-2 py-1" value={defaultShopId} onChange={e=>setDefaultShopId(e.target.value)} placeholder="1" />
              <span className="text-[11px] text-gray-500 mt-1">Used as first shop when saving. Also provide Shop IDs (comma) to include additional shops.</span>
            </label>
            <label className="flex flex-col">
              <span className="text-xs text-gray-600">Default category ID</span>
              <input className="border rounded px-2 py-1" value={defaultCategoryId} onChange={e => setDefaultCategoryId(e.target.value)} placeholder="273" />
            </label>
            <label className="flex flex-col">
              <span className="text-xs text-gray-600">Default language ID</span>
              <input className="border rounded px-2 py-1" value={defaultLanguageId} onChange={e => setDefaultLanguageId(e.target.value)} placeholder="1" />
            </label>
            <label className="flex flex-col sm:col-span-2">
              <span className="text-xs text-gray-600">Shop IDs (comma)</span>
              <input className="border rounded px-2 py-1" value={shopIds} onChange={e => setShopIds(e.target.value)} placeholder="1,2,3" />
            </label>
            <label className="flex flex-col">
              <span className="text-xs text-gray-600">Tax rules group ID</span>
              <input className="border rounded px-2 py-1" value={taxRulesGroupId} onChange={e => setTaxRulesGroupId(e.target.value)} placeholder="26" />
            </label>
            <label className="flex flex-col">
              <span className="text-xs text-gray-600">Default manufacturer ID</span>
              <input className="border rounded px-2 py-1" value={defaultManufacturerId} onChange={e => setDefaultManufacturerId(e.target.value)} placeholder="0" />
            </label>
            <label className="flex flex-col">
              <span className="text-xs text-gray-600">Default supplier ID</span>
              <input className="border rounded px-2 py-1" value={defaultSupplierId} onChange={e => setDefaultSupplierId(e.target.value)} placeholder="0" />
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
              <span className="text-xs text-gray-700">Active</span>
            </label>
            <label className="flex items-center gap-2">
              <span className="text-xs text-gray-600">Visibility</span>
              <select className="border rounded px-2 py-1 text-sm" value={visibility} onChange={e => setVisibility(e.target.value)}>
                <option value="both">both</option>
                <option value="catalog">catalog</option>
                <option value="search">search</option>
                <option value="none">none</option>
              </select>
            </label>
          </div>

          <div className="pt-2 flex items-center gap-2">
            <button onClick={onSaveProfile} disabled={saving} className="px-3 py-1 rounded bg-indigo-600 text-white text-sm disabled:opacity-60">{saving ? 'Saving…' : 'Save as profile'}</button>
            {!!activeProfile && <button onClick={onDeleteActive} className="px-3 py-1 rounded border text-sm">Delete active</button>}
            <button onClick={onTest} disabled={testing} className="px-3 py-1 rounded border text-sm disabled:opacity-60">{testing ? 'Testing…' : 'Test connection'}</button>
            <button onClick={onValidate} disabled={testing} className="px-3 py-1 rounded border text-sm disabled:opacity-60">{testing ? 'Validating…' : 'Validate profile'}</button>
          </div>
        </div>
      )}
    </div>
  );
}








