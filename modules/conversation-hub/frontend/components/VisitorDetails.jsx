import {useMemo, useState} from "react";

/* Helpers */
function flagEmoji(cc) {
  if (!cc || cc.length !== 2) return "🏳️";
  const code = cc.toUpperCase();
  return String.fromCodePoint(...[...code].map(c => 0x1f1e6 - 65 + c.charCodeAt(0)));
}
function regionName(cc) {
  try {
    if (!cc) return null;
    const dn = new Intl.DisplayNames(["fr", "en"], { type: "region" });
    return dn.of(String(cc).toUpperCase());
  } catch {
    return null;
  }
}
function initialsFrom(info) {
  const f = (info?.customer_firstname || "").trim();
  const l = (info?.customer_lastname || "").trim();
  if (f || l) return `${f} ${l}`.trim().split(/\s+/).slice(0,2).map(s=>s.charAt(0)).join("").toUpperCase();
  const mail = (info?.customer_email || "").trim();
  if (mail) return mail.charAt(0).toUpperCase();
  return "?";
}
function niceName(info) {
  const f = (info?.customer_firstname || "").trim();
  const l = (info?.customer_lastname || "").trim();
  if (f || l) return `${f} ${l}`.trim();
  return info?.customer_email || "Visiteur";
}
function parseDevice(ua = "") {
  const s = String(ua);
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(s);
  let os = null;
  if (/Windows NT 11/.test(s)) os = "Windows 11";
  else if (/Windows NT 10\.0/.test(s)) os = "Windows 10";
  else if (/Windows NT 6\.3/.test(s)) os = "Windows 8.1";
  else if (/Windows NT 6\.1/.test(s)) os = "Windows 7";
  else if (/Android ([\d_.]+)/i.test(s)) os = `Android ${RegExp.$1.replace(/_/g, ".")}`;
  else if (/(iPhone|iPad);.*?OS ([\d_]+)/i.test(s)) os = `iOS ${RegExp.$2.replace(/_/g, ".")}`;
  else if (/Mac OS X ([\d_]+)/.test(s)) os = `macOS ${RegExp.$1.replace(/_/g, ".")}`;
  else if (/Linux/.test(s)) os = "Linux";
  let browser = null;
  if (/Edg\/([\d.]+)/.test(s)) browser = `Edge ${RegExp.$1}`;
  else if (/Chrome\/([\d.]+)/.test(s)) browser = `Chrome ${RegExp.$1}`;
  else if (/Firefox\/([\d.]+)/.test(s)) browser = `Firefox ${RegExp.$1}`;
  else if (/Version\/([\d.]+).*Safari\//.test(s)) browser = `Safari ${RegExp.$1}`;
  return { device: isMobile ? "Mobile" : "Desktop", os, browser };
}
function fmtDT(v) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return v;
  }
}
function extLink(url, label) {
  if (!url) return "—";
  const safe = String(url);
  const txt = label || safe.replace(/^https?:\/\//, "");
  return <a className="text-blue-600 hover:text-blue-800 underline break-all" href={safe} target="_blank" rel="noopener noreferrer">{txt}</a>;
}
function Badge({children}) {
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-gray-100 text-gray-700 border">{children}</span>;
}

/**
 * Props:
 *  - visitorId: string|null
 *  - info: object | undefined
 *  - visits: array | []
 */
export default function VisitorDetails({ visitorId, info, visits, messages = [] }) {
  const [showFullUA, setShowFullUA] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const screenStr = useMemo(() => {
    if (!info) return "—";
    const s = info.screen;
    if (typeof s === "string" && s.trim()) return s.trim();
    if (s && typeof s === "object") {
      const w = s.w ?? s.width ?? s.screen_w ?? info.screen_w;
      const h = s.h ?? s.height ?? s.screen_h ?? info.screen_h;
      const d = s.dpr ?? s.pixelRatio ?? s.screen_dpr ?? info.screen_dpr;
      const dpr = d ? ` @${d}x` : "";
      if (w && h) return `${w}×${h}${dpr}`;
    }
    const w = info.screen_w;
    const h = info.screen_h;
    const dpr = info.screen_dpr ? ` @${info.screen_dpr}x` : "";
    if (w && h) return `${w}×${h}${dpr}`;
    return "—";
  }, [info]);

  const dev = useMemo(() => parseDevice(info?.user_agent || ""), [info?.user_agent]);
  const countryLabel = useMemo(() => regionName(info?.country_code) || info?.country_code || "—", [info?.country_code]);
  const chatsForVisitor = useMemo(() => (messages || []).filter(m => m?.visitorId === visitorId), [messages, visitorId]);
  const chatsCount = chatsForVisitor.length;
  const lastChatAt = chatsForVisitor.length ? (new Date(chatsForVisitor[chatsForVisitor.length - 1].timestamp || Date.now())) : null;

  if (!visitorId) {
    return (
      <div className="h-full w-full flex items-center justify-center text-gray-500">
        Sélectionnez une conversation pour voir les détails du visiteur.
      </div>
    );
  }

  if (!info) {
    return (
      <div className="p-4 text-sm text-gray-500">
        Chargement des informations du visiteur…
      </div>
    );
  }

  const uaShort = info.user_agent ? (info.user_agent.length > 80 ? info.user_agent.slice(0, 80) + "…" : info.user_agent) : "—";

  const idShop = (info.id_shop ?? info.shop_id ?? info.idShop ?? null);
  const idLang = (info.id_lang ?? info.idLang ?? info.id_Lang ?? null);
  const shopStr = (info.shop_name || idShop != null)
    ? `${info.shop_name ?? "—"}${idShop != null ? ` (ID ${idShop})` : ""}`
    : "—";

  const langShopStr = (info.lang_name || info.lang_iso || idLang != null)
    ? `${info.lang_name ?? "—"}${info.lang_iso ? ` [${info.lang_iso}]` : ""}${idLang != null ? ` · id_lang ${idLang}` : ""}`
    : "—";

  const currencyStr = info.currency ?? "—";
  const cartStr = Number.isFinite(+info.cart_total) ? (+info.cart_total).toFixed(2) : "—";

  const chatbotId = (() => {
    try {
      const v = (info?.chatbot_id ?? info?.chatbotId ?? '').toString().trim();
      return v || '';
    } catch { return ''; }
  })();

  return (
    <div className="visitor-details scroll-area">
      <div className="flex items-center justify-between mb-3">
        <div className="font-semibold">Détails du visiteur</div>
        <div className="text-xs text-gray-500">{String(visitorId).slice(0, 8)}…</div>
      </div>

      <div className="visitor-details__card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-semibold">
              {initialsFrom(info)}
            </div>
            <div>
              <div className="font-semibold leading-5">{niceName(info)}</div>
              <div className="text-xs text-gray-500 break-all">{info.customer_email || ""}</div>
            </div>
          </div>
          <div className="text-right text-[11px] text-gray-600">
            <div>
              <span className="font-semibold">Visites</span> {Array.isArray(visits) ? visits.length : 0}
              <span className="mx-2">·</span>
              <span className="font-semibold">Chats</span> {chatsCount}
            </div>
            {lastChatAt && <div>Dernier chat: {fmtDT(lastChatAt)}</div>}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-xl">{flagEmoji(info.country_code)}</span>
            <span>
              {info.city ? `${info.city}, ` : ''}{countryLabel}
              {info.postcode ? ` (${info.postcode})` : ''}
              {info.ip ? ` — ${info.ip}` : ''}
            </span>
          </div>
          {(dev.os || dev.browser) && (
            <div className="flex items-center gap-2 text-gray-700">
              <span className="inline-block w-2 h-2 rounded-full bg-gray-400" />
              <span>{[dev.os, dev.browser, dev.device].filter(Boolean).join(", ")}{screenStr !== '—' ? ` — ${screenStr}` : ''}</span>
            </div>
          )}
          {(info.last_action || info.last_action_at) && (
            <div className="flex items-center gap-2 text-gray-700">
              <span className="inline-block w-2 h-2 rounded-full bg-indigo-400" />
              <span>
                Dernière action: <span className="font-medium">{info.last_action || '—'}</span>
                {info.last_action_at ? ` — ${fmtDT(info.last_action_at)}` : ''}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="visitor-details__card">
        <div className="flex items-center gap-2 mb-2">
          <div className="text-xl">{flagEmoji(info.country_code)}</div>
          <div className="text-sm text-gray-700">
            <div><span className="font-medium">Pays</span> : {info.country_code || "—"}</div>
            <div><span className="font-medium">IP</span> : {info.ip || "—"}</div>
            <div><span className="font-medium">Ville</span> : {info.city || "—"}</div>
            <div><span className="font-medium">Code postal</span> : {info.postcode || "—"}</div>
          </div>
        </div>

        <div className="text-sm grid grid-cols-2 gap-x-4 gap-y-1">
          <div><span className="font-medium">Langue navigateur</span> : {info.lang || info.language || "—"}</div>
          <div><span className="font-medium">Fuseau</span> : {info.time_zone || "—"}</div>
          <div><span className="font-medium">Écran</span> : {screenStr}</div>
          <div><span className="font-medium">Dernier vu</span> : {fmtDT(info.last_seen)}</div>
          <div><span className="font-medium">Première visite</span> : {fmtDT(info.first_seen)}</div>
          <div><span className="font-medium">Origine</span> : {info.origin || "—"}</div>

          <div><span className="font-medium">Boutique</span> : {shopStr}</div>
          <div><span className="font-medium">Langue boutique</span> : {langShopStr}</div>
          <div><span className="font-medium">id_shop</span> : {idShop != null ? String(idShop) : "—"}</div>
          <div><span className="font-medium">id_lang</span> : {idLang != null ? String(idLang) : "—"}</div>

          <div><span className="font-medium">Devise</span> : {currencyStr}</div>
          <div><span className="font-medium">Panier courant</span> : {cartStr}</div>

          {chatbotId ? (
            <div className="col-span-2">
              <span className="font-medium">Chatbot</span> : <span className="font-mono">{chatbotId}</span>
            </div>
          ) : null}
        </div>

        <div className="mt-2 text-sm">
          <div className="font-medium">Dernière page</div>
          <div className="break-anywhere">
            {extLink(info.page_url || info.page_url_last, info.title ? `${info.title}` : undefined)}
          </div>
        </div>

        <div className="mt-2 text-sm">
          <div className="font-medium">Référent</div>
          <div className="break-anywhere">
            {extLink(info.referrer)}
          </div>
        </div>

        <div className="mt-2 text-sm">
          <div className="font-medium">User-Agent</div>
          <div className="text-gray-700 break-all">
            {showFullUA ? (info.user_agent || "—") : uaShort}
          </div>
          {info.user_agent && info.user_agent.length > 80 && (
            <button
              onClick={() => setShowFullUA(s => !s)}
              className="mt-1 text-xs text-blue-600 hover:text-blue-800 underline"
            >
              {showFullUA ? "Réduire" : "Voir tout"}
            </button>
          )}
        </div>
      </div>

      {(info.customer_logged != null || info.customer_id || info.customer_email || info.orders_count != null) && (
        <div className="visitor-details__card">
          <div className="font-medium mb-2">Client</div>
          <div className="text-sm grid grid-cols-2 gap-x-4 gap-y-1">
            <div>
              <span className="font-medium">Connecté</span> : {info.customer_logged === true ? 'oui' : info.customer_logged === false ? 'non' : '—'}
            </div>
            <div>
              <span className="font-medium">ID Client</span> : {info.customer_id ?? '—'}
            </div>
            <div className="col-span-2">
              <span className="font-medium">Email</span> : {info.customer_email ? <a className="text-blue-600 underline" href={`mailto:${info.customer_email}`}>{info.customer_email}</a> : '—'}
            </div>
            <div className="col-span-2">
              <span className="font-medium">Nom</span> : {(info.customer_firstname || info.customer_lastname) ? `${info.customer_firstname || ''} ${info.customer_lastname || ''}`.trim() : '—'}
            </div>
            <div>
              <span className="font-medium">Commandes</span> : {Number.isFinite(+info.orders_count) ? info.orders_count : '—'}
            </div>
            <div>
              <span className="font-medium">Montant total</span> : {Number.isFinite(+info.orders_amount) ? `${(+info.orders_amount).toFixed(2)}${info.currency ? ' ' + info.currency : ''}` : '—'}
            </div>
          </div>
        </div>
      )}

      {(info.utm_source || info.utm_medium || info.utm_campaign || info.utm_term || info.utm_content) && (
        <div className="visitor-details__card">
          <div className="font-medium mb-2">Campagne (UTM)</div>
          <div className="flex flex-wrap gap-2">
            {info.utm_source   && <Badge>source: {info.utm_source}</Badge>}
            {info.utm_medium   && <Badge>medium: {info.utm_medium}</Badge>}
            {info.utm_campaign && <Badge>campaign: {info.utm_campaign}</Badge>}
            {info.utm_term     && <Badge>term: {info.utm_term}</Badge>}
            {info.utm_content  && <Badge>content: {info.utm_content}</Badge>}
          </div>
        </div>
      )}

      <div className="visitor-details__card">
        <div className="flex items-center justify-between">
          <div className="font-medium">Historique de navigation</div>
          <div className="text-xs text-gray-500">{Array.isArray(visits) ? visits.length : 0} sites</div>
        </div>
        <div className="mt-2">
          {(!visits || visits.length === 0) && (
            <div className="text-sm text-gray-500">Aucune page enregistrée.</div>
          )}
          <div className="relative">
            <div className="absolute left-2 top-0 bottom-0 w-px bg-gray-200" />
            <div className="space-y-3">
              {(visits || []).map((v, i) => (
                <div key={i} className="pl-6 relative">
                  <div className="absolute left-0 top-1 w-4 h-4 rounded-full bg-white border-2 border-indigo-300" />
                  <div className="text-[11px] text-gray-500">{fmtDT(v.occurred_at)}</div>
                  <div className="text-sm break-anywhere">{extLink(v.page_url, v.title || v.page_url)}</div>
                  <div className="text-xs text-gray-500">
                    {v.origin && <span className="mr-2">origin: {v.origin}</span>}
                    {v.referrer && <>ref: {extLink(v.referrer)}</>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="border rounded-lg p-3 bg-white mt-3">
        <div className="flex items-center justify-between mb-2">
          <div className="font-medium">Toutes les données</div>
          <button
            onClick={() => setShowAll(s => !s)}
            className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
          >
            {showAll ? 'Masquer' : 'Afficher'}
          </button>
        </div>
        {showAll && (
          <pre className="text-xs whitespace-pre-wrap break-anywhere bg-gray-50 p-2 rounded border overflow-auto max-h-80">
{JSON.stringify(info || {}, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
