export type StandingEntrant = {
  Seed: number | null;
  TetrioID?: string;
  TetrioName: string;
  CountryName?: string;
  CountryCode?: string;
};

export type StandingMatch = {
  ID: number;
  Bracket: string;
  RoundNo: number | null;
  MatchNo: number | null;
  Seed1: number | null;
  Seed2: number | null;
  Score1: number | null;
  Score2: number | null;
  Winner: number | null;
  PlacementGroupStart?: number | null;
  PlacementGroupEnd?: number | null;
  PlacementAwardWinner?: number | null;
  PlacementAwardLoser?: number | null;
};

export type CalculatedPlacement = {
  Placement: number;
  TetrioID?: string;
  TetrioName: string;
  CountryName?: string;
  CountryCode?: string;
};

export function rankGroup(code: string, matches: StandingMatch[], entrants: StandingEntrant[]) {
  const bySeed = new Map(entrants.map((entrant) => [entrant.Seed, entrant]));
  const rows = new Map<number, { entrant: StandingEntrant; wins: number; diff: number }>();
  for (const match of matches.filter((item) => item.Bracket === code)) {
    const player1 = bySeed.get(match.Seed1);
    const player2 = bySeed.get(match.Seed2);
    if (player1?.Seed && !rows.has(player1.Seed)) rows.set(player1.Seed, { entrant: player1, wins: 0, diff: 0 });
    if (player2?.Seed && !rows.has(player2.Seed)) rows.set(player2.Seed, { entrant: player2, wins: 0, diff: 0 });
    if (!player1?.Seed || !player2?.Seed || !match.Winner || match.Score1 === null || match.Score2 === null) continue;
    const player1Row = rows.get(player1.Seed)!;
    const player2Row = rows.get(player2.Seed)!;
    player1Row.diff += match.Score1 - match.Score2;
    player2Row.diff += match.Score2 - match.Score1;
    if (match.Winner === 1) player1Row.wins++;
    else player2Row.wins++;
  }
  return [...rows.values()]
    .sort((a, b) => b.wins - a.wins || b.diff - a.diff || (a.entrant.Seed || 9999) - (b.entrant.Seed || 9999))
    .map((row) => row.entrant);
}

function winnerSeed(match: StandingMatch) {
  return match.Winner === 1 ? match.Seed1 : match.Winner === 2 ? match.Seed2 : null;
}

function loserSeed(match: StandingMatch) {
  return match.Winner === 1 ? match.Seed2 : match.Winner === 2 ? match.Seed1 : null;
}

export function calculatePlacements(matches: StandingMatch[], entrants: StandingEntrant[]): CalculatedPlacement[] {
  if (!matches.length || matches.some((match) => !match.Winner || !match.Seed1 || !match.Seed2)) return [];

  const entrantsBySeed = new Map(entrants.filter((entrant) => entrant.Seed).map((entrant) => [entrant.Seed!, entrant]));
  const assigned = new Map<number, number>();
  const assign = (seed: number | null, placement: number) => {
    if (seed && entrantsBySeed.has(seed) && !assigned.has(seed)) assigned.set(seed, placement);
  };
  const assignLoserRound = (roundMatches: StandingMatch[], placement: number) => {
    const seeds = [...new Set(roundMatches.map(loserSeed).filter((seed): seed is number => !!seed && !assigned.has(seed)))];
    for (const seed of seeds) assign(seed, placement);
    return seeds.length;
  };

  // Placement-stage matches declare their exact finishing positions. Apply
  // these before inferred elimination placements so their local result wins.
  for (const match of matches) {
    const winnerPlacement = Number(match.PlacementAwardWinner);
    const loserPlacement = Number(match.PlacementAwardLoser);
    if (Number.isInteger(winnerPlacement) && winnerPlacement > 0) assign(winnerSeed(match), winnerPlacement);
    if (Number.isInteger(loserPlacement) && loserPlacement > 0) assign(loserSeed(match), loserPlacement);
  }

  const finals = matches
    .filter((match) => match.Bracket === 'F')
    .sort((a, b) => (a.RoundNo ?? 0) - (b.RoundNo ?? 0) || (a.MatchNo ?? 0) - (b.MatchNo ?? 0) || a.ID - b.ID);
  let championship = finals.at(-1);
  const lowerMatches = matches.filter((match) => match.Bracket === 'L');
  const upperMatches = matches.filter((match) => match.Bracket === 'W');

  if (!championship && !lowerMatches.length && upperMatches.length) {
    const lastRound = Math.max(...upperMatches.map((match) => match.RoundNo ?? 0));
    const candidates = upperMatches.filter((match) => (match.RoundNo ?? 0) === lastRound);
    if (candidates.length === 1) championship = candidates[0];
  }

  let nextPlacement = 1;
  if (championship) {
    assign(winnerSeed(championship), 1);
    assign(loserSeed(championship), 2);
    nextPlacement = 3;
  }

  const eliminationMatches = lowerMatches.length
    ? lowerMatches
    : upperMatches.filter((match) => match.ID !== championship?.ID);
  const eliminationRounds = [...new Set(eliminationMatches.map((match) => match.RoundNo ?? 0))].sort((a, b) => b - a);
  for (const round of eliminationRounds) {
    nextPlacement += assignLoserRound(eliminationMatches.filter((match) => (match.RoundNo ?? 0) === round), nextPlacement);
  }

  const groupCodes = [...new Set(matches.filter((match) => /^G[A-Z]/.test(match.Bracket)).map((match) => match.Bracket))].sort();
  const groupRankings = groupCodes.map((code) => rankGroup(code, matches, entrants));
  const longestGroup = Math.max(0, ...groupRankings.map((ranking) => ranking.length));
  nextPlacement = Math.max(nextPlacement, assigned.size + 1);
  for (let rank = 0; rank < longestGroup; rank++) {
    const seeds = [...new Set(groupRankings.map((ranking) => ranking[rank]?.Seed).filter((seed): seed is number => !!seed && !assigned.has(seed)))];
    for (const seed of seeds) assign(seed, nextPlacement);
    nextPlacement += seeds.length;
  }

  const unassigned = [...entrantsBySeed.keys()].filter((seed) => !assigned.has(seed));
  for (const seed of unassigned) assign(seed, nextPlacement);

  return [...assigned.entries()]
    .map(([seed, placement]) => {
      const entrant = entrantsBySeed.get(seed)!;
      return {
        Placement: placement,
        TetrioID: entrant.TetrioID,
        TetrioName: entrant.TetrioName,
        CountryName: entrant.CountryName,
        CountryCode: entrant.CountryCode,
      };
    })
    .sort((a, b) => a.Placement - b.Placement || (entrants.find((entrant) => entrant.TetrioID === a.TetrioID)?.Seed ?? 9999) - (entrants.find((entrant) => entrant.TetrioID === b.TetrioID)?.Seed ?? 9999));
}
