import { marked } from "marked";
import DOMPurify from "dompurify";
/**
 * Essaie successivement :
 * - JSON (objet avec items/liens) → HTML (liste)
 * - Markdown → HTML
 * - Texte brut → échappé
 */
export function parseAndSanitizeHTML(input) {
  if (!input) return "<p>(vide)</p>";

  // 1) JSON ?
  try {
    const obj = JSON.parse(input);
    const html = jsonToHTML(obj);
    if (html) return sanitize(html);
  } catch {
    // pas du JSON
  }

  // 2) Markdown → HTML
  try {
    const md = String(input);
    const raw = marked.parse(md);
    return sanitize(raw);
  } catch {
    // fallback
  }

  // 3) Texte brut
  return sanitize(escapeHTML(String(input)).replace(/\n/g, "<br/>"));
}

function sanitize(html) {
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}

function escapeHTML(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Exemple de transformation JSON structurée → HTML */
function jsonToHTML(obj) {
  if (!obj || typeof obj !== "object") return "";
  // Format attendu flexible :
  // { title, items: [{label, url, description, solutions:[{label,url}]}], contact:{...} }
  let out = "";

  if (obj.title) out += `<h3>${escapeHTML(obj.title)}</h3>`;

  if (Array.isArray(obj.items) && obj.items.length) {
    out += "<ul>";
    for (const it of obj.items) {
      out += "<li>";
      if (it.url) {
        out += `<a href="${escapeAttr(
          it.url
        )}" target="_blank" rel="noreferrer">${escapeHTML(
          it.label || it.url
        )}</a>`;
      } else if (it.label) {
        out += `<strong>${escapeHTML(it.label)}</strong>`;
      }
      if (it.description) out += `<div>${escapeHTML(it.description)}</div>`;

      if (Array.isArray(it.solutions) && it.solutions.length) {
        out += "<div>Solutions&nbsp;:</div><ul>";
        for (const s of it.solutions) {
          if (s?.url) {
            out += `<li><a href="${escapeAttr(
              s.url
            )}" target="_blank" rel="noreferrer">${escapeHTML(
              s.label || s.url
            )}</a></li>`;
          } else if (s?.label) {
            out += `<li>${escapeHTML(s.label)}</li>`;
          }
        }
        out += "</ul>";
      }

      out += "</li>";
    }
    out += "</ul>";
  }

  if (obj.contact && typeof obj.contact === "object") {
    out += `<div class="mt-2 text-sm text-gray-700">Besoin d’aide ? `;
    const bits = [];
    if (obj.contact.form)
      bits.push(
        `<a href="${escapeAttr(
          obj.contact.form
        )}" target="_blank" rel="noreferrer">formulaire</a>`
      );
    if (obj.contact.email)
      bits.push(
        `<a href="mailto:${escapeAttr(obj.contact.email)}">${escapeHTML(
          obj.contact.email
        )}</a>`
      );
    if (obj.contact.phone)
      bits.push(`<span>${escapeHTML(obj.contact.phone)}</span>`);
    out += bits.join(" · ");
    out += `</div>`;
  }

  return out || "";
}

function escapeAttr(s) {
  return String(s).replaceAll('"', "&quot;");
}
export function renderRichTextHTML(input) {
  const raw = String(input ?? "");

  // If looks like HTML, sanitize with a whitelist:
  if (/[<>]/.test(raw)) {
    const clean = DOMPurify.sanitize(raw, {
      ALLOWED_TAGS: [
        "b","strong","i","em","u","s","p","br","ul","ol","li","blockquote","code","pre","a","span"
      ],
      ALLOWED_ATTR: ["href","target","rel","class","style"],
    });
    // enforce target/rel on anchors
    try {
      const tmp = document.createElement('div');
      tmp.innerHTML = clean;
      tmp.querySelectorAll('a').forEach(a => {
        if (!a.getAttribute('target')) a.setAttribute('target','_blank');
        a.setAttribute('rel','noreferrer');
      });
      return tmp.innerHTML;
    } catch {
      return clean;
    }
  }

  // Plain text → escape + autolink + newlines→<br>
  const escaped = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const autolinked = escaped.replace(/((https?:\/\/|www\.)[^\s<]+)/gi, (m) => {
    const href = m.startsWith("http") ? m : `https://${m}`;
    return `<a href="${href}" target="_blank" rel="noreferrer">${m}</a>`;
  });

  return autolinked.replace(/\n/g, "<br/>");
}
