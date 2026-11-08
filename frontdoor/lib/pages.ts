// =============================================================================
// The Quarry -- frontdoor/lib/pages.ts
//
// The human-facing answers of the front door, rendered as HTML strings from
// route handlers (no React tree in this app). They speak the Quarry's
// language (design/DESIGN.md): limestone ground, one white card with the
// strata band along its top, Zilla Slab for the one big line, Atkinson
// Hyperlegible for the reading text, Courier Prime only for what a collector
// would type (the eyebrow, the label's field names). Nothing moves. The
// token values are COPIED from design/tokens.css, not imported: this app
// has no Tailwind and no build step for CSS, and the house rule is copy,
// don't share. The faces are self-hosted from /public/fonts, so the page
// asks Google for nothing.
//
// Every value interpolated here is either validated upstream (slug, ip) or
// escaped below; both, where it costs nothing.
// =============================================================================

import { describeAge, QUARRY_PREFIX, type StationRecord } from "./frontdoor";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const STYLE = `
@font-face{font-family:"Zilla Slab";font-style:normal;font-weight:600;font-display:swap;src:url("/fonts/zilla-slab-600-latin.woff2") format("woff2")}
@font-face{font-family:"Atkinson Hyperlegible";font-style:normal;font-weight:400;font-display:swap;src:url("/fonts/atkinson-hyperlegible-400-latin.woff2") format("woff2")}
@font-face{font-family:"Atkinson Hyperlegible";font-style:normal;font-weight:700;font-display:swap;src:url("/fonts/atkinson-hyperlegible-700-latin.woff2") format("woff2")}
@font-face{font-family:"Courier Prime";font-style:normal;font-weight:400;font-display:swap;src:url("/fonts/courier-prime-400-latin.woff2") format("woff2")}
@font-face{font-family:"Courier Prime";font-style:normal;font-weight:700;font-display:swap;src:url("/fonts/courier-prime-700-latin.woff2") format("woff2")}
:root{--ground:#F5F1EA;--surface:#FFFFFF;--label:#FFFDF8;--sand:#EDE6DA;--line:#DDD3C3;--line-2:#CFC3AF;--line-strong:#A8977C;--rule:#E6DDCD;
--ink:#2A2622;--ink-2:#5A5048;--ink-3:#6E645A;--tag-ink:#3E3630;--azurite:#2D5B8A;--azurite-deep:#1F4468;--azurite-soft:#E4ECF4;--azurite-note:#1F3A57;
--catalog:#9E2F22;--warn:#FBF4E4;--warn-line:#E4C98A;--warn-ink:#5A4210;--strata-1:#D8C7A8;--strata-2:#B9A586;--strata-3:#E6DAC4;--strata-4:#8C7B66;
--font-display:"Zilla Slab",Georgia,serif;--font-sans:"Atkinson Hyperlegible",system-ui,sans-serif;--font-label:"Courier Prime","Courier New",monospace}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%}
@media (hover:hover) and (pointer:fine){html{zoom:.9}}
body{background:var(--ground);color:var(--ink);font-family:var(--font-sans);font-size:18px;line-height:1.55;display:grid;place-items:center;padding:24px 16px}
main{width:min(100%,600px);background:var(--surface);border:1px solid var(--line);border-radius:18px;overflow:hidden}
.strata{display:grid;grid-template-rows:3px 4px 3px 5px}
.strata span:nth-child(1){background:var(--strata-1)}
.strata span:nth-child(2){background:var(--strata-2)}
.strata span:nth-child(3){background:var(--strata-3)}
.strata span:nth-child(4){background:var(--strata-4)}
.body{padding:26px 32px 28px}
.eyebrow{margin:0 0 14px;color:var(--ink-2);font-family:var(--font-label);font-size:16px;letter-spacing:.04em}
h1{margin:0 0 16px;font-family:var(--font-display);font-weight:600;font-size:clamp(30px,6vw,38px);line-height:1.1;letter-spacing:-.01em;overflow-wrap:anywhere}
p{margin:0 0 12px}
p:last-child{margin-bottom:0}
.meta{color:var(--ink-2);font-size:16px}
.foot{margin-top:22px;padding-top:16px;border-top:1px solid var(--rule);color:var(--ink-2);font-size:16px}
a{color:var(--azurite);font-weight:700;text-decoration:underline;text-underline-offset:3px;overflow-wrap:anywhere}
a:hover{color:var(--azurite-deep)}
code{font-family:var(--font-label);font-size:17px;color:var(--ink);background:var(--sand);padding:1px 7px;border-radius:6px}
.tag{display:inline-block;vertical-align:middle;margin-left:10px;padding:4px 12px;border-radius:999px;font-family:var(--font-sans);font-size:15px;font-weight:700;letter-spacing:0;line-height:1.4}
.tag.up{background:var(--azurite-soft);color:var(--azurite-note)}
.tag.quiet{background:var(--sand);color:var(--tag-ink)}
.tag.gone{background:var(--warn);color:var(--warn-ink);border:1px solid var(--warn-line)}
.label{margin:20px 0 0;background:var(--label);border:1px solid var(--line-2);border-radius:6px;padding:22px 24px 20px;box-shadow:inset 0 0 0 10px var(--label),inset 0 0 0 11px var(--line)}
.label dl{margin:0;display:grid;grid-template-columns:max-content 1fr;gap:10px 20px}
.label dt{font-family:var(--font-label);font-size:16px;color:var(--ink-2);padding-top:2px}
.label dd{margin:0;overflow-wrap:anywhere}
.label .blank{color:var(--ink-3);font-style:italic}
@media (max-width:420px){.body{padding:22px 20px 24px}.label{padding:18px 18px 16px}.label dl{grid-template-columns:1fr;gap:4px}.label dd{margin-bottom:8px}}
`;

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<div class="strata" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
<div class="body">
${body}
</div>
</main>
</body>
</html>
`;
}

export function landingPage(): string {
  return shell(
    "The Quarry front door",
    `<p class="eyebrow">The Quarry</p>
<h1>The front door.</h1>
<p>Each house that keeps a Quarry has its own link here, and that link always leads to the box in that house, wherever it sits on the home Wi-Fi this week. Open the one you were given.</p>
<p class="foot">A Quarry can be reached only from inside its own house. This page keeps no stones and lists no houses.</p>`,
  );
}

export function unknownStationPage(): string {
  return shell(
    "No such station",
    `<p class="eyebrow">The Quarry</p>
<h1>That isn't a station.</h1>
<p>Check the link you were given. Station links look like <code>quarry.toddtech.llc/name</code>, all lowercase.</p>`,
  );
}

export function notReportedPage(station: string): string {
  return shell(
    `${station} hasn't reported yet`,
    `<p class="eyebrow">The Quarry</p>
<h1>${esc(station)} hasn't checked in yet.</h1>
<p>The box tells this page where it lives on its home network the first time it comes online. Until then there is nowhere to send you.</p>
<p class="meta">If the box is plugged in and its light is on, give it a few minutes and try again.</p>`,
  );
}

export function statusPage(station: string, rec: StationRecord, now: Date = new Date()): string {
  const ageS = (now.getTime() - Date.parse(rec.seen_at)) / 1000;
  const tag = Number.isNaN(ageS)
    ? `<span class="tag gone">Not heard from</span>`
    : ageS <= 20 * 60
      ? `<span class="tag up">Up</span>`
      : ageS <= 24 * 3600
        ? `<span class="tag quiet">Quiet</span>`
        : `<span class="tag gone">Not heard from</span>`;
  const blank = `<span class="blank">Not reported</span>`;
  return shell(
    `${station} · station status`,
    `<p class="eyebrow">The Quarry · station status</p>
<h1>${esc(station)}${tag}</h1>
<p>Last heard from <strong>${esc(describeAge(rec.seen_at, now))}</strong>. The address below is the box itself, and it only opens from inside its house.</p>
<div class="label">
<dl>
<dt>Address</dt><dd><a href="/${esc(station)}">http://${esc(rec.ip)}/${QUARRY_PREFIX}</a></dd>
<dt>Interface</dt><dd>${rec.iface ? esc(rec.iface) : blank}</dd>
<dt>Build</dt><dd>${rec.sha ? `<code>${esc(rec.sha)}</code>` : blank}</dd>
<dt>Checked in</dt><dd>${esc(rec.seen_at)}</dd>
</dl>
</div>
<p class="foot">Up: heard within 20 minutes. Quiet: within a day. Not heard from: longer than that, but the address is still the best guess. The build is the Aviary's on that box; the Quarry's is on its own check page.</p>`,
  );
}
