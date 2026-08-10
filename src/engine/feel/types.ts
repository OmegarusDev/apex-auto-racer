/** Named Scalextric feel-contract gate ids — see DEVIATIONS.md freeze section. */
export type FeelGateId =
  | 'GRID_NO_STALL'
  | 'GRID_COLUMN_SIGNS'
  | 'PIN_DESLOT'
  | 'PIN_AUTHORITY'
  | 'PIN_RARE_P1'
  | 'PIN_RUNOFF_WALL'
  | 'WALL_ALIGN'
  | 'DESLOT_PRIMARY'
  | 'OVAL_SANE'
  | 'FINISH_RATE'
  | 'PACK_CONTACT'
  | 'FIELD_SPAN'
  | 'DETERMINISM'
  | 'TYRE_START_WARM'
  | 'TYRE_RECOVERY_FLOOR'
  | 'TYRE_WARM_PATH'
  | 'TYRE_COLD_GRIP'
  | 'REJOIN_NO_PARK'
  | 'CRASH_STUN_SOFT'
  | 'DRAFT_TOW'
  | 'GEAR_ASSIST'
  | 'GEAR_NO_MISS'
  | 'STORY_INTENT_DENSITY'
  | 'STREET_WALL_BITE'
  | 'RALLY_DESLOT_LONG'
  | 'META_TOURNAMENT_TEAMS'
  | 'SUITE_START'
  | 'SUITE_SLOT'
  | 'SUITE_PACK'
  | 'SUITE_FIELD'
  | 'SUITE_SMOKE'
  | 'SUITE_STACK';

export interface FeelGateResult {
  id: FeelGateId;
  ok: boolean;
  detail: string;
}
