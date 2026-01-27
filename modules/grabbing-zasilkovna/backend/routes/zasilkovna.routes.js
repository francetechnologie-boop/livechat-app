import fs from 'fs';
import path from 'path';

function backendDirFromModule() {
  const here = path.resolve(path.dirname(new URL(import.meta.url).pathname));
  const repoRootGuess = path.resolve(here, '../../../../');
  const candidate = path.join(repoRootGuess, 'backend');
  try { if (fs.existsSync(candidate)) return candidate; } catch {}
  try { const cwd = process.cwd(); if (fs.existsSync(path.join(cwd, 'package.json'))) return cwd; } catch {}
  return candidate;
}

export function registerZasilkovnaRoutes(app, ctx = {}) {
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { res.status(401).json({ error: 'unauthorized' }); return null; });
  const pool = ctx.pool;
  const backendDir = backendDirFromModule();
  const dataDir = path.join(backendDir, 'uploads', 'grabbing-zasilkovna');
  try { fs.mkdirSync(dataDir, { recursive: true }); } catch {}
  const log = (m) => { try { ctx.logToFile?.(`[grabbing-zasilkovna] ${m}`); } catch {} };
  const sanitizePlaywrightEnv = (label) => {
    try {
      const v = process.env.PLAYWRIGHT_BROWSERS_PATH || '';
      // If misconfigured (contains spaces or shell command), unset to let Playwright use defaults
      if (/\s/.test(v) || /playwright\s+install/i.test(v) || /=/.test(v)) {
        delete process.env.PLAYWRIGHT_BROWSERS_PATH;
        log(`${label||'pw'}:sanitized PLAYWRIGHT_BROWSERS_PATH`);
      }
    } catch {}
  };

  const TRACK_LANG = 'cs';
  const buildPacketaTrackingUrl = (packetId) => {
    const pid = (packetId||'').toString().trim();
    if (!pid) return null;
    return `https://tracking.packeta.com/${TRACK_LANG}/?id=${encodeURIComponent(pid)}`;
  };

  async function loadPacketaApiConfig(cfgId) {
    const configId = String(cfgId || '').trim();
    if (!configId) return { apiKey: '', apiPassword: '', apiBase: '' };
    try {
      await ensureConfigTable();
      const r = await pool.query('SELECT options FROM mod_grabbing_zasilkovna_config WHERE id=$1 LIMIT 1', [configId]);
      if (!r.rowCount) return { apiKey: '', apiPassword: '', apiBase: '' };
      const p = r.rows[0]?.options?.packeta || {};
      return {
        apiKey: String(p.apiKey || ''),
        apiPassword: String(p.apiPassword || ''),
        apiBase: String(p.apiBase || ''),
      };
    } catch {
      return { apiKey: '', apiPassword: '', apiBase: '' };
    }
  }

  async function fetchExternalTrackingInfo(apiKey, apiPassword, packetId, apiBase, debugAttempts) {
    try {
      const pid = (packetId||'').toString().trim(); if (!pid) return null;
      // Prefer the official Zasilkovna SOAP API endpoint (WSDL: https://www.zasilkovna.cz/api/soap.wsdl).
      // api.packeta.com endpoints frequently return HTML/504 and are not the SOAP endpoint for packetInfo().
      let soapUrl = (apiBase && typeof apiBase === 'string' && apiBase.trim())
        ? apiBase.trim()
        : 'https://www.zasilkovna.cz/api/soap';
      try {
        if (/api\.packeta\.com/i.test(soapUrl)) {
          log(`tracking_api: warn apiBase points to api.packeta.com; using https://www.zasilkovna.cz/api/soap`);
          soapUrl = 'https://www.zasilkovna.cz/api/soap';
        }
      } catch {}
      const f = globalThis.fetch || (await import('node-fetch')).default;
      // Helper: parse courierTrackingUrls + courierTrackingNumber from XML
      const parseTrackingFromXml = (xml) => {
        try {
          const out = { tracking_external_url: null, courier_tracking_number: null };
          const blockMatch = xml.match(/<(?:\w+:)?courierTrackingUrls\b[\s\S]*?<\/(?:\w+:)?courierTrackingUrls>/i);
          if (blockMatch) {
            const block = blockMatch[0];
            // Take the first courier tracking URL as returned by the API (ordering is meaningful).
            out.tracking_external_url = (block.match(/<(?:\w+:)?url>\s*([^<]+)\s*<\/(?:\w+:)?url>/i)?.[1]?.trim() || null);
          }
          // Some carriers expose courierTrackingNumber / courierNumber for last-mile.
          out.courier_tracking_number =
            (xml.match(/<(?:\w+:)?courierTrackingNumber[^>]*>\s*([^<]+)\s*<\/(?:\w+:)?courierTrackingNumber>/i)?.[1]?.trim() || null) ||
            (xml.match(/<(?:\w+:)?courierNumber[^>]*>\s*([^<]+)\s*<\/(?:\w+:)?courierNumber>/i)?.[1]?.trim() || null);
          if (!out.tracking_external_url && !out.courier_tracking_number) return null;
          return out;
        } catch { return null; }
      };

      // SOAP packetInfo() call (doc/literal)
      // WSDL binding indicates input namespace "http://www.zasilkovna.cz/api/soap.wsdl2" and SOAPAction ".../packetInfo"
      const escapeXml = (str) => String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] || c));
      const soapAction = 'http://www.zasilkovna.cz/api/soap/packetInfo';
      const soapBody = `<?xml version="1.0" encoding="utf-8"?>\n` +
        `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">\n` +
        `  <soapenv:Body>\n` +
        `    <packetInfo xmlns="http://www.zasilkovna.cz/api/soap.wsdl2">\n` +
        `      <apiPassword>${escapeXml(apiPassword)}</apiPassword>\n` +
        `      <packetId>${escapeXml(pid)}</packetId>\n` +
        `    </packetInfo>\n` +
        `  </soapenv:Body>\n` +
        `</soapenv:Envelope>\n`;
      const soapHeaders = {
        'Content-Type': 'text/xml; charset=utf-8',
        'Accept': 'text/xml, application/xml, */*',
        'SOAPAction': soapAction,
      };
      const requestPreview = `<packetInfo><apiPassword>****</apiPassword><packetId>${pid}</packetId></packetInfo>`;
      try {
        log(`tracking_api: soap_request ${soapUrl} action=${soapAction} body=${requestPreview}`);
        const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const t = setTimeout(() => { try { ac?.abort?.(); } catch {} }, 15000);
        const resp = await f(soapUrl, { method: 'POST', headers: soapHeaders, body: soapBody, signal: ac?.signal });
        clearTimeout(t);
        const txt = await resp.text().catch(() => '');
        log(`tracking_api: soap_response ${soapUrl} status=${resp.status} ok=${resp.ok} body=${(txt || '').slice(0, 1200)}`);
        if (debugAttempts) {
          debugAttempts.push({
            kind: 'soap',
            url: soapUrl,
            soapAction,
            request: { contentType: 'text/xml', body: requestPreview },
            response: { status: resp.status, ok: resp.ok, body: (txt || '').slice(0, 1200) },
          });
        }
        const out = resp.ok ? parseTrackingFromXml(txt) : null;
        if (out) return out;
      } catch (e) {
        log(`tracking_api: soap_error ${soapUrl} error=${String(e?.message || e)}`);
        if (debugAttempts) {
          debugAttempts.push({
            kind: 'soap',
            url: soapUrl,
            soapAction,
            request: { contentType: 'text/xml', body: requestPreview },
            error: String(e?.message || e),
          });
        }
      }

      // Intentionally no JSON fallback here:
      // `packetInfo()` is a SOAP method and the official WSDL endpoint is on `www.zasilkovna.cz`.
    } catch {}
    return null;
  }

  async function updateTrackingLinks({ cfgId, onlyMissing = true, limit = 2000, orgId = null, orderRaws = null } = {}) {
    if (!pool || typeof pool.query !== 'function') throw new Error('db_unavailable');
    const configId = String(cfgId || '').trim();
    const effectiveLimit = Math.max(1, Math.min(2000, Number(limit || 2000) || 2000));
    const byOrderRaws = Array.isArray(orderRaws) ? orderRaws.map((v) => String(v || '').trim()).filter(Boolean) : null;

    const baseWhere = [
      `(packet_id IS NOT NULL AND packet_id <> '')`,
      `(status IS NULL OR status NOT ILIKE 'cancel%')`,
    ];
    const vals = [];
    if (orgId) {
      vals.push(String(orgId).trim());
      baseWhere.push(`org_id = $${vals.length}`);
    }
    if (byOrderRaws && byOrderRaws.length) {
      vals.push(byOrderRaws);
      baseWhere.push(`order_raw = ANY($${vals.length}::text[])`);
    }

    // Fast path: set Packeta tracking URL deterministically in SQL (packet_id is digits).
    let updatedPacketa = 0;
    try {
      const packetaWhere = [
        ...baseWhere,
        `(tracking_packeta_url IS NULL OR tracking_packeta_url = '')`,
      ];
      const sql = `
        UPDATE public.mod_grabbing_zasilkovna
           SET tracking_packeta_url = $${vals.length + 1} || packet_id,
               updated_at = NOW()
         WHERE ${packetaWhere.join(' AND ')}
      `;
      const prefix = `https://tracking.packeta.com/${TRACK_LANG}/?id=`;
      const r = await pool.query(sql, [...vals, prefix]);
      updatedPacketa = r.rowCount || 0;
    } catch {}

    // External link (SOAP packetInfo) – best effort.
    const { apiKey, apiPassword, apiBase } = await loadPacketaApiConfig(configId);
    let updatedExternal = 0;
    let skipped = 0;
    let failed = 0;

    if (!apiPassword) {
      // No API credentials configured; still return Packeta updates.
      return { ok: true, limit: effectiveLimit, updated_packeta: updatedPacketa, updated_external: 0, skipped: 0, failed: 0 };
    }

    const whereExternal = [
      ...baseWhere,
      onlyMissing ? `((tracking_external_url IS NULL OR tracking_external_url = '') OR (courier_tracking_number IS NULL OR courier_tracking_number = ''))` : `TRUE`,
    ];
    const externalVals = [...vals, effectiveLimit];
    const pickSql = `
      SELECT order_raw, packet_id, tracking_external_url, courier_tracking_number
        FROM public.mod_grabbing_zasilkovna
       WHERE ${whereExternal.join(' AND ')}
       ORDER BY updated_at DESC NULLS LAST
       LIMIT $${externalVals.length}
    `;
    const pick = await pool.query(pickSql, externalVals);
    const candidates = (pick.rows || []).filter((r) => r && r.order_raw && r.packet_id);
    const concurrency = Math.max(1, Math.min(5, Number(ctx?.trackingConcurrency || 3) || 3));
    let idx = 0;

    const worker = async () => {
      while (idx < candidates.length) {
        const my = idx++;
        const row = candidates[my];
        const pid = String(row.packet_id || '').trim();
        const orderRaw = String(row.order_raw || '').trim();
        if (!pid || !orderRaw) { skipped++; continue; }
        try {
          const info = await fetchExternalTrackingInfo(apiKey, apiPassword, pid, apiBase);
          if (!info) { skipped++; continue; }
          await pool.query(
            `UPDATE public.mod_grabbing_zasilkovna
                SET tracking_external_url = COALESCE($1, tracking_external_url),
                    courier_tracking_number = COALESCE($2, courier_tracking_number),
                    updated_at = NOW()
              WHERE order_raw = $3`,
            [info.tracking_external_url || null, info.courier_tracking_number || null, orderRaw]
          );
          updatedExternal++;
        } catch {
          failed++;
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length || 1) }, () => worker()));
    return { ok: true, limit: effectiveLimit, updated_packeta: updatedPacketa, updated_external: updatedExternal, skipped, failed };
  }

  async function ensureStatusTable() {
    if (!pool || typeof pool.query !== 'function') throw new Error('db_unavailable');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.mod_grabbing_zasilkovna_status (
        id           SERIAL PRIMARY KEY,
        packet_id    TEXT NOT NULL,
        status_code  TEXT NULL,
        code_text    TEXT NULL,
        status_text  TEXT NULL,
        status_at    TIMESTAMPTZ NULL,
        source       TEXT NULL DEFAULT 'soap.packetStatus',
        raw_xml      TEXT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        org_id       TEXT NULL
      );
      CREATE INDEX IF NOT EXISTS mod_grabbing_zasilkovna_status_packet_idx
        ON public.mod_grabbing_zasilkovna_status (packet_id);
      CREATE INDEX IF NOT EXISTS mod_grabbing_zasilkovna_status_created_idx
        ON public.mod_grabbing_zasilkovna_status (created_at DESC);
    `);
    try {
      await pool.query(`
        DO $$ BEGIN
          IF to_regclass('public.mod_grabbing_zasilkovna_staus') IS NULL THEN
            EXECUTE 'CREATE VIEW public.mod_grabbing_zasilkovna_staus AS SELECT * FROM public.mod_grabbing_zasilkovna_status';
          END IF;
        END $$;
      `);
    } catch {}
  }

  const xmlValue = (xml, tag) => {
    try {
      const re = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, 'i');
      const m = String(xml || '').match(re);
      if (!m) return null;
      return String(m[1] || '').trim();
    } catch {
      return null;
    }
  };

  async function fetchPacketStatus({ apiPassword, packetId, apiBase, debugAttempts }) {
    const pid = String(packetId || '').trim();
    if (!pid) return { ok: false, error: 'bad_request', message: 'packet_id required' };
    if (!apiPassword) return { ok: false, error: 'bad_request', message: 'apiPassword missing in config' };

    let soapUrl = (apiBase && typeof apiBase === 'string' && apiBase.trim())
      ? apiBase.trim()
      : 'https://www.zasilkovna.cz/api/soap';
    try {
      if (/api\.packeta\.com/i.test(soapUrl)) {
        log(`tracking_api: warn apiBase points to api.packeta.com; using https://www.zasilkovna.cz/api/soap`);
        soapUrl = 'https://www.zasilkovna.cz/api/soap';
      }
    } catch {}

    const escapeXml = (str) => String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] || c));
    const soapAction = 'http://www.zasilkovna.cz/api/soap/packetStatus';
    const soapBody =
      `<?xml version="1.0" encoding="utf-8"?>\n` +
      `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">\n` +
      `  <soapenv:Body>\n` +
      `    <packetStatus xmlns="http://www.zasilkovna.cz/api/soap.wsdl2">\n` +
      `      <apiPassword>${escapeXml(apiPassword)}</apiPassword>\n` +
      `      <packetId>${escapeXml(pid)}</packetId>\n` +
      `    </packetStatus>\n` +
      `  </soapenv:Body>\n` +
      `</soapenv:Envelope>\n`;
    const soapHeaders = {
      'Content-Type': 'text/xml; charset=utf-8',
      'Accept': 'text/xml, application/xml, */*',
      'SOAPAction': soapAction,
    };

    const requestPreview = `<packetStatus><apiPassword>****</apiPassword><packetId>${pid}</packetId></packetStatus>`;
    try {
      const f = globalThis.fetch || (await import('node-fetch')).default;
      log(`status_api: soap_request ${soapUrl} action=${soapAction} body=${requestPreview}`);
      const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const t = setTimeout(() => { try { ac?.abort?.(); } catch {} }, 10000);
      const resp = await f(soapUrl, { method: 'POST', headers: soapHeaders, body: soapBody, signal: ac?.signal });
      clearTimeout(t);
      const txt = await resp.text().catch(() => '');
      log(`status_api: soap_response ${soapUrl} status=${resp.status} ok=${resp.ok} body=${(txt || '').slice(0, 1200)}`);
      if (debugAttempts) {
        debugAttempts.push({
          kind: 'soap',
          url: soapUrl,
          soapAction,
          request: { contentType: 'text/xml', body: requestPreview },
          response: { status: resp.status, ok: resp.ok, body: (txt || '').slice(0, 1200) },
        });
      }
      if (!resp.ok) return { ok: false, error: 'upstream_error', status: resp.status, body: (txt || '').slice(0, 1200) };

      const resultXml = xmlValue(txt, 'packetStatusResult') || txt;
      const dateTime = xmlValue(resultXml, 'dateTime') || null;
      const statusCode = xmlValue(resultXml, 'statusCode') || null;
      const codeText = xmlValue(resultXml, 'codeText') || null;
      const statusText = xmlValue(resultXml, 'statusText') || null;
      return { ok: true, packet_id: pid, date_time: dateTime, status_code: statusCode, code_text: codeText, status_text: statusText, raw_xml: txt };
    } catch (e) {
      log(`status_api: soap_error ${soapUrl} error=${String(e?.message || e)}`);
      if (debugAttempts) {
        debugAttempts.push({ kind: 'soap', url: soapUrl, soapAction, request: { contentType: 'text/xml', body: requestPreview }, error: String(e?.message || e) });
      }
      return { ok: false, error: 'network_error', message: String(e?.message || e) };
    }
  }

  const isTerminalCodeText = (s) => {
    const t = String(s || '').trim().toLowerCase();
    if (!t) return false;
    return /\bdelivered\b/.test(t) || /\bcancelled\b/.test(t) || /\bcanceled\b/.test(t) || /\breturned\b/.test(t);
  };

  // Robust loader: resolve Playwright either from global resolution or backend/node_modules
  async function loadPlaywrightChromium() {
    try {
      const mod = await import('playwright');
      const chromium = mod.chromium || (mod.default && mod.default.chromium);
      if (chromium) return chromium;
    } catch {}
    try {
      const { pathToFileURL } = await import('url');
      const { createRequire } = await import('module');
      const req = createRequire(path.join(backendDir, 'package.json'));
      const pw = req('playwright');
      if (pw && pw.chromium) return pw.chromium;
    } catch {}
    return null;
  }

  // Internal helper: upsert parsed rows array of objects into DB
  async function upsertRows(rows, orgId) {
    if (!Array.isArray(rows) || !rows.length) return { ok:true, total:0, inserted:0, updated:0, skipped:0, failed:0 };
    log(`upsertRows:start total=${rows.length} org_id=${orgId||'-'}`);
    let inserted = 0, updated = 0, skipped = 0, failed = 0;
    const val = (obj, list) => {
      for (const k of list) {
        if (obj[k] != null && String(obj[k]).trim() !== '') return String(obj[k]).trim();
      }
      return '';
    };
    const toNum = (s) => {
      if (s == null || s === '') return null; const t = String(s).replace(/[^0-9,.-]/g,'').replace(/\s+/g,'').replace(/,(?=\d{1,2}$)/, '.'); const n = parseFloat(t); return Number.isFinite(n) ? n : null;
    };
    const toDateFlex = (s) => {
      if (!s) return null; const t = String(s).trim();
      let m = /^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
      if (m) { const [ , dd, mm, yyyy, HH='00', MM='00', SS='00'] = m; const iso = `${yyyy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}T${String(HH).padStart(2,'0')}:${String(MM).padStart(2,'0')}:${String(SS).padStart(2,'0')}Z`; const d2 = new Date(iso); return isNaN(d2.getTime()) ? null : d2; }
      m = /^(\d{1,2})[.\/](\d{1,2})[.\/](\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
      if (m) { const [ , dd, mm, yy, HH='00', MM='00', SS='00'] = m; const yyyy = (2000 + parseInt(yy,10)).toString(); const iso = `${yyyy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}T${String(HH).padStart(2,'0')}:${String(MM).padStart(2,'0')}:${String(SS).padStart(2,'0')}Z`; const d2 = new Date(iso); return isNaN(d2.getTime()) ? null : d2; }
      m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
      if (m) { const [ , yyyy, mm, dd, HH='00', MM='00', SS='00'] = m; const iso = `${yyyy}-${mm}-${dd}T${HH}:${MM}:${SS}Z`; const d2 = new Date(iso); return isNaN(d2.getTime()) ? null : d2; }
      return null;
    };
    let existenceChecks = 0;
    for (let __i = 0; __i < rows.length; __i++) {
      const rr = rows[__i];
      let submission = '', orderRaw = '', idOrderDbg = '', statusDbg = '', emailDbg = '';
      try {
        submission = val(rr, ['submission','submission_number','Submission','Submission number','Entry','Entry number']);
        // Prefer explicit order fields; avoid ambiguous generic labels like 'Number' that may refer to submission
        orderRaw = val(rr, [
          'order','order_raw','Order','Order number','Order Number','Order No','Order no','Order ID','Order Id','OrderID',
          'id_order','id order','ID order','ID Order','ID_ORDER'
        ]);
        const barcode = val(rr, ['barcode','Barcode','tracking','Tracking']);
        const name = val(rr, ['name','Name','first_name','First name','First Name','Prénom']);
        const surname = val(rr, ['surname','Surname','last_name','Last name','Last Name','Nom']);
        const carrierCsv = val(rr, ['carrier','Carrier']);
        const pickupCsv = val(rr, ['Pick up point or carrier']);
        const carrier = carrierCsv || pickupCsv;
        const sender = val(rr, ['sender','Sender']);
        const cod = toNum(val(rr, ['cod','COD']));
        const currency = val(rr, ['currency','Currency']) || null;
        const status = val(rr, ['status','Status','etat','Etat']);
        statusDbg = status;
        const readyUntil = toDateFlex(val(rr, ['ready_for_pickup_until','Ready for pickup until','Ready for pick up until','Ready until']));
        const deliveredOn = toDateFlex(val(rr, ['delivered_on','Delivered on']));
        const consignedDate = toDateFlex(val(rr, ['consigned_date','Consigned date','Consigned Date','Entry time','Entry date','Entry Date']));
        const emailCsv = val(rr, ['Email','email','E-mail','E‑mail','E – mail']);
        const email = val(rr, ['customer_email']) || emailCsv;
        emailDbg = email || '';
        const packetPrice = toNum(val(rr, ['packet_price','Packet price','price','Price','Montant']));
        // CSV-aligned extras
        const labelFormat = val(rr, ['Label format']);
        const labelPrinted = val(rr, ['Label printed?']);
        const labelDate = toDateFlex(val(rr, ['Date']));
        const recipientName = val(rr, ["Recipient's name", "Recipient’s name", "Recipient\'s name"]) || name;
        const recipientSurname = val(rr, ["Recipient's surname", "Recipient’s surname", "Recipient\'s surname"]) || surname;
        const pickupPointOrCarrier = pickupCsv || carrierCsv;
        const convertedCod = toNum(val(rr, ['Converted currency COD']));
        const note = val(rr, ['Note']);
        const adult18 = /^(1|true|yes|oui|ano)$/i.test(val(rr, ['18+']));
        const storedDate = toDateFlex(val(rr, ['Stored date']));
        const storedTime = val(rr, ['Stored time']);
        const weight = toNum(val(rr, ['Weight']));
        const phone = val(rr, ['Phone']);
        const idOrder = (()=>{ try { const d = String(orderRaw||'').match(/\d+/g)?.join('')||''; return d || null; } catch { return null; } })();
        idOrderDbg = idOrder || '';
        const packetId = (()=>{ try { const first = String(barcode||'').split(',')[0]; const d = String(first||'').replace(/\D+/g,''); return d || null; } catch { return null; } })();
        const vals = [
          submission,
          orderRaw||null,
          idOrder||null,
          barcode||null,
          packetId||null,
          name||null,
          surname||null,
          carrier||null,
          sender||null,
          cod,
          currency,
          status||null,
          readyUntil,
          deliveredOn,
          consignedDate,
          email||null,
          packetPrice,
          orgId||null,
          labelFormat||null,
          labelPrinted||null,
          labelDate||null,
          recipientName||null,
          recipientSurname||null,
          pickupPointOrCarrier||null,
          convertedCod,
          note||null,
          adult18,
          storedDate,
          storedTime||null,
          weight,
          phone||null,
          emailCsv||null
        ];
        // Log first few extracted keys to ensure mapping is correct (+ existence check)
        if (inserted+updated+skipped+failed < 5) {
          const maskedEmail = emailDbg ? (emailDbg.split('@')[0].slice(0,2)+'***@'+emailDbg.split('@')[1]) : '';
          let existsNote = '';
          try {
            if (orderRaw && existenceChecks < 5) {
              existenceChecks++;
              const exq = await pool.query('SELECT 1 FROM public.mod_grabbing_zasilkovna WHERE order_raw = $1 LIMIT 1', [orderRaw]);
              existsNote = exq.rowCount ? ' exists' : ' new';
            }
          } catch {}
          log(`upsertRows:sample order_raw='${orderRaw}' id_order='${idOrderDbg||''}' submission='${submission}' status='${statusDbg||''}' email='${maskedEmail}'${existsNote}`);
        }
        const sql = `
          INSERT INTO mod_grabbing_zasilkovna (
            submission_number, order_raw, id_order, barcode, packet_id,
            name, surname, carrier, sender,
            cod, currency, status, ready_for_pickup_until, delivered_on, consigned_date,
            customer_email, packet_price, created_at, updated_at, org_id,
            label_format, label_printed, label_date,
            recipient_name, recipient_surname,
            pickup_point_or_carrier, converted_currency_cod, note, adult_18_plus, stored_date, stored_time, weight, phone, email)
          VALUES (
            $1,$2,$3,$4,$5,
            $6,$7,$8,$9,
            $10,$11,$12,$13,$14,$15,
            $16,$17,NOW(),NOW(),$18,
            $19,$20,$21,
            $22,$23,
            $24,$25,$26,$27,$28,$29,$30,$31,$32)
          ON CONFLICT (order_raw) DO UPDATE SET
            -- Prefer non-empty values; keep existing when EXCLUDED is null/empty for text
            id_order = COALESCE(NULLIF(EXCLUDED.id_order, ''), mod_grabbing_zasilkovna.id_order),
            barcode = COALESCE(NULLIF(EXCLUDED.barcode, ''), mod_grabbing_zasilkovna.barcode),
            packet_id = COALESCE(NULLIF(EXCLUDED.packet_id, ''), mod_grabbing_zasilkovna.packet_id),
            name = COALESCE(NULLIF(EXCLUDED.name, ''), mod_grabbing_zasilkovna.name),
            surname = COALESCE(NULLIF(EXCLUDED.surname, ''), mod_grabbing_zasilkovna.surname),
            carrier = COALESCE(NULLIF(EXCLUDED.carrier, ''), mod_grabbing_zasilkovna.carrier),
            sender = COALESCE(NULLIF(EXCLUDED.sender, ''), mod_grabbing_zasilkovna.sender),
            -- numerics/dates: only overwrite when not null
            cod = COALESCE(EXCLUDED.cod, mod_grabbing_zasilkovna.cod),
            currency = COALESCE(NULLIF(EXCLUDED.currency, ''), mod_grabbing_zasilkovna.currency),
            status = COALESCE(NULLIF(EXCLUDED.status, ''), mod_grabbing_zasilkovna.status),
            ready_for_pickup_until = COALESCE(EXCLUDED.ready_for_pickup_until, mod_grabbing_zasilkovna.ready_for_pickup_until),
            delivered_on = COALESCE(EXCLUDED.delivered_on, mod_grabbing_zasilkovna.delivered_on),
            consigned_date = COALESCE(EXCLUDED.consigned_date, mod_grabbing_zasilkovna.consigned_date),
            customer_email = COALESCE(NULLIF(EXCLUDED.customer_email, ''), mod_grabbing_zasilkovna.customer_email),
            packet_price = COALESCE(EXCLUDED.packet_price, mod_grabbing_zasilkovna.packet_price),
            org_id = COALESCE(NULLIF(EXCLUDED.org_id, ''), mod_grabbing_zasilkovna.org_id),
            label_format = COALESCE(NULLIF(EXCLUDED.label_format, ''), mod_grabbing_zasilkovna.label_format),
            label_printed = COALESCE(NULLIF(EXCLUDED.label_printed, ''), mod_grabbing_zasilkovna.label_printed),
            label_date = COALESCE(EXCLUDED.label_date, mod_grabbing_zasilkovna.label_date),
            recipient_name = COALESCE(NULLIF(EXCLUDED.recipient_name, ''), mod_grabbing_zasilkovna.recipient_name),
            recipient_surname = COALESCE(NULLIF(EXCLUDED.recipient_surname, ''), mod_grabbing_zasilkovna.recipient_surname),
            pickup_point_or_carrier = COALESCE(NULLIF(EXCLUDED.pickup_point_or_carrier, ''), mod_grabbing_zasilkovna.pickup_point_or_carrier),
            converted_currency_cod = COALESCE(EXCLUDED.converted_currency_cod, mod_grabbing_zasilkovna.converted_currency_cod),
            note = COALESCE(NULLIF(EXCLUDED.note, ''), mod_grabbing_zasilkovna.note),
            adult_18_plus = COALESCE(EXCLUDED.adult_18_plus, mod_grabbing_zasilkovna.adult_18_plus),
            stored_date = COALESCE(EXCLUDED.stored_date, mod_grabbing_zasilkovna.stored_date),
            stored_time = COALESCE(NULLIF(EXCLUDED.stored_time, ''), mod_grabbing_zasilkovna.stored_time),
            weight = COALESCE(EXCLUDED.weight, mod_grabbing_zasilkovna.weight),
            phone = COALESCE(NULLIF(EXCLUDED.phone, ''), mod_grabbing_zasilkovna.phone),
            email = COALESCE(NULLIF(EXCLUDED.email, ''), mod_grabbing_zasilkovna.email),
            updated_at = NOW()
          RETURNING (xmax = 0) AS inserted`;
        const r = await pool.query(sql, vals);
        if (r?.rows?.[0]?.inserted) inserted++; else updated++;
        if (((__i+1) % 50) === 0 || (__i+1) === rows.length) {
          log(`upsertRows:progress ${__i+1}/${rows.length} inserted=${inserted} updated=${updated} failed=${failed}`);
        }
      } catch (e) {
        failed++;
        try { log(`upsertRows:error order_raw='${orderRaw||''}' id_order='${idOrderDbg||''}' message='${(e && e.message) || e}'`); } catch {}
      }
    }
    log(`upsertRows:done total=${rows.length} inserted=${inserted} updated=${updated} skipped=${skipped} failed=${failed}`);
    return { ok:true, total: rows.length, inserted, updated, skipped, failed };
  }

  // Download CSV: supports (A) raw content, (B) direct URL, (C) Playwright login + export or table scrape
  app.post('/api/grabbing-zasilkovna/download', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const b = req.body || {};
      const now = new Date();
      const tag = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
      const defName = `zasilkovna_${tag}.csv`;

      // (A) Raw content
      if (typeof b.content === 'string' && b.content.length) {
        const dest = path.join(dataDir, defName);
        fs.writeFileSync(dest, b.content, 'utf8');
        const st = fs.statSync(dest);
        return res.json({ ok:true, file: { name: defName, path: dest, size: st.size }, download_url: `/api/grabbing-zasilkovna/file/${encodeURIComponent(defName)}` });
      }

      const email = String(b.email || '').trim();
      const password = String(b.password || '').trim();
      const useBrowser = (typeof b.browser === 'boolean') ? !!b.browser : (!!email && !!password);

      if (useBrowser) {
        // (C) Use Playwright to sign in and export/scrape
        sanitizePlaywrightEnv('download');
        const chromium = await loadPlaywrightChromium();
        if (!chromium) return res.status(500).json({ ok:false, error:'playwright_missing', message:'Playwright not available to module. Ensure backend has playwright and Chromium installed.', details: 'npm i -w backend playwright && (cd backend && npx playwright install chromium)' });
        const signInUrl = String(b.signInUrl || b.sign_in_url || 'https://client.packeta.com/en/sign/in');
        const listUrl = String(b.listUrl || b.list_url || 'https://client.packeta.com/en/packets/list');
        const debug = !!b.debug;
        const includeEmail = !!b.include_email;
        const out = { steps: [] };
        const step = (m) => { try { out.steps.push(m); } catch {} };
        let browser, context, page;
        const saveCsv = (content, suggestedName) => {
          const name = suggestedName || defName;
          const dest = path.join(dataDir, name);
          fs.writeFileSync(dest, content, 'utf8');
          const st = fs.statSync(dest);
          return { name, path: dest, size: st.size, download_url: `/api/grabbing-zasilkovna/file/${encodeURIComponent(name)}` };
        };
        try {
          const headless = true; // Force headless even in debug to avoid X server requirement
          const launchArgs = []; try { if (process.getuid && process.getuid() === 0) launchArgs.push('--no-sandbox'); } catch {}
          browser = await chromium.launch({ headless, args: launchArgs, slowMo: debug?80:0 });
          context = await browser.newContext({ acceptDownloads: true });
          page = await context.newPage();
          step('goto sign-in');
          await page.goto(signInUrl, { waitUntil: 'domcontentloaded' });
          // best-effort cookie banners
          try { await page.click('text=/Accept|Souhlasím|Accept All/i', { timeout: 2000 }); } catch {}
          // fill credentials
          try { await page.fill('input[name="email"], input[type="email"]', email, { timeout: 5000 }); } catch {}
          try { await page.fill('input[name="password"], input[type="password"]', password, { timeout: 5000 }); } catch {}
          try { await page.click('button[type="submit"], button:has-text("Sign in"), input[type="submit"]', { timeout: 5000 }); } catch {}
          await page.waitForLoadState('domcontentloaded');
          step('goto list');
          await page.goto(listUrl, { waitUntil: 'domcontentloaded' });

          // Ensure all columns visible (like /download-and-import) before download/scrape
          try {
            const cur = new URL(await page.url());
            const origin = cur.origin; const pathname = cur.pathname.replace(/\/$/, '');
            const baseFromList = `${origin}${pathname}`;
            const candidates = [
              `${baseFromList}?do=list-showAllColumns`,
              `${baseFromList}?list-id=1&do=list-showAllColumns`,
              ...['cs','fr','en'].flatMap(lang => [
                `${origin}/${lang}/packets/list?do=list-showAllColumns`,
                `${origin}/${lang}/packets/list?list-id=1&do=list-showAllColumns`
              ])
            ];
            let applied = false;
            for (const u2 of candidates) {
              try {
                const ck = await context.cookies(u2);
                const cookieHeader2 = ck.map(c => `${c.name}=${c.value}`).join('; ');
                const r2 = await fetch(u2, { headers: { 'Cookie': cookieHeader2, 'User-Agent': 'Mozilla/5.0 (PlaywrightBot)', 'Referer': await page.url(), 'Accept': 'text/html,*/*;q=0.8', 'X-Requested-With': 'XMLHttpRequest' } });
                step(`show_all_columns_try ${u2} -> ${r2.status}`);
                if (r2.ok) { applied = true; break; }
              } catch {}
            }
            if (!applied) {
              const selectors = [
                "a.ajax.dropdown-item:has-text('Zobrazit všechny sloupce')",
                "a.dropdown-item:has-text('Zobrazit všechny sloupce')",
                "a.dropdown-item:has-text('Show all columns')",
                "a.dropdown-item:has-text('Afficher toutes les colonnes')"
              ];
              for (const sel of selectors) {
                try { await page.click(sel, { timeout: 1500 }); step(`show_all_columns_click ${sel}`); applied = true; break; } catch {}
              }
            }
            if (applied) { try { await page.reload({ waitUntil:'domcontentloaded' }); } catch {} }
            // Increase per page
            try {
              const cur2 = new URL(await page.url());
              if (!cur2.searchParams.get('list-perPage')) cur2.searchParams.set('list-perPage','500');
              if (!cur2.searchParams.get('list-page')) cur2.searchParams.set('list-page','1');
              const target = cur2.toString();
              step(`per_page=${cur2.searchParams.get('list-perPage')}`);
              await page.goto(target, { waitUntil: 'domcontentloaded' });
            } catch {}
          } catch {}

          // Attempt to trigger CSV download
          let downloadFile = null;
          try {
            const dlPromise = page.waitForEvent('download', { timeout: 10000 });
            // Try common export triggers
            const clicked = await Promise.race([
              page.click('a:has-text("CSV")', { timeout: 5000 }).then(()=>true).catch(()=>false),
              page.click('button:has-text("CSV")', { timeout: 5000 }).then(()=>true).catch(()=>false),
              page.click('[download][href*="csv" i]', { timeout: 5000 }).then(()=>true).catch(()=>false),
            ]);
            if (clicked) {
              const dl = await dlPromise;
              const suggested = dl.suggestedFilename() || defName;
              const dest = path.join(dataDir, suggested);
              await dl.saveAs(dest);
              const st = fs.statSync(dest);
              downloadFile = { name: suggested, path: dest, size: st.size, download_url: `/api/grabbing-zasilkovna/file/${encodeURIComponent(suggested)}` };
              step(`downloaded=${suggested}`);
            }
          } catch {}

          // Fallback: scrape table to CSV
          if (!downloadFile) {
            step('scrape table -> CSV');
            const { csv, hasEmail } = await page.evaluate((includeEmailEval) => {
              const norm = (s) => (s||'').replace(/\s+/g,' ').trim();
              const findTable = () => {
                const tables = Array.from(document.querySelectorAll('table'));
                for (const t of tables) {
                  const head = Array.from(t.querySelectorAll('thead th')).map(th=>norm(th.innerText||th.textContent||'')).join(' | ').toLowerCase();
                  if (/barcode|tracking|order|submission|podání|podani|objedn/.test(head)) return t;
                }
                return tables[0] || null;
              };
              const t = findTable();
              const d = ';';
              const rows = [];
              if (t) {
                const hs = Array.from(t.querySelectorAll('thead th')).map(th=>norm(th.innerText||th.textContent||''));
                const headers = [...hs];
                const hasEmailCol = headers.some(h=>/e[-\s]?mail|email/i.test(h));
                if (includeEmailEval && !hasEmailCol) headers.push('E-mail');
                rows.push(headers.join(d));
                const trs = Array.from(t.querySelectorAll('tbody tr'));
                for (const tr of trs) {
                  const tds = Array.from(tr.querySelectorAll('td'));
                  const vals = tds.map(td=>norm(td.innerText||td.textContent||''));
                  if (includeEmailEval && !hasEmailCol) {
                    const a = tr.querySelector('a[href^="mailto:"]');
                    let email = '';
                    if (a) { const m = (a.getAttribute('href')||'').match(/mailto:([^?&#\s]+)/i); if (m) email = m[1]; }
                    if (!email) { const txt = norm(tr.innerText||tr.textContent||''); const m2 = txt.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i); if (m2) email = m2[0]; }
                    vals.push(email);
                  }
                  rows.push(vals.join(d));
                }
              }
              return { csv: rows.join('\n'), hasEmail: rows.length>0 };
            }, includeEmail);
            if (!csv || !csv.trim()) throw new Error('table_not_found');
            downloadFile = saveCsv(csv, defName);
          }

          await page.close().catch(()=>{}); await context.close().catch(()=>{}); await browser.close().catch(()=>{});
          return res.json({ ok:true, file: downloadFile, steps: out.steps });
        } catch (e) {
          try { await page?.close(); } catch {} try { await context?.close(); } catch {} try { await browser?.close(); } catch {}
          return res.status(500).json({ ok:false, error:'download_failed', message: e?.message || String(e), steps: out.steps });
        }
      }

      // (B) Direct URL fetch
      const url = String(b.url || '').trim();
      if (!url) return res.status(400).json({ ok:false, error:'bad_request', message:'Provide content, credentials, or url' });
      const hdr = (b.headers && typeof b.headers==='object') ? b.headers : {};
      const f = (globalThis.fetch || (await import('node-fetch')).default);
      const r = await f(url, { headers: hdr });
      if (!r.ok) {
        const body = await r.text().catch(()=> '');
        return res.status(400).json({ ok:false, error:'download_failed', status: r.status, body: body.slice(0,2000) });
      }
      const buf = Buffer.from(await r.arrayBuffer());
      const dest = path.join(dataDir, defName);
      fs.writeFileSync(dest, buf);
      const st = fs.statSync(dest);
      return res.json({ ok:true, file: { name: defName, path: dest, size: st.size }, download_url: `/api/grabbing-zasilkovna/file/${encodeURIComponent(defName)}` });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });

  const parseCsv = (text, delim) => {
    const lines = String(text||'').split(/\r?\n/).filter(l=>l.length>0);
    if (!lines.length) return { headers: [], rows: [] };
    const sample = lines.slice(0, 20).join('\n');
    const guess = delim || (/(;|\t)/.test(sample) ? (sample.includes(';')?';':'\t') : ',');
    const split = (s) => {
      const out = [];
      let cur = '';
      let q = false;
      for (let i=0;i<s.length;i++) {
        const ch = s[i];
        if (ch === '"') { q = !q; cur += ch; continue; }
        if (!q && ch === guess) { out.push(cur); cur=''; continue; }
        cur += ch;
      }
      out.push(cur);
      return out.map(x => x.replace(/^\"|\"$/g,'').replace(/\"\"/g,'"'));
    };
    const headers = split(lines[0]).map(h=>h.trim());
    const rows = [];
    for (let i=1;i<lines.length;i++) {
      const cols = split(lines[i]);
      if (cols.every(c=>c.trim()==='')) continue;
      const obj = {};
      for (let j=0;j<headers.length;j++) obj[headers[j]||`col${j+1}`] = cols[j] ?? '';
      rows.push(obj);
    }
    return { headers, rows };
  };

  app.post('/api/grabbing-zasilkovna/parse', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const b = req.body || {};
      let text = '';
      if (typeof b.content === 'string' && b.content.length) text = b.content;
      else if (typeof b.name === 'string' && b.name.trim()) {
        const p = path.join(dataDir, b.name.trim());
        if (!fs.existsSync(p)) return res.status(404).json({ ok:false, error:'not_found' });
        text = fs.readFileSync(p, 'utf8');
      } else return res.status(400).json({ ok:false, error:'bad_request', message:'content or name required' });
      const { headers, rows } = parseCsv(text, b.delimiter);
      return res.json({ ok:true, headers, count: rows.length, sample: rows.slice(0, 5) });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });

  app.get('/api/grabbing-zasilkovna/latest', async (_req, res) => {
    try {
      if (!fs.existsSync(dataDir)) return res.json({ ok:true, items: [] });
      const all = fs.readdirSync(dataDir, { withFileTypes: true })
        .filter(d => d.isFile() && /\.(csv|json|png)$/i.test(d.name));
      const items = all.map(d => {
        const p = path.join(dataDir, d.name); const st = fs.statSync(p);
        return { name: d.name, size: st.size, mtime: st.mtime, download_url: `/api/grabbing-zasilkovna/file/${encodeURIComponent(d.name)}` };
      }).sort((a,b)=> b.mtime - a.mtime).slice(0, 100);
      res.json({ ok:true, items });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Debug: report which DB/schema/table the module sees and basic stats
  app.get('/api/grabbing-zasilkovna/debug/where', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      const info = await pool.query('select current_database() as db, current_schema() as schema');
      const table = await pool.query("select to_regclass('public.mod_grabbing_zasilkovna') as rel");
      let count = 0, sample = [];
      if (table.rows?.[0]?.rel) {
        const c = await pool.query('select count(*)::int as c from public.mod_grabbing_zasilkovna');
        count = c.rows?.[0]?.c || 0;
        const s = await pool.query('select order_raw, packet_id, id_order, status, updated_at from public.mod_grabbing_zasilkovna order by updated_at desc nulls last limit 5');
        sample = s.rows || [];
      }
      return res.json({ ok:true, db: info.rows?.[0]?.db, schema: info.rows?.[0]?.schema, table_exists: !!table.rows?.[0]?.rel, count, sample });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Debug: fetch a single row by order_raw
  app.get('/api/grabbing-zasilkovna/row/:order', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      const key = String(req.params.order||'').trim();
      if (!key) return res.status(400).json({ ok:false, error:'bad_request' });
      const r = await pool.query('SELECT * FROM public.mod_grabbing_zasilkovna WHERE order_raw=$1 LIMIT 1', [key]);
      return res.json({ ok:true, exists: !!r.rowCount, row: r.rows?.[0] || null });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Debug: exists helper (lightweight)
  app.get('/api/grabbing-zasilkovna/exists/:order', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      const key = String(req.params.order||'').trim();
      if (!key) return res.status(400).json({ ok:false, error:'bad_request' });
      const r = await pool.query('SELECT 1 FROM public.mod_grabbing_zasilkovna WHERE order_raw=$1 LIMIT 1', [key]);
      return res.json({ ok:true, exists: !!r.rowCount });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Import CSV content or a saved file into mod_grabbing_zasilkovna with ON CONFLICT (order_raw)
  app.post('/api/grabbing-zasilkovna/import', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      const b = req.body || {};
      const orgId = (typeof b.org_id === 'string' && b.org_id.trim()) ? b.org_id.trim() : (typeof req.headers['x-org-id'] === 'string' ? String(req.headers['x-org-id']).trim() : null);
      const limit = (() => { try { const v = Number(b.limit ?? req.query?.limit); return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0; } catch { return 0; } })();
      let text = '';
      if (typeof b.content === 'string' && b.content.length) text = b.content;
      else if (typeof b.name === 'string' && b.name.trim()) {
        const p = path.join(dataDir, b.name.trim());
        if (!fs.existsSync(p)) return res.status(404).json({ ok:false, error:'not_found' });
        text = fs.readFileSync(p, 'utf8');
      } else return res.status(400).json({ ok:false, error:'bad_request', message:'content or name required' });

      // Helpers (ported from legacy server.js.pre_strip.bak)
      const stripBom = (s='') => (s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s);
      const pickDelim = (headerLine='') => {
        const cands = [';', '\t', ','];
        let best = ';', bestCount = -1;
        for (const d of cands) { const c = (headerLine.split(d).length - 1); if (c > bestCount) { best = d; bestCount = c; } }
        return best;
      };
      const parseLine = (line, d) => {
        const out = [];
        let cur = '';
        let inQ = false;
        for (let i=0;i<line.length;i++) {
          const ch = line[i];
          if (inQ) {
            if (ch === '"') { if (line[i+1] === '"') { cur += '"'; i++; } else { inQ = false; } }
            else { cur += ch; }
          } else {
            if (ch === '"') inQ = true;
            else if (ch === d) { out.push(cur); cur = ''; }
            else cur += ch;
          }
        }
        out.push(cur);
        return out;
      };
      const lines = stripBom(text).split(/\r?\n/);
      if (!lines.length) return res.json({ ok:true, total:0, inserted:0, updated:0, skipped:0, failed:0 });
      const headerLine = lines[0];
      const d = pickDelim(headerLine);
      const headers = parseLine(headerLine, d).map(s => (s||'').trim());
      const norm = (s='') => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
      const findIdx = (pats) => {
        const ps = pats.map(p => (typeof p === 'string' ? new RegExp(p, 'i') : p));
        for (let i=0;i<headers.length;i++) { const h = headers[i]; const hn = norm(h); if (ps.some(re => re.test(h) || re.test(hn))) return i; }
        return -1;
      };
      const idx = {
        submission: findIdx([/submission/, /podani|podaci|podan/i, /entry/]),
        order: findIdx([/order/, /objedn|commande|pedido/i]),
        barcode: findIdx([/barcode|tracking|k[oó]d|code\s*barre/i]),
        name: findIdx([/recipient.*name|^name$|jmeno|prijemce/i]),
        surname: findIdx([/surname|last\s*name|prijmeni/i]),
        carrier: findIdx([/carrier|pick[-\s]?up|pickup|point|vydejni|poste/i]),
        sender: findIdx([/sender|odesilatel/i]),
        cod: findIdx([/\bCOD\b|cash\s*on\s*delivery|dobir/i]),
        currency: findIdx([/currency|mena|monnaie|valuta/i]),
        status: findIdx([/status|stav|etat/i]),
        ready_until: findIdx([/ready\s*for\s*pick\s*up.*until|vyzvedn|until/i]),
        delivered_on: findIdx([/delivered\s*on|doruc|livr/i]),
        consigned_date: findIdx([/consigned|podan|shipped|exped/i]),
        email: findIdx([/(^|\b)e[-\s]?mail\b|email/i]),
        packet_price: findIdx([/packet\s*price|^price$|cena|montant/i]),
      };
      const toNum = (s) => { if (s == null) return null; const t = String(s).replace(/[^0-9,.-]/g,'').replace(/\s+/g,'').replace(/,(?=\d{1,2}$)/, '.'); const n = parseFloat(t); return Number.isFinite(n) ? n : null; };
      const toDate = (s) => {
        if (!s) return null; const t = String(s).trim();
        let m = /^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
        if (m) { const [ , dd, mm, yyyy, HH='00', MM='00', SS='00'] = m; const iso = `${yyyy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}T${String(HH).padStart(2,'0')}:${String(MM).padStart(2,'0')}:${String(SS).padStart(2,'0')}Z`; const d2 = new Date(iso); return isNaN(d2.getTime()) ? null : d2; }
        m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
        if (m) { const [ , yyyy, mm, dd, HH='00', MM='00', SS='00'] = m; const iso = `${yyyy}-${mm}-${dd}T${HH}:${MM}:${SS}Z`; const d2 = new Date(iso); return isNaN(d2.getTime()) ? null : d2; }
        return null;
      };
      const get = (arr, i) => (i>=0 && i < arr.length ? (arr[i]??'').toString().trim() : '');
      const computeIdOrderText = (s) => { const d = String(s||'').match(/\d+/g)?.join('') || ''; return d || null; };
      const computePacketId = (barcode) => { const first = String(barcode||'').split(',')[0] || String(barcode||''); const digits = first.replace(/\D+/g,''); return digits || null; };

      const rows = [];
      for (let i=1;i<lines.length;i++) { const l = lines[i]; if (l == null || l === '') continue; const arr = parseLine(l, d); if (!arr.length || arr.every(x => String(x||'').trim()==='')) continue; rows.push(arr); }
      try {
        log(`import_csv:start rows=${rows.length} limit=${limit||0} org_id=${orgId||'-'}`);
        if (rows.length > 0) {
          const hdr = (k) => headers.find(h => h.toLowerCase() === k) || k;
          const first = rows[0] || [];
          const orderIdx = idx.order;
          const subIdx = idx.submission;
          const orderVal = orderIdx>=0 ? String(first[orderIdx]||'').trim() : '';
          const subVal = subIdx>=0 ? String(first[subIdx]||'').trim() : '';
          log(`import_csv:first_row submission='${subVal}' order='${orderVal}'`);
        }
      } catch {}
      let total = 0, insertedCount = 0, updatedCount = 0, failedCount = 0, skippedCount = 0; const failedLines = [], skippedLines = [];
      const max = limit > 0 ? Math.min(limit, rows.length) : rows.length;
      for (let ri = 0; ri < max; ri++) {
        const arr = rows[ri]; const csvLine = ri + 2; total++;
        let orderRaw = '';
        try {
          const submission = get(arr, idx.submission);
          if (!submission) { skippedCount++; skippedLines.push(csvLine); continue; }
          orderRaw = get(arr, idx.order);
          if (!orderRaw) { skippedCount++; skippedLines.push(csvLine); continue; }
          const idOrder = computeIdOrderText(orderRaw);
          const barcode = get(arr, idx.barcode);
          const packetId = computePacketId(barcode);
          const name = get(arr, idx.name);
          const surname = get(arr, idx.surname);
          const carrier = get(arr, idx.carrier);
          const sender = get(arr, idx.sender);
          const cod = toNum(get(arr, idx.cod));
          const currency = get(arr, idx.currency) || null;
          const status = get(arr, idx.status);
          const readyUntil = toDate(get(arr, idx.ready_until));
          const deliveredOn = toDate(get(arr, idx.delivered_on));
          const consignedDate = toDate(get(arr, idx.consigned_date));
          const email = get(arr, idx.email);
          const packetPrice = toNum(get(arr, idx.packet_price));
          const vals = [ submission, orderRaw || null, idOrder || null, barcode || null, packetId || null, name || null, surname || null, carrier || null, sender || null, cod, currency, status || null, readyUntil, deliveredOn, consignedDate, email || null, packetPrice, orgId ];
          const upsertSql = `
            INSERT INTO mod_grabbing_zasilkovna (
              submission_number, order_raw, id_order, barcode, packet_id, name, surname, carrier, sender,
              cod, currency, status, ready_for_pickup_until, delivered_on, consigned_date, customer_email, packet_price, created_at, updated_at, org_id)
            VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8,$9,
              $10,$11,$12,$13,$14,$15,$16,$17,NOW(),NOW(),$18)
            ON CONFLICT (order_raw) DO UPDATE SET
              id_order = COALESCE(NULLIF(EXCLUDED.id_order, ''), mod_grabbing_zasilkovna.id_order),
              barcode = COALESCE(NULLIF(EXCLUDED.barcode, ''), mod_grabbing_zasilkovna.barcode),
              packet_id = COALESCE(NULLIF(EXCLUDED.packet_id, ''), mod_grabbing_zasilkovna.packet_id),
              name = COALESCE(NULLIF(EXCLUDED.name, ''), mod_grabbing_zasilkovna.name),
              surname = COALESCE(NULLIF(EXCLUDED.surname, ''), mod_grabbing_zasilkovna.surname),
              carrier = COALESCE(NULLIF(EXCLUDED.carrier, ''), mod_grabbing_zasilkovna.carrier),
              sender = COALESCE(NULLIF(EXCLUDED.sender, ''), mod_grabbing_zasilkovna.sender),
              cod = COALESCE(EXCLUDED.cod, mod_grabbing_zasilkovna.cod),
              currency = COALESCE(NULLIF(EXCLUDED.currency, ''), mod_grabbing_zasilkovna.currency),
              status = COALESCE(NULLIF(EXCLUDED.status, ''), mod_grabbing_zasilkovna.status),
              ready_for_pickup_until = COALESCE(EXCLUDED.ready_for_pickup_until, mod_grabbing_zasilkovna.ready_for_pickup_until),
              delivered_on = COALESCE(EXCLUDED.delivered_on, mod_grabbing_zasilkovna.delivered_on),
              consigned_date = COALESCE(EXCLUDED.consigned_date, mod_grabbing_zasilkovna.consigned_date),
              customer_email = COALESCE(NULLIF(EXCLUDED.customer_email, ''), mod_grabbing_zasilkovna.customer_email),
              packet_price = COALESCE(EXCLUDED.packet_price, mod_grabbing_zasilkovna.packet_price),
              org_id = COALESCE(NULLIF(EXCLUDED.org_id, ''), mod_grabbing_zasilkovna.org_id),
              updated_at = NOW()
            RETURNING (xmax = 0) AS inserted, submission_number, order_raw, id_order, packet_id, barcode`;
          const r = await pool.query(upsertSql, vals);
          const row = r?.rows?.[0];
          if (row) { if (row.inserted) insertedCount++; else updatedCount++; }
          if (((ri+1) % 50) === 0 || (ri+1) === rows.length) {
            log(`import_csv:progress ${ri+1}/${rows.length} inserted=${insertedCount} updated=${updatedCount} failed=${failedCount}`);
          }
        } catch (e) {
          failedCount++; failedLines.push(csvLine);
          try { log(`import_csv:error line=${csvLine} order_raw='${orderRaw||''}' message='${(e && e.message) || e}'`); } catch {}
        }
      }
      try { log(`import_csv:done total=${total} inserted=${insertedCount} updated=${updatedCount} skipped=${skippedCount} failed=${failedCount}`); } catch {}
      return res.json({ ok:true, total, inserted: insertedCount, updated: updatedCount, skipped: skippedCount, failed: failedCount, failed_lines: failedLines, skipped_lines: skippedLines });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });

  app.post('/api/grabbing-zasilkovna/cleanup', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const days = Math.max(1, Math.min(365, Number(req.body?.days || 30)));
      const cutoff = Date.now() - days*24*60*60*1000;
      let removed = 0;
      if (fs.existsSync(dataDir)) {
        for (const d of fs.readdirSync(dataDir, { withFileTypes: true })) {
          if (!d.isFile()) continue;
          const p = path.join(dataDir, d.name);
          const st = fs.statSync(p);
          if (+st.mtime < cutoff) { try { fs.unlinkSync(p); removed++; } catch {} }
        }
      }
      res.json({ ok:true, removed });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.get('/api/grabbing-zasilkovna/file/:name', (req, res) => {
    try {
      const name = String(req.params.name||'').replace(/[^A-Za-z0-9._\-]/g,'');
      const p = path.join(dataDir, name);
      if (!name || !fs.existsSync(p)) return res.status(404).json({ ok:false, error:'not_found' });
      const dl = /^(1|true|yes)$/i.test(String(req.query?.download||''));
      const ex = path.extname(name).toLowerCase();
      const ct = ex === '.csv' ? 'text/csv' : (ex === '.png' ? 'image/png' : 'application/json');
      res.setHeader('Content-Type', ct);
      if (dl) res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      fs.createReadStream(p).pipe(res);
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Export exact CSV header order (duplicates allowed in header row)
  app.get('/api/grabbing-zasilkovna/export', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const orgId = typeof req.query.org_id === 'string' ? String(req.query.org_id).trim() : '';
      const limit = Math.min(5000, Math.max(1, Number(req.query.limit||1000)));
      const where = orgId ? 'WHERE org_id = $1' : '';
      const vals = orgId ? [orgId, limit] : [limit];
      const sql = `
        SELECT label_format, submission_number, label_printed, label_date, order_raw, barcode,
               COALESCE(recipient_name, name) AS recipient_name,
               COALESCE(recipient_surname, surname) AS recipient_surname,
               COALESCE(pickup_point_or_carrier, carrier) AS pickup_point_or_carrier,
               sender, cod, currency, converted_currency_cod, status,
               ready_for_pickup_until, delivered_on, note, adult_18_plus,
               consigned_date, stored_date, stored_time, weight, phone,
               COALESCE(email, customer_email) AS email,
               packet_price, currency AS price_currency
          FROM public.mod_grabbing_zasilkovna
          ${where}
          ORDER BY (order_raw)::text DESC
          LIMIT $${orgId?2:1}`;
      const r = await pool.query(sql, vals);
      const headers = [
        'Label format','Submission number','Label printed?','Date','Order','Barcode',
        "Recipient's name","Recipient's surname",'Pick up point or carrier','Sender','COD','Currency','Converted currency COD','Status','Ready for pick up until','Delivered on','Note','18+','Consigned Date','Stored date','Stored time','Weight','Phone','Email','Packet price','Currency'
      ];
      const rows = r.rows || [];
      const toCsv = (v) => {
        if (v == null) return '';
        const s = (v instanceof Date) ? v.toISOString() : String(v);
        if (/[";\n]/.test(s)) return '"'+s.replace(/"/g,'""')+'"';
        return s;
      };
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="zasilkovna_export.csv"');
      res.write(headers.join(';') + '\n');
      for (const row of rows) {
        const line = [
          row.label_format,
          row.submission_number,
          row.label_printed,
          row.label_date,
          row.order_raw,
          row.barcode,
          row.recipient_name,
          row.recipient_surname,
          row.pickup_point_or_carrier,
          row.sender,
          row.cod,
          row.currency,
          row.converted_currency_cod,
          row.status,
          row.ready_for_pickup_until,
          row.delivered_on,
          row.note,
          row.adult_18_plus,
          row.consigned_date,
          row.stored_date,
          row.stored_time,
          row.weight,
          row.phone,
          row.email,
          row.packet_price,
          row.price_currency
        ].map(toCsv).join(';');
        res.write(line + '\n');
      }
      res.end();
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Step 3: Populate tracking links (Packeta + external) for rows meeting criteria
  app.post('/api/grabbing-zasilkovna/tracking/update', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      const b = req.body || {};
      const cfgId = typeof b.id === 'string' ? b.id.trim() : '';
      const onlyMissing = b.only_missing === undefined ? true : !!b.only_missing;
      const limit = Math.max(1, Math.min(2000, Number(b.limit || 200)));
      const orgId = (typeof b.org_id === 'string' && b.org_id.trim()) ? b.org_id.trim() : null;

      const out = await updateTrackingLinks({ cfgId, onlyMissing, limit, orgId });
      log(`tracking_update:done limit=${limit} updated_packeta=${out.updated_packeta} updated_external=${out.updated_external} skipped=${out.skipped} failed=${out.failed}`);
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });

  // Step 3 (test): Given a packet_id, return Packeta tracking URLs using selected config creds
  app.post('/api/grabbing-zasilkovna/tracking/test', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      await ensureConfigTable();
      const b = req.body || {};
      const cfgId = typeof b.id === 'string' ? b.id.trim() : '';
      const packetId = typeof b.packet_id === 'string' ? b.packet_id.trim() : '';
      if (!packetId) return res.status(400).json({ ok:false, error:'bad_request', message:'packet_id required' });

      // Load API creds from config
      let apiKey = '', apiPassword = '', apiBase = '';
      if (cfgId) {
        const r = await pool.query('SELECT options FROM mod_grabbing_zasilkovna_config WHERE id=$1 LIMIT 1', [cfgId]);
        if (r.rowCount) {
          const p = r.rows[0]?.options?.packeta || {};
          apiKey = String(p.apiKey||'');
          apiPassword = String(p.apiPassword||'');
          apiBase = String(p.apiBase||'');
        }
      }

      const urlPacketa = buildPacketaTrackingUrl(packetId);
      const attempts = [];
      const info = await fetchExternalTrackingInfo(apiKey, apiPassword, packetId, apiBase, attempts);
      return res.json({
        ok: true,
        packet_id: packetId,
        url_packeta: urlPacketa,
        url_external: info?.tracking_external_url || null,
        courier_tracking_number: info?.courier_tracking_number || null,
        debug: { attempts },
      });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });

  app.get('/api/grabbing-zasilkovna/tracking/latest', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      try {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Surrogate-Control', 'no-store');
      } catch {}
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      const onlyMissing = /^(?:1|true|yes)$/i.test(String(req.query?.only_missing || ''));
      const hasLimit = req.query?.limit !== undefined && req.query?.limit !== null && String(req.query.limit).trim() !== '';
      const limitVal = hasLimit ? Math.max(1, Math.min(2000, Number(req.query?.limit ?? 200) || 200)) : null;
      const orgId = typeof req.query?.org_id === 'string' ? req.query.org_id.trim() : '';
      const where = [];
      const vals = [];
      if (orgId) { vals.push(orgId); where.push(`org_id = $${vals.length}`); }
      const rowsSql = `
        SELECT COALESCE(
                 NULLIF(TRIM(name), ''),
                 NULLIF(TRIM(CONCAT_WS(' ', recipient_name, recipient_surname)), ''),
                 NULLIF(TRIM(recipient_name), ''),
                 NULLIF(TRIM(recipient_surname), ''),
                 '—'
               ) AS name,
               submission_number,
               order_raw,
               id_order,
               packet_id,
               consigned_date,
               recipient_name,
               recipient_surname,
               phone,
               email,
               status,
               tracking_packeta_url,
               tracking_external_url,
               courier_tracking_number,
               updated_at
          FROM public.mod_grabbing_zasilkovna
       WHERE (packet_id IS NOT NULL AND packet_id <> '')
          ${where.length ? `AND ${where.join(' AND ')}` : ''}
          AND (consigned_date >= now() - interval '3 months' OR consigned_date IS NULL)
        ${onlyMissing ? "AND ((tracking_packeta_url IS NULL OR tracking_packeta_url = '') OR (tracking_external_url IS NULL OR tracking_external_url = '') OR (courier_tracking_number IS NULL OR courier_tracking_number = ''))" : ''}
         ORDER BY updated_at DESC NULLS LAST
      `;
      const sql = hasLimit ? `${rowsSql}\n LIMIT $${vals.length + 1}` : rowsSql;
      const rows = (await pool.query(sql, hasLimit ? [...vals, limitVal] : vals)).rows || [];
      return res.json({ ok:true, rows });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });

  // Step 4: Fetch packet status from Zasilkovna SOAP API and store snapshot in DB
  app.post('/api/grabbing-zasilkovna/status/fetch', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      await ensureConfigTable();
      await ensureStatusTable();

      const b = req.body || {};
      const cfgId = typeof b.id === 'string' ? b.id.trim() : '';
      const packetId = typeof b.packet_id === 'string' ? b.packet_id.trim() : '';
      const orgId = (typeof b.org_id === 'string' && b.org_id.trim()) ? b.org_id.trim() : null;
      if (!packetId) return res.status(400).json({ ok:false, error:'bad_request', message:'packet_id required' });

      // If packet is already terminal, do not re-check
      try {
        const vals = [packetId];
        let where = 'packet_id=$1';
        if (orgId) { vals.push(orgId); where += ` AND org_id=$2`; }
        const lr = await pool.query(
          `SELECT id, code_text, status_text, status_code, status_at, created_at, org_id
             FROM public.mod_grabbing_zasilkovna_status
            WHERE ${where}
            ORDER BY created_at DESC
            LIMIT 1`,
          vals
        );
        const last = lr.rows?.[0] || null;
        if (last && isTerminalCodeText(last.code_text)) {
          return res.json({ ok:true, packet_id: packetId, skipped: true, reason: 'terminal', last_status: last });
        }
      } catch {}

      let apiPassword = '', apiBase = '';
      if (cfgId) {
        const r = await pool.query('SELECT options FROM mod_grabbing_zasilkovna_config WHERE id=$1 LIMIT 1', [cfgId]);
        if (r.rowCount) {
          const p = r.rows[0]?.options?.packeta || {};
          apiPassword = String(p.apiPassword || '');
          apiBase = String(p.apiBase || '');
        }
      }

      const attempts = [];
      const out = await fetchPacketStatus({ apiPassword, packetId, apiBase, debugAttempts: attempts });
      if (!out.ok) return res.status(502).json({ ok:false, error: out.error || 'upstream_error', message: out.message || null, status: out.status || null, body: out.body || null, debug: { attempts } });

      const rawPreview = String(out.raw_xml || '').slice(0, 8000);
      const statusAt = (() => {
        if (!out.date_time) return null;
        const d = new Date(out.date_time);
        return Number.isFinite(d.getTime()) ? d : null;
      })();
      const ins = await pool.query(
        `INSERT INTO public.mod_grabbing_zasilkovna_status (packet_id, status_code, code_text, status_text, status_at, raw_xml, org_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, created_at`,
        [packetId, out.status_code, out.code_text, out.status_text, statusAt, rawPreview, orgId]
      );
      return res.json({ ok:true, packet_id: packetId, status: { status_code: out.status_code, code_text: out.code_text, status_text: out.status_text, date_time: out.date_time }, stored: { id: ins.rows?.[0]?.id, created_at: ins.rows?.[0]?.created_at }, debug: { attempts } });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });

  // Step 4: List stored status snapshots (latest first)
  app.get('/api/grabbing-zasilkovna/status/latest', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      await ensureStatusTable();
      const limitVal = Math.max(1, Math.min(200, Number(req.query?.limit ?? 20) || 20));
      const packetId = typeof req.query?.packet_id === 'string' ? req.query.packet_id.trim() : '';
      const orgId = typeof req.query?.org_id === 'string' ? req.query.org_id.trim() : '';
      const where = [];
      const vals = [];
      if (packetId) { vals.push(packetId); where.push(`packet_id=$${vals.length}`); }
      if (orgId) { vals.push(orgId); where.push(`org_id=$${vals.length}`); }
      const sql = `
        SELECT id, packet_id, status_code, code_text, status_text, status_at, source, created_at, org_id
          FROM public.mod_grabbing_zasilkovna_status
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY created_at DESC
         LIMIT $${vals.length + 1}
      `;
      const r = await pool.query(sql, [...vals, limitVal]);
      return res.json({ ok:true, rows: r.rows || [] });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });

  // Step 4 (batch): fetch packet status for packet_ids from mod_grabbing_zasilkovna
  app.post('/api/grabbing-zasilkovna/status/fetch-batch', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      await ensureConfigTable();
      await ensureStatusTable();
      const b = req.body || {};
      const cfgId = typeof b.id === 'string' ? b.id.trim() : '';
      if (!cfgId) return res.status(400).json({ ok:false, error:'bad_request', message:'config id required' });
      const limit = Math.max(1, Math.min(500, Number(b.limit || 50) || 50));
      const concurrency = Math.max(1, Math.min(10, Number(b.concurrency || 3) || 3));
      const onlyMissing = b.only_missing === undefined ? true : !!b.only_missing;
      const orgId = (typeof b.org_id === 'string' && b.org_id.trim()) ? b.org_id.trim() : null;

      let apiPassword = '', apiBase = '';
      {
        const r = await pool.query('SELECT options FROM mod_grabbing_zasilkovna_config WHERE id=$1 LIMIT 1', [cfgId]);
        if (r.rowCount) {
          const p = r.rows[0]?.options?.packeta || {};
          apiPassword = String(p.apiPassword || '');
          apiBase = String(p.apiBase || '');
        }
      }
      if (!apiPassword) return res.status(400).json({ ok:false, error:'bad_request', message:'config packeta.apiPassword missing' });

      const where = [
        `(z.packet_id IS NOT NULL AND z.packet_id <> '')`,
        `(z.status IS NULL OR z.status NOT ILIKE 'cancel%')`,
      ];
      const vals = [];
      let orgIdx = null;
      if (orgId) { vals.push(orgId); orgIdx = vals.length; where.push(`z.org_id = $${orgIdx}`); }
      const terminalClause = `AND NOT EXISTS (
        SELECT 1
          FROM public.mod_grabbing_zasilkovna_status s_term
         WHERE s_term.packet_id = z.packet_id
           ${orgIdx ? `AND s_term.org_id = $${orgIdx}` : ''}
           AND (
             s_term.code_text ILIKE '%delivered%'
             OR s_term.code_text ILIKE '%cancelled%'
             OR s_term.code_text ILIKE '%canceled%'
             OR s_term.code_text ILIKE '%returned%'
           )
      )`;
      const missingClause = onlyMissing
        ? `AND NOT EXISTS (SELECT 1 FROM public.mod_grabbing_zasilkovna_status s WHERE s.packet_id = z.packet_id ${orgIdx ? `AND s.org_id = $${orgIdx}` : ''} )`
        : '';

      // Count total candidates for UI (best-effort)
      let todoTotal = null;
      try {
        const countSql = `
          SELECT COUNT(*)::int AS c
            FROM (
              SELECT z.packet_id
                FROM public.mod_grabbing_zasilkovna z
               WHERE ${where.join(' AND ')}
               ${terminalClause}
               ${missingClause}
               GROUP BY z.packet_id
            ) q
        `;
        const cr = await pool.query(countSql, vals);
        todoTotal = cr.rows?.[0]?.c ?? null;
      } catch {}

      const pickSql = `
        SELECT z.packet_id AS packet_id, MAX(z.updated_at) AS last_seen
          FROM public.mod_grabbing_zasilkovna z
         WHERE ${where.join(' AND ')}
         ${terminalClause}
         ${missingClause}
         GROUP BY z.packet_id
         ORDER BY last_seen DESC NULLS LAST
         LIMIT $${vals.length + 1}
      `;
      const pick = await pool.query(pickSql, [...vals, limit]);
      const pids = (pick.rows || []).map(r => String(r.packet_id || '').trim()).filter(Boolean);
      const hasMore = (typeof todoTotal === 'number') ? (todoTotal > pids.length) : null;

      const results = [];
      let idx = 0;
      let stored = 0, skipped = 0, failed = 0;

      const worker = async () => {
        while (idx < pids.length) {
          const my = idx++;
          const packetId = pids[my];
          const attempts = [];
          const out = await fetchPacketStatus({ apiPassword, packetId, apiBase, debugAttempts: attempts });
          if (!out.ok) {
            failed++;
            results.push({ packet_id: packetId, ok: false, error: out.error || 'upstream_error', message: out.message || null, status: out.status || null });
            continue;
          }
          const rawPreview = String(out.raw_xml || '').slice(0, 8000);
          const statusAt = (() => {
            if (!out.date_time) return null;
            const d = new Date(out.date_time);
            return Number.isFinite(d.getTime()) ? d : null;
          })();
          try {
            await pool.query(
              `INSERT INTO public.mod_grabbing_zasilkovna_status (packet_id, status_code, code_text, status_text, status_at, raw_xml, org_id)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [packetId, out.status_code, out.code_text, out.status_text, statusAt, rawPreview, orgId]
            );
            stored++;
            results.push({ packet_id: packetId, ok: true, status_text: out.status_text || null, status_code: out.status_code || null, date_time: out.date_time || null });
          } catch (e) {
            failed++;
            results.push({ packet_id: packetId, ok: false, error: 'db_error', message: String(e?.message || e) });
          }
        }
      };

      const workers = Array.from({ length: Math.min(concurrency, pids.length || 1) }, () => worker());
      await Promise.all(workers);
      skipped = Math.max(0, pids.length - stored - failed);

      log(`status_batch:done todo=${pids.length} stored=${stored} failed=${failed} skipped=${skipped} only_missing=${onlyMissing ? 1 : 0} org_id=${orgId || '-'}`);
      return res.json({ ok:true, config_id: cfgId, todo_total: todoTotal, has_more: hasMore, total: pids.length, stored, failed, skipped, items: results.slice(0, 200) });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });

  // One-click: download using config id and auto-import into DB
  app.post('/api/grabbing-zasilkovna/download-and-import/:id', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      await ensureConfigTable();
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      const id = String(req.params.id||'').trim();
      const r = await pool.query(`SELECT * FROM mod_grabbing_zasilkovna_config WHERE id=$1 LIMIT 1`, [id]);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const cfg = r.rows[0] || {};
      const p = (cfg.options && cfg.options.packeta) ? cfg.options.packeta : {};
      const body = { email: p.email || '', password: p.password || '', signInUrl: p.signInUrl || 'https://client.packeta.com/en/sign/in', listUrl: p.listUrl || 'https://client.packeta.com/en/packets/list', include_email: !!p.includeEmail || true, browser: true, debug: !!req.body?.debug, url: req.body?.url, headers: req.body?.headers };

      // Reuse same logic as /download (inline, simplified)
      const now = new Date();
      const tag = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
      const defName = `zasilkovna_${tag}.csv`;
      const saveCsv = (content, name) => { const n = name || defName; const dest = path.join(dataDir, n); fs.writeFileSync(dest, content, 'utf8'); const st = fs.statSync(dest); return { name: n, path: dest, size: st.size, download_url: `/api/grabbing-zasilkovna/file/${encodeURIComponent(n)}` }; };

      let file = null; const steps = []; const t0 = Date.now();
      const step = (m) => { try { steps.push(m); log(m); } catch {} };
      if (typeof req.body?.content === 'string' && req.body.content.length) {
        file = saveCsv(req.body.content, defName); step('content_saved');
      } else if (body.url) {
        const f = (globalThis.fetch || (await import('node-fetch')).default);
        const hdr = (body.headers && typeof body.headers==='object') ? body.headers : {};
        const resp = await f(body.url, { headers: hdr }); if (!resp.ok) return res.status(400).json({ ok:false, error:'download_failed', status: resp.status });
        const buf = Buffer.from(await resp.arrayBuffer()); const dest = path.join(dataDir, defName); fs.writeFileSync(dest, buf); const st = fs.statSync(dest); file = { name: defName, path: dest, size: st.size, download_url: `/api/grabbing-zasilkovna/file/${encodeURIComponent(defName)}` }; step('url_fetched');
      } else {
        // Playwright path
        sanitizePlaywrightEnv('download-and-import');
        const chromium = await loadPlaywrightChromium();
        if (!chromium) return res.status(500).json({ ok:false, error:'playwright_missing', message:'Playwright not available to module. Ensure backend has playwright and Chromium installed.' });
        let browser, context, page;
        try {
          const headless = true; const launchArgs=[]; try { if (process.getuid && process.getuid() === 0) launchArgs.push('--no-sandbox'); } catch {}
          browser = await chromium.launch({ headless, args: launchArgs, slowMo: body.debug?80:0 }); context = await browser.newContext({ acceptDownloads: true }); page = await context.newPage();
          step('goto_sign_in'); await page.goto(body.signInUrl, { waitUntil: 'domcontentloaded' });
          try { await page.click('text=/Accept|Souhlasím|Accept All/i', { timeout: 2000 }); } catch {}
          try { await page.fill('input[name="email"], input[type="email"]', body.email, { timeout: 5000 }); } catch {}
          try { await page.fill('input[name="password"], input[type="password"]', body.password, { timeout: 5000 }); } catch {}
          try { await page.click('button[type="submit"], button:has-text("Sign in"), input[type="submit"]', { timeout: 5000 }); } catch {}
          await page.waitForLoadState('domcontentloaded'); step('goto_list'); await page.goto(body.listUrl, { waitUntil: 'domcontentloaded' });
          // Ensure all columns visible, including E-mail; then increase per-page for scraping
          try {
            const cur = new URL(await page.url());
            const origin = cur.origin; const pathname = cur.pathname.replace(/\/$/, '');
            const baseFromList = `${origin}${pathname}`;
            const candidates = [
              `${baseFromList}?do=list-showAllColumns`,
              `${baseFromList}?list-id=1&do=list-showAllColumns`,
              ...['cs','fr','en'].flatMap(lang => [
                `${origin}/${lang}/packets/list?do=list-showAllColumns`,
                `${origin}/${lang}/packets/list?list-id=1&do=list-showAllColumns`
              ])
            ];
            let applied = false;
            for (const u of candidates) {
              try {
                const ck = await context.cookies(u);
                const cookieHeader2 = ck.map(c => `${c.name}=${c.value}`).join('; ');
                const r = await fetch(u, { headers: { 'Cookie': cookieHeader2, 'User-Agent': 'Mozilla/5.0 (PlaywrightBot)', 'Referer': await page.url(), 'Accept': 'text/html,*/*;q=0.8', 'X-Requested-With': 'XMLHttpRequest' } });
                step(`show_all_columns_try ${u} -> ${r.status}`);
                if (r.ok) { applied = true; break; }
              } catch {}
            }
            if (!applied) {
              // Fallback: click the UI entry if present (CS/EN/FR variants)
              const selectors = [
                "a.ajax.dropdown-item:has-text('Zobrazit všechny sloupce')",
                "a.dropdown-item:has-text('Zobrazit všechny sloupce')",
                "a.dropdown-item:has-text('Show all columns')",
                "a.dropdown-item:has-text('Afficher toutes les colonnes')"
              ];
              for (const sel of selectors) {
                try {
                  await page.click(sel, { timeout: 1500 });
                  step(`show_all_columns_click ${sel}`); applied = true; break;
                } catch {}
              }
            }
            if (applied) { try { await page.reload({ waitUntil:'domcontentloaded' }); } catch {} }
            // Email column toggle if present
            try {
              let toggleHref = '';
              try { toggleHref = await page.locator('a[href*="list-column=email"]').first().getAttribute('href'); } catch {}
              if (toggleHref) {
                const href = new URL(toggleHref, await page.url()).toString();
                if (/do=list-showColumn/i.test(href)) {
                  const ck = await context.cookies(href);
                  const cookieHeader2 = ck.map(c => `${c.name}=${c.value}`).join('; ');
                  const r = await fetch(href, { headers: { 'Cookie': cookieHeader2, 'User-Agent': 'Mozilla/5.0 (PlaywrightBot)', 'Referer': await page.url(), 'Accept': 'text/html,*/*;q=0.8', 'X-Requested-With': 'XMLHttpRequest' } });
                  step(`email_toggle_show -> ${r.status}`);
                  try { await page.reload({ waitUntil:'domcontentloaded' }); } catch {}
                } else if (/do=list-hideColumn/i.test(href)) {
                  step('email_column_state=visible');
                }
              }
            } catch {}
            // Increase per page
            try {
              const cur2 = new URL(await page.url());
              if (!cur2.searchParams.get('list-perPage')) cur2.searchParams.set('list-perPage','500');
              if (!cur2.searchParams.get('list-page')) cur2.searchParams.set('list-page','1');
              const target = cur2.toString();
              step(`per_page=${cur2.searchParams.get('list-perPage')}`);
              await page.goto(target, { waitUntil: 'domcontentloaded' });
            } catch {}
          } catch {}
          // Try CSV download
          try {
            const dlPromise = page.waitForEvent('download', { timeout: 10000 });
            const clicked = await Promise.race([
              page.click('a:has-text("CSV")', { timeout: 5000 }).then(()=>true).catch(()=>false),
              page.click('button:has-text("CSV")', { timeout: 5000 }).then(()=>true).catch(()=>false),
              page.click('[download][href*="csv" i]', { timeout: 5000 }).then(()=>true).catch(()=>false),
            ]);
            if (clicked) { const dl = await dlPromise; const suggested = dl.suggestedFilename() || defName; const dest = path.join(dataDir, suggested); await dl.saveAs(dest); const st = fs.statSync(dest); file = { name: suggested, path: dest, size: st.size, download_url: `/api/grabbing-zasilkovna/file/${encodeURIComponent(suggested)}` }; step('downloaded_csv'); }
          } catch {}
          if (!file) {
            // table scrape to CSV
            const { csv } = await page.evaluate(() => {
              const norm = (s) => (s||'').replace(/\s+/g,' ').trim();
              const findTable = () => { const tables = Array.from(document.querySelectorAll('table')); for (const t of tables) { const head = Array.from(t.querySelectorAll('thead th')).map(th=>norm(th.innerText||th.textContent||'')).join(' | ').toLowerCase(); if (/barcode|tracking|order|submission|podání|podani|objedn/.test(head)) return t; } return tables[0] || null; };
              const t = findTable(); const d=';'; const rows=[]; if (t) { const hs=Array.from(t.querySelectorAll('thead th')).map(th=>norm(th.innerText||th.textContent||'')); rows.push(hs.join(d)); const trs = Array.from(t.querySelectorAll('tbody tr')); for (const tr of trs) { const vals = Array.from(tr.querySelectorAll('td')).map(td=>norm(td.innerText||td.textContent||'')); rows.push(vals.join(d)); } }
              return { csv: rows.join('\n') };
            });
            if (!csv || !csv.trim()) throw new Error('table_not_found'); file = saveCsv(csv, defName); step('scraped_table');
          }
        } finally { try { await page?.close(); } catch {} try { await context?.close(); } catch {} try { await browser?.close(); } catch {} }
      }

      if (!file) return res.status(500).json({ ok:false, error:'download_failed' });
      // Import phase
      const text = fs.readFileSync(file.path, 'utf8');
      const t1 = Date.now();
      // Reuse parseCsv from above
      const parseCsv = (text, delim) => {
        const lines = String(text||'').split(/\r?\n/).filter(l=>l.length>0);
        if (!lines.length) return { headers: [], rows: [] };
        const sample = lines.slice(0, 20).join('\n');
        const guess = delim || (/(;|\t)/.test(sample) ? (sample.includes(';')?';':'\t') : ',');
        const split = (s) => { const out = []; let cur = ''; let q = false; for (let i=0;i<s.length;i++) { const ch = s[i]; if (ch === '"') { q = !q; cur += ch; continue; } if (!q && ch === guess) { out.push(cur); cur=''; continue; } cur += ch; } out.push(cur); return out.map(x => x.replace(/^\"|\"$/g,'').replace(/\"\"/g,'"')); };
        const headers = split(lines[0]).map(h=>h.trim()); const rows = []; for (let i=1;i<lines.length;i++) { const cols = split(lines[i]); if (cols.every(c=>c.trim()==='')) continue; const obj = {}; for (let j=0;j<headers.length;j++) obj[headers[j]||`col${j+1}`] = cols[j] ?? ''; rows.push(obj); } return { headers, rows };
      };
      const { rows } = parseCsv(text);
      const orgId = (typeof req.body?.org_id === 'string' && req.body.org_id.trim()) ? req.body.org_id.trim() : (typeof req.headers['x-org-id'] === 'string' ? String(req.headers['x-org-id']).trim() : null);
      log(`download-and-import:parsed rows=${rows.length} org_id=${orgId||'-'}`);
      const imp = await upsertRows(rows, orgId);
      const t2 = Date.now();
      const orderRawKeys = [
        'order','order_raw','Order','Order number','Order Number','Order No','Order no','Order ID','Order Id','OrderID',
        'id_order','id order','ID order','ID Order','ID_ORDER'
      ];
      const pickOrderRaw = (obj) => {
        for (const k of orderRawKeys) {
          const v = obj && obj[k];
          if (v != null && String(v).trim() !== '') return String(v).trim();
        }
        return '';
      };
      const orderRaws = Array.from(new Set(rows.map(pickOrderRaw).filter(Boolean))).slice(0, 5000);
      const trackingLimit = Math.max(1, Math.min(2000, Number(req.body?.tracking_limit || 200) || 200));
      const runTracking = req.body?.run_tracking === undefined ? true : !!req.body.run_tracking;
      const tracking = runTracking && orderRaws.length
        ? await updateTrackingLinks({ cfgId: id, onlyMissing: true, limit: trackingLimit, orgId, orderRaws })
        : null;

      log(`download-and-import:imported total=${imp.total} inserted=${imp.inserted} updated=${imp.updated} skipped=${imp.skipped} failed=${imp.failed} tracking_packeta=${tracking?.updated_packeta ?? 0} tracking_external=${tracking?.updated_external ?? 0} timing_ms={download:${t1-t0}, import:${t2-t1}, total:${t2-t0}}`);
      return res.json({ ok:true, file, import: imp, tracking, steps });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // -------- Module-specific Config CRUD (mod_grabbing_zasilkovna_config)
  async function ensureConfigTable() {
    if (!pool || typeof pool.query !== 'function') throw new Error('db_unavailable');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mod_grabbing_zasilkovna_config (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        target TEXT,
        options JSONB,
        enabled BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS mod_grabbing_zasilkovna_config_name_uq ON mod_grabbing_zasilkovna_config (name);
    `);
  }

  // List configs
  app.get('/api/grabbing-zasilkovna/configs', async (req, res) => {
    try {
      await ensureConfigTable();
      const r = await pool.query(`SELECT id, name, target, options, enabled, created_at, updated_at FROM mod_grabbing_zasilkovna_config ORDER BY updated_at DESC`);
      return res.json({ ok:true, items: r.rows });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Create or upsert config
  app.post('/api/grabbing-zasilkovna/config', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      await ensureConfigTable();
      const b = req.body || {};
      const id = (String(b.id||'').trim()) || `zsk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
      const name = String(b.name || b.title || '').trim() || 'Zásilkovna';
      const target = (typeof b.target==='string' && b.target.trim()) || null;
      let options = null; try { if (b.options && typeof b.options==='object' && !Array.isArray(b.options)) options = b.options; else if (typeof b.options==='string' && b.options.trim()) options = JSON.parse(b.options); } catch {}
      const enabled = b.enabled === undefined ? true : !!b.enabled;
      const r = await pool.query(`
        INSERT INTO mod_grabbing_zasilkovna_config (id, name, target, options, enabled, created_at, updated_at)
        VALUES ($1,$2,$3,$4::jsonb,$5,NOW(),NOW())
        ON CONFLICT (id)
        DO UPDATE SET name=EXCLUDED.name, target=EXCLUDED.target, options=EXCLUDED.options, enabled=EXCLUDED.enabled, updated_at=NOW()
        RETURNING id, name, target, options, enabled, created_at, updated_at
      `, [id, name, target, JSON.stringify(options||{}), enabled]);
      return res.json({ ok:true, item: r.rows[0] });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Read one
  app.get('/api/grabbing-zasilkovna/config/:id', async (req, res) => {
    try {
      await ensureConfigTable();
      const id = String(req.params.id||'').trim();
      const r = await pool.query(`SELECT id, name, target, options, enabled, created_at, updated_at FROM mod_grabbing_zasilkovna_config WHERE id=$1 LIMIT 1`, [id]);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      return res.json({ ok:true, item: r.rows[0] });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Update
  app.patch('/api/grabbing-zasilkovna/config/:id', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      await ensureConfigTable();
      const id = String(req.params.id||'').trim();
      const b = req.body || {};
      const ent = Object.entries(b).filter(([k]) => ['name','title','target','options','enabled'].includes(k));
      if (!ent.length) return res.status(400).json({ ok:false, error:'bad_request' });
      const entries = ent.map(([k,v]) => [k==='title'?'name':k, v]);
      const sets = entries.map(([k],i)=> (k==='options'?`${k} = $${i+1}::jsonb`:`${k} = $${i+1}`));
      const vals = entries.map(([k,v]) => (k==='options' && v && typeof v==='object' ? JSON.stringify(v) : v));
      const r = await pool.query(`UPDATE mod_grabbing_zasilkovna_config SET ${sets.join(', ')}, updated_at=NOW() WHERE id = $${vals.length+1} RETURNING id, name, target, options, enabled, created_at, updated_at`, [...vals, id]);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      return res.json({ ok:true, item: r.rows[0] });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Delete
  app.delete('/api/grabbing-zasilkovna/config/:id', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try { await ensureConfigTable(); const id = String(req.params.id||'').trim(); await pool.query(`DELETE FROM mod_grabbing_zasilkovna_config WHERE id=$1`, [id]); return res.json({ ok:true }); }
    catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Drive download using a stored config id (reads options.packeta and forwards to /download)
  app.post('/api/grabbing-zasilkovna/download/using-config/:id', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      await ensureConfigTable();
      const id = String(req.params.id||'').trim();
      if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
      const r = await pool.query(`SELECT * FROM mod_grabbing_zasilkovna_config WHERE id=$1 LIMIT 1`, [id]);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const cfg = r.rows[0] || {};
      const p = (cfg.options && cfg.options.packeta) ? cfg.options.packeta : {};
      const body = {
        email: p.email || '',
        password: p.password || '',
        signInUrl: p.signInUrl || 'https://client.packeta.com/en/sign/in',
        listUrl: p.listUrl || 'https://client.packeta.com/en/packets/list',
        include_email: !!p.includeEmail || true,
        browser: (typeof req.body?.url === 'string' && req.body.url.trim()) ? false : true,
        url: (typeof req.body?.url === 'string' && req.body.url.trim()) ? req.body.url.trim() : undefined,
        headers: (req.body && req.body.headers && typeof req.body.headers === 'object') ? req.body.headers : undefined,
        debug: !!req.body?.debug
      };
      // Forward to the main download route
      const fakeReq = { ...req, method: 'POST', url: '/api/grabbing-zasilkovna/download', originalUrl: '/api/grabbing-zasilkovna/download', body };
      return app._router.handle(fakeReq, res, ()=>{});
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });
}
