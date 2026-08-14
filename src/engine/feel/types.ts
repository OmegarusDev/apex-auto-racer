/** Named feel-contract gate ids — see DEVIATIONS.md freeze section. */
export type FeelGateId =
  | 'TYRE_PEAK_FALLOFF'
  | 'DRIFT_IS_USABLE_STREET'
  | 'UNDERSTEER_EMERGES'
  | 'OVERSTEER_EMERGES'
  | 'SPIN_EMERGENT'
  | 'SKILL_IS_CONTROL'
  | 'PLAYER_AGENCY_ALWAYS'
  | 'TYRE_START_WARM'
  | 'TYRE_COLD_GRIP'
  | 'PACK_CONTACT'
  | 'FINISH_LAP_CUTOFF'
  | 'DISCIPLINE_IDENTITY'
  | 'RALLY_LOOSE_UNDER_BRAKE'
  | 'REJOIN_NATURAL'
  | 'MARSHAL_ONLY_WHEN_STUCK'
  | 'PIN_AUTHORITY'
  | 'QR_TRACK_SCALE'
  | 'DETERMINISM'
  | 'STORY_INTENT_DENSITY'
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
