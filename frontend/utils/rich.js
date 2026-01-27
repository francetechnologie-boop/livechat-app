import { marked } from "marked";
import DOMPurify from "dompurify";

// Markdown -> HTML sécurisé
export function markdownToHtmlSafe(md) {
  const raw = marked.parse(md || "", { breaks: true });
  const clean = DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: [
      "a",
      "p",
      "ul",
      "ol",
      "li",
      "strong",
      "em",
      "br",
      "h3",
      "h4",
      "h5",
      "h6",
      "blockquote",
      "code",
      "pre",
      "span",
    ],
    ALLOWED_ATTR: ["href", "target", "rel"],
  });
  return clean;
}

// JSON objet -> HTML (cartes produits)
export function jsonDraftToHtml(d) {
  if (!d || typeof d !== "object") return "";
  const esc = (s) =>
    String(s || "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        }[c])
    );
  const a = [];
  if (d.title) a.push(`<h3>${esc(d.title)}</h3>`);
  if (d.intro) a.push(`<p>${esc(d.intro)}</p>`);

  if (Array.isArray(d.products) && d.products.length) {
    a.push(`<ol>`);
    for (const p of d.products) {
      a.push(
        `<li><strong>${esc(p.name)}</strong> — <a href="${esc(
          p.url
        )}" target="_blank" rel="noopener">ouvrir</a>`
      );
      if (p.notes) a.push(`<div>${esc(p.notes)}</div>`);
      if (Array.isArray(p.solutions) && p.solutions.length) {
        a.push(`<div>Solutions d’étalonnage :</div><ul>`);
        for (const s of p.solutions) {
          a.push(
            `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(
              s.label
            )}</a></li>`
          );
        }
        a.push(`</ul>`);
      }
      a.push(`</li>`);
    }
    a.push(`</ol>`);
  }

  if (d.contact) {
    a.push(`<p style="margin-top:.75rem">Contact : 
      <a href="https://sonde-ph-redox-piscine.fr/nous-contacter" target="_blank" rel="noopener">formulaire</a> · 
      <a href="mailto:ventes@sonde-ph-redox-piscine.fr">email</a> · 
      <a href="tel:+33680012753">06 80 01 27 53</a>
    </p>`);
  }
  // Sanitize the whole block anyway
  return DOMPurify.sanitize(a.join("\n"), {
    ALLOWED_TAGS: [
      "a",
      "p",
      "ol",
      "ul",
      "li",
      "strong",
      "em",
      "br",
      "h3",
      "div",
      "span",
    ],
    ALLOWED_ATTR: ["href", "target", "rel", "style"],
  });
}
