import React from 'react';
import ProfileSelector from '../components/ProfileSelector.jsx';
import FillMissingPanel from '../components/FillMissingPanel.jsx';
import TranslatorPanel from '../components/TranslatorPanel.jsx';
import DescriptionMakerPanel from '../components/DescriptionMakerPanel.jsx';
import ImageMakerPanel from '../components/ImageMakerPanel.jsx';

export default function CategoryDataUpdateMain() {
  const [profileId, setProfileId] = React.useState(null);
  const [prefix, setPrefix] = React.useState('ps_');
  const [orgId, setOrgId] = React.useState('');
  const [view, setView] = React.useState('fill');

  React.useEffect(() => {
    const onHash = () => {
      try {
        const h = String(window.location.hash || '').toLowerCase();
        const m = h.match(/\/category_data_update\/(fill|translate|maker|image)/);
        if (m && m[1]) setView(m[1]);
      } catch {}
    };
    window.addEventListener('hashchange', onHash);
    onHash();
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  function setHashView(v) {
    try {
      const next = `#/category_data_update/${v}`;
      if (String(window.location.hash||'') !== next) window.location.hash = next;
    } finally { setView(v); }
  }

  return (
    <div className="h-full w-full flex flex-col min-h-0">
      <ProfileSelector value={{ profileId, prefix, orgId }} onChange={({ profileId:pid, prefix:px, orgId:oid }) => { setProfileId(pid ?? null); setPrefix(px ?? ''); setOrgId(oid ?? ''); }} />

      <div className="px-4 pt-3">
        <div className="inline-flex items-center gap-1 border rounded overflow-hidden bg-white">
          <button className={"px-3 py-1.5 text-sm border-r " + (view==='fill'? 'bg-indigo-600 text-white':'bg-white hover:bg-gray-50')} onClick={()=>setHashView('fill')}>Category – Fill Missing</button>
          <button className={"px-3 py-1.5 text-sm "+ (view==='translate'? 'bg-indigo-600 text-white':'bg-white hover:bg-gray-50')} onClick={()=>setHashView('translate')}>Category – Translator</button>
          <button className={"px-3 py-1.5 text-sm "+ (view==='maker'? 'bg-indigo-600 text-white':'bg-white hover:bg-gray-50')} onClick={()=>setHashView('maker')}>Category – Description Maker</button>
          <button className={"px-3 py-1.5 text-sm "+ (view==='image'? 'bg-indigo-600 text-white':'bg-white hover:bg-gray-50')} onClick={()=>setHashView('image')}>Category – Image Maker</button>
        </div>
      </div>

      <div className="p-4 flex flex-col gap-6">
        {view==='fill' && (
          <FillMissingPanel
            profileId={profileId}
            prefix={prefix}
            orgId={orgId}
            onApplyProfile={(pid, px) => { if (pid !== undefined) setProfileId(pid); if (px !== undefined) setPrefix(px); }}
          />
        )}
        {view==='translate' && (
          <TranslatorPanel
            profileId={profileId}
            prefix={prefix}
            orgId={orgId}
            onApplyProfile={(pid, px) => { if (pid !== undefined) setProfileId(pid); if (px !== undefined) setPrefix(px); }}
          />)
        }
        {view==='maker' && (
          <DescriptionMakerPanel
            profileId={profileId}
            prefix={prefix}
            orgId={orgId}
            onApplyProfile={(pid, px) => { if (pid !== undefined) setProfileId(pid); if (px !== undefined) setPrefix(px); }}
          />
        )}
        {view==='image' && (
          <ImageMakerPanel
            orgId={orgId}
            profileId={profileId}
            prefix={prefix}
          />
        )}
      </div>
    </div>
  );
}
