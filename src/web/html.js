export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CSS = `:root{--fg:#1b1f24;--muted:#5b6470;--line:#dde1e6;--acc:#0b6bcb;--bg:#fff;--red:#c62828;--amber:#b26a00;--green:#2e7d32}
@media (prefers-color-scheme:dark){:root{--fg:#e8eaed;--muted:#a0a8b3;--line:#3a3f45;--bg:#15181b}}
*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--fg);background:var(--bg)}
main{max-width:640px;margin:0 auto;padding:24px 16px 48px}h1{font-size:1.5rem;margin:.2em 0 .6em}h2{font-size:1.15rem;margin-top:1.6em}
label{display:block;margin:12px 0;font-weight:600}input,select,textarea{display:block;width:100%;margin-top:4px;padding:10px;border:1px solid var(--line);border-radius:8px;font:inherit;background:transparent;color:inherit}
button{background:var(--acc);color:#fff;border:0;border-radius:8px;padding:12px 18px;font:inherit;font-weight:600;cursor:pointer}button.secondary{background:transparent;color:var(--acc);border:1px solid var(--acc)}
.muted{color:var(--muted)}.small{font-size:.85rem}.err{color:var(--red);font-weight:600}.card{border:1px solid var(--line);border-radius:12px;padding:14px;margin:12px 0}
.red{color:var(--red)}.amber{color:var(--amber)}.green{color:var(--green)}table{width:100%;border-collapse:collapse}td,th{padding:6px 4px;border-bottom:1px solid var(--line);text-align:left}
.row{display:flex;gap:8px;flex-wrap:wrap}.chk{display:flex;gap:8px;align-items:flex-start;font-weight:400}.chk input{width:auto;margin-top:5px}`;

export function page(title, body, { lang = 'en', head = '', noTranslate = false } = {}) {
  // noTranslate: app screens are already localised; stops browsers auto-translating the brand (e.g. Chrome rendering an English-looking brand as a translated word).
  const nt = noTranslate ? ' translate="no"' : '';
  return `<!doctype html><html lang="${esc(lang)}"${nt}><head>${noTranslate ? '<meta name="google" content="notranslate">' : ''}<meta charset="utf-8"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="robots" content="noindex"><style>${CSS}</style>${head}</head><body><main>${body}</main></body></html>`;
}
