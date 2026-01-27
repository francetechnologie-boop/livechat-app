import React from 'react';

function normalizeSmsTo00(row) {
  try {
    const candidate = String(row?.mobile_e164 || row?.phone_e164 || row?.mobile || row?.phone || '').trim();
    const callPrefix = String(row?.call_prefix || '').trim().replace(/\D/g, '');
    if (!candidate) return '';
    if (candidate.startsWith('00')) return candidate.replace(/[^\d]/g, '');
    if (candidate.startsWith('+')) return `00${candidate.slice(1).replace(/[^\d]/g, '')}`;
    const digits = candidate.replace(/[^\d]/g, '');
    if (!digits) return '';
    if (!callPrefix) return digits;
    const national = digits.replace(/^0+/, '');
    return `00${callPrefix}${national}`;
  } catch {
    return '';
  }
}

export default function EmailRelanceNumeroMaisonPanel({
  loading,
  rows,
  rowBusy,
  rowMsg,
  rowSmsDraft,
  rowEmailGenerated,
  gatewayLines,
  shopSubscriptionMap,
  defaultSubscriptionId,
  onGenerateSms,
  onGenerateEmail,
  onOpenSmsModal,
  onOpenEmailModal,
}) {
  const list = Array.isArray(rows) ? rows : [];
  const lines = Array.isArray(gatewayLines) ? gatewayLines : [];
  const map = (shopSubscriptionMap && typeof shopSubscriptionMap === 'object' && !Array.isArray(shopSubscriptionMap)) ? shopSubscriptionMap : {};
  const defaultSub = defaultSubscriptionId == null ? null : Number(defaultSubscriptionId);
  const emailById = (rowEmailGenerated && typeof rowEmailGenerated === 'object' && !Array.isArray(rowEmailGenerated)) ? rowEmailGenerated : {};

  return (
    <div className="space-y-3">
      <div className="text-xs text-gray-500">
        “Générer SMS” / “Générer email” utilisent le prompt configuré dans “Paramètres”. L’envoi SMS passe par la ligne Gateway liée au shop (Shop → Subscription), sinon la ligne par défaut.
      </div>

      <div className="border rounded max-h-[70vh] overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-[11px] uppercase text-gray-600">
            <tr>
              <th className="sticky top-0 z-10 bg-gray-50 px-2 py-2 text-left">Order</th>
              <th className="sticky top-0 z-10 bg-gray-50 px-2 py-2 text-left">Shop</th>
              <th className="sticky top-0 z-10 bg-gray-50 px-2 py-2 text-left">Langue</th>
              <th className="sticky top-0 z-10 bg-gray-50 px-2 py-2 text-left">Client</th>
              <th className="sticky top-0 z-10 bg-gray-50 px-2 py-2 text-left">Email</th>
              <th className="sticky top-0 z-10 bg-gray-50 px-2 py-2 text-left">Country</th>
              <th className="sticky top-0 z-10 bg-gray-50 px-2 py-2 text-left">Phone</th>
              <th className="sticky top-0 z-10 bg-gray-50 px-2 py-2 text-left">Phone (+code)</th>
              <th className="sticky top-0 z-10 bg-gray-50 px-2 py-2 text-left">Subscription</th>
              <th className="sticky top-0 z-10 bg-gray-50 px-2 py-2 text-left">SMS</th>
              <th className="sticky top-0 z-10 bg-gray-50 px-2 py-2 text-left" />
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={11} className="px-3 py-3 text-center text-xs text-gray-500">
                  {loading ? 'Chargement…' : 'Aucun élément.'}
                </td>
              </tr>
            )}
            {list.map((r) => {
              const id = r?.id_order;
              const busy = !!rowBusy?.[String(id)];
              const msg = (rowMsg && rowMsg[String(id)]) || '';
              const smsText = (rowSmsDraft && rowSmsDraft[String(id)]) || '';
              const email = emailById[String(id)] || null;
              const hasEmail = !!(email && String(email.subject || '').trim() && String(email.html || '').trim());
              const idShop = r?.id_shop != null ? Number(r.id_shop) : null;
              const subFromMapRaw = (idShop != null && map[String(idShop)] != null) ? map[String(idShop)] : null;
              const subFromMap = subFromMapRaw == null ? null : Number(subFromMapRaw);
              const chosenSub = (Number.isFinite(subFromMap) && subFromMap > 0) ? subFromMap : (Number.isFinite(defaultSub) && defaultSub > 0 ? defaultSub : null);
              const line = chosenSub != null ? lines.find((li) => Number(li?.subscription_id) === Number(chosenSub)) : null;
              const subSrc = (Number.isFinite(subFromMap) && subFromMap > 0) ? 'shop' : (chosenSub != null ? 'default' : '');
              return (
                <React.Fragment key={String(id)}>
                  <tr className="border-t align-top">
                    <td className="px-2 py-2 text-xs">
                    <div className="font-semibold">{r.id_order}</div>
                    <div className="text-gray-500">{r.reference || ''}</div>
                    </td>
                    <td className="px-2 py-2 text-xs">
                    <div>{r.shop_domain_no_www || ''}</div>
                    <div className="text-gray-500">id_shop: {r.id_shop ?? ''}</div>
                    </td>
                    <td className="px-2 py-2 text-xs">
                    <div>{r.langue || ''}</div>
                    <div className="text-gray-500">{r.lang_iso_code || ''}</div>
                    </td>
                    <td className="px-2 py-2 text-xs">{r.customer_name || ''}</td>
                    <td className="px-2 py-2 text-xs">{r.customer_email || ''}</td>
                    <td className="px-2 py-2 text-xs">
                    <div>{r.country || ''}</div>
                    <div className="text-gray-500">{r.call_prefix ? `+${String(r.call_prefix)}` : ''}</div>
                    </td>
                    <td className="px-2 py-2 text-xs">
                    <div>{r.phone || '—'}</div>
                    <div className="text-gray-500">{r.mobile || ''}</div>
                    </td>
                    <td className="px-2 py-2 text-xs">
                    <div>{normalizeSmsTo00(r) || '—'}</div>
                    </td>
                    <td className="px-2 py-2 text-xs">
                    <div>{chosenSub != null ? `sub:${chosenSub}` : '—'}</div>
                    <div className="text-gray-500">
                      {(line?.msisdn ? String(line.msisdn) : '')}
                      {(line?.carrier ? (line?.msisdn ? ` · ${String(line.carrier)}` : String(line.carrier)) : '')}
                    </div>
                    {subSrc ? (
                      <div className="text-[11px] text-gray-500">{subSrc === 'shop' ? 'shop-map' : 'default'}</div>
                    ) : null}
                    </td>
                    <td className="px-2 py-2 text-xs">
                    <div className="whitespace-pre-wrap break-words max-w-[340px]">{smsText || <span className="text-gray-400">—</span>}</div>
                    </td>
                    <td className="px-2 py-2 text-xs whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="px-2 py-1 rounded border bg-white hover:bg-gray-50"
                        onClick={() => { onOpenSmsModal(r); onGenerateSms(r); }}
                        disabled={busy}
                      >
                        {busy ? '…' : 'Générer SMS'}
                      </button>
                      <button
                        type="button"
                        className="px-2 py-1 rounded border bg-white hover:bg-gray-50"
                        onClick={() => onGenerateEmail(r)}
                        disabled={busy}
                      >
                        {busy ? '…' : 'Générer email'}
                      </button>
                      <button
                        type="button"
                        className="px-2 py-1 rounded border bg-white hover:bg-gray-50"
                        onClick={() => onOpenSmsModal(r)}
                        disabled={busy || !smsText}
                        title={smsText ? 'Voir/éditer SMS' : 'Générer SMS d’abord.'}
                      >
                        {busy ? '…' : 'SMS…'}
                      </button>
                      <button
                        type="button"
                        className="px-2 py-1 rounded border bg-white hover:bg-gray-50"
                        onClick={() => onOpenEmailModal(r)}
                        disabled={busy || !hasEmail}
                        title={hasEmail ? (email?.subject || '') : 'Générer email d’abord.'}
                      >
                        {busy ? '…' : 'Email…'}
                      </button>
                    </div>
                    {msg && <div className="mt-1 text-[11px] text-gray-600 max-w-[260px]">{msg}</div>}
                    </td>
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
