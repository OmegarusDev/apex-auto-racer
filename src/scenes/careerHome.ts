import { getGameContext } from '../engine/GameContext';
import { activeDriver } from '../engine/SaveManager';
import { CampaignScene } from './CampaignScene';

/** Career home is the campaign screen (hub identity + calendar). */
export function careerHomeScene(): CampaignScene {
  const state = getGameContext().state;
  const driver = state !== null ? activeDriver(state) : null;
  return new CampaignScene(driver?.discipline ?? 'track');
}
