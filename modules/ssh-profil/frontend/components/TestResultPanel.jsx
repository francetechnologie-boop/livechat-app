import React from 'react';

function boolText(v) {
  if (v === true) return 'yes';
  if (v === false) return 'no';
  return 'n/a';
}

export default function TestResultPanel({ result }) {
  if (!result) return null;
  const ok = !!result.ok;
  const access = result.access || {};
  const info = result.info || {};
  const sudo = access.sudo || {};
  const flags = access.group_flags || {};
  const groups = access.groups || [];

  return (
    <div className="mt-4 border rounded p-3 text-sm">
      <div className="font-semibold mb-1">Last Test</div>
      {!ok ? (
        <div className="text-xs text-red-600">
          {String(result.message || result.error || 'test_failed')}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-xs text-gray-600">
            connected: {boolText(result.connected)} • duration: {Number(result.duration_ms || 0)}ms
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className="text-xs font-semibold mb-1">Access</div>
              <div className="text-xs text-gray-700">root: {boolText(access.is_root)}</div>
              <div className="text-xs text-gray-700">sudo (passwordless): {boolText(sudo.passwordless)}</div>
              <div className="text-xs text-gray-700">sudo (with password): {boolText(sudo.with_password)}</div>
              <div className="text-xs text-gray-700 mt-1">groups: {groups.length ? groups.join(', ') : '(none)'}</div>
              <div className="text-xs text-gray-700 mt-1">
                known groups:
                <span className="ml-2">admin={boolText(flags.admin)}</span>
                <span className="ml-2">adm={boolText(flags.adm)}</span>
                <span className="ml-2">users={boolText(flags.users)}</span>
                <span className="ml-2">francetechnologie={boolText(flags.francetechnologie)}</span>
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold mb-1">Information</div>
              <div className="text-xs text-gray-700">whoami: {info.whoami || 'n/a'}</div>
              <div className="text-xs text-gray-700">uid: {info.uid != null ? String(info.uid) : 'n/a'}</div>
              <div className="text-xs text-gray-700">hostname: {info.hostname || 'n/a'}</div>
              <div className="text-xs text-gray-700">os: {info?.os?.pretty_name || info?.os?.name || 'n/a'}</div>
              <div className="text-xs text-gray-700">shell: {info.shell || 'n/a'}</div>
              <div className="text-xs text-gray-700">home: {info.home || 'n/a'}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

