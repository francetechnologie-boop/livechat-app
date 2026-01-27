import React from 'react';

function Field({ label, children, hint }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-gray-500 mb-1">{label}</div>
      {children}
      {hint ? <div className="text-[11px] text-gray-400 mt-1">{hint}</div> : null}
    </div>
  );
}

function normalizeBankDetails(value) {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const banks = Array.isArray(v.banks) ? v.banks : [];
  if (banks.length) return { ...v, banks };

  // Backward compat (single bank shape)
  const accounts = Array.isArray(v.accounts) ? v.accounts : [];
  const bank = {
    label: 'Bank 1',
    account_holder: v.account_holder || '',
    bank_name: v.bank_name || '',
    address: {
      line1: v.bank_address || '',
      line2: '',
      postal_code: '',
      city: '',
      country: '',
    },
    accounts: accounts.map((a) => ({ currency: a.currency || '', iban: a.iban || '', bic: a.bic || '' })),
  };
  return { banks: [bank] };
}

export default function EmailRelanceBankSettingsEditor({ value, onChange }) {
  const model = normalizeBankDetails(value);
  const banks = Array.isArray(model.banks) ? model.banks : [];
  const setBanks = (next) => onChange({ ...model, banks: next });

  const updateBank = (idx, patch) => {
    const next = banks.slice();
    next[idx] = { ...(next[idx] || {}), ...(patch || {}) };
    setBanks(next);
  };

  const updateBankAddress = (idx, patch) => {
    const cur = banks[idx] || {};
    const addr = cur.address && typeof cur.address === 'object' && !Array.isArray(cur.address) ? cur.address : {};
    updateBank(idx, { address: { ...addr, ...(patch || {}) } });
  };

  const updateAccount = (idx, aidx, patch) => {
    const cur = banks[idx] || {};
    const accounts = Array.isArray(cur.accounts) ? cur.accounts : [];
    const nextAcc = accounts.slice();
    nextAcc[aidx] = { ...(nextAcc[aidx] || {}), ...(patch || {}) };
    updateBank(idx, { accounts: nextAcc });
  };

  const addBank = () => {
    setBanks([
      ...banks,
      {
        label: `Bank ${banks.length + 1}`,
        account_holder: '',
        bank_name: '',
        address: { line1: '', line2: '', postal_code: '', city: '', country: '' },
        accounts: [{ currency: 'EUR', iban: '', bic: '' }],
      },
    ]);
  };

  return (
    <div className="space-y-4">
      {banks.map((b, idx) => {
        const address = b?.address && typeof b.address === 'object' && !Array.isArray(b.address) ? b.address : {};
        const accounts = Array.isArray(b?.accounts) ? b.accounts : [];
        return (
          <div key={idx} className="border rounded p-3">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="text-xs uppercase tracking-wide text-gray-500">Bank #{idx + 1}</div>
              <button
                type="button"
                className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
                onClick={() => setBanks(banks.filter((_, i) => i !== idx))}
                disabled={banks.length <= 1}
                title={banks.length <= 1 ? 'Keep at least one bank' : undefined}
              >
                Remove bank
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <Field label="Label" hint="Just for your UI; optional.">
                <input
                  className="w-full rounded border px-2 py-1 text-sm"
                  value={b?.label || ''}
                  onChange={(e) => updateBank(idx, { label: e.target.value })}
                  placeholder="ex: Fio Praha"
                />
              </Field>
              <Field label="Titulaire du compte">
                <input
                  className="w-full rounded border px-2 py-1 text-sm"
                  value={b?.account_holder || ''}
                  onChange={(e) => updateBank(idx, { account_holder: e.target.value })}
                  placeholder="ex: Gottvaldová Ivana"
                />
              </Field>
              <Field label="Banque">
                <input
                  className="w-full rounded border px-2 py-1 text-sm"
                  value={b?.bank_name || ''}
                  onChange={(e) => updateBank(idx, { bank_name: e.target.value })}
                  placeholder="ex: Fio banka, a.s."
                />
              </Field>
            </div>

            <div className="mt-3 grid grid-cols-1 lg:grid-cols-5 gap-3">
              <Field label="Adresse (ligne 1)">
                <input
                  className="w-full rounded border px-2 py-1 text-sm"
                  value={address.line1 || ''}
                  onChange={(e) => updateBankAddress(idx, { line1: e.target.value })}
                  placeholder="ex: V Celnici 1028/10"
                />
              </Field>
              <Field label="Adresse (ligne 2)">
                <input
                  className="w-full rounded border px-2 py-1 text-sm"
                  value={address.line2 || ''}
                  onChange={(e) => updateBankAddress(idx, { line2: e.target.value })}
                  placeholder="ex: Praha 1"
                />
              </Field>
              <Field label="Code postal">
                <input
                  className="w-full rounded border px-2 py-1 text-sm"
                  value={address.postal_code || ''}
                  onChange={(e) => updateBankAddress(idx, { postal_code: e.target.value })}
                  placeholder="117 21"
                />
              </Field>
              <Field label="Ville">
                <input
                  className="w-full rounded border px-2 py-1 text-sm"
                  value={address.city || ''}
                  onChange={(e) => updateBankAddress(idx, { city: e.target.value })}
                  placeholder="Praha 1"
                />
              </Field>
              <Field label="Pays" hint="Le prompt peut traduire ce champ (ex: 'République tchèque').">
                <input
                  className="w-full rounded border px-2 py-1 text-sm"
                  value={address.country || ''}
                  onChange={(e) => updateBankAddress(idx, { country: e.target.value })}
                  placeholder="République tchèque"
                />
              </Field>
            </div>

            <div className="mt-4 border rounded">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-[11px] uppercase text-gray-600">
                  <tr>
                    <th className="px-2 py-2 text-left">Devise</th>
                    <th className="px-2 py-2 text-left">IBAN</th>
                    <th className="px-2 py-2 text-left">BIC / SWIFT</th>
                    <th className="px-2 py-2 text-left" />
                  </tr>
                </thead>
                <tbody>
                  {accounts.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-3 text-center text-xs text-gray-500">
                        Aucune ligne. Ajoute au moins EUR.
                      </td>
                    </tr>
                  )}
                  {accounts.map((a, aidx) => (
                    <tr key={aidx} className="border-t">
                      <td className="px-2 py-2">
                        <input
                          className="w-24 rounded border px-2 py-1 text-sm"
                          value={a.currency || ''}
                          onChange={(e) => updateAccount(idx, aidx, { currency: e.target.value.toUpperCase() })}
                          placeholder="EUR"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          className="w-full rounded border px-2 py-1 text-sm"
                          value={a.iban || ''}
                          onChange={(e) => updateAccount(idx, aidx, { iban: e.target.value })}
                          placeholder="CZ27 2010 0000 0024 0186 6752"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          className="w-full rounded border px-2 py-1 text-sm"
                          value={a.bic || ''}
                          onChange={(e) => updateAccount(idx, aidx, { bic: e.target.value })}
                          placeholder="FIOBCZPPXXX"
                        />
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button
                          type="button"
                          className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
                          onClick={() => updateBank(idx, { accounts: accounts.filter((_, i) => i !== aidx) })}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-2">
              <button
                type="button"
                className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
                onClick={() => updateBank(idx, { accounts: [...accounts, { currency: '', iban: '', bic: '' }] })}
              >
                + Add currency
              </button>
            </div>
          </div>
        );
      })}

      <div>
        <button type="button" className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={addBank}>
          + Add bank
        </button>
      </div>
    </div>
  );
}

