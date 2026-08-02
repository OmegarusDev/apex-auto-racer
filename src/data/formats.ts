export interface RaceFormat {
  id: string;
  label: string;
  teamSize: number;
  teamCount: number;
  weight: number;
  minRoster: number;
}

export const FORMATS: RaceFormat[] = [
  { id: '1v1', label: '1v1', teamSize: 1, teamCount: 2, weight: 3, minRoster: 1 },
  { id: '2v2', label: '2v2', teamSize: 2, teamCount: 2, weight: 3, minRoster: 2 },
  { id: '1v1v1v1', label: '1v1v1v1', teamSize: 1, teamCount: 4, weight: 3, minRoster: 1 },
  { id: '2v2v2', label: '2v2v2', teamSize: 2, teamCount: 3, weight: 2, minRoster: 2 },
  { id: '8solo', label: '8 Solo', teamSize: 1, teamCount: 8, weight: 2, minRoster: 1 },
  { id: '3v3', label: '3v3', teamSize: 3, teamCount: 2, weight: 2, minRoster: 3 },
  { id: '3v3v3v3', label: '3v3v3v3', teamSize: 3, teamCount: 4, weight: 1, minRoster: 3 },
  { id: '4v4', label: '4v4', teamSize: 4, teamCount: 2, weight: 1, minRoster: 4 },
  { id: '5v5', label: '5v5', teamSize: 5, teamCount: 2, weight: 1, minRoster: 5 },
  { id: '2x5', label: '2v2v2v2v2', teamSize: 2, teamCount: 5, weight: 1, minRoster: 2 },
  { id: '6v6', label: '6v6', teamSize: 6, teamCount: 2, weight: 1, minRoster: 6 },
];

export function formatsForRoster(rosterSize: number): RaceFormat[] {
  return FORMATS.filter((f) => f.minRoster <= rosterSize && f.teamSize <= 6);
}
