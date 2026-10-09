import type { MatchState, PlayerId } from '@deadminton/sim';

/** Which physical controls a human player is using. */
export type KeyLayout = 'solo' | 'p1' | 'p2' | 'gamepad' | 'touch';

interface Keys {
  move: string;
  jump: string;
  swing: string;
  weapon: string;
  fuse: string;
  fire: string;
  aim: string;
}

const LAYOUTS: Record<KeyLayout, Keys> = {
  solo: { move: 'A D', jump: 'SPACE', swing: 'J', weapon: 'Q E', fuse: 'R', fire: 'K', aim: 'W S' },
  p1: {
    move: 'A D',
    jump: 'L-SHIFT',
    swing: 'SPACE',
    weapon: 'Q E',
    fuse: 'R',
    fire: 'F',
    aim: 'W S',
  },
  p2: {
    move: '← →',
    jump: 'R-SHIFT',
    swing: 'ENTER',
    weapon: '[ ]',
    fuse: '\\',
    fire: '/',
    aim: '↑ ↓',
  },
  gamepad: {
    move: 'STICK',
    jump: 'A',
    swing: 'X',
    weapon: 'LB RB',
    fuse: 'B',
    fire: 'Y',
    aim: 'STICK ↑↓',
  },
  touch: {
    move: 'STICK',
    jump: 'JUMP',
    swing: 'HIT',
    weapon: 'WPN',
    fuse: 'FUSE',
    fire: 'FIRE',
    aim: 'STICK ↑↓',
  },
};

const key = (k: string, label: string) => `<span class="key"><kbd>${k}</kbd>${label}</span>`;

/**
 * Context-aware control hints for one player (HTML). Shows only what the player can do
 * right now: rally controls, Revenge Turn aiming as the shooter, or dodging as the target.
 */
export function keyHints(state: MatchState, id: PlayerId, layout: KeyLayout): string {
  const k = LAYOUTS[layout];
  const weapons = state.config.scheme !== 'purist';
  const rv = state.revenge;
  if (state.phase === 'matchOver' || state.players[id].dead) return '';
  if (rv && !rv.fired) {
    if (rv.shooter === id) {
      return [
        key(k.aim, 'AIM'),
        key(`HOLD ${k.fire}`, 'CHARGE · RELEASE'),
        key(k.weapon, 'WEAPON'),
        key(k.move, 'MOVE'),
      ].join('');
    }
    return [key(k.move, 'DODGE'), key(k.jump, 'JUMP')].join('');
  }
  if (rv) return key(k.move, 'MOVE');
  const parts = [key(k.move, 'MOVE'), key(k.jump, 'JUMP'), key(k.swing, 'SWING')];
  if (weapons) {
    parts.push(key(k.weapon, 'WEAPON'));
    if (state.players[id].rallyWeapon === 'frag') parts.push(key(k.fuse, 'FUSE'));
    if (state.players[id].rallyWeapon === 'mine') parts.push(key(k.fire, 'THROW'));
  }
  return parts.join('');
}
