const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;

function escHtml(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escAttr(s = "") {
  return String(s).replaceAll('"', "&quot;");
}

export function textToSafeHTML(raw = "") {
  let html = escHtml(raw);
  html = html.replace(
    URL_RE,
    (u) =>
      `<a href="${escAttr(u)}" target="_blank" rel="noreferrer nofollow">${u}</a>`
  );
  return html.replace(/\n/g, "<br/>");
}

const HTML_ALLOWED_TAGS = new Set([
  'a', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'p', 'b', 'i', 'u', 's', 'code', 'pre', 'blockquote', 'span',
]);

export function sanitizeAgentHtmlServer(html = "") {
  try {
    let s = String(html);
    s = s.replace(/<\s*(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "");
    s = s.replace(/\son\w+="[^"]*"/gi, "").replace(/\son\w+='[^']*'/gi, "");
    s = s.replace(/<\/?([a-z0-9-]+)([^>]*)>/gi, (m, tag, attrs) => {
      const t = String(tag || '').toLowerCase();
      if (!HTML_ALLOWED_TAGS.has(t)) return '';
      const isClose = /^<\//.test(m);
      if (t === 'a') {
        if (isClose) return '</a>';
        const hrefMatch = attrs.match(/\shref\s*=\s*(".*?"|'[^']*'|[^\s>]+)/i);
        const href = hrefMatch ? hrefMatch[0] : '';
        return `<a ${href} target="_blank" rel="noopener noreferrer">`;
      }
      return isClose ? `</${t}>` : `<${t}>`;
    });
    return s;
  } catch {
    return "";
  }
}

export const safeHtmlUtils = {
  escHtml,
  escAttr,
  URL_RE,
  HTML_ALLOWED_TAGS,
};
