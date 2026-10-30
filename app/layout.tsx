import type { ReactNode } from "react";

export const metadata = { title: "B2B Orders Test", description: "Test site for the B2B order agent (staging)" };

const css = `
:root{--bg:#f6f7f9;--card:#fff;--ink:#1d2330;--muted:#5d6676;--line:#e3e6ec;--brand:#d92b2b;--ok:#1d8a4e;--bad:#c0392b;--soft:#fdf1f1}
@media (prefers-color-scheme: dark){:root{--bg:#14171d;--card:#1c2028;--ink:#e8ebf0;--muted:#9aa3b2;--line:#2c323d;--soft:#2a1d1f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
header{background:var(--card);border-bottom:1px solid var(--line);padding:12px 16px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
header b{color:var(--brand)}nav a{color:var(--ink);text-decoration:none;margin-right:14px;font-weight:500}nav a:hover{color:var(--brand)}
main{max-width:980px;margin:0 auto;padding:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:0 0 14px}
h1{font-size:20px;margin:4px 0 12px}h2{font-size:16px;margin:0 0 8px}.am{color:var(--muted);font-size:14px}
table{width:100%;border-collapse:collapse;font-size:14px}td,th{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{color:var(--muted);font-weight:500}.num{text-align:right;white-space:nowrap}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}
.pill{display:inline-block;padding:1px 8px;border-radius:99px;font-size:12px;background:var(--soft);color:var(--brand)}
.okp{background:#e5f5ec;color:var(--ok)}.badp{background:#fbe7e5;color:var(--bad)}
button,input,select,textarea{font:inherit}button{background:var(--brand);color:#fff;border:0;border-radius:8px;padding:6px 14px;cursor:pointer}
button.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}
input,select,textarea{border:1px solid var(--line);border-radius:8px;padding:6px 8px;background:var(--card);color:var(--ink);max-width:100%}
textarea{width:100%}label{display:block;margin:4px 0}.muted{color:var(--muted)}ul{margin:4px 0 0 18px;padding:0}
img.thumb{max-width:220px;border-radius:6px;border:1px solid var(--line)}
`;

export default function Root({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head><style dangerouslySetInnerHTML={{ __html: css }} /></head>
      <body>
        <header>
          <b>ChipChip B2B · test</b>
          <nav>
            <a href="/">Orders · ትዕዛዞች</a>
            <a href="/received">Received · የደረሱ</a>
            <a href="/questions">4 questions · 4 ጥያቄዎች</a>
            <a href="/customers">Customers · ደንበኞች</a>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
