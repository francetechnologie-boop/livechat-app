import React from 'react';

export default function ImageImportSettings({ ctx, imageSet, setImageSet, imgSaveStatus, setImgSaveStatus, mapType }) {
  const { activeDomain, setMapMsg } = ctx || {};
  const [ftpProfiles, setFtpProfiles] = React.useState([]);
  const [ftpMsg, setFtpMsg] = React.useState('');

  // Load FTP/SFTP profiles from ftp-connection module (if available)
  React.useEffect(() => {
    (async () => {
      try {
        setFtpMsg('');
        const r = await fetch('/api/ftp-connection/profiles', { credentials:'include' });
        const ct = r.headers?.get?.('content-type') || '';
        if (!ct.includes('application/json')) { setFtpProfiles([]); return; }
        const j = await r.json();
        if (r.ok && j?.ok && Array.isArray(j.items)) setFtpProfiles(j.items);
        else setFtpProfiles([]);
      } catch (e) { setFtpProfiles([]); setFtpMsg(String(e?.message||e)); }
    })();
  }, []);

  return (
    <div className="mt-2 p-2 border rounded">
      <div className="text-sm font-semibold mb-1">Image Import Settings</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
        <label className="flex items-center gap-2"><input type="checkbox" checked={!!imageSet?.download} onChange={e=>setImageSet(prev=>({ ...prev, download: !!e.target.checked }))} /> Download images</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={!!imageSet?.sync_images} onChange={e=>setImageSet(prev=>({ ...prev, sync_images: !!e.target.checked }))} /> Sync images (prune missing)</label>
        <label className="flex items-center gap-2">Cover strategy
          <select className="border rounded px-2 py-1" value={imageSet?.cover_strategy||'first'} onChange={e=>setImageSet(prev=>({ ...prev, cover_strategy: e.target.value }))}>
            <option value="first">first</option>
          </select>
        </label>
        <label className="flex items-center gap-2">Image root (img/p)
          <input className="border rounded px-2 py-1 flex-1" placeholder="/var/www/prestashop/img/p" value={imageSet?.img_root||''} onChange={e=>setImageSet(prev=>({ ...prev, img_root: e.target.value }))} />
        </label>
        <label className="flex items-center gap-2">bin/console
          <input className="border rounded px-2 py-1 flex-1" placeholder="/var/www/prestashop/bin/console" value={imageSet?.bin_console||''} onChange={e=>setImageSet(prev=>({ ...prev, bin_console: e.target.value }))} />
        </label>
        <label className="flex items-center gap-2">PHP binary
          <input className="border rounded px-2 py-1 w-28" placeholder="php" value={imageSet?.php_bin||'php'} onChange={e=>setImageSet(prev=>({ ...prev, php_bin: e.target.value }))} />
        </label>
        <label className="flex items-center gap-2">Image server (FTP/SFTP)
          <select className="border rounded px-2 py-1 flex-1" value={String(imageSet?.ftp_profile_id||'')} onChange={(e)=>setImageSet(prev => ({ ...prev, ftp_profile_id: (e.target.value? Number(e.target.value): null) }))}>
            <option value="">(none / local)</option>
            {(ftpProfiles||[]).map(p => (
              <option key={p.id} value={String(p.id)}>{p.name || (`#${p.id}`)}{p.host? ` @ ${p.host}`:''}{p.protocol? ` (${p.protocol})`:''}</option>
            ))}
          </select>
        </label>
        {/* Remote perms (optional) */}
        <label className="flex items-center gap-2"><input type="checkbox" checked={!!imageSet?.remote_set_perms} onChange={e=>setImageSet(prev=>({ ...prev, remote_set_perms: !!e.target.checked }))} /> Apply perms on remote</label>
        <label className="flex items-center gap-2">Owner (remote)
          <input className="border rounded px-2 py-1 flex-1" placeholder="e.g. www-data" value={imageSet?.remote_owner || ''} onChange={e=>setImageSet(prev=>({ ...prev, remote_owner: e.target.value }))} />
        </label>
        <label className="flex items-center gap-2">Group (remote)
          <input className="border rounded px-2 py-1 flex-1" placeholder="e.g. www-data" value={imageSet?.remote_group || ''} onChange={e=>setImageSet(prev=>({ ...prev, remote_group: e.target.value }))} />
        </label>
        <label className="flex items-center gap-2">File mode (remote)
          <input className="border rounded px-2 py-1 w-28" placeholder="0644" value={imageSet?.remote_file_mode || ''} onChange={e=>setImageSet(prev=>({ ...prev, remote_file_mode: e.target.value }))} />
        </label>
        <label className="flex items-center gap-2">Dir mode (remote)
          <input className="border rounded px-2 py-1 w-28" placeholder="0755" value={imageSet?.remote_dir_mode || ''} onChange={e=>setImageSet(prev=>({ ...prev, remote_dir_mode: e.target.value }))} />
        </label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={!!imageSet?.remote_recursive} onChange={e=>setImageSet(prev=>({ ...prev, remote_recursive: !!e.target.checked }))} /> Recursive chown</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={!!imageSet?.generate_thumbs} onChange={e=>setImageSet(prev=>({ ...prev, generate_thumbs: !!e.target.checked }))} /> Regenerate thumbnails</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={!!imageSet?.overwrite_existing} onChange={e=>setImageSet(prev=>({ ...prev, overwrite_existing: !!e.target.checked }))} /> Overwrite existing</label>
        <label className="flex items-center gap-2">Console timeout (ms)
          <input className="border rounded px-2 py-1 w-32" type="number" value={Number(imageSet?.console_timeout_ms||60000)} onChange={e=>setImageSet(prev=>({ ...prev, console_timeout_ms: Number(e.target.value||60000) }))} />
        </label>
      </div>
      {imageSet?.ftp_profile_id ? (
        <div className="mt-1 text-[11px] text-gray-600">
          Using remote image server profile #{imageSet.ftp_profile_id}. Files will be transferred via FTP/SFTP.
        </div>
      ) : null}
      <div className="mt-2 flex items-center gap-2 text-xs">
        <button className="px-2 py-1 border rounded bg-white" onClick={async ()=>{
          if (!activeDomain) { setMapMsg && setMapMsg('Select a domain first'); return; }
          setImgSaveStatus && setImgSaveStatus('saving');
          try {
            // Primary: dedicated endpoint to update mapping_tools.image_setting
            let ok = false, errMsg = '';
            try {
              const r = await fetch('/api/grabbing-sensorex/mapping/tools/image-setting', {
                method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
                body: JSON.stringify({ domain: activeDomain, page_type: (mapType||'product'), image_setting: imageSet })
              });
              const ctype = r.headers?.get?.('content-type') || '';
              if (ctype.includes('application/json')) {
                const j = await r.json();
                ok = !!(r.ok && (!j || j.ok !== false));
                if (!ok) errMsg = String((j && (j.message||j.error)) || `status_${r.status}`);
              } else {
                // Non-JSON response (proxy/HTML). Treat as error so we try fallback.
                errMsg = `non_json_${r.status||0}`;
              }
            } catch (e) { errMsg = String(e?.message||e); }
            // Fallback: update latest mapping_tools row with POST /mapping/tools (no bump)
            if (!ok) {
              try {
                const p = new URLSearchParams(); p.set('domain', activeDomain); p.set('page_type', String(mapType||'product'));
                // Ask for latest version to update
                let ver = 0;
                try {
                  const rv = await fetch(`/api/grabbing-sensorex/mapping/tools/versions-lite?${p.toString()}`, { credentials:'include' });
                  const ctv = rv.headers?.get?.('content-type') || '';
                  if (ctv.includes('application/json')) {
                    const jv = await rv.json();
                    const arr = (rv.ok && jv?.ok && Array.isArray(jv.items)) ? jv.items.map(x=>Number(x.version||0)).filter(n=>n>0) : [];
                    if (arr.length) ver = arr[0];
                  }
                } catch {}
                // Build config wrapper so backend derives image_setting column
                const body = { domain: activeDomain, page_type: (mapType||'product'), config: { tables: { image: { setting_image: imageSet || {} } } }, enabled: true };
                if (ver>0) body.version = ver;
                const ru = await fetch('/api/grabbing-sensorex/mapping/tools', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
                ok = ru.ok;
              } catch (e2) { errMsg = String(e2?.message||e2); }
            }
            if (!ok) throw new Error(errMsg||'save_failed');
            setImgSaveStatus && setImgSaveStatus('saved'); setTimeout(()=>setImgSaveStatus && setImgSaveStatus('idle'), 1200);
          } catch (e) { setImgSaveStatus && setImgSaveStatus('error'); setMapMsg && setMapMsg('Save failed: '+String(e?.message||e)); }
        }}>Save Image Settings</button>
        {imgSaveStatus==='saving' && <span className="text-xs text-gray-500">Saving…</span>}
        {imgSaveStatus==='saved' && <span className="text-xs text-green-600">Saved</span>}
        {imgSaveStatus==='error' && <span className="text-xs text-red-600">Save failed</span>}
      </div>
    </div>
  );
}
