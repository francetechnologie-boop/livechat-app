import React, { useEffect, useMemo, useState } from "react";

function safeJsonParse(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function getApiError(payload, fallback) {
  if (!payload) return fallback;
  return payload?.message || payload?.error || fallback;
}

async function fetchJson(url) {
  const resp = await fetch(url, { credentials: "include" });
  const text = await resp.text();
  const json = safeJsonParse(text);
  return { resp, json, text };
}

function normalizeIso(value) {
  const iso = String(value || "").trim().toLowerCase();
  return iso.replace(/[^a-z]/g, "").slice(0, 8);
}

function ensureLangPrefix(rawUrl, iso, knownIsos = []) {
  const url = String(rawUrl || "").trim();
  const isoNorm = normalizeIso(iso);
  if (!url || !isoNorm) return url;
  let u;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  const known = Array.from(new Set((knownIsos || []).map(normalizeIso).filter(Boolean)));

  const path = String(u.pathname || "/");
  const segments = path.split("/").filter(Boolean);
  const first = normalizeIso(segments[0] || "");
  let rest = segments.slice();
  if (first && known.includes(first)) {
    rest = segments.slice(1);
  } else if (path.startsWith(`/${isoNorm}`) && path.length > isoNorm.length + 1 && path.charAt(isoNorm.length + 1) !== "/") {
    // Fix malformed path like /es2034-foo.html -> /es/2034-foo.html
    const after = path.slice(1 + isoNorm.length); // remove leading / + iso
    u.pathname = `/${isoNorm}/${after.replace(/^\/+/, "")}`;
    return u.toString();
  }
  const nextSegments = [isoNorm, ...rest];
  u.pathname = `/${nextSegments.join("/")}`;
  return u.toString();
}

function loadPickerState() {
  try {
    const raw = localStorage.getItem("tools_sms_product_picker") || "";
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      profile_id: parsed.profile_id ? String(parsed.profile_id) : "",
      id_shop: parsed.id_shop ? String(parsed.id_shop) : "",
      id_lang: parsed.id_lang ? String(parsed.id_lang) : "",
    };
  } catch {
    return null;
  }
}

function savePickerState(state) {
  try {
    localStorage.setItem("tools_sms_product_picker", JSON.stringify(state));
  } catch {}
}

export default function SmsProductLinkModal({ open, onClose, onApply, initialMessage }) {
  const defaultShopId = "3";
  const [profiles, setProfiles] = useState([]);
  const [profileId, setProfileId] = useState("");
  const [shops, setShops] = useState([]);
  const [shopId, setShopId] = useState("");
  const [languages, setLanguages] = useState([]);
  const [languageId, setLanguageId] = useState("");

  const [search, setSearch] = useState("");
  const [items, setItems] = useState([]);
  const [selectedLinks, setSelectedLinks] = useState([]);
  const [messageDraft, setMessageDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const saved = loadPickerState();
    if (saved) {
      setProfileId(saved.profile_id || "");
      setShopId(saved.id_shop || defaultShopId);
      setLanguageId(saved.id_lang || "");
    } else {
      setShopId(defaultShopId);
    }
    setSelectedLinks([]);
    setMessageDraft(String(initialMessage || ""));
    setSearch("");
    setItems([]);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setError("");
    setLoadingMeta(true);
    fetchJson("/api/db-mysql/profiles?limit=200")
      .then(({ resp, json }) => {
        if (!resp.ok || !json?.ok) throw new Error(getApiError(json, `http_${resp.status}`));
        const list = Array.isArray(json.items) ? json.items : [];
        setProfiles(list);
        if (!profileId && list.length) setProfileId(String(list[0].id));
      })
      .catch((e) => {
        setProfiles([]);
        setError(String(e?.message || e));
      })
      .finally(() => setLoadingMeta(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const pid = String(profileId || "").trim();
    if (!pid) {
      setShops([]);
      setShopId("");
      return;
    }
    setLoadingMeta(true);
    setError("");
    fetchJson(`/api/product-search-index/mysql/shops?${new URLSearchParams({ profile_id: pid }).toString()}`)
      .then(({ resp, json }) => {
        if (!resp.ok || !json?.ok) throw new Error(getApiError(json, `http_${resp.status}`));
        const list = (Array.isArray(json.items) ? json.items : [])
          .map((row) => ({
            id_shop: Number(row?.id_shop ?? row?.id ?? 0),
            name: typeof row?.name === "string" ? row.name : "",
          }))
          .filter((row) => Number.isFinite(row.id_shop) && row.id_shop > 0);
        setShops(list);
        const preferred = list.find((s) => String(s.id_shop) === defaultShopId);
        const stillValid = shopId && list.some((s) => String(s.id_shop) === String(shopId));
        if (stillValid) return;
        if (preferred) setShopId(defaultShopId);
        else if (!shopId && list.length) setShopId(String(list[0].id_shop));
      })
      .catch((e) => {
        setShops([]);
        setError(String(e?.message || e));
      })
      .finally(() => setLoadingMeta(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, profileId]);

  useEffect(() => {
    if (!open) return;
    const pid = String(profileId || "").trim();
    const sid = String(shopId || "").trim();
    if (!pid || !sid) {
      setLanguages([]);
      setLanguageId("");
      return;
    }
    setLoadingMeta(true);
    setError("");
    const qs = new URLSearchParams({ profile_id: pid, id_shop: sid }).toString();
    fetchJson(`/api/product-search-index/mysql/languages?${qs}`)
      .then(({ resp, json }) => {
        if (!resp.ok || !json?.ok) throw new Error(getApiError(json, `http_${resp.status}`));
        const rows = Array.isArray(json.items) ? json.items : [];
        const filtered = Array.from(
          new Map(
            rows
              .map((item) => {
                const id = Number(item?.id_lang ?? item?.id ?? item);
                const iso = typeof item?.iso_code === "string" ? item.iso_code : "";
                return Number.isFinite(id) && id > 0
                  ? [id, { id_lang: id, name: typeof item?.name === "string" ? item.name : "", iso_code: iso }]
                  : null;
              })
              .filter(Boolean)
          ).values()
        );
        setLanguages(filtered);
        if (!languageId && filtered.length) setLanguageId(String(filtered[0].id_lang));
      })
      .catch((e) => {
        setLanguages([]);
        setError(String(e?.message || e));
      })
      .finally(() => setLoadingMeta(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, profileId, shopId]);

  useEffect(() => {
    if (!open) return;
    savePickerState({ profile_id: profileId, id_shop: shopId, id_lang: languageId });
  }, [open, profileId, shopId, languageId]);

  const canSearch = useMemo(() => {
    return !!String(profileId || "").trim() && !!String(shopId || "").trim() && !!String(languageId || "").trim();
  }, [profileId, shopId, languageId]);

  const selectedLanguage = useMemo(() => {
    const id = String(languageId || "");
    return languages.find((l) => String(l.id_lang) === id) || null;
  }, [languages, languageId]);

  const langIso = useMemo(() => normalizeIso(selectedLanguage?.iso_code || ""), [selectedLanguage]);
  const knownIsos = useMemo(() => languages.map((l) => normalizeIso(l.iso_code)).filter(Boolean), [languages]);

  function appendLinkToDraft(url) {
    const value = String(url || "").trim();
    if (!value) return;
    setSelectedLinks((prev) => {
      if (prev.some((x) => x === value)) return prev;
      return [...prev, value];
    });
    setMessageDraft((prev) => {
      const cur = String(prev || "");
      const sep = cur && !/\s$/.test(cur) ? "\n" : "";
      return `${cur}${sep}${value}`;
    });
  }

  async function runSearch() {
    if (!canSearch) {
      setError("Sélectionnez un profil, une boutique et une langue.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams();
      qs.set("profile_id", String(profileId));
      qs.set("id_shop", String(shopId));
      qs.set("id_lang", String(languageId));
      qs.set("search", String(search || "").trim());
      qs.set("limit", "12");
      qs.set("include_accessories", "1");
      const { resp, json, text } = await fetchJson(`/api/tools/devis/data?${qs.toString()}`);
      if (!resp.ok || !json?.ok) {
        throw new Error(getApiError(json, text ? `Serveur: ${String(text).slice(0, 200)}` : `http_${resp.status}`));
      }
      setItems(Array.isArray(json.items) ? json.items : []);
    } catch (e) {
      setItems([]);
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/30" onMouseDown={onClose} role="presentation">
      <div
        className="w-full max-w-5xl bg-white rounded-xl shadow-lg border overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
        role="presentation"
      >
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div className="font-medium">Add product link</div>
          <div className="flex items-center gap-2">
            <button
              className="btn"
              type="button"
              onClick={() => {
                onApply?.(String(messageDraft || ""));
                onClose?.();
              }}
            >
              Apply to SMS
            </button>
            <button className="btn" onClick={onClose} type="button">
              Close
            </button>
          </div>
        </div>

        <div className="p-4 grid gap-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="grid gap-1">
              <div className="text-xs text-gray-600">Profil MySQL</div>
              <select className="input" value={profileId} onChange={(e) => setProfileId(e.target.value)} disabled={loadingMeta}>
                <option value="">Select…</option>
                {profiles.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name ? `${p.name} (ID ${p.id})` : `ID ${p.id}`}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <div className="text-xs text-gray-600">Shop (ps_shop)</div>
              <select className="input" value={shopId} onChange={(e) => setShopId(e.target.value)} disabled={loadingMeta || !profileId}>
                <option value="">Select…</option>
                {shops.map((s) => (
                  <option key={String(s.id_shop)} value={String(s.id_shop)}>
                    {s.name ? `${s.name} (ID ${s.id_shop})` : `ID ${s.id_shop}`}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <div className="text-xs text-gray-600">Langue (ps_lang / ps_lang_shop)</div>
              <select className="input" value={languageId} onChange={(e) => setLanguageId(e.target.value)} disabled={loadingMeta || !shopId}>
                <option value="">Select…</option>
                {languages.map((l) => (
                  <option key={String(l.id_lang)} value={String(l.id_lang)}>
                    {l.name ? `${l.name} (ID ${l.id_lang}${l.iso_code ? ` · ${l.iso_code}` : ""})` : `ID ${l.id_lang}`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="text-xs text-gray-600">
              Profil: {profileId || "—"} · id_shop: {shopId || "—"} · id_lang: {languageId || "—"} · iso: {langIso || "—"}
            </div>
            {loadingMeta ? <div className="text-xs text-gray-500">Loading…</div> : null}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 min-h-0">
            <div className="grid gap-3 min-h-0">
              <div className="flex items-center gap-2">
                <input
                  className="input flex-1"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search products…"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") runSearch();
                  }}
                />
                <button className="btn" onClick={runSearch} disabled={loading || !canSearch}>
                  {loading ? "Searching…" : "Search"}
                </button>
              </div>

              {error ? <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded p-2">{error}</div> : null}

              <div className="border rounded overflow-hidden min-h-0">
                <div className="max-h-[55vh] overflow-auto">
                  {!items.length && !loading ? (
                    <div className="p-3 text-sm text-gray-500">No results.</div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-xs text-gray-600">
                        <tr>
                          <th className="text-left px-3 py-2 w-[44%]">Product</th>
                          <th className="text-left px-3 py-2 w-[18%]">Ref</th>
                          <th className="text-left px-3 py-2 w-[30%]">Link</th>
                          <th className="text-right px-3 py-2 w-[8%]">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((p) => {
                          const rawUrl = p.product_url || p.link_product || "";
                          const url = ensureLangPrefix(rawUrl, langIso, knownIsos);
                          const title = p.product_name || p.name || "";
                          const ref = p.product_reference || p.reference || p.product_id || p.id || "";
                          const acc = Array.isArray(p.accessories) ? p.accessories : [];
                          const hasAcc = acc.length > 0;

                          const renderRow = ({ row, accessory = false }) => {
                            const rTitle = row?.product_name || row?.name || "";
                            const rRef = row?.product_reference || row?.reference || row?.product_id || row?.id || "";
                            const rRawUrl = row?.product_url || row?.link_product || "";
                            const rUrl = ensureLangPrefix(rRawUrl, langIso, knownIsos);
                            return (
                              <tr
                                key={`${accessory ? "a" : "p"}-${row?.id || rRef || rTitle}`}
                                className={`border-t ${accessory ? "bg-amber-50/40" : "bg-white"}`}
                              >
                                <td className="px-3 py-2">
                                  <div className="flex items-center gap-2">
                                    {accessory ? (
                                      <span className="text-[11px] px-2 py-0.5 rounded bg-amber-50 border border-amber-100 text-amber-800">
                                        Accessory
                                      </span>
                                    ) : null}
                                    <div className="font-medium text-gray-900">{rTitle || "—"}</div>
                                  </div>
                                </td>
                                <td className="px-3 py-2 font-mono text-xs text-gray-700">{String(rRef || "—")}</td>
                                <td className="px-3 py-2">
                                  {rUrl ? (
                                    <a className="text-blue-700 hover:underline break-all" href={rUrl} target="_blank" rel="noreferrer">
                                      {rUrl}
                                    </a>
                                  ) : (
                                    <span className="text-gray-400">—</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <button className="btn" type="button" disabled={!rUrl} onClick={() => appendLinkToDraft(rUrl)}>
                                    Add
                                  </button>
                                </td>
                              </tr>
                            );
                          };

                          return (
                            <React.Fragment key={`p-${p.id || ref || title}`}>
                              {renderRow({ row: { ...p, product_url: url }, accessory: false })}
                              {hasAcc ? (
                                <tr className="border-t bg-amber-50">
                                  <td colSpan={4} className="px-3 py-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="text-xs text-amber-900">
                                        Accessoires ({acc.length})
                                      </div>
                                      <button
                                        className="btn"
                                        type="button"
                                        onClick={() => {
                                          if (url) appendLinkToDraft(url);
                                          for (const a of acc) {
                                            const aUrl = ensureLangPrefix(a.product_url || a.link_product || "", langIso, knownIsos);
                                            if (aUrl) appendLinkToDraft(aUrl);
                                          }
                                        }}
                                      >
                                        Add all links
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ) : null}
                              {hasAcc ? acc.map((a) => renderRow({ row: a, accessory: true })) : null}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
	            </div>

	            <div className="grid gap-3 min-h-0">
	              <div className="text-sm font-medium text-gray-900">Message preview</div>
	              <textarea
	                className="input min-h-[260px] flex-1"
	                value={messageDraft}
                onChange={(e) => setMessageDraft(e.target.value)}
                placeholder="Your SMS message…"
              />

              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-gray-600">
                  Links added: {selectedLinks.length}
                </div>
                <div className="flex items-center gap-2">
                  <button className="btn" type="button" onClick={() => setMessageDraft(String(initialMessage || ""))}>
                    Reset
                  </button>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => {
                      onApply?.(String(messageDraft || ""));
                      onClose?.();
                    }}
                  >
                    Apply to SMS
                  </button>
                </div>
              </div>

              {selectedLinks.length ? (
                <div className="border rounded p-3 bg-gray-50">
                  <div className="text-xs text-gray-600 mb-2">Selected links</div>
                  <div className="grid gap-2">
                    {selectedLinks.map((l) => (
                      <div key={l} className="flex items-center justify-between gap-2">
                        <div className="text-xs font-mono break-all text-gray-800">{l}</div>
                        <button
                          type="button"
                          className="text-[11px] px-2 py-1 rounded border bg-white hover:bg-gray-50"
                          onClick={() => {
                            setSelectedLinks((prev) => prev.filter((x) => x !== l));
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
	              ) : null}
	            </div>
	          </div>
	        </div>
      </div>
    </div>
  );
}
