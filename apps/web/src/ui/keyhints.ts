import type { MatchState, PlayerId } from '@deadminton/sim';
import { keyLabel } from '../input/keyboard';
import type { KeyMap } from '../input/keyboard';

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

/** Hint labels for a (possibly remapped) keyboard layout. */
function keyboardKeys(m: KeyMap): Keys {
  const one = (codes: string[]) => keyLabel(codes[0]);
  return {
    move: `${one(m.left)} ${one(m.right)}`,
    jump: one(m.jump),
    swing: one(m.hit),
    weapon: `${one(m.prev)} ${one(m.next)}`,
    fuse: one(m.fuse),
    fire: one(m.fire),
    aim: `${one(m.up)} ${one(m.down)}`,
  };
}

const PAD_KEYS: Keys = {
  move: 'STICK',
  jump: 'A',
  swing: 'X',
  weapon: 'LB RB',
  fuse: 'B',
  fire: 'Y',
  aim: 'STICK ↑↓',
};

const TOUCH_KEYS: Keys = {
  move: 'STICK',
  jump: 'JUMP',
  swing: 'HIT',
  weapon: 'WPN',
  fuse: 'FUSE',
  fire: 'FIRE',
  aim: 'STICK ↑↓',
};

const key = (k: string, label: string) => `<span class="key"><kbd>${k}</kbd>${label}</span>`;

/**
 * Context-aware control hints for one player (HTML). Shows only what the player can do
 * right now: rally controls, Revenge Turn aiming as the shooter, or dodging as the target.
 */
export function keyHints(state: MatchState, id: PlayerId, layout: KeyLayout, keys: KeyMap): string {
  const k = layout === 'gamepad' ? PAD_KEYS : layout === 'touch' ? TOUCH_KEYS : keyboardKeys(keys);
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
