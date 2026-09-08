const SCRIPT_URLS = [
  'https://momentjs.com/downloads/moment.min.js',
  'https://momentjs.com/downloads/moment-timezone-with-data.min.js',
  'https://cdn.jsdelivr.net/npm/dompurify@3.0.8/dist/purify.min.js',
  'https://cdn.jsdelivr.net/npm/marked@11.1.1/lib/marked.umd.min.js',
  'https://cdn.jsdelivr.net/npm/scheduler-polyfill@1.3.0/dist/scheduler-polyfill.min.js',
  'https://cdn.jsdelivr.net/npm/fuse.js@7.0.0/dist/fuse.basic.min.js',
  'https://ch.tetr.io/res/js/remote/identicon.js',
  'https://eucannon.org/js/eucannon.js',
];
const CHECKMARK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="white" d="m3 12 6 6L21 5l-2-2L9 14 5 10z"/></svg>';
const CHECKMARK_DATA_URI = `data:image/svg+xml,${encodeURIComponent(CHECKMARK_SVG)}`;

type AssetEntrant = { TetrioID?: string; CountryCode?: string; Rank?: string; Rank_S1?: string };
type ImportedPayload = { Meta?: Record<string, unknown>; Entrants?: AssetEntrant[]; Bracket?: unknown[]; [key: string]: unknown };

function regexEscape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function patchAssetCode(value: string) {
  return value
    .replace('img.src = `https://tetr.io/user-content/avatars/${id}.jpg?rv=${avatarRV[id]}`;', 'if (window.__LOCAL_ASSETS?.avatars?.[id]) img.src = window.__LOCAL_ASSETS.avatars[id]; else { const identicon = new Identicon(MD5(id), identicon_settings).toString(); img.src = `data:image/svg+xml;base64,${identicon}`; }')
    .replaceAll('img.src = `https://tetr.io/res/flags/${code}.png`;', 'img.src = window.__LOCAL_ASSETS?.flags?.[code] || window.__localCountryFlag(code);')
    .replaceAll('img.src = `https://hatscripts.github.io/circle-flags/flags/${code}.svg`;', 'img.src = window.__LOCAL_ASSETS?.flags?.[code] || window.__localCountryFlag(code);')
    .replaceAll('img.src = `https://tetr.io/res/league-ranks/${rank}.png`;', 'img.src = window.__LOCAL_ASSETS?.ranks?.[rank] || window.__localRankIcon(rank);')
    .replaceAll('img.src = `https://tetr.io/res/league-ranks/z.png`;', 'img.src = window.__LOCAL_ASSETS?.ranks?.z || window.__localRankIcon("z");');
}

async function toDataUrl(url: string) {
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(6000) });
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:${response.headers.get('content-type') || 'application/octet-stream'};base64,${btoa(binary)}`;
  } catch { return null; }
}

async function loadVisualAssets(payload: ImportedPayload) {
  const entrants = Array.isArray(payload?.Entrants) ? payload.Entrants : [];
  const ids = [...new Set(entrants.map((e) => String(e?.TetrioID || '')).filter(Boolean))] as string[];
  const countries = [...new Set(entrants.map((e) => String(e?.CountryCode || '').toLowerCase()).filter(Boolean))] as string[];
  const ranks = [...new Set(entrants.flatMap((e) => [e?.Rank, e?.Rank_S1]).map((rank) => String(rank || '').toLowerCase()).filter(Boolean))] as string[];
  const [avatarValues, flagValues, rankValues] = await Promise.all([
    Promise.all(ids.map((id) => toDataUrl(`https://tetr.io/user-content/avatars/${id}.jpg?rv=${Date.now()}`))),
    Promise.all(countries.map((code) => toDataUrl(`https://hatscripts.github.io/circle-flags/flags/${code}.svg`))),
    Promise.all(ranks.map((rank) => toDataUrl(`https://tetr.io/res/league-ranks/${rank}.png`))),
  ]);
  return {
    avatars: Object.fromEntries(ids.flatMap((id, i) => avatarValues[i] ? [[id, avatarValues[i]]] : [])),
    flags: Object.fromEntries(countries.flatMap((code, i) => flagValues[i] ? [[code, flagValues[i]]] : [])),
    ranks: Object.fromEntries(ranks.flatMap((rank, i) => rankValues[i] ? [[rank, rankValues[i]]] : [])),
  };
}

async function findLatestCompletedTournamentId() {
  const response = await fetch('https://eucannon.org/', { cache: 'no-store' });
  if (!response.ok) throw new Error(`EUCannon returned ${response.status} while finding the latest tournament.`);
  const html = await response.text();
  const ids = [...new Set(
    [...html.matchAll(/location\.href=["']\/landing\/(\d+)["']/gi)]
      .map((match) => Number(match[1]))
      .filter((id) => Number.isInteger(id) && id > 0),
  )].sort((a, b) => b - a);

  for (const id of ids) {
    try {
      const bracketResponse = await fetch(`https://eucannon.org/json/bracket/${id}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!bracketResponse.ok) continue;
      const payload = await bracketResponse.json() as ImportedPayload;
      if (Number(payload.Meta?.IDtournament_phase) === 5) return id;
    } catch {
      // A broken listing should not prevent trying the next tournament.
    }
  }

  throw new Error('EUCannon did not list a completed tournament.');
}

async function bundlePage(id: number) {
  const [pageResponse, cssResponse, ...scriptResponses] = await Promise.all([
    fetch(`https://eucannon.org/bracket/${id}`, { cache: 'no-store' }),
    fetch('https://eucannon.org/css/eucannon.css', { cache: 'no-store' }),
    ...SCRIPT_URLS.map((url) => fetch(url, { cache: 'no-store' })),
  ]);
  if (!pageResponse.ok) throw new Error(`EUCannon returned ${pageResponse.status} for bracket #${id}.`);
  let html = await pageResponse.text();
  html = html.replace(
    /(function getGroupStageMatchVisibilityState\s*\([^)]*\)\s*\{)/,
    `$1\n\t\t\t\tif (isRoundRobinStatusMatch(match)) { return { player1Visible: true, player2Visible: true, roomVisible: true }; }`,
  );
  const roomVisibilitySignature = 'function getRenderedMatchRoomValue(match, groupStageVisibilityState = getGroupStageMatchVisibilityState(match)) {';
  html = html.replace(
    roomVisibilitySignature,
    `${roomVisibilitySignature}\n\t\t\t\tif (!window.__LOCAL_SHOW_ROOM_CODES_EARLY && (!(Number(match?.Seed1) > 0) || !(Number(match?.Seed2) > 0))) { return null; }`,
  );
  if (cssResponse.ok) {
    const css = await cssResponse.text();
    html = html.replace(/<link([^>]+)href=["']\/css\/eucannon\.css["']([^>]*)>/i, (_match, before, after) => `<link${before}href="data:text/css;charset=utf-8,${encodeURIComponent(css)}"${after}>`);
  }
  for (let i = 0; i < SCRIPT_URLS.length; i++) {
    if (!scriptResponses[i]?.ok) continue;
    const requested = SCRIPT_URLS[i];
    const inPage = requested.startsWith('https://eucannon.org/') ? requested.replace('https://eucannon.org', '') : requested;
    const code = patchAssetCode(await scriptResponses[i].text());
    html = html.replace(
      new RegExp(`<script([^>]*?)src=["']${regexEscape(inPage)}["']([^>]*)><\\/script>`, 'i'),
      (_match, before, after) => `<script${before}src="data:text/javascript;charset=utf-8,${encodeURIComponent(code)}"${after}></script>`,
    );
  }
  html = html
    .replace(/<link[^>]+rel=["']preconnect["'][^>]*>/gi, '')
    .replace(/<link[^>]+href=["']https:\/\/use\.fontawesome\.com\/[^"']+["'][^>]*>/gi, '')
    .replaceAll('/res/checkmark.svg', CHECKMARK_DATA_URI)
    .replace(/<link[^>]+rel=["']icon["'][^>]*>/gi, '');
  const [staticAssets, interVariableFont] = await Promise.all([
    Promise.all(['/res/euc.svg', '/res/tetrio-mono.svg', '/res/favicon.png'].map((path) => toDataUrl(`https://eucannon.org${path}`))),
    toDataUrl('https://rsms.me/inter/font-files/InterVariable.woff2?v=4.1'),
  ]);
  ['/res/euc.svg', '/res/tetrio-mono.svg', '/res/favicon.png'].forEach((path, index) => { if (staticAssets[index]) html = html.replaceAll(path, staticAssets[index]!); });
  const interCss = interVariableFont ? `<style>@font-face{font-family:InterVariable;font-style:normal;font-weight:100 900;font-display:swap;src:url('${interVariableFont}') format('woff2')}@font-face{font-family:Inter;font-style:normal;font-weight:100 900;font-display:swap;src:url('${interVariableFont}') format('woff2')}</style>` : '';
  html = html.replace(/<link[^>]+href=["']https:\/\/rsms\.me\/inter\/inter\.css["'][^>]*>/gi, interCss);
  const [solidCssResponse, brandsCssResponse, baseCssResponse, solidFont, brandsFont] = await Promise.all([
    fetch('https://use.fontawesome.com/releases/v6.7.2/css/solid.css', { cache: 'no-store' }),
    fetch('https://use.fontawesome.com/releases/v6.7.2/css/brands.css', { cache: 'no-store' }),
    fetch('https://use.fontawesome.com/releases/v6.7.2/css/fontawesome.css', { cache: 'no-store' }),
    toDataUrl('https://use.fontawesome.com/releases/v6.7.2/webfonts/fa-solid-900.woff2'),
    toDataUrl('https://use.fontawesome.com/releases/v6.7.2/webfonts/fa-brands-400.woff2'),
  ]);
  let iconCss = [solidCssResponse, brandsCssResponse, baseCssResponse].filter((response) => response.ok).length
    ? (await Promise.all([solidCssResponse, brandsCssResponse, baseCssResponse].map((response) => response.ok ? response.text() : Promise.resolve('')))).join('\n')
    : '';
  if (solidFont) iconCss = iconCss.replaceAll('../webfonts/fa-solid-900.woff2', solidFont);
  if (brandsFont) iconCss = iconCss.replaceAll('../webfonts/fa-brands-400.woff2', brandsFont);
  if (iconCss) html = html.replace('</head>', `<style>${iconCss}</style></head>`);
  return html;
}

export async function GET(request: Request) {
  const requestedId = new URL(request.url).searchParams.get('id');
  let id: number;
  try {
    id = requestedId?.toLowerCase() === 'latest' ? await findLatestCompletedTournamentId() : Number(requestedId);
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'Could not find the latest completed tournament.', { status: 502 });
  }
  if (!Number.isInteger(id) || id <= 0 || id > 1_000_000) return new Response('Invalid bracket ID.', { status: 400 });
  try {
    const [bracketResponse, infoResponse, sourceHtml] = await Promise.all([
      fetch(`https://eucannon.org/json/bracket/${id}?placements=1`, { headers: { Accept: 'application/json' }, cache: 'no-store' }),
      fetch(`https://eucannon.org/json/info/${id}`, { headers: { Accept: 'application/json' }, cache: 'no-store' }),
      bundlePage(id),
    ]);
    if (!bracketResponse.ok) return new Response(`EUCannon returned ${bracketResponse.status} for bracket #${id}.`, { status: 502 });
    const payload = await bracketResponse.json() as ImportedPayload;
    const info = infoResponse.ok ? await infoResponse.json() as Record<string, unknown> : {};
    if (!payload?.Meta || !Array.isArray(payload?.Entrants) || !Array.isArray(payload?.Bracket)) return new Response('This bracket did not return a supported data shape.', { status: 502 });
    const assets = await loadVisualAssets(payload);
    const title = typeof info.Title === 'string' ? info.Title : typeof info.FullTitle === 'string' ? info.FullTitle : `Tournament ${id}`;
    const subtitle = typeof info.Subtitle === 'string' ? info.Subtitle : '';
    return Response.json({ id, title, subtitle, info, loadedAt: new Date().toISOString(), payload, sourceHtml, assets }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'Could not reach EUCannon.', { status: 502 });
  }
}
