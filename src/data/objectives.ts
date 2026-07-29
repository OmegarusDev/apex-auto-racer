export type ObjectiveKind =
  | 'win_no_brake'
  | 'zero_wall_hits'
  | 'podium_low_level'
  | 'win_hands_off'
  | 'finish_no_spin'
  | 'podium_any'
  | 'win_rain'
  | 'overtake_3'
  | 'win_underdog'
  | 'no_input_half'
  | 'repair_then_podium'
  | 'team_win';

export interface ObjectiveDef {
  id: ObjectiveKind;
  title: string;
  description: string;
  reward: number;
}

export const OBJECTIVES: ObjectiveDef[] = [
  {
    id: 'win_no_brake',
    title: 'Trust the Limiter',
    description: 'Win a race without touching the brake',
    reward: 400,
  },
  {
    id: 'zero_wall_hits',
    title: 'Clean Racing',
    description: 'Finish a race with zero wall hits',
    reward: 250,
  },
  {
    id: 'podium_low_level',
    title: 'Rookie Rising',
    description: 'Podium with a driver under level 3',
    reward: 350,
  },
  {
    id: 'win_hands_off',
    title: 'Idle Ace',
    description: 'Win with under 20% pedal input time',
    reward: 500,
  },
  {
    id: 'finish_no_spin',
    title: 'Keep It Pointy',
    description: 'Finish top 3 without spinning',
    reward: 300,
  },
  {
    id: 'podium_any',
    title: 'On the Box',
    description: 'Podium in any race',
    reward: 200,
  },
  {
    id: 'win_rain',
    title: 'Wet Wizard',
    description: 'Win a race in the rain',
    reward: 450,
  },
  {
    id: 'overtake_3',
    title: 'Pass Master',
    description: 'Record 3 overtakes in one race',
    reward: 300,
  },
  {
    id: 'win_underdog',
    title: 'Upset',
    description: 'Win starting outside the front row',
    reward: 350,
  },
  {
    id: 'no_input_half',
    title: 'Half Idle',
    description: 'Finish a race with under 50% input time',
    reward: 200,
  },
  {
    id: 'repair_then_podium',
    title: 'Fixed & Fierce',
    description: 'Podium after repairing mid-session damage',
    reward: 280,
  },
  {
    id: 'team_win',
    title: 'Team Effort',
    description: 'Win a race as a team (2+ cars)',
    reward: 320,
  },
];
