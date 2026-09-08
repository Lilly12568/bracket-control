type TetrioResponse<T> = {
  success?: boolean;
  data?: T;
  error?: { msg?: string };
};

type TetrioUser = {
  _id?: string;
  username?: string;
  country?: string | null;
  avatar_revision?: number;
};

type LeagueSummary = {
  tr?: number;
  rank?: string;
  glicko?: number;
  rd?: number;
  standing?: number;
  standing_local?: number;
  past?: Record<string, { tr?: number; rank?: string }>;
};

type SoloSummary = {
  record?: {
    results?: {
      stats?: { finaltime?: number; score?: number };
    };
  } | null;
};

async function optionalSummary<T>(url: string, headers: HeadersInit) {
  try {
    const response = await fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(12_000) });
    if (!response.ok) return null;
    const body = await response.json() as TetrioResponse<T>;
    return body.success && body.data ? body.data : null;
  } catch {
    return null;
  }
}

async function toDataUrl(url: string) {
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return `data:${response.headers.get('content-type') || 'application/octet-stream'};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

function usableNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function countryName(code?: string | null) {
  if (!code) return undefined;
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase()) || code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

export async function GET(request: Request) {
  const rawIdentifier = new URL(request.url).searchParams.get('user')?.trim().replace(/^@/, '') || '';
  if (!/^(?:[a-f\d]{24}|[a-z\d_-]{1,32})$/i.test(rawIdentifier)) {
    return new Response('Enter a valid TETR.IO username or 24-character user ID.', { status: 400 });
  }

  const identifier = rawIdentifier.toLowerCase();
  const headers = {
    Accept: 'application/json',
    'X-Session-ID': `bracket-control-${crypto.randomUUID()}`,
  };

  try {
    const userResponse = await fetch(`https://ch.tetr.io/api/users/${encodeURIComponent(identifier)}`, {
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(12_000),
    });
    const userBody = await userResponse.json() as TetrioResponse<TetrioUser>;
    if (!userResponse.ok || !userBody.success || !userBody.data?._id || !userBody.data.username) {
      return new Response(userBody.error?.msg || 'TETR.IO user not found.', { status: 404 });
    }

    const user = userBody.data;
    const userId = String(user._id);
    const username = String(user.username);
    const [league, fortyLines, blitz] = await Promise.all([
      optionalSummary<LeagueSummary>(`https://ch.tetr.io/api/users/${userId}/summaries/league`, headers),
      optionalSummary<SoloSummary>(`https://ch.tetr.io/api/users/${userId}/summaries/40l`, headers),
      optionalSummary<SoloSummary>(`https://ch.tetr.io/api/users/${userId}/summaries/blitz`, headers),
    ]);

    const countryCode = user.country?.toUpperCase();
    const previousSeason = league?.past?.['1'];
    const rank = league?.rank?.toLowerCase();
    const previousRank = previousSeason?.rank?.toLowerCase();
    const [avatar, flag, ...rankIcons] = await Promise.all([
      user.avatar_revision === undefined ? Promise.resolve(null) : toDataUrl(`https://tetr.io/user-content/avatars/${userId}.jpg?rv=${user.avatar_revision}`),
      countryCode ? toDataUrl(`https://hatscripts.github.io/circle-flags/flags/${countryCode.toLowerCase()}.svg`) : Promise.resolve(null),
      ...[...new Set([rank, previousRank].filter((value): value is string => !!value))]
        .map((value) => toDataUrl(`https://tetr.io/res/league-ranks/${value}.png`)),
    ]);
    const ranks = [...new Set([rank, previousRank].filter((value): value is string => !!value))];
    const glicko = usableNumber(league?.glicko);
    const rd = usableNumber(league?.rd);
    const fortyLinesTime = usableNumber(fortyLines?.record?.results?.stats?.finaltime);
    const blitzScore = usableNumber(blitz?.record?.results?.stats?.score);

    return Response.json({
      entrant: {
        TetrioID: userId,
        TetrioName: username.toUpperCase(),
        CountryName: countryName(countryCode),
        CountryCode: countryCode,
        TR: usableNumber(league?.tr),
        Rank: rank,
        Glicko: glicko === null ? null : Math.round(glicko),
        RD: rd === null ? null : Math.round(rd),
        StandingGlobal: usableNumber(league?.standing),
        StandingCountry: usableNumber(league?.standing_local),
        TR_S1: usableNumber(previousSeason?.tr),
        Rank_S1: previousRank,
        _40L: fortyLinesTime === null ? null : Math.round(fortyLinesTime),
        Blitz: blitzScore === null ? null : Math.round(blitzScore),
      },
      assets: {
        avatars: avatar ? { [userId]: avatar } : {},
        flags: flag && countryCode ? { [countryCode.toLowerCase()]: flag } : {},
        ranks: Object.fromEntries(ranks.flatMap((value, index) => rankIcons[index] ? [[value, rankIcons[index]]] : [])),
      },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'Could not reach TETR.IO.', { status: 502 });
  }
}
