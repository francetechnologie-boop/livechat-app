import React from 'react';

function Field({ label, children }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-gray-500 mb-1">{label}</div>
      {children}
    </div>
  );
}

export default function EmailRelanceVirementPanel({
  loading,
  rows,
  rowBusy,
  rowMsg,
  generatedById,
  onGenerateEmail,
  onEditEmail,
  onCreateDraft,
}) {
  const list = Array.isArray(rows) ? rows : [];

  return (
    <div className="space-y-3">
      <div className="text-xs text-gray-500">
        Workflow: “Générer email” (prompt → JSON subject/html/text + bloc virement + signature), puis “Edit” pour ajuster, puis “Brouillon” ou “Envoyer”.
      </div>

      <div className="border rounded max-h-[70vh] overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-[11px] uppercase text-gray-600">
            <tr>
              <th className="sticky top-0 z-10 bg-gray-50 px-2 py-2 text-left">Order</th>
              <th className="sticky top-0 z-10 bg-gray-50 px-2 py-2 text-left">Client</th>
              <th className="sticky top-0 z-10 bg-gray-50 px-2 py-2 text-left">Email</th>
              <th className="sticky top-0 z-10 bg-gray-50 px-2 py-2 text-left">Lang</th>
              <th className="sticky top-0 z-10 bg-gray-50 px-2 py-2 text-left">Shop</th>
              <th className="sticky top-0 z-10 bg-gray-50 px-2 py-2 text-left">Payment</th>
              <th className="sticky top-0 z-10 bg-gray-50 px-2 py-2 text-left">State</th>
              <th className="sticky top-0 z-10 bg-gray-50 px-2 py-2 text-left" />
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-3 text-center text-xs text-gray-500">
                  {loading ? 'Chargement…' : 'Aucun élément.'}
                </td>
              </tr>
            )}
            {list.map((r) => {
              const id = r?.id_order;
              const busy = !!rowBusy?.[String(id)];
              const msg = (rowMsg && rowMsg[String(id)]) || '';
              const hasGenerated = !!(generatedById && generatedById[String(id)] && generatedById[String(id)].html);
              return (
                <tr key={String(id)} className="border-t">
                  <td className="px-2 py-2 text-xs">
                    <div className="font-semibold">{r.id_order}</div>
                    <div className="text-gray-500">{r.reference || ''}</div>
                  </td>
                  <td className="px-2 py-2 text-xs">{r.customer_name || ''}</td>
                  <td className="px-2 py-2 text-xs">{r.customer_email || ''}</td>
                  <td className="px-2 py-2 text-xs">{r.langue || ''}</td>
                  <td className="px-2 py-2 text-xs">
                    <div>{r.shop_domain_no_www || ''}</div>
                    <div className="text-gray-500">{r.shop_email || ''}</div>
                  </td>
                  <td className="px-2 py-2 text-xs">{r.payment || ''}</td>
                  <td className="px-2 py-2 text-xs">{r.order_state || ''}</td>
                  <td className="px-2 py-2 text-xs whitespace-nowrap">
                    <div className="flex items-center gap-2">
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
                        onClick={() => onEditEmail(r)}
                        disabled={busy || !hasGenerated}
                        title={!hasGenerated ? 'Générer l’email d’abord' : undefined}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="px-2 py-1 rounded border bg-blue-600 text-white hover:bg-blue-700"
                        onClick={() => onCreateDraft(r)}
                        disabled={busy || !hasGenerated}
                        title={!hasGenerated ? 'Générer l’email d’abord' : undefined}
                      >
                        Brouillon
                      </button>
                    </div>
                    {msg && <div className="mt-1 text-[11px] text-gray-600 max-w-[260px]">{msg}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
