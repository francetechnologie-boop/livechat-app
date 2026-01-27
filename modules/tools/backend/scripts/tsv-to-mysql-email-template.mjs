#!/usr/bin/env node
// Generates MySQL INSERTs for `mod_tools_email_template` from a TSV export that contains quoted multi-line HTML.
//
// Usage:
//   node livechat-app/modules/tools/backend/scripts/tsv-to-mysql-email-template.mjs < export.tsv > seed.sql
//
// Expected row shapes (TAB-delimited, with optional CSV quoting using " and "" escaping):
//   A) template_name, id_shop, id_lang, language_name, iso_code, subject, html
//   B) template_name, id_shop, id_lang, iso_code, subject, html
//   C) template_name, id_shop, id_lang, subject, html
//
// Output is idempotent if the MySQL table has a UNIQUE KEY on (template_type, id_shop, id_lang).

function parseDelimitedRows(input, { delimiter = '\t' } = {}) {
  const text = String(input || '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };

  const pushRow = () => {
    pushField();
    const isSingleEmpty = row.length === 1 && String(row[0] || '') === '';
    if (!isSingleEmpty) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        const next = text[i + 1];
        if (next === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === delimiter) {
      pushField();
      continue;
    }

    if (ch === '\n') {
      pushRow();
      continue;
    }

    if (ch === '\r') {
      if (text[i + 1] === '\n') i += 1;
      pushRow();
      continue;
    }

    field += ch;
  }

  if (row.length > 0 || field !== '') pushRow();
  return rows;
}

function clampInt(v, fallback = 0) {
  const n = Number.parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

function toUtf8Hex(s) {
  const buf = Buffer.from(String(s ?? ''), 'utf8');
  return buf.toString('hex').toUpperCase();
}

function mysqlUtf8mb4(hex) {
  return `CONVERT(0x${hex} USING utf8mb4)`;
}

function isHeaderRow(cols) {
  const c0 = String(cols?.[0] || '').trim().toLowerCase();
  return c0 === 'template_name' || c0 === 'template type' || c0 === 'template_type' || c0 === 'template';
}

function pickRowShape(cols) {
  const n = Array.isArray(cols) ? cols.length : 0;
  if (n >= 7) return { template: 0, shop: 1, lang: 2, iso: 4, subject: 5, htmlFrom: 6 };
  if (n === 6) return { template: 0, shop: 1, lang: 2, iso: 3, subject: 4, htmlFrom: 5 };
  if (n === 5) return { template: 0, shop: 1, lang: 2, subject: 3, htmlFrom: 4 };
  return null;
}

async function main() {
  const raw = await new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });

  if (!String(raw || '').trim()) {
    process.stderr.write('No input on stdin.\n');
    process.stderr.write('Usage: node livechat-app/modules/tools/backend/scripts/tsv-to-mysql-email-template.mjs < export.tsv > seed.sql\n');
    process.exitCode = 2;
    return;
  }

  const rows = parseDelimitedRows(raw, { delimiter: '\t' });

  process.stdout.write('SET NAMES utf8mb4;\n');
  process.stdout.write('-- Inserts for table: mod_tools_email_template(template_type,id_shop,id_lang,subject,html_body)\n');
  process.stdout.write('-- Requires UNIQUE KEY (template_type,id_shop,id_lang) for idempotent upsert.\n\n');

  let inserted = 0;
  for (const cols of rows) {
    if (!Array.isArray(cols)) continue;
    if (!cols.some((x) => String(x || '').trim())) continue;
    if (isHeaderRow(cols)) continue;

    const shape = pickRowShape(cols);
    if (!shape) continue;

    const templateType = String(cols[shape.template] || '').trim();
    if (!templateType) continue;

    const idShop = clampInt(cols[shape.shop], 0);
    const idLang = clampInt(cols[shape.lang], 0);

    let subject = String(cols[shape.subject] || '').trim();
    if (!subject || subject.toUpperCase() === '#VALUE!') subject = templateType;

    const htmlBody = String(cols.slice(shape.htmlFrom).join('\t'));
    if (!String(htmlBody || '').trim()) continue;

    const ttHex = toUtf8Hex(templateType);
    const subjHex = toUtf8Hex(subject);
    const htmlHex = toUtf8Hex(htmlBody);

    process.stdout.write(
      `INSERT INTO mod_tools_email_template (template_type, id_shop, id_lang, subject, html_body)\n` +
      `VALUES (${mysqlUtf8mb4(ttHex)}, ${idShop}, ${idLang}, ${mysqlUtf8mb4(subjHex)}, ${mysqlUtf8mb4(htmlHex)})\n` +
      `ON DUPLICATE KEY UPDATE subject = VALUES(subject), html_body = VALUES(html_body);\n\n`
    );
    inserted += 1;
  }

  process.stdout.write(`-- Done. Rows emitted: ${inserted}\n`);
}

main().catch((err) => {
  process.stderr.write(`Failed: ${String(err?.message || err)}\n`);
  process.exitCode = 1;
});

