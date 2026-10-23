// The server's web pages (phones first, any browser): joining, pairing a device,
// your own page, and the admin's.

import qrcode from "qrcode-generator";

export const MODES = ["Deadline", "Evolved", "Sequence", "Waves", "Pacifism", "King"];

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function date(t: number | null | undefined): string {
  return t ? new Date(t * 1000).toISOString().slice(0, 10) : "never";
}

const STYLE = `
:root { --bg: #03040b; --panel: #0a0d1c; --edge: #1b2b6e; --ink: #e4e9ff; --dim: #98a1cc;
  --glow: #ff28c8; --cyan: #6fe8ff; --warn: #ffd23f; color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 17px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif;
  background-image: linear-gradient(#10183a 1px, transparent 1px), linear-gradient(90deg, #10183a 1px, transparent 1px);
  background-size: 40px 40px; }
main { max-width: 640px; margin: 0 auto; padding: 24px max(16px, env(safe-area-inset-right)) 48px max(16px, env(safe-area-inset-left));
  display: grid; gap: 20px; }
h1 { margin: 0; font-size: 28px; color: #fff; text-shadow: 0 0 14px var(--glow); }
h2 { margin: 0; font-size: 18px; color: var(--cyan); text-transform: uppercase; letter-spacing: .08em; }
p { margin: 0; }
a { color: var(--cyan); }
.group { color: var(--dim); font-size: 14px; text-transform: uppercase; letter-spacing: .12em; }
.panel { background: rgba(10, 13, 28, .92); border: 1px solid var(--edge); border-radius: 8px; padding: 16px; display: grid; gap: 12px; }
form { display: grid; gap: 10px; margin: 0; }
form.inline { display: inline; }
label { display: grid; gap: 4px; color: var(--dim); font-size: 14px; }
input { font: inherit; color: var(--ink); background: #000; border: 1px solid var(--edge); border-radius: 6px; padding: 10px 12px; width: 100%; }
button { font: inherit; color: #fff; background: rgba(255, 40, 200, .16); border: 1px solid var(--glow); border-radius: 6px;
  padding: 10px 16px; cursor: pointer; }
button.quiet { background: none; border-color: var(--edge); color: var(--dim); padding: 4px 10px; font-size: 14px; }
.error { color: var(--warn); }
.big { font: 700 32px/1.2 ui-monospace, Consolas, monospace; letter-spacing: .12em; color: #fff; }
.code { font-family: ui-monospace, Consolas, monospace; word-break: break-all; color: var(--cyan); }
table { width: 100%; border-collapse: collapse; font-size: 15px; }
td, th { text-align: left; padding: 6px 4px; border-bottom: 1px solid var(--edge); vertical-align: top; }
th { color: var(--dim); font-weight: 400; }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
.wrap { overflow-x: auto; }
ol { margin: 0; padding-left: 22px; display: grid; gap: 6px; }
.link { display: flex; gap: 8px; align-items: stretch; margin-top: 6px; }
.link input { flex: 1; min-width: 0; font: 14px/1.4 ui-monospace, Consolas, monospace; color: var(--cyan); padding: 8px 10px; }
.link button { padding: 6px 14px; flex: none; }
.invite { display: grid; gap: 4px; padding: 10px 0; border-bottom: 1px solid var(--edge); }
.invite .meta { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; color: var(--dim); font-size: 14px; }
.qr { display: block; width: 200px; height: 200px; border-radius: 4px; }
.tip { border-color: var(--glow); }
/* What only helps on a computer: getting from there to your phone. */
@media (hover: none), (pointer: coarse) { .computer-only { display: none; } }
`;

// A QR code as inline SVG: dark modules on white with the standard four-module
// margin, which phone cameras need.
export function qrSvg(text: string, label: string): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount(), size = n + 8;
  let path = "";
  for (let row = 0; row < n; row++)
    for (let col = 0; col < n; col++) if (qr.isDark(row, col)) path += `M${col + 4} ${row + 4}h1v1h-1z`;
  return `<svg class="qr" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(label)}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

// Copy buttons for .link boxes (the clipboard needs https, which the
// deployed server has; otherwise the text is selected for copying by hand),
// and a link box's text selected whole when it gets the focus.
export const SCRIPT_BODY = `
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-copy]");
  if (!b) return;
  const input = b.parentElement.querySelector("input");
  try { await navigator.clipboard.writeText(input.value); b.textContent = "Copied"; }
  catch { input.focus(); input.select(); b.textContent = "Selected"; }
  setTimeout(() => { b.textContent = "Copy"; }, 1600);
});
document.addEventListener("focusin", (e) => { if (e.target.matches(".link input")) e.target.select(); });
`;
const SCRIPT = `<script>${SCRIPT_BODY}</script>`;

// The Content-Security-Policy every response carries: the pages' own inline
// styles and the one script above (by its SHA-256, checked by the tests), no
// other sources, forms only to this server, and no framing.
export const SCRIPT_HASH = "sha256-Wy6dQ+7y/KC7EOZjKC5JsXbLKmx6YAqFyX+RNVsBJfA=";
export const CSP =
  `default-src 'none'; script-src '${SCRIPT_HASH}'; style-src 'unsafe-inline'; form-action 'self'; ` +
  "frame-ancestors 'none'; base-uri 'none'";

// A link to send: on its own line, selected whole when tapped, with a Copy button.
export function linkBox(url: string): string {
  return `<div class="link"><input readonly value="${esc(url)}" aria-label="Link">` +
    `<button type="button" class="quiet" data-copy>Copy</button></div>`;
}

export function page(group: string, title: string, body: string): string {
  // "<group> · geow2 scores", or just the one name while the group has the
  // default (GROUP_NAME unset or "geow2 scores").
  const label = group.toLowerCase() === "geow2 scores" ? group : `${group} · geow2 scores`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${esc(title === group ? title : `${title} · ${group}`)}</title><style>${STYLE}</style></head>
<body><main><p class="group">${esc(label)}</p>${body}</main>${SCRIPT}</body></html>`;
}

export function message(group: string, title: string, text: string, extra = ""): string {
  return page(group, title, `<h1>${esc(title)}</h1><p>${text}</p>${extra}`);
}

// --- Players -------------------------------------------------------------------

// The browser you join in is the one that confirms each device you pair, by
// scanning the QR code the game shows: so the page steers computers to a phone.
export function invitePage(group: string, origin: string, code: string, error = "", name = ""): string {
  return page(
    group,
    "Join",
    `<h1>Join ${esc(group)}</h1>
<p>You've been invited to share geow2 high scores with this group. Choose the name the others will see on the boards.</p>
<section class="panel tip computer-only"><h2>Join on your phone</h2>
<p>The browser you join in is the one that pairs your devices: each PC or Steam Deck shows a QR code, and you scan it.
With your phone that's one scan; on a computer you'd type a code each time. Scan this to join on your phone instead:</p>
${qrSvg(`${origin}/invite/${code}`, "QR code of this invite link")}</section>
<form method="post" class="panel">
  <label for="name">Your name (up to 20 characters)
    <input id="name" name="name" value="${esc(name)}" maxlength="20" autocomplete="nickname" required autofocus></label>
  ${error ? `<p class="error">${esc(error)}</p>` : ""}
  <button type="submit">Join</button>
</form>`,
  );
}

export function signInPage(group: string, name: string): string {
  return page(
    group,
    "Sign in",
    `<h1>Sign in as ${esc(name)}</h1>
<p>This link signs this browser in as <b>${esc(name)}</b>, so you can pair devices and change your name.</p>
<form method="post" class="panel"><button type="submit">Sign in</button></form>`,
  );
}

// How to pair, in the order the game asks: the address (without https://,
// which the game adds), then the code.
export function pairSteps(origin: string): string {
  const host = origin.replace(/^https?:\/\//, "");
  return `<ol>
<li>In geow2, open <b>Help and options</b>, then <b>Online scores</b>, and enter this server's address. On the
same computer, copy it here and paste it in the game with Ctrl+V (Cmd+V on a Mac):${linkBox(host)}</li>
<li>Choose <b>Pair this device</b>. The game shows a code and a QR code.</li>
<li>Scan the QR code with your phone, signed in here, and confirm. Or type the code below.</li>
</ol>`;
}

// On a computer: a one-time link that signs your phone in as you, so you can
// pair by scanning from then on.
const phonePanel = (name: string, csrf: string) => `<section class="panel tip computer-only"><h2>Sign in on your phone</h2>
<p>Pairing is quickest with your phone: scan the QR code the game shows and confirm. Sign your phone in as
<b>${esc(name)}</b> once, with a code to scan.</p>
<form method="post" action="/me/phone"><input type="hidden" name="csrf" value="${esc(csrf)}">
<button type="submit">Show a code for my phone</button></form></section>`;

export function phonePage(group: string, name: string, url: string): string {
  return page(
    group,
    "Sign in on your phone",
    `<h1>Sign in on your phone</h1>
<section class="panel"><p>Scan this with your phone's camera and choose <b>Sign in</b>: your phone is then signed in as
<b>${esc(name)}</b>, and stays signed in here too.</p>
${qrSvg(url, "QR code of a sign-in link")}
<p>Or open this link on the phone. It works once, for a day.</p>${linkBox(url)}</section>
<p><a href="/me">Back to your page</a></p>`,
  );
}

export function mePage(
  group: string,
  origin: string,
  name: string,
  csrf: string,
  devices: { id: string; name: string; created: number; last_seen: number | null }[],
  notice = "",
  error = "",
): string {
  const rows = devices
    .map(
      (d) => `<tr><td>${esc(d.name)}</td><td>${date(d.created)}</td><td>${date(d.last_seen)}</td>
<td><form method="post" action="/me/devices/${esc(d.id)}/revoke" class="inline"><input type="hidden" name="csrf" value="${esc(csrf)}">
<button class="quiet" type="submit">Unpair</button></form></td></tr>`,
    )
    .join("");
  return page(
    group,
    name,
    `<h1>${esc(name)}</h1>
${notice ? `<p>${notice}</p>` : ""}
${phonePanel(name, csrf)}
<section class="panel"><h2>Pair a device</h2>${pairSteps(origin)}
<form method="get" action="/pair"><label for="code">Code shown in the game
<input id="code" name="code" autocomplete="off" autocapitalize="characters" placeholder="ABCD-EFGH"></label>
<button type="submit">Continue</button></form></section>
<section class="panel"><h2>Your devices</h2>
${devices.length ? `<div class="wrap"><table><tr><th>Device</th><th>Paired</th><th>Last sync</th><th></th></tr>${rows}</table></div>` : "<p>None yet.</p>"}
</section>
<section class="panel"><h2>Your name</h2>
<form method="post" action="/me/name"><input type="hidden" name="csrf" value="${esc(csrf)}">
<label for="rename">Name on the boards<input id="rename" name="name" value="${esc(name)}" maxlength="20" required></label>
${error ? `<p class="error">${esc(error)}</p>` : ""}
<button type="submit">Save</button></form></section>
<p><a href="/boards">The group's boards</a></p>
<form method="post" action="/me/signout"><input type="hidden" name="csrf" value="${esc(csrf)}">
<button class="quiet" type="submit">Sign out of this browser</button></form>`,
  );
}

export function pairPage(group: string, name: string, deviceName: string, code: string, csrf: string): string {
  return page(
    group,
    "Pair",
    `<h1>Pair ${esc(deviceName)}?</h1>
<p>This links <b>${esc(deviceName)}</b> to <b>${esc(name)}</b>: its scores, unlocks and achievements join yours, and it shows the group's boards.</p>
<p class="big">${esc(code.slice(0, 4))}-${esc(code.slice(4))}</p>
<p>Check that the game shows the same code.</p>
<form method="post" action="/pair/${esc(code)}" class="panel"><input type="hidden" name="csrf" value="${esc(csrf)}">
<button type="submit">Pair</button></form>`,
  );
}

// The PS5 port's front page: the public boards and how to join from the game.
export function publicHome(group: string, boards: { name: string; score: number }[][], signedIn: boolean): string {
  const tables = boards
    .map((rows, mode) =>
      rows.length
        ? `<section class="panel"><h2>${MODES[mode]}</h2><table>${rows
            .slice(0, 20)
            .map((r, i) => `<tr><td class="num">${i + 1}</td><td>${esc(r.name)}</td><td class="num">${r.score.toLocaleString("en-US")}</td></tr>`)
            .join("")}</table></section>`
        : "",
    )
    .join("");
  return page(
    group,
    group,
    `<h1>${esc(group)}</h1>
<p>The public high scores of Geometry Wars: Retro Evolved 2 on PlayStation 5.</p>
${signedIn ? `<p><a href="/me">Your page</a></p>` : `<section class="panel tip"><h2>Join</h2>
<p>In the game: <b>Help and options</b>, <b>Online scores</b>, <b>Pair this device</b>. Scan the QR code it shows with your phone and choose your name.</p></section>`}
${tables || "<p>No games yet.</p>"}`,
  );
}

// A browser that is not signed in, opening a device's pairing link: joining
// and pairing in one form.
export function joinPairPage(group: string, deviceName: string, code: string, error = "", name = ""): string {
  return page(
    group,
    "Join",
    `<h1>Join ${esc(group)}</h1>
<p>Choose the name everyone will see on the boards. <b>${esc(deviceName)}</b> is paired to it at the same time.</p>
<p class="big">${esc(code.slice(0, 4))}-${esc(code.slice(4))}</p>
<p>Check that the game shows the same code.</p>
<form method="post" action="/pair/${esc(code)}/join" class="panel">
  <label for="name">Your name (up to 20 characters)
    <input id="name" name="name" value="${esc(name)}" maxlength="20" autocomplete="nickname" required autofocus></label>
  ${error ? `<p class="error">${esc(error)}</p>` : ""}
  <button type="submit">Join and pair</button>
</form>`,
  );
}

export function boardsPage(group: string, boards: { name: string; score: number }[][]): string {
  const tables = boards
    .map((rows, mode) =>
      rows.length
        ? `<section class="panel"><h2>${MODES[mode]}</h2><table>${rows
            .slice(0, 20)
            .map((r, i) => `<tr><td class="num">${i + 1}</td><td>${esc(r.name)}</td><td class="num">${r.score.toLocaleString("en-US")}</td></tr>`)
            .join("")}</table></section>`
        : "",
    )
    .join("");
  return page(group, "Boards", `<h1>Boards</h1>${tables || "<p>No games yet.</p>"}`);
}

// --- Admin ---------------------------------------------------------------------

export function adminLogin(group: string, error = ""): string {
  return page(
    group,
    "Admin",
    `<h1>Admin</h1>
<form method="post" action="/admin/login" class="panel">
<label for="secret">Admin secret (set when the server was deployed)<input id="secret" name="secret" type="password" required autofocus></label>
${error ? `<p class="error">${esc(error)}</p>` : ""}
<button type="submit">Sign in</button></form>`,
  );
}

export function adminPage(
  group: string,
  origin: string,
  csrf: string,
  shortSecret: boolean,
  data: {
    players: { id: string; name: string; created: number; devices: number; games: number }[];
    invites: { code: string; player: string | null; name: string | null; expires: number; max_uses: number; uses: number }[];
    devices: { id: string; name: string; created: number; last_seen: number | null; player: string }[];
    scores: { seq: number; mode: number; score: number; time: number; player: string }[];
  },
  notice = "",
): string {
  const hidden = `<input type="hidden" name="csrf" value="${esc(csrf)}">`;
  const button = (action: string, label: string) =>
    `<form method="post" action="${action}" class="inline">${hidden}<button class="quiet" type="submit">${label}</button></form>`;
  const invites = data.invites
    .map(
      (i) => `<div class="invite">${linkBox(`${origin}/${i.player ? "signin" : "invite"}/${i.code}`)}
<div class="meta"><span>${i.player ? `Signs in as ${esc(i.name)}` : `${i.max_uses - i.uses} more can join`}, until ${date(i.expires)}</span>
${button(`/admin/invites/${esc(i.code)}/delete`, "Delete")}</div></div>`,
    )
    .join("");
  const players = data.players
    .map(
      (p) => `<tr><td>${esc(p.name)}</td><td class="num">${p.games}</td><td class="num">${p.devices}</td>
<td><form method="post" action="/admin/players/${esc(p.id)}/rename" class="inline">${hidden}
<input name="name" value="${esc(p.name)}" maxlength="20" style="width:9em;padding:4px 6px"> <button class="quiet" type="submit">Rename</button></form>
${button(`/admin/players/${esc(p.id)}/signin`, "Sign-in link")} ${button(`/admin/players/${esc(p.id)}/signout`, "Sign out")}
${button(`/admin/players/${esc(p.id)}/remove`, "Remove")}</td></tr>`,
    )
    .join("");
  const devices = data.devices
    .map(
      (d) => `<tr><td>${esc(d.player)}</td><td>${esc(d.name)}</td><td>${date(d.last_seen)}</td>
<td>${button(`/admin/devices/${esc(d.id)}/revoke`, "Unpair")}</td></tr>`,
    )
    .join("");
  const scores = data.scores
    .map(
      (s) => `<tr><td>${esc(s.player)}</td><td>${MODES[s.mode] ?? s.mode}</td><td class="num">${s.score.toLocaleString("en-US")}</td>
<td>${date(s.time)}</td><td>${button(`/admin/scores/${s.seq}/remove`, "Delete")}</td></tr>`,
    )
    .join("");
  return page(
    group,
    "Admin",
    `<h1>Admin</h1>${notice ? `<p>${notice}</p>` : ""}
${shortSecret ? `<p class="error">The admin secret is short, so it could be guessed. Set a longer one (at least 16
characters, random is best) in the Worker's settings: Settings, Variables and Secrets, ADMIN_SECRET.</p>` : ""}
<section class="panel"><h2>Invite people</h2>
<p>An invite link lets each person who opens it join with a name of their choice. Send it to your friends, to open
on their phones: the browser they join in is the one that pairs their devices, by scanning a QR code in the game.</p>
<form method="post" action="/admin/invites">${hidden}
<label for="uses">How many people can join with it<input id="uses" name="uses" type="number" min="1" max="100" value="5"></label>
<label for="days">Valid for (days)<input id="days" name="days" type="number" min="1" max="365" value="14"></label>
<button type="submit">Make an invite link</button></form>
${invites ? `<div>${invites}</div>` : ""}</section>
<section class="panel"><h2>Players</h2>
${players ? `<div class="wrap"><table><tr><th>Name</th><th>Games</th><th>Devices</th><th></th></tr>${players}</table></div>` : "<p>Nobody yet.</p>"}
<p>A sign-in link signs a player in on another phone or computer (for example when they lost the old one).
Sign out signs them out of every browser; their devices stay paired.</p></section>
<section class="panel"><h2>Devices</h2>
${devices ? `<div class="wrap"><table><tr><th>Player</th><th>Device</th><th>Last sync</th><th></th></tr>${devices}</table></div>` : "<p>None yet.</p>"}</section>
<section class="panel"><h2>Latest games</h2>
${scores ? `<div class="wrap"><table>${scores}</table></div>` : "<p>None yet.</p>"}</section>
<p><a href="/boards">The boards</a></p>
<form method="post" action="/admin/signout">${hidden}<button class="quiet" type="submit">Sign out</button></form>`,
  );
}
