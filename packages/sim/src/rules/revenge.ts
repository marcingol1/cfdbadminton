import { DT } from '../constants';
import { heal, raiseShield } from '../combat';
import { ARENAS } from '../data/arenas';
import { SCHEMES, WEAPONS, WEAPON_TUNING } from '../data/weapons';
import { Buttons } from '../input';
import { clamp } from '../math/dmath';
import type { InputFrame, MatchState, PlayerId, RevengeState, SimEvent } from '../types';
import { revengeLaunch, spawnProjectile } from '../weapons/projectiles';
import { consumeAmmo, cycle, revengeOptions } from '../weapons/selection';
import { other, sideSign } from '../world';
import { canAct, updatePlayer } from './player';

/** R-41 turn timer and R-43 resolution time. */
export const REVENGE_TURN_TICKS = 600;
export const REVENGE_RESOLVE_TICKS = 180;
const SKIP_RESOLVE_TICKS = 30;
/** Resolution never waits longer than this for projectiles to finish. */
const MAX_EXTRA_RESOLVE_TICKS = 240;
export const MIN_AIM = -30;
export const MAX_AIM = 85;

/** R-40: the loser of a point gets a Revenge Turn if they hold any revenge weapon or utility. */
export function canRevenge(state: MatchState, loser: PlayerId): boolean {
  if (!SCHEMES[state.config.scheme].revenge) return false;
  const p = state.players[loser];
  return !p.dead && revengeOptions(state, p).some((o) => o !== null);
}

export function startRevenge(state: MatchState, shooter: PlayerId, events: SimEvent[]): void {
  const p = state.players[shooter];
  const options = revengeOptions(state, p);
  if (!options.includes(p.revengeWeapon) || p.revengeWeapon === null) p.revengeWeapon = options[0]!;
  state.revenge = {
    shooter,
    target: other(shooter),
    ticksLeft: REVENGE_TURN_TICKS,
    angle: 35,
    power: 0,
    charging: false,
    cursor: 4,
    fired: false,
    resolveTicks: 0,
  };
  state.phase = 'revenge';
  state.phaseTicks = 0;
  events.push({ type: 'revengeStart', shooter, target: other(shooter) });
}

function isAimed(weapon: string | null): boolean {
  return weapon === 'rocket' || weapon === 'mortar' || weapon === 'homing';
}

function fire(state: MatchState, rv: RevengeState, events: SimEvent[]): void {
  const p = state.players[rv.shooter];
  const target = state.players[rv.target];
  const w = p.revengeWeapon;
  rv.fired = true;
  rv.charging = false;
  rv.resolveTicks = REVENGE_RESOLVE_TICKS;
  switch (w) {
    case null:
      rv.resolveTicks = SKIP_RESOLVE_TICKS;
      break;
    case 'medkit':
      heal(p, WEAPONS.medkit.damage, events);
      break;
    case 'shield':
      raiseShield(p, WEAPONS.shield.damage, events);
      break;
    case 'airstrike': {
      const a = WEAPON_TUNING.airstrike;
      const cx = sideSign(rv.target) * rv.cursor;
      // Indoors the planes fly just under the ceiling.
      const ceiling = ARENAS[state.config.arena].ceiling;
      const top = ceiling === null ? a.height : Math.min(a.height, ceiling - 0.4);
      for (let i = 0; i < a.missiles; i++) {
        const x = cx + (i - (a.missiles - 1) / 2) * a.spacing;
        spawnProjectile(state, 'airMissile', p.id, x, top - i * 0.3, 0, -a.fallSpeed);
      }
      break;
    }
    case 'rocket':
    case 'mortar':
    case 'homing': {
      const l = revengeLaunch(state, p.id, rv.angle, rv.power);
      spawnProjectile(state, w, p.id, l.x, l.y, l.vx, l.vy, target.x, target.y + 0.9);
      break;
    }
    default:
      break;
  }
  if (w !== null) consumeAmmo(p, w);
  events.push({ type: 'revengeFire', player: p.id, weapon: w, power: rv.power });
}

/**
 * One tick of a Revenge Turn (R-40..R-45). The shooter moves, picks a weapon, aims with
 * up/down and fires once; the target may only move (or is frozen with classic targeting).
 * Returns true when the turn, including its resolution, is over.
 */
export function stepRevenge(
  state: MatchState,
  inputs: readonly [InputFrame, InputFrame],
  pressed: readonly [number, number],
  events: SimEvent[],
): boolean {
  const rv = state.revenge!;
  const shooter = state.players[rv.shooter];
  const target = state.players[rv.target];
  updatePlayer(
    state,
    shooter,
    inputs[shooter.id],
    pressed[shooter.id],
    { locked: false, canSwing: false },
    events,
  );
  updatePlayer(
    state,
    target,
    inputs[target.id],
    pressed[target.id],
    { locked: state.config.classicTargeting, canSwing: false },
    events,
  );

  if (rv.fired) {
    rv.resolveTicks--;
    return (
      (rv.resolveTicks <= 0 && state.projectiles.length === 0) ||
      rv.resolveTicks < -MAX_EXTRA_RESOLVE_TICKS
    );
  }

  rv.ticksLeft--;
  const input = inputs[shooter.id];
  const press = pressed[shooter.id];
  if (canAct(shooter)) {
    if (press & (Buttons.WEAPON_NEXT | Buttons.WEAPON_PREV)) {
      shooter.revengeWeapon = cycle(
        revengeOptions(state, shooter),
        shooter.revengeWeapon,
        press & Buttons.WEAPON_NEXT ? 1 : -1,
      );
      rv.charging = false;
      rv.power = 0;
      events.push({ type: 'select', player: shooter.id, weapon: shooter.revengeWeapon });
    }
    const t = WEAPON_TUNING.revenge;
    const axis = input.moveY / 127;
    if (shooter.revengeWeapon === 'airstrike') {
      rv.cursor = clamp(rv.cursor + axis * t.cursorRate * DT, 0.5, 8.4);
    } else {
      rv.angle = clamp(rv.angle + axis * t.aimRate * DT, MIN_AIM, MAX_AIM);
    }
    if (isAimed(shooter.revengeWeapon)) {
      // Worms-style: hold FIRE to charge, release to shoot (full charge fires by itself).
      if (press & Buttons.FIRE) {
        rv.charging = true;
        rv.power = 0;
      } else if (rv.charging) {
        if (input.buttons & Buttons.FIRE) rv.power = Math.min(1, rv.power + 1 / t.chargeTicks);
        if (!(input.buttons & Buttons.FIRE) || rv.power >= 1) fire(state, rv, events);
      }
    } else if (press & Buttons.FIRE) {
      fire(state, rv, events);
    }
  }
  if (!rv.fired && rv.ticksLeft <= 0) {
    // Out of time: the turn is lost (a charged shot still goes off, like in Worms).
    if (rv.charging) fire(state, rv, events);
    else {
      rv.fired = true;
      rv.resolveTicks = SKIP_RESOLVE_TICKS;
      events.push({ type: 'revengeFire', player: shooter.id, weapon: null, power: 0 });
    }
  }
  return false;
}
