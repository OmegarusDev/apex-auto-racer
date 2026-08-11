import type { TournamentStandingsEntry } from '../engine/types';

export function buildTournamentStandings(
  teamCount: number,
  rivalNames?: readonly string[],
): TournamentStandingsEntry[] {
  const standings: TournamentStandingsEntry[] = [{ teamId: 0, points: 0, name: 'You' }];
  for (let t = 1; t < teamCount; t++) {
    const named = rivalNames?.[t - 1];
    standings.push({
      teamId: t,
      points: 0,
      name: named && named.length > 0 ? named : `Rival ${t}`,
    });
  }
  return standings;
}

