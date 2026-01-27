import React, { useEffect, useMemo, useState } from 'react';

export default function CronManagementMain() {
  const [tasks, setTasks] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [logs, setLogs] = useState([]);
  const [grabbings, setGrabbings] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState({ name: '', module_id: '', task: 'packeta_download', schedule: 'hours', every_hours: 24, every_days: 1, at_time: '03:00', options: { use_grabbing: true, grabbing_id: '' } });
  const [edit, setEdit] = useState(null);
  const readJson = async (resp) => {
    const contentType = String(resp?.headers?.get?.('content-type') || '');
    const raw = await resp.text().catch(() => '');
    const trimmed = raw.trim();
    const looksLikeJson =
      contentType.includes('application/json') ||
      trimmed.startsWith('{') ||
      trimmed.startsWith('[');

    if (!trimmed) return null;
    if (!looksLikeJson) {
      const snippet = trimmed.replace(/\s+/g, ' ').slice(0, 300);
      throw new Error(`Non-JSON response (${resp.status}): ${snippet}`);
    }
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      const snippet = trimmed.replace(/\s+/g, ' ').slice(0, 300);
      throw new Error(`Invalid JSON (${resp.status}): ${snippet}`);
    }
  };

  const load = async () => {
    setBusy(true); setMsg('');
    try {
      // Keep DB action list in sync with the in-memory registry (modules register on startup).
      try {
        await fetch('/api/cron-management/actions/sync', {
          method: 'POST',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
      } catch {}

      const [r1,r2,r3,r4] = await Promise.all([
        fetch('/api/cron-management/tasks', { credentials:'include', headers: { Accept: 'application/json' } }),
        fetch('/api/cron-management/jobs', { credentials:'include', headers: { Accept: 'application/json' } }),
        // Legacy `/api/grabbings` is not always mounted; fetch Zásilkovna configs directly.
        fetch('/api/grabbing-zasilkovna/configs', { credentials:'include', headers: { Accept: 'application/json' } }),
        fetch('/api/cron-management/logs?limit=50', { credentials:'include', headers: { Accept: 'application/json' } }),
      ]);
      const [j1,j2,j3,j4] = await Promise.all([readJson(r1), readJson(r2), readJson(r3), readJson(r4)]);
      if (r1.ok && j1?.ok) setTasks(Array.isArray(j1.tasks)? j1.tasks: []);
      if (r2.ok && j2?.ok) setJobs(Array.isArray(j2.items)? j2.items: []);
      if (r3.ok && j3?.ok) setGrabbings(Array.isArray(j3.items)? j3.items: []);
      if (r4.ok && j4?.ok) setLogs(Array.isArray(j4.items)? j4.items: []);
    } catch (e) { setMsg(String(e?.message||e)); }
    finally { setBusy(false); }
  };
  useEffect(() => { load(); }, []);

  const moduleOptions = useMemo(() => {
    const set = new Set();
    for (const t of (tasks || [])) {
      const mid = String(t.module_id || '').trim();
      if (mid) set.add(mid);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [tasks]);

  const tasksForSelectedModule = useMemo(() => {
    const mid = String(form.module_id || '').trim();
    if (!mid) return tasks || [];
    return (tasks || []).filter((t) => String(t.module_id || '').trim() === mid);
  }, [tasks, form.module_id]);

  // Initialize module selection from tasks and keep task aligned when module changes.
  useEffect(() => {
    if (!moduleOptions.length) return;
    if (!String(form.module_id || '').trim()) {
      setForm((prev) => ({ ...prev, module_id: moduleOptions[0] }));
    }
  }, [moduleOptions, form.module_id]);

  useEffect(() => {
    if (!tasksForSelectedModule.length) return;
    const current = String(form.task || '').trim();
    const exists = tasksForSelectedModule.some((t) => String(t.id || '').trim() === current);
    if (!exists) {
      setForm((prev) => ({ ...prev, task: String(tasksForSelectedModule[0]?.id || '').trim() }));
    }
  }, [tasksForSelectedModule, form.task]);

  const taskMeta = useMemo(() => tasks.find(t => t.id === form.task) || null, [tasks, form.task]);

  const create = async () => {
    setBusy(true); setMsg('');
    try {
      const body = {
        name: form.name?.trim(),
        task: form.task,
        options: form.task === 'packeta_download'
          ? { use_grabbing: true, grabbing_id: form.options?.grabbing_id || '' }
          : form.options
      };
      if (form.task === 'packeta_download' && !body.options.grabbing_id) throw new Error('Select a Zásilkovna grabbing');
      if (form.schedule === 'hours') body.every_hours = Math.max(1, Number(form.every_hours||0));
      else { body.every_days = Math.max(1, Number(form.every_days||0)); body.at_time = form.at_time || '03:00'; }
      const r = await fetch('/api/cron-management/jobs', { method:'POST', headers:{'Content-Type':'application/json', Accept:'application/json'}, credentials:'include', body: JSON.stringify(body) });
      const j = await readJson(r);
      if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || 'create_failed');
      setForm(prev => ({ ...prev, name: '' }));
      await load();
    } catch (e) { setMsg(String(e?.message||e)); }
    finally { setBusy(false); }
  };

  const toggle = async (id, enabled) => {
    try { const r = await fetch(`/api/cron-management/jobs/${encodeURIComponent(id)}`, { method:'PATCH', headers:{'Content-Type':'application/json', Accept:'application/json'}, credentials:'include', body: JSON.stringify({ enabled }) }); const j = await readJson(r); if (r.ok && j?.ok) setJobs(prev => prev.map(x => x.id===id? j.item : x)); }
    catch {}
  };
  const remove = async (id) => {
    if (!confirm('Delete this job?')) return;
    try { await fetch(`/api/cron-management/jobs/${encodeURIComponent(id)}`, { method:'DELETE', credentials:'include' }); setJobs(prev => prev.filter(x => x.id!==id)); }
    catch {}
  };
  const runNow = async (id) => {
    try { const resp = await fetch(`/api/cron-management/jobs/${encodeURIComponent(id)}/run`, { method:'POST', credentials:'include', headers:{ Accept: 'application/json' } }); await readJson(resp); setMsg('Triggered. It may take a moment.'); }
    catch {}
  };

  const fmtDate = (s) => { if (!s) return '-'; try { return new Date(s).toLocaleString(); } catch { return String(s); } };
  const scheduleSummary = (j) => {
    if (j.every_hours) return `Every ${j.every_hours} hour(s)`;
    if (j.every_days) return `Every ${j.every_days} day(s) at ${j.at_time||'00:00'}`;
    return j.schedule || '-';
  };

  const isPacketa = (it) => {
    if (!it) return false;
    try { if (it.options && it.options.packeta) return true; } catch {}
    const t = String(it.name||it.title||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    return t.includes('zasil') || t.includes('packeta');
  };
  const packetaGrabs = useMemo(() => (grabbings||[]).filter(isPacketa), [grabbings]);

  const beginEdit = (j) => {
    const schedule = j.every_hours ? 'hours' : (j.every_days ? 'days' : 'hours');
    setEdit({
      id: j.id,
      name: j.name || '',
      task: j.task || j.action,
      schedule,
      every_hours: j.every_hours || 24,
      every_days: j.every_days || 1,
      at_time: j.at_time || '03:00',
      options: (j.options && typeof j.options === 'object') ? j.options : {},
    });
  };
  const cancelEdit = () => setEdit(null);
  const saveEdit = async () => {
    if (!edit) return;
    setBusy(true); setMsg('');
    try {
      const body = { name: edit.name, task: edit.task };
      if (edit.schedule === 'hours') {
        body.every_hours = Math.max(1, Number(edit.every_hours||1));
        body.every_days = null;
        body.at_time = null;
      } else {
        body.every_hours = null;
        body.every_days = Math.max(1, Number(edit.every_days||1));
        body.at_time = edit.at_time || '03:00';
      }
      if (edit.task === 'packeta_download') {
        const gid = String(edit.options?.grabbing_id || '').trim();
        body.options = { use_grabbing: true, grabbing_id: gid };
      } else if (edit.options && typeof edit.options === 'object') {
        body.options = edit.options;
      }
      const r = await fetch(`/api/cron-management/jobs/${encodeURIComponent(edit.id)}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
      const j = await readJson(r);
      if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || 'save_failed');
      setEdit(null);
      await load();
    } catch (e) { setMsg(String(e?.message||e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between p-4 border-b bg-white">
        <div className="font-semibold">Cron Management</div>
      </div>
      <div className="p-4 space-y-4 overflow-auto">
        {msg && <div className="text-xs text-amber-700">{msg}</div>}
	        <div className="border rounded p-3 bg-white max-w-3xl">
	          <div className="text-sm font-medium mb-2">Create job</div>
	          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
	            <div>
	              <div className="text-xs text-gray-600">Name</div>
	              <input className="w-full border rounded px-3 py-2" placeholder="Job name" value={form.name} onChange={(e)=>setForm({...form, name:e.target.value})} />
	            </div>
	            <div>
	              <div className="text-xs text-gray-600">Module</div>
	              <select
	                className="w-full border rounded px-3 py-2"
	                value={form.module_id}
	                onChange={(e)=>setForm({ ...form, module_id: e.target.value })}
	              >
	                {moduleOptions.map((m) => (<option key={m} value={m}>{m}</option>))}
	              </select>
	            </div>
	            <div>
	              <div className="text-xs text-gray-600">Task</div>
	              <select className="w-full border rounded px-3 py-2" value={form.task} onChange={(e)=>setForm({...form, task:e.target.value})}>
	                {tasksForSelectedModule.map(t => (<option key={t.id} value={t.id}>{t.name || t.id}</option>))}
	              </select>
	              {taskMeta?.description && <div className="text-[11px] text-gray-500 mt-1">{taskMeta.description}</div>}
	            </div>
            <div>
              <div className="text-xs text-gray-600">Schedule</div>
              <select className="w-full border rounded px-3 py-2" value={form.schedule} onChange={(e)=>setForm({...form, schedule:e.target.value})}>
                <option value="hours">Every X hours</option>
                <option value="days">Every X days at time</option>
              </select>
            </div>
            {form.task === 'packeta_download' && (
              <div className="md:col-span-2">
                <div className="text-xs text-gray-600">Zásilkovna config</div>
                <select
                  className="w-full border rounded px-3 py-2"
                  value={form.options?.grabbing_id || ''}
                  onChange={(e) => setForm({
                    ...form,
                    options: { ...(form.options || {}), grabbing_id: e.target.value },
                  })}
                >
                  <option value="">Select config…</option>
                  {packetaGrabs.map(g => (
                    <option key={g.id} value={g.id}>{g.name || g.title || g.id}</option>
                  ))}
                </select>
                {!packetaGrabs.length && <div className="text-xs text-gray-500 mt-1">No Zásilkovna grabbing available.</div>}
              </div>
            )}
            {form.schedule === 'hours' ? (
              <div>
                <div className="text-xs text-gray-600">Every (hours)</div>
                <input type="number" min={1} className="w-full border rounded px-3 py-2" value={form.every_hours} onChange={(e)=>setForm({...form, every_hours:e.target.value})} />
              </div>
            ) : (
              <>
                <div>
                  <div className="text-xs text-gray-600">Every (days)</div>
                  <input type="number" min={1} className="w-full border rounded px-3 py-2" value={form.every_days} onChange={(e)=>setForm({...form, every_days:e.target.value})} />
                </div>
                <div>
                  <div className="text-xs text-gray-600">At time (HH:mm)</div>
                  <input className="w-full border rounded px-3 py-2" value={form.at_time} onChange={(e)=>setForm({...form, at_time:e.target.value})} />
                </div>
              </>
            )}
            {form.task === 'packeta_download' && (
              <div className="md:col-span-2">
                <div className="text-xs text-gray-600">Zásilkovna Grabbing</div>
                <select className="border rounded px-2 py-1 w-full text-sm" value={form.options?.grabbing_id||''} onChange={(e)=>setForm({...form, options:{...form.options, grabbing_id:e.target.value}})}>
                  <option value="">Select grabbing…</option>
                  {packetaGrabs.map(g => (
                    <option key={g.id} value={g.id}>{g.name || g.title || g.id}</option>
                  ))}
                </select>
                {!packetaGrabs.length && <div className="text-xs text-gray-500 mt-1">No Zásilkovna grabbing found. Create one in Grabbing.</div>}
              </div>
            )}
          </div>
          <div className="mt-2">
            <button className="px-3 py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-700 text-sm" onClick={create} disabled={busy || !form.name.trim()}>Create job</button>
          </div>
        </div>
        <div className="border rounded p-3 bg-white max-w-5xl">
          <div className="text-sm font-medium mb-2">Jobs</div>
          <div className="text-xs text-gray-600 mb-1">{jobs.length} job(s)</div>
          <div className="space-y-1">
            {jobs.map(j => (
              <div key={j.id} className="border rounded">
                <div className="p-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{j.name} <span className="text-gray-500">({j.task||j.action})</span></div>
                    <div className="text-[11px] text-gray-600">{scheduleSummary(j)}</div>
                    <div className="text-[11px] text-gray-500">Last: {fmtDate(j.last_run)} • Next: {fmtDate(j.next_run)}</div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <label className="text-xs flex items-center gap-1">
                      <input type="checkbox" checked={!!j.enabled} onChange={(e)=>toggle(j.id, e.target.checked)} /> Enabled
                    </label>
                    <button className="text-xs px-2 py-1 rounded border" onClick={()=>beginEdit(j)}>Edit</button>
                    <button className="text-xs px-2 py-1 rounded border" onClick={()=>runNow(j.id)}>Run now</button>
                    <button className="text-xs px-2 py-1 rounded border" onClick={()=>remove(j.id)}>Delete</button>
                  </div>
                </div>
                {edit?.id === j.id && (
                  <div className="p-2 border-t bg-gray-50">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                      <div>
                        <div className="text-xs text-gray-600">Name</div>
                        <input className="border rounded px-2 py-1 w-full" value={edit.name} onChange={(e)=>setEdit({...edit, name:e.target.value})} />
                      </div>
                      <div>
                        <div className="text-xs text-gray-600">Schedule</div>
                        <select className="border rounded px-2 py-1 w-full" value={edit.schedule} onChange={(e)=>setEdit({...edit, schedule:e.target.value})}>
                          <option value="hours">Every X hours</option>
                          <option value="days">Every X days at time</option>
                        </select>
                      </div>
                      {edit.schedule === 'hours' ? (
                        <div>
                          <div className="text-xs text-gray-600">Every (hours)</div>
                          <input type="number" min={1} className="border rounded px-2 py-1 w-full" value={edit.every_hours} onChange={(e)=>setEdit({...edit, every_hours:e.target.value})} />
                        </div>
                      ) : (
                        <>
                          <div>
                            <div className="text-xs text-gray-600">Every (days)</div>
                            <input type="number" min={1} className="border rounded px-2 py-1 w-full" value={edit.every_days} onChange={(e)=>setEdit({...edit, every_days:e.target.value})} />
                          </div>
                          <div>
                            <div className="text-xs text-gray-600">At time (HH:mm)</div>
                            <input className="border rounded px-2 py-1 w-full" value={edit.at_time} onChange={(e)=>setEdit({...edit, at_time:e.target.value})} />
                          </div>
                        </>
                      )}
                      {j.task === 'packeta_download' && (
                        <div className="md:col-span-2">
                          <div className="text-xs text-gray-600">Zásilkovna Grabbing</div>
                          <select className="border rounded px-2 py-1 w-full text-sm" value={edit.options?.grabbing_id||''} onChange={(e)=>setEdit({...edit, options:{...edit.options, grabbing_id:e.target.value}})}>
                            <option value="">Select grabbing…</option>
                            {packetaGrabs.map(g => (
                              <option key={g.id} value={g.id}>{g.name || g.title || g.id}</option>
                            ))}
                          </select>
                          {!packetaGrabs.length && <div className="text-xs text-gray-500 mt-1">No Zásilkovna grabbing found. Create one in Grabbing.</div>}
                        </div>
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <button className="px-3 py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-700 text-sm" onClick={saveEdit} disabled={busy}>Save</button>
                      <button className="px-3 py-1.5 rounded border text-sm" onClick={cancelEdit} disabled={busy}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {!jobs.length && <div className="text-xs text-gray-500">No jobs yet.</div>}
          </div>
        </div>

        <div className="border rounded p-3 bg-white max-w-5xl">
          <div className="text-sm font-medium mb-2">Recent logs</div>
          <div className="overflow-auto max-h-64">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="px-2 py-1">When</th>
                  <th className="px-2 py-1">Job</th>
                  <th className="px-2 py-1">Status</th>
                  <th className="px-2 py-1">Message</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(l => (
                  <tr key={l.id} className="border-t">
                    <td className="px-2 py-1 whitespace-nowrap">{fmtDate(l.ran_at)}</td>
                    <td className="px-2 py-1">{l.job_id}</td>
                    <td className="px-2 py-1">{l.status}</td>
                    <td className="px-2 py-1">{l.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

export const Main = CronManagementMain;
