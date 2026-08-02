import type { DisciplineId } from './disciplines';
import type { RankId } from './balance';

export interface TournamentRaceDef {
  trackSeed: number;
  laps: number;
  formatId: string;
  archetypeHint?: string;
}

export interface TournamentDef {
  id: string;
  discipline: DisciplineId;
  rank: RankId;
  name: string;
  teamSize: number;
  races: TournamentRaceDef[];
}

function makeSeries(
  discipline: DisciplineId,
  rank: RankId,
  teamSize: number,
  raceCount: number,
  formatId: string,
): TournamentDef {
  const rankNames = ['Novice', 'Amateur', 'Semi-Pro', 'Pro', 'Elite', 'Legend'];
  const races: TournamentRaceDef[] = [];
  for (let i = 0; i < raceCount; i++) {
    races.push({
      trackSeed: (rank + 1) * 100000 + (discipline === 'track' ? 1 : discipline === 'street' ? 2 : 3) * 10000 + i * 777 + 42,
      laps: Math.min(9, 2 + rank + (i % 2)),
      formatId,
    });
  }
  return {
    id: `${discipline}-r${rank}`,
    discipline,
    rank,
    name: `${rankNames[rank]} Cup`,
    teamSize,
    races,
  };
}

const DISCIPLINES: DisciplineId[] = ['track', 'street', 'rally'];
const TEAM_SIZES = [1, 2, 3, 4, 5, 6];
const RACE_COUNTS = [3, 3, 4, 4, 5, 5];
const FORMAT_BY_SIZE = ['1v1', '2v2', '3v3', '4v4', '5v5', '6v6'];

export const TOURNAMENTS: TournamentDef[] = [];
for (const d of DISCIPLINES) {
  for (let r = 0; r < 6; r++) {
    const ts = TEAM_SIZES[r]!;
    TOURNAMENTS.push(
      makeSeries(d, r as RankId, ts, RACE_COUNTS[r]!, FORMAT_BY_SIZE[r]!),
    );
  }
}

export function getTournament(discipline: DisciplineId, rank: RankId): TournamentDef {
  const t = TOURNAMENTS.find((x) => x.discipline === discipline && x.rank === rank);
  if (!t) throw new Error(`No tournament ${discipline} rank ${rank}`);
  return t;
}
