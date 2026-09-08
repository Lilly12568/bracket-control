'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCheck, CloudDownload, Loader2, RefreshCw, RotateCcw, Settings2, UserPlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { calculatePlacements, rankGroup } from '@/lib/bracket-standings';

type Phase = 'upcoming' | 'registration' | 'checkin' | 'active' | 'complete';
type Entrant = { IDentrant: number; Seed: number | null; TetrioID?: string; TetrioName: string; CountryName?: string; CountryCode?: string; TR?: number | null; Rank?: string | null; Glicko?: number | null; RD?: number | null; StandingGlobal?: number | null; StandingCountry?: number | null; TR_S1?: number | null; Rank_S1?: string | null; _40L?: number | null; Blitz?: number | null; LocallyAdded?: boolean };
type Match = { ID: number; Bracket: string; RoundNo: number | null; MatchNo: number | null; Name: string; ShortName: string; IDmatchFrom1: number | null; IDmatchFrom2: number | null; GroupStagePlacement1: number | null; GroupStagePlacement2: number | null; Seed1: number | null; Seed2: number | null; Score1: number | null; Score2: number | null; ScoreReset1: number | null; ScoreReset2: number | null; Winner: number | null; PlacementGroupStart?: number | null; PlacementGroupEnd?: number | null; PlacementAwardWinner?: number | null; PlacementAwardLoser?: number | null; Room?: string | null };
type Placement = { Placement: number; TetrioID?: string; TetrioName: string; CountryName?: string; CountryCode?: string };
type Payload = { Meta: Record<string, unknown>; Entrants: Entrant[]; Bracket: Match[]; Placements?: Placement[] };
type Tournament = { id: number; title: string; subtitle: string; info: Record<string, unknown>; loadedAt: string; resourcesUpdatedAt?: string; payload: Payload; sourceHtml: string; assets?: { avatars?: Record<string,string>; flags?: Record<string,string>; ranks?: Record<string,string> } };
type PlayerLookup = { entrant: Omit<Entrant, 'IDentrant' | 'Seed' | 'LocallyAdded'>; assets?: Tournament['assets'] };
type ManualSet = { a: number; b: number };
type Saved = { tournament: Tournament; phase: Phase; registrations: Record<string, boolean>; checkins: Record<string, boolean>; checkinsInitializedFromSource: boolean; seedOrder: number[]; revealedSets: Record<string, number>; manualScores: Record<string, ManualSet[]>; showRoomCodesEarly: boolean };

const STORAGE_KEY = 'bracket-control-source-v11';
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');

function apiUrl(path: `/api/${string}`) {
  return `${API_BASE_URL}${path}`;
}

const PHASES = [
  { value: 'upcoming', id: 1, label: 'Upcoming', detail: 'Before registration' },
  { value: 'registration', id: 2, label: 'Registration', detail: 'Registered entrants' },
  { value: 'checkin', id: 3, label: 'Check-ins', detail: 'Attendance' },
  { value: 'active', id: 4, label: 'In progress', detail: 'Seeded bracket' },
  { value: 'complete', id: 5, label: 'Complete', detail: 'Results & standings' },
] as const satisfies ReadonlyArray<{ value: Phase; id: number; label: string; detail: string }>;
const PHASE_VALUES = PHASES.map(({ value }) => value) as Phase[];
const CHECKMARK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="white" d="m3 12 6 6L21 5l-2-2L9 14 5 10z"/></svg>';
const CHECKMARK_DATA_URI = `data:image/svg+xml,${encodeURIComponent(CHECKMARK_SVG)}`;
const LEGACY_CHECKMARK_DATA_URI = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"%3E%3Cpath fill="white" d="m3 12 6 6L21 5l-2-2L9 14 5 10z"/%3E%3C/svg%3E';

function normalizePhase(value: unknown): Phase {
  if (PHASE_VALUES.includes(value as Phase)) return value as Phase;
  if (value === 'pre') return 'registration';
  if (value === 'seeded') return 'active';
  if (value === 'live') return 'complete';
  return 'active';
}

function importedSeedOrder(tournament: Tournament) {
  return [...tournament.payload.Entrants]
    .sort((a, b) => (a.Seed ?? Number.MAX_SAFE_INTEGER) - (b.Seed ?? Number.MAX_SAFE_INTEGER) || a.TetrioName.localeCompare(b.TetrioName) || a.IDentrant - b.IDentrant)
    .map((entrant) => entrant.IDentrant);
}

function normalizeSeedOrder(tournament: Tournament, seedOrder?: number[]) {
  const imported = importedSeedOrder(tournament);
  const valid = new Set(imported);
  const seen = new Set<number>();
  const result: number[] = [];
  for (const id of seedOrder || []) {
    if (valid.has(id) && !seen.has(id)) { seen.add(id); result.push(id); }
  }
  for (const id of imported) {
    if (!seen.has(id)) { seen.add(id); result.push(id); }
  }
  return result;
}

function entrantsInRegistrationOrder(tournament: Tournament) {
  return [...tournament.payload.Entrants].sort((a, b) => a.IDentrant - b.IDentrant);
}

function importedCheckins(tournament: Tournament) {
  return Object.fromEntries(tournament.payload.Entrants.map((entrant) => [entrant.IDentrant, !entrant.LocallyAdded && (entrant.TR === 0 || !!entrant.TR)]));
}

function isRegistered(saved: Saved, entrantId: number) {
  return saved.registrations[entrantId] !== false;
}

function isCheckedIn(saved: Saved, entrantId: number) {
  return saved.checkins[entrantId] !== false;
}

function checkedInEntrantsInSeedOrder(saved: Saved) {
  const entrantsById = new Map(saved.tournament.payload.Entrants.map((entrant) => [entrant.IDentrant, entrant]));
  return normalizeSeedOrder(saved.tournament, saved.seedOrder)
    .filter((id) => isRegistered(saved, id) && isCheckedIn(saved, id))
    .map((id) => entrantsById.get(id))
    .filter((entrant): entrant is Entrant => !!entrant);
}

function mergeCheckedSeedOrder(saved: Saved, nextCheckedOrder: number[]) {
  const fullOrder = normalizeSeedOrder(saved.tournament, saved.seedOrder);
  const checkedIds = fullOrder.filter((id) => isRegistered(saved, id) && isCheckedIn(saved, id));
  const expected = new Set(checkedIds);
  if (nextCheckedOrder.length !== checkedIds.length || nextCheckedOrder.some((id) => !expected.has(id)) || new Set(nextCheckedOrder).size !== checkedIds.length) return fullOrder;
  let index = 0;
  return fullOrder.map((id) => isRegistered(saved, id) && isCheckedIn(saved, id) ? nextCheckedOrder[index++] : id);
}

function sourceStore(mode: 'get' | 'put', key: string, value?: string): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('bracket-control', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('sources');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('sources', mode === 'get' ? 'readonly' : 'readwrite');
      const store = tx.objectStore('sources');
      const operation = mode === 'get' ? store.get(key) : store.put(value, key);
      operation.onsuccess = () => resolve(mode === 'get' ? operation.result as string | undefined : undefined);
      operation.onerror = () => reject(operation.error);
      tx.oncomplete = () => db.close();
    };
  });
}

function parseId(value: string): number | 'latest' | null {
  const trimmed = value.trim();
  if (/^(?:https?:\/\/eucannon\.org\/bracket\/)?latest\/?$/i.test(trimmed)) return 'latest';
  const match = trimmed.match(/(?:bracket\/)?(\d+)(?:[/?#]|$)/i);
  return match ? Number(match[1]) : null;
}

function flag(code?: string) {
  if (!code || code.length !== 2) return '◆';
  return String.fromCodePoint(...code.toUpperCase().split('').map((c) => 127397 + c.charCodeAt(0)));
}

function setCount(match: Match) {
  return match.ScoreReset1 !== null || match.ScoreReset2 !== null ? 2 : (match.Score1 !== null && match.Score2 !== null ? 1 : 0);
}

type GroupScheduleEntry = { aIndex: number; bIndex: number; round: number; matchNo: number; template?: Match };

function groupSchedulePairKey(aIndex: number, bIndex: number) {
  return aIndex < bIndex ? `${aIndex}-${bIndex}` : `${bIndex}-${aIndex}`;
}

function fallbackRoundRobinSchedule(size: number): GroupScheduleEntry[] {
  if (size === 4) return [
    { aIndex: 0, bIndex: 2, round: 1, matchNo: 1 },
    { aIndex: 3, bIndex: 1, round: 1, matchNo: 2 },
    { aIndex: 0, bIndex: 1, round: 2, matchNo: 1 },
    { aIndex: 2, bIndex: 3, round: 2, matchNo: 2 },
    { aIndex: 0, bIndex: 3, round: 3, matchNo: 1 },
    { aIndex: 1, bIndex: 2, round: 3, matchNo: 2 },
  ];
  const slots: Array<number | null> = Array.from({ length: size }, (_, index) => index);
  if (slots.length % 2) slots.push(null);
  const schedule: GroupScheduleEntry[] = [];
  for (let round = 1; round < slots.length; round++) {
    let matchNo = 1;
    for (let index = 0; index < slots.length / 2; index++) {
      const aIndex = slots[index];
      const bIndex = slots[slots.length - 1 - index];
      if (aIndex !== null && bIndex !== null) schedule.push({ aIndex, bIndex, round, matchNo: matchNo++ });
    }
    slots.splice(1, 0, slots.pop()!);
  }
  return schedule;
}

function augmentGroupStageMatches(matches: Match[], seededCount: number) {
  const groupCodes = [...new Set(matches.filter((match) => /^G[A-Z]/.test(match.Bracket)).map((match) => match.Bracket))].sort();
  if (!groupCodes.length) return;
  const expectedByGroup = new Map(groupCodes.map((code) => [code, [] as number[]]));
  for (let seed = 1; seed <= seededCount; seed++) {
    const block = Math.floor((seed - 1) / groupCodes.length);
    const offset = (seed - 1) % groupCodes.length;
    const groupIndex = block % 2 === 0 ? offset : groupCodes.length - 1 - offset;
    expectedByGroup.get(groupCodes[groupIndex])!.push(seed);
  }
  const schedules = new Map<number, GroupScheduleEntry[]>();
  for (const code of groupCodes) {
    const seeds = expectedByGroup.get(code)!;
    if (seeds.length < 2 || schedules.has(seeds.length)) continue;
    const groupMatches = matches.filter((match) => match.Bracket === code && match.Seed1 && match.Seed2 && !match.IDmatchFrom1 && !match.IDmatchFrom2);
    if (groupMatches.length !== seeds.length * (seeds.length - 1) / 2) continue;
    const inferred = groupMatches.map((match) => ({ aIndex: seeds.indexOf(match.Seed1!), bIndex: seeds.indexOf(match.Seed2!), round: match.RoundNo || 1, matchNo: match.MatchNo || 1, template: match }));
    if (inferred.every(({ aIndex, bIndex }) => aIndex >= 0 && bIndex >= 0)) schedules.set(seeds.length, inferred);
  }
  let nextId = Math.max(0, ...matches.map((match) => match.ID)) + 1;
  const genericTemplate = matches.find((match) => /^G[A-Z]/.test(match.Bracket));
  for (let index = matches.length - 1; index >= 0; index--) {
    const match = matches[index];
    const seeds = expectedByGroup.get(match.Bracket);
    if (!seeds || !match.Seed1 || !match.Seed2 || match.IDmatchFrom1 || match.IDmatchFrom2) continue;
    if (!seeds.includes(match.Seed1) || !seeds.includes(match.Seed2)) matches.splice(index, 1);
  }
  for (const code of groupCodes) {
    const seeds = expectedByGroup.get(code)!;
    if (seeds.length < 2) continue;
    const schedule = schedules.get(seeds.length) || fallbackRoundRobinSchedule(seeds.length);
    const existingPairs = new Set(matches.filter((match) => match.Bracket === code && match.Seed1 && match.Seed2).map((match) => groupSchedulePairKey(seeds.indexOf(match.Seed1!), seeds.indexOf(match.Seed2!))));
    for (const entry of schedule) {
      if (entry.aIndex >= seeds.length || entry.bIndex >= seeds.length || existingPairs.has(groupSchedulePairKey(entry.aIndex, entry.bIndex))) continue;
      const matchNoTaken = matches.some((match) => match.Bracket === code && match.RoundNo === entry.round && match.MatchNo === entry.matchNo);
      const matchNo = matchNoTaken ? Math.max(0, ...matches.filter((match) => match.Bracket === code && match.RoundNo === entry.round).map((match) => match.MatchNo || 0)) + 1 : entry.matchNo;
      const template = entry.template || genericTemplate;
      if (!template) continue;
      matches.push({
        ...structuredClone(template),
        ID: nextId++,
        Bracket: code,
        RoundNo: entry.round,
        MatchNo: matchNo,
        Name: `Group ${code.slice(1)} Round ${entry.round}`,
        ShortName: `${code}${entry.round}.${matchNo}`,
        IDmatchFrom1: null,
        IDmatchFrom2: null,
        GroupStagePlacement1: null,
        GroupStagePlacement2: null,
        Seed1: seeds[entry.aIndex],
        Seed2: seeds[entry.bIndex],
        Score1: null,
        Score2: null,
        ScoreReset1: null,
        ScoreReset2: null,
        Winner: null,
        Room: null,
        ReplayAvailable: false,
        RewatchUrl: null,
      } as Match);
    }
  }

  // EUCannon only reads the contiguous group-stage block at the beginning of
  // Bracket. Keep generated matches there so they are included in its layout.
  const groupStageMatches = matches
    .filter((match) => groupCodes.includes(match.Bracket))
    .sort((a, b) =>
      groupCodes.indexOf(a.Bracket) - groupCodes.indexOf(b.Bracket) ||
      (a.RoundNo || 0) - (b.RoundNo || 0) ||
      (a.MatchNo || 0) - (b.MatchNo || 0) ||
      a.ID - b.ID
    );
  const laterStageMatches = matches.filter((match) => !groupCodes.includes(match.Bracket));
  matches.splice(0, matches.length, ...groupStageMatches, ...laterStageMatches);
}

function materialize(saved: Saved): Payload {
  const payload = structuredClone(saved.tournament.payload);
  const sourceById = new Map(saved.tournament.payload.Bracket.map((m) => [m.ID, m]));
  const seedByEntrantId = new Map(checkedInEntrantsInSeedOrder(saved).map((entrant, index) => [entrant.IDentrant, index + 1]));
  payload.Meta.IDtournament_phase = PHASES.find(({ value }) => value === saved.phase)?.id ?? 4;
  payload.Meta.Refresh = 0;
  payload.Entrants = saved.phase === 'upcoming' ? [] : payload.Entrants
    .filter((entrant) => isRegistered(saved, entrant.IDentrant))
    .map((entrant) => ({
      ...entrant,
      Seed: saved.phase === 'registration' || saved.phase === 'checkin' || !isCheckedIn(saved, entrant.IDentrant) ? null : (seedByEntrantId.get(entrant.IDentrant) ?? null),
      TR: saved.phase === 'registration'
        ? null
        : isCheckedIn(saved, entrant.IDentrant)
          ? (entrant.TR ?? 0)
          : null,
    }));
  if (saved.phase === 'registration') payload.Entrants.sort((a, b) => a.IDentrant - b.IDentrant);
  if (saved.phase === 'upcoming' || saved.phase === 'registration' || saved.phase === 'checkin') {
    payload.Bracket = [];
    payload.Placements = [];
    return payload;
  }
  payload.Entrants.sort((a, b) => (a.Seed ?? Number.MAX_SAFE_INTEGER) - (b.Seed ?? Number.MAX_SAFE_INTEGER));
  augmentGroupStageMatches(payload.Bracket, seedByEntrantId.size);
  const outputById = new Map(payload.Bracket.map((m) => [m.ID, m]));
  const groups = [...new Set(payload.Bracket.filter((m) => /^G[A-Z]/.test(m.Bracket)).map((m) => m.Bracket))].sort();
  const entrantsBySeed = new Map(payload.Entrants.filter((entrant) => entrant.Seed !== null).map((entrant) => [entrant.Seed, entrant]));

  for (const match of payload.Bracket) {
    const source = sourceById.get(match.ID) || match;
    const manual = saved.manualScores[match.ID];
    const revealed = saved.revealedSets[match.ID] || 0;
    match.Score1 = manual?.[0] ? manual[0].a : revealed >= 1 ? source.Score1 : null;
    match.Score2 = manual?.[0] ? manual[0].b : revealed >= 1 ? source.Score2 : null;
    match.ScoreReset1 = manual?.[1] ? manual[1].a : revealed >= 2 ? source.ScoreReset1 : null;
    match.ScoreReset2 = manual?.[1] ? manual[1].b : revealed >= 2 ? source.ScoreReset2 : null;
    const finalManual = manual?.[manual.length - 1];
    match.Winner = finalManual ? (finalManual.a > finalManual.b ? 1 : 2) : revealed >= setCount(source) && setCount(source) > 0 ? source.Winner : null;
    if (match.IDmatchFrom1 || match.GroupStagePlacement1) match.Seed1 = null;
    if (match.IDmatchFrom2 || match.GroupStagePlacement2) match.Seed2 = null;
  }

  for (let pass = 0; pass < payload.Bracket.length + 2; pass++) {
    let changed = false;
    for (const match of payload.Bracket) {
      for (const slot of [1, 2] as const) {
        const ref = match[`IDmatchFrom${slot}`];
        const placement = match[`GroupStagePlacement${slot}`];
        let seed: number | null = null;
        if (ref) {
          const prior = outputById.get(Math.abs(ref));
          if (prior?.Winner) {
            const winnerSeed = prior.Winner === 1 ? prior.Seed1 : prior.Seed2;
            const loserSeed = prior.Winner === 1 ? prior.Seed2 : prior.Seed1;
            seed = ref > 0 ? winnerSeed : loserSeed;
          }
        } else if (placement && groups.length) {
          const groupIndex = (placement - 1) % groups.length;
          const rank = placement > groups.length ? 1 : 0;
          const groupMatches = payload.Bracket.filter((m) => m.Bracket === groups[groupIndex]);
          if (groupMatches.length && groupMatches.every((m) => !!m.Winner)) seed = rankGroup(groups[groupIndex], payload.Bracket, [...entrantsBySeed.values()])[rank]?.Seed || null;
        }
        const currentSeed = slot === 1 ? match.Seed1 : match.Seed2;
        if (seed && currentSeed !== seed) { if (slot === 1) match.Seed1 = seed; else match.Seed2 = seed; changed = true; }
      }
    }
    if (!changed) break;
  }
  if (!saved.showRoomCodesEarly) {
    for (const match of payload.Bracket) if (!(match.Seed1 && match.Seed2)) match.Room = null;
  }
  payload.Placements = saved.phase === 'complete' ? calculatePlacements(payload.Bracket, payload.Entrants) : [];
  return payload;
}

function safeJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/<\/script/gi, '<\\/script');
}

function makeFrameHtml(saved: Saved) {
  const payload = materialize(saved);
  const importedMatches = new Map(saved.tournament.payload.Bracket.map((match) => [match.ID, match]));
  const actions = Object.fromEntries(payload.Bracket.map((match) => {
    const imported = importedMatches.get(match.ID);
    const total = imported ? setCount(imported) : 0, revealed = saved.revealedSets[match.ID] || 0;
    const manual = !!saved.manualScores[match.ID];
    return [match.ID, { disabled: manual || total === 0 || revealed >= total, label: manual ? 'MANUAL SCORE ACTIVE' : total === 0 ? (imported ? 'NO IMPORTED RESULT' : 'ENTER MANUAL SCORE IN LOCAL CONTROL') : revealed >= total ? 'RESULT REVEALED' : total > 1 ? `REVEAL SET ${revealed + 1} OF ${total}` : 'REVEAL IMPORTED RESULT' }];
  }));
  const injected = `<script>
    window.__LOCAL_PAYLOAD=${safeJson(payload)};
    window.__LOCAL_INFO=${safeJson(saved.tournament.info)};
    window.__LOCAL_ACTIONS=${safeJson(actions)};
    window.__LOCAL_ASSETS=${safeJson(saved.tournament.assets || {})};
    window.__LOCAL_SHOW_ROOM_CODES_EARLY=${saved.showRoomCodesEarly ? 'true' : 'false'};
    window.__localCountryFlag=function(code){var c=String(code||'').toUpperCase();var f=Array.from(c).map(function(x){return String.fromCodePoint(127397+x.charCodeAt(0))}).join('');return 'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><text x="32" y="48" text-anchor="middle" font-size="48">'+f+'</text></svg>')};
    window.__localRankIcon=function(rank){return 'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="8" fill="#333"/><text x="32" y="43" text-anchor="middle" font-family="Arial" font-size="30" font-weight="bold" fill="white">'+String(rank||'?').toUpperCase()+'</text></svg>')};
    (function(){window.fetch=async function(input){var u=typeof input==='string'?input:(input&&input.url)||'';if(/\\/json\\/bracket\\/detail-support\\//.test(u))return new Response(JSON.stringify({IDtournament:${saved.tournament.id},HistoricalMatches:[],PlayerDirectory:[],RecentPlacementsByPlayer:{},SeasonRankingsByPlayer:{},SeasonPoints:null}),{status:200,headers:{'Content-Type':'application/json'}});if(/\\/json\\/bracket\\//.test(u))return new Response(JSON.stringify(window.__LOCAL_PAYLOAD),{status:200,headers:{'Content-Type':'application/json','X-Server-Now-Utc-Ms':String(Date.now())}});if(/\\/json\\/info\\//.test(u))return new Response(JSON.stringify(window.__LOCAL_INFO),{status:200,headers:{'Content-Type':'application/json'}});return new Response('{}',{status:404,headers:{'Content-Type':'application/json'}})};
      var active=null;
      function addButton(){var host=document.getElementById('detail-pane-scroll');if(!host||!active)return;var action=window.__LOCAL_ACTIONS[active];if(!action)return;var old=document.getElementById('local-reveal-button');if(old&&old.parentNode===host){old.textContent=action.label;old.disabled=action.disabled;return}if(old)old.remove();var b=document.createElement('button');b.id='local-reveal-button';b.textContent=action.label;b.disabled=action.disabled;b.style.cssText='position:sticky;bottom:0;width:100%;min-height:48px;margin-top:18px;border:1px solid #f06b7d;background:#9f2135;color:white;font:900 13px InterVariable,Inter,Arial,sans-serif;letter-spacing:.06em;cursor:pointer;z-index:99';b.onclick=function(e){e.stopPropagation();parent.postMessage({type:'bracket-local-reveal',matchId:Number(active)},'*')};host.appendChild(b)}
      document.addEventListener('click',function(e){var z=e.target&&e.target.closest&&e.target.closest('.interactive-zone[data-kind="match"]');if(z){active=z.dataset.matchId;parent.postMessage({type:'bracket-local-select',matchId:Number(active)},'*');setTimeout(addButton,30);setTimeout(addButton,200)}},true);
      document.addEventListener('DOMContentLoaded',function(){var scheduled=false;new MutationObserver(function(){if(scheduled)return;scheduled=true;requestAnimationFrame(function(){scheduled=false;addButton()})}).observe(document.body,{childList:true,subtree:true});setTimeout(function(){window.dispatchEvent(new Event('resize'));var b=document.getElementById('bracket-reset-view');if(b)b.click()},900);setTimeout(function(){window.dispatchEvent(new Event('resize'));var b=document.getElementById('bracket-reset-view');if(b)b.click()},2200)});
    })();
  </${'script'}>`;
  const sourceHtml = saved.tournament.sourceHtml
    .replaceAll(LEGACY_CHECKMARK_DATA_URI, CHECKMARK_DATA_URI)
    .replaceAll('/res/checkmark.svg', CHECKMARK_DATA_URI);
  return sourceHtml.replace(/<head([^>]*)>/i, `<head$1>${injected}`);
}

export default function Home() {
  const [saved, setSaved] = useState<Saved | null>(null);
  const [input, setInput] = useState('latest');
  const [menu, setMenu] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshingResources, setRefreshingResources] = useState(false);
  const [addingPlayer, setAddingPlayer] = useState(false);
  const [message, setMessage] = useState('');
  const initialized = useRef(false);
  const savedRef = useRef<Saved | null>(null);

  const persist = useCallback((next: Saved) => {
    savedRef.current = next;
    setSaved(next);
    const lightweight = { ...next, tournament: { ...next.tournament, sourceHtml: '', assets: undefined } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lightweight));
    void sourceStore('put', `source-${next.tournament.id}`, JSON.stringify({ html: next.tournament.sourceHtml, assets: next.tournament.assets || {} }));
  }, []);
  const load = useCallback(async (raw: string) => {
    const requestedId = parseId(raw); if (requestedId === null) { setMessage('Enter "latest", a bracket ID, or an EUCannon bracket URL.'); return; }
    setLoading(true); setMessage('');
    try { const response = await fetch(apiUrl(`/api/import?id=${requestedId}`), { cache: 'no-store' }); if (!response.ok) throw new Error(await response.text()); const imported = await response.json() as Tournament; const id = imported.id; const tournament = { ...imported, resourcesUpdatedAt: imported.loadedAt }; const previous = savedRef.current; const next: Saved = previous?.tournament.id === id ? { ...previous, tournament, phase: normalizePhase(previous.phase), registrations: previous.registrations || {}, checkins: previous.checkinsInitializedFromSource ? previous.checkins : importedCheckins(tournament), checkinsInitializedFromSource: true, seedOrder: normalizeSeedOrder(tournament, previous.seedOrder), manualScores: previous.manualScores || {}, showRoomCodesEarly: previous.showRoomCodesEarly ?? false } : { tournament, phase: 'active', registrations: Object.fromEntries(tournament.payload.Entrants.map((e) => [e.IDentrant, true])), checkins: importedCheckins(tournament), checkinsInitializedFromSource: true, seedOrder: importedSeedOrder(tournament), revealedSets: {}, manualScores: {}, showRoomCodesEarly: previous?.showRoomCodesEarly ?? false }; persist(next); setInput(`https://eucannon.org/bracket/${id}`); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not load this bracket.'); } finally { setLoading(false); }
  }, [persist]);
  const update = useCallback((fn: (s: Saved) => Saved) => { const current = savedRef.current; if (current) persist(fn(current)); }, [persist]);
  const reveal = useCallback((id: number) => { update((s) => { const match = s.tournament.payload.Bracket.find((m) => m.ID === id); if (!match) return s; return { ...s, phase: s.phase === 'complete' ? 'complete' : 'active', revealedSets: { ...s.revealedSets, [id]: Math.min(setCount(match), (s.revealedSets[id] || 0) + 1) } }; }); }, [update]);
  const completeAllMatches = useCallback(() => {
    setMessage('');
    update((s) => ({
      ...s,
      phase: 'complete',
      revealedSets: Object.fromEntries(s.tournament.payload.Bracket.map((match) => [match.ID, setCount(match)])),
    }));
    setSelected(null);
    setMenu(false);
  }, [update]);
  const toggleCheckin = useCallback((entrantId: number) => {
    setMessage('Attendance updated. Previous revealed and manual results were cleared.');
    setSelected(null);
    update((s) => ({
      ...s,
      phase: s.phase === 'complete' ? 'active' : s.phase,
      checkins: { ...s.checkins, [entrantId]: !isCheckedIn(s, entrantId) },
      checkinsInitializedFromSource: true,
      revealedSets: {},
      manualScores: {},
    }));
  }, [update]);
  const restoreImportedCheckins = useCallback(() => {
    setMessage('Imported check-ins restored. Previous revealed and manual results were cleared.');
    setSelected(null);
    update((s) => ({
      ...s,
      phase: s.phase === 'complete' ? 'active' : s.phase,
      checkins: importedCheckins(s.tournament),
      checkinsInitializedFromSource: true,
      revealedSets: {},
      manualScores: {},
    }));
  }, [update]);
  const toggleRegistration = useCallback((entrantId: number) => {
    const current = savedRef.current;
    if (!current) return;
    const registering = !isRegistered(current, entrantId);
    const entrant = current.tournament.payload.Entrants.find((item) => item.IDentrant === entrantId);
    setMessage(`${entrant?.TetrioName || 'Player'} ${registering ? 'registered' : 'unregistered'}. Previous revealed and manual results were cleared.`);
    setSelected(null);
    persist({
      ...current,
      registrations: { ...current.registrations, [entrantId]: registering },
      checkins: { ...current.checkins, [entrantId]: registering ? importedCheckins(current.tournament)[entrantId] : false },
      revealedSets: {},
      manualScores: {},
    });
  }, [persist]);
  const addRegistration = useCallback(async (identifier: string) => {
    const current = savedRef.current;
    const value = identifier.trim();
    if (!current || !value) return false;
    const tournamentId = current.tournament.id;
    setAddingPlayer(true);
    setMessage('');
    try {
      const response = await fetch(apiUrl(`/api/player?user=${encodeURIComponent(value)}`), { cache: 'no-store' });
      if (!response.ok) throw new Error(await response.text());
      const lookup = await response.json() as PlayerLookup;
      const latest = savedRef.current;
      if (!latest || latest.tournament.id !== tournamentId) throw new Error('The loaded tournament changed before the player could be added.');
      const existing = latest.tournament.payload.Entrants.find((entrant) =>
        entrant.TetrioID?.toLowerCase() === lookup.entrant.TetrioID?.toLowerCase() ||
        entrant.TetrioName.toLowerCase() === lookup.entrant.TetrioName.toLowerCase()
      );
      if (existing) {
        if (isRegistered(latest, existing.IDentrant)) {
          setMessage(`${existing.TetrioName} is already registered.`);
        } else {
          persist({
            ...latest,
            registrations: { ...latest.registrations, [existing.IDentrant]: true },
            checkins: { ...latest.checkins, [existing.IDentrant]: false },
            revealedSets: {},
            manualScores: {},
          });
          setMessage(`${existing.TetrioName} restored to registrations and left unchecked.`);
        }
        return true;
      }

      const entrantId = Math.max(0, ...latest.tournament.payload.Entrants.map((entrant) => entrant.IDentrant)) + 1;
      const entrant: Entrant = { ...lookup.entrant, IDentrant: entrantId, Seed: null, LocallyAdded: true };
      const assets = {
        avatars: { ...latest.tournament.assets?.avatars, ...lookup.assets?.avatars },
        flags: { ...latest.tournament.assets?.flags, ...lookup.assets?.flags },
        ranks: { ...latest.tournament.assets?.ranks, ...lookup.assets?.ranks },
      };
      persist({
        ...latest,
        tournament: {
          ...latest.tournament,
          payload: { ...latest.tournament.payload, Entrants: [...latest.tournament.payload.Entrants, entrant] },
          assets,
        },
        registrations: { ...latest.registrations, [entrantId]: true },
        checkins: { ...latest.checkins, [entrantId]: false },
        checkinsInitializedFromSource: true,
        seedOrder: [...normalizeSeedOrder(latest.tournament, latest.seedOrder), entrantId],
        revealedSets: {},
        manualScores: {},
      });
      setSelected(null);
      setMessage(`${entrant.TetrioName} added as registered and not checked in. Previous revealed and manual results were cleared.`);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not add this TETR.IO user.');
      return false;
    } finally {
      setAddingPlayer(false);
    }
  }, [persist]);
  const applySeedOrder = useCallback((nextCheckedOrder: number[]) => {
    setMessage('Seed order updated. Previous revealed and manual results were cleared.');
    setSelected(null);
    update((s) => ({
      ...s,
      phase: s.phase === 'complete' ? 'active' : s.phase,
      seedOrder: mergeCheckedSeedOrder(s, nextCheckedOrder),
      revealedSets: {},
      manualScores: {},
    }));
  }, [update]);
  const resetSeedOrder = useCallback(() => {
    setMessage('Imported seed order restored. Previous revealed and manual results were cleared.');
    setSelected(null);
    update((s) => ({
      ...s,
      phase: s.phase === 'complete' ? 'active' : s.phase,
      seedOrder: importedSeedOrder(s.tournament),
      revealedSets: {},
      manualScores: {},
    }));
  }, [update]);
  const refreshResources = useCallback(async () => {
    const current = savedRef.current;
    if (!current) return;
    setRefreshingResources(true);
    setMessage('');
    try {
      const response = await fetch(apiUrl(`/api/import?id=${current.tournament.id}&resources=${Date.now()}`), { cache: 'no-store' });
      if (!response.ok) throw new Error(await response.text());
      const refreshed = await response.json() as Tournament;
      const latest = savedRef.current;
      if (!latest || latest.tournament.id !== current.tournament.id) return;
      const assets = {
        avatars: { ...latest.tournament.assets?.avatars, ...refreshed.assets?.avatars },
        flags: { ...latest.tournament.assets?.flags, ...refreshed.assets?.flags },
        ranks: { ...latest.tournament.assets?.ranks, ...refreshed.assets?.ranks },
      };
      persist({ ...latest, tournament: { ...latest.tournament, title: refreshed.title, subtitle: refreshed.subtitle, info: refreshed.info, sourceHtml: refreshed.sourceHtml, assets, resourcesUpdatedAt: new Date().toISOString() } });
      setMessage('Visual resources refreshed without changing local match results.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not refresh visual resources.');
    } finally {
      setRefreshingResources(false);
    }
  }, [persist]);
  useEffect(() => { savedRef.current = saved; }, [saved]);
  useEffect(() => { if (initialized.current) return; initialized.current = true; void (async () => { const raw = localStorage.getItem(STORAGE_KEY); if (raw) { try { const value = JSON.parse(raw) as Saved; const source = await sourceStore('get', `source-${value.tournament.id}`); if (source) { const cached = JSON.parse(source) as { html: string; assets: Tournament['assets'] }; value.tournament.sourceHtml = cached.html; value.tournament.assets = cached.assets; value.tournament.resourcesUpdatedAt ??= value.tournament.loadedAt; value.showRoomCodesEarly ??= false; value.phase = normalizePhase(value.phase); value.registrations ||= {}; if (!value.checkinsInitializedFromSource) { value.checkins = importedCheckins(value.tournament); value.checkinsInitializedFromSource = true; } else value.checkins ||= {}; value.seedOrder = normalizeSeedOrder(value.tournament, value.seedOrder); value.revealedSets ||= {}; value.manualScores ||= {}; setSaved(value); savedRef.current = value; setInput(`https://eucannon.org/bracket/${value.tournament.id}`); return; } } catch {} } await load('latest'); })(); }, [load]);
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); }; const onMessage = (e: MessageEvent) => { if (e.data?.type === 'bracket-local-select') setSelected(Number(e.data.matchId)); if (e.data?.type === 'bracket-local-reveal') reveal(Number(e.data.matchId)); }; window.addEventListener('keydown', onKey); window.addEventListener('message', onMessage); return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('message', onMessage); }; }, [reveal]);
  useEffect(() => {
    const modelContext = (document as Document & { modelContext?: { registerTool: (tool: unknown, options?: { signal?: AbortSignal }) => unknown } }).modelContext;
    if (!modelContext?.registerTool) return;
    const lifecycle = new AbortController();
    const registration = modelContext.registerTool({
      name: 'set_tournament_phase',
      description: 'Set the visible phase of the currently loaded local tournament bracket.',
      inputSchema: { type: 'object', properties: { phase: { type: 'string', enum: PHASE_VALUES } }, required: ['phase'] },
      execute: ({ phase }: { phase: Phase }) => {
        const current = savedRef.current;
        if (!current || !PHASE_VALUES.includes(phase)) throw new Error('A valid phase and loaded bracket are required.');
        persist({ ...current, phase });
        return { phase, bracketId: current.tournament.id };
      },
    }, { signal: lifecycle.signal });
    void Promise.resolve(registration).catch(() => undefined);
    return () => lifecycle.abort();
  }, [persist]);
  function saveManual(match: Match, scores: ManualSet[]) { if (!scores.length || scores.some((score) => score.a < 0 || score.b < 0 || score.a === score.b)) { setMessage('Each set needs non-negative, non-tied scores.'); return; } setMessage(''); update((s) => ({ ...s, phase: s.phase === 'complete' ? 'complete' : 'active', manualScores: { ...s.manualScores, [match.ID]: scores } })); }
  const selectedMatch = useMemo(() => saved ? materialize(saved).Bracket.find((match) => match.ID === selected) : undefined, [saved, selected]);
  const frame = useMemo(() => saved ? makeFrameHtml(saved) : '', [saved]);
  if (!saved) return <div className="loading-screen"><Loader2 className="animate-spin" /><b>Loading the original bracket locally</b><span>{message || 'Bundling the page and bracket data once…'}</span></div>;
  return <main className="source-shell">
    <iframe key={`${saved.phase}-${saved.showRoomCodesEarly}-${saved.tournament.resourcesUpdatedAt || saved.tournament.loadedAt}-${JSON.stringify(saved.revealedSets)}-${JSON.stringify(saved.manualScores)}-${JSON.stringify(saved.registrations)}-${JSON.stringify(saved.checkins)}-${JSON.stringify(saved.seedOrder)}`} className="source-frame" srcDoc={frame} title={`${saved.tournament.title} local bracket`} />
    <button type="button" className="source-shortcut" onClick={() => setMenu(true)} aria-label="Open local control" aria-expanded={menu}><Settings2 /> <span>CONTROL</span></button>
    <aside className={`source-menu ${menu ? 'open' : ''}`}><div className="source-menu-head"><b>LOCAL CONTROL</b><button onClick={() => setMenu(false)} aria-label="Close"><X /></button></div><div className="source-menu-body">
      <p className="panel-kicker">Original page snapshot</p><h1>{saved.tournament.title}</h1><p className="muted">The page source and bracket data were saved locally {new Date(saved.tournament.loadedAt).toLocaleString()}. It never auto-refreshes.</p>
      <div className="load-row"><Input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void load(input)} aria-label="Bracket ID or URL" /><Button onClick={() => void load(input)} disabled={loading}>{loading ? <Loader2 className="animate-spin" /> : <CloudDownload />}</Button></div>{message && <p className="panel-message">{message}</p>}
      <section className="source-section"><p className="panel-kicker">EU Cannon tournament phase</p><div className="phase-grid">{PHASES.map(({ value, id, label, detail }) => <button key={value} className={saved.phase === value ? 'active' : ''} onClick={() => { setSelected(null); update((s) => ({ ...s, phase: value })); }}><b>{id}. {label}</b><span>{detail}</span></button>)}</div></section>
      <section className="source-section room-code-setting"><div><p className="panel-kicker">Room-code visibility</p><b>Show future room codes</b><span>{saved.showRoomCodesEarly ? 'All imported codes are visible.' : 'Codes appear when both players are known.'}</span></div><Switch checked={saved.showRoomCodesEarly} onCheckedChange={(checked) => update((s) => ({ ...s, showRoomCodesEarly: checked }))} aria-label="Show future room codes" /></section>
      {saved.phase === 'registration' && <RegistrationEditor saved={saved} toggle={toggleRegistration} add={addRegistration} adding={addingPlayer} />}
      <CheckinEditor saved={saved} toggle={toggleCheckin} restore={restoreImportedCheckins} />
      {(saved.phase === 'checkin' || saved.phase === 'active' || saved.phase === 'complete') && <SeedEditor key={`${saved.tournament.id}-${saved.seedOrder.join(',')}-${JSON.stringify(saved.registrations)}-${JSON.stringify(saved.checkins)}`} saved={saved} apply={applySeedOrder} reset={resetSeedOrder} />}
      {selectedMatch && <section className="source-section selected-local"><p className="panel-kicker">Selected match</p><h2>{selectedMatch.ShortName} · {selectedMatch.Name}</h2><p>{saved.manualScores[selectedMatch.ID] ? 'Manual score active; downstream slots use its winner.' : setCount(selectedMatch) > 1 ? `${saved.revealedSets[selectedMatch.ID] || 0} of ${setCount(selectedMatch)} sets revealed` : (saved.revealedSets[selectedMatch.ID] ? 'Result revealed' : 'Result hidden')}</p><Button onClick={() => reveal(selectedMatch.ID)} disabled={!!saved.manualScores[selectedMatch.ID] || (saved.revealedSets[selectedMatch.ID] || 0) >= setCount(selectedMatch)}>{setCount(selectedMatch) > 1 ? `Reveal set ${(saved.revealedSets[selectedMatch.ID] || 0) + 1}` : 'Reveal imported result'}</Button><ManualScoreForm match={selectedMatch} values={saved.manualScores[selectedMatch.ID]} save={(scores) => saveManual(selectedMatch, scores)} clear={() => update((s) => { const manualScores = { ...s.manualScores }; delete manualScores[selectedMatch.ID]; return { ...s, manualScores }; })} /></section>}
      <section className="source-section bulk-actions"><Button className="w-full" onClick={completeAllMatches}><CheckCheck /> Complete all matches</Button><Button variant="outline" className="w-full" onClick={() => void refreshResources()} disabled={loading || refreshingResources}>{refreshingResources ? <Loader2 className="animate-spin" /> : <RefreshCw />} Refresh visual resources</Button><Button variant="outline" className="w-full" onClick={() => update((s) => ({ ...s, phase: 'active', revealedSets: {}, manualScores: {} }))}><RotateCcw /> Reset all revealed results</Button></section><div className="keyboard-note"><Settings2 /><span>Use the corner control button to reopen this menu. Click a match in the original page; the reveal button is added to its normal details pane.</span></div>
    </div></aside>
  </main>;
}

function CheckinEditor({ saved, toggle, restore }: { saved: Saved; toggle: (entrantId: number) => void; restore: () => void }) {
  const entrantsById = new Map(saved.tournament.payload.Entrants.map((entrant) => [entrant.IDentrant, entrant]));
  const entrants = normalizeSeedOrder(saved.tournament, saved.seedOrder)
    .map((id) => entrantsById.get(id))
    .filter((entrant): entrant is Entrant => !!entrant && isRegistered(saved, entrant.IDentrant));
  const sourceCheckins = importedCheckins(saved.tournament);
  const checkedCount = entrants.filter((entrant) => isCheckedIn(saved, entrant.IDentrant)).length;
  const changed = entrants.some((entrant) => isCheckedIn(saved, entrant.IDentrant) !== sourceCheckins[entrant.IDentrant]);
  return <section className="source-section checkin-editor">
    <div className="checkin-editor-head"><div><p className="panel-kicker">Check-ins</p><b>{checkedCount}/{entrants.length} checked in</b></div><span>Available in every phase</span></div>
    <p className="checkin-help">Attendance starts from the imported source. Click any player to change it locally.</p>
    <div className="checkin-list">{entrants.map((entrant) => { const checked = isCheckedIn(saved, entrant.IDentrant); return <button type="button" key={entrant.IDentrant} onClick={() => toggle(entrant.IDentrant)}><span>{flag(entrant.CountryCode)} {entrant.TetrioName}</span><span className={checked ? 'yes' : ''}>{checked ? 'CHECKED IN' : 'ABSENT'}</span></button>; })}</div>
    <Button type="button" variant="outline" className="checkin-restore" onClick={restore} disabled={!changed}><RotateCcw /> Restore imported check-ins</Button>
  </section>;
}

function RegistrationEditor({ saved, toggle, add, adding }: { saved: Saved; toggle: (entrantId: number) => void; add: (identifier: string) => Promise<boolean>; adding: boolean }) {
  const entrants = entrantsInRegistrationOrder(saved.tournament);
  const registeredCount = entrants.filter((entrant) => isRegistered(saved, entrant.IDentrant)).length;
  const [identifier, setIdentifier] = useState('');
  return <section className="source-section registration-editor">
    <div className="registration-editor-head"><div><p className="panel-kicker">Registration</p><b>{registeredCount}/{entrants.length} registered players</b></div><span>Earliest first</span></div>
    <p className="registration-help">Add a TETR.IO account by username or MongoDB user ID. New players start registered but not checked in.</p>
    <form className="registration-add" onSubmit={(event) => { event.preventDefault(); void add(identifier).then((added) => { if (added) setIdentifier(''); }); }}>
      <Input value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="Username or 24-character user ID" aria-label="TETR.IO username or user ID" disabled={adding} />
      <Button type="submit" disabled={adding || !identifier.trim()}>{adding ? <Loader2 className="animate-spin" /> : <UserPlus />} Add</Button>
    </form>
    <p className="registration-help">Click a player to unregister them completely. Click an unregistered player again to restore them.</p>
    <div className="registration-list">{entrants.map((entrant, index) => { const registered = isRegistered(saved, entrant.IDentrant); return <button type="button" key={entrant.IDentrant} className={registered ? '' : 'unregistered'} onClick={() => toggle(entrant.IDentrant)} title={registered ? `Unregister ${entrant.TetrioName}` : `Restore ${entrant.TetrioName}`}><strong>{index + 1}</strong><span>{flag(entrant.CountryCode)} {entrant.TetrioName}</span><b>{registered ? 'REGISTERED' : 'UNREGISTERED'}</b></button>; })}</div>
  </section>;
}

function SeedEditor({ saved, apply, reset }: { saved: Saved; apply: (order: number[]) => void; reset: () => void }) {
  const entrants = checkedInEntrantsInSeedOrder(saved);
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(entrants.map((entrant, index) => [entrant.IDentrant, String(index + 1)])));
  const [error, setError] = useState('');
  const registeredCount = saved.tournament.payload.Entrants.filter((entrant) => isRegistered(saved, entrant.IDentrant)).length;
  const absentCount = registeredCount - entrants.length;
  const unregisteredCount = saved.tournament.payload.Entrants.length - registeredCount;
  const exclusionSummary = [absentCount ? `${absentCount} absent` : '', unregisteredCount ? `${unregisteredCount} unregistered` : ''].filter(Boolean).join(' · ') || 'All checked in';

  function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const requested = entrants.map((entrant) => ({ id: entrant.IDentrant, seed: Number(draft[entrant.IDentrant]) }));
    const seeds = requested.map(({ seed }) => seed);
    const valid = seeds.every((seed) => Number.isInteger(seed) && seed >= 1 && seed <= entrants.length)
      && new Set(seeds).size === entrants.length;
    if (!valid) {
      setError(`Use every seed from 1 to ${entrants.length} exactly once.`);
      return;
    }
    setError('');
    apply(requested.sort((a, b) => a.seed - b.seed).map(({ id }) => id));
  }

  return <section className="source-section seed-editor">
    <div className="seed-editor-head"><div><p className="panel-kicker">Seeding</p><b>{entrants.length} checked-in player{entrants.length === 1 ? '' : 's'}</b></div><span>{exclusionSummary}</span></div>
    {entrants.length ? <form onSubmit={submit}>
      <p className="seed-help">Assign every seed from 1 to {entrants.length} once, then apply the order.</p>
      <div className="seed-list">{entrants.map((entrant, index) => <label key={entrant.IDentrant}><span>{flag(entrant.CountryCode)} {entrant.TetrioName}</span><Input type="number" min={1} max={entrants.length} step={1} value={draft[entrant.IDentrant] ?? String(index + 1)} onChange={(event) => { setError(''); setDraft((current) => ({ ...current, [entrant.IDentrant]: event.target.value })); }} aria-label={`Seed for ${entrant.TetrioName}`} /></label>)}</div>
      {error && <p className="seed-error" role="alert">{error}</p>}
      <div className="seed-actions"><Button type="submit">Apply seed order</Button><Button type="button" variant="outline" onClick={reset}>Use imported order</Button></div>
    </form> : <p className="seed-empty">No players are checked in. Check in at least one player before seeding.</p>}
  </section>;
}

function ManualScoreForm({ match, values, save, clear }: { match: Match; values?: ManualSet[]; save: (sets: ManualSet[]) => void; clear: () => void }) {
  const count = Math.max(1, setCount(match));
  return <form className="manual-score" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); save(Array.from({ length: count }, (_, i) => ({ a: Math.max(0, Number(data.get(`a${i}`)) || 0), b: Math.max(0, Number(data.get(`b${i}`)) || 0) }))); }}><p className="panel-kicker">Manual score override</p>{Array.from({ length: count }, (_, i) => <div className="score-pair" key={i}><span>SET {i + 1}</span><Input name={`a${i}`} type="number" min="0" defaultValue={values?.[i]?.a ?? (i === 0 ? match.Score1 ?? 0 : match.ScoreReset1 ?? 0)} aria-label={`Set ${i + 1} player one score`} /><b>–</b><Input name={`b${i}`} type="number" min="0" defaultValue={values?.[i]?.b ?? (i === 0 ? match.Score2 ?? 0 : match.ScoreReset2 ?? 0)} aria-label={`Set ${i + 1} player two score`} /></div>)}<div className="manual-actions"><Button type="submit">Apply &amp; advance</Button>{values && <Button type="button" variant="outline" onClick={clear}>Use imported</Button>}</div></form>;
}
