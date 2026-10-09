// GAME_DESIGN §7. Every weapon number lives here so balancing is a data change.

export type WeaponId =
  | 'frag'
  | 'shock'
  | 'lead'
  | 'cluster'
  | 'ghost'
  | 'mine'
  | 'rocket'
  | 'mortar'
  | 'homing'
  | 'airstrike'
  | 'medkit'
  | 'shield';

/**
 * loaded: turns the next hit's shuttle into the weapon (§7.1).
 * throwable: thrown during a rally (§7.2).
 * revenge: aimed in a Revenge Turn (§7.3).
 * utility: used instead of attacking in a Revenge Turn (§7.4).
 */
export type WeaponCategory = 'loaded' | 'throwable' | 'revenge' | 'utility';

export interface WeaponSpec {
  id: WeaponId;
  name: string;
  category: WeaponCategory;
  /** R-52: rallies that must be played this game before it unlocks. */
  delay: number;
  /** Explosion radius in meters (0 = no explosion). */
  radius: number;
  /** Damage at the explosion center, or the direct effect (shock, lead, heal, shield). */
  damage: number;
  /** Knockback impulse at the explosion center, m/s. */
  knockback: number;
}

const w = (s: Partial<WeaponSpec> & Pick<WeaponSpec, 'id' | 'name' | 'category'>): WeaponSpec => ({
  delay: 0,
  radius: 0,
  damage: 0,
  knockback: 0,
  ...s,
});

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  frag: w({
    id: 'frag',
    name: 'Frag Shuttle',
    category: 'loaded',
    radius: 1.6,
    damage: 35,
    knockback: 9,
  }),
  shock: w({ id: 'shock', name: 'Shock Shuttle', category: 'loaded', damage: 10 }),
  lead: w({ id: 'lead', name: 'Lead Shuttle', category: 'loaded', damage: 18, knockback: 8 }),
  cluster: w({
    id: 'cluster',
    name: 'Cluster Shuttle',
    category: 'loaded',
    delay: 3,
    radius: 0.8,
    damage: 10,
    knockback: 4,
  }),
  ghost: w({ id: 'ghost', name: 'Ghost Shuttle', category: 'loaded' }),
  mine: w({
    id: 'mine',
    name: 'Proximity Mine',
    category: 'throwable',
    delay: 2,
    radius: 1.2,
    damage: 25,
    knockback: 7,
  }),
  rocket: w({
    id: 'rocket',
    name: 'Rocket',
    category: 'revenge',
    radius: 1.5,
    damage: 14,
    knockback: 7,
  }),
  mortar: w({
    id: 'mortar',
    name: 'Mortar',
    category: 'revenge',
    delay: 2,
    radius: 1.0,
    damage: 10,
    knockback: 5,
  }),
  homing: w({
    id: 'homing',
    name: 'Homing Missile',
    category: 'revenge',
    delay: 4,
    radius: 1.5,
    damage: 24,
    knockback: 8,
  }),
  airstrike: w({
    id: 'airstrike',
    name: 'Air Strike',
    category: 'revenge',
    delay: 6,
    radius: 1.0,
    damage: 12,
    knockback: 6,
  }),
  medkit: w({ id: 'medkit', name: 'Medkit', category: 'utility', damage: 25 }),
  shield: w({ id: 'shield', name: 'Shield', category: 'utility', damage: 30 }),
};

/** Order of the weapon cycles (NEXT / PREV buttons). */
export const RALLY_WEAPONS: WeaponId[] = ['frag', 'shock', 'lead', 'cluster', 'ghost', 'mine'];
export const REVENGE_WEAPONS: WeaponId[] = [
  'rocket',
  'mortar',
  'homing',
  'airstrike',
  'medkit',
  'shield',
];

/** Numbers that belong to a weapon's behavior rather than its blast. */
export const WEAPON_TUNING = {
  smash: { minSpeed: 20, maxSpeed: 60, minDamage: 3, maxDamage: 8 },
  shock: { stunTicks: 24 },
  lead: { dragMultiplier: 0.35 },
  frag: { minFuse: 1, maxFuse: 5, defaultFuse: 3 },
  cluster: { bomblets: 4 },
  ghost: { invisibleTicks: 48 },
  mine: { armTicks: 60, triggerRadius: 0.6, fuseTicks: 30, maxActive: 2, throwTicks: 30 },
  revenge: {
    minSpeed: 4,
    maxSpeed: 18,
    chargeTicks: 72,
    windAccel: 0.9,
    aimRate: 60,
    cursorRate: 6,
  },
  mortar: { bomblets: 3, spread: 2.2 },
  homing: { lockDelayTicks: 24, accel: 30, maxSpeed: 20 },
  airstrike: { missiles: 5, spacing: 0.55, height: 12, fallSpeed: 16 },
  crate: { radius: 1.2, damage: 15, knockback: 6, health: 20, shield: 30, fallSpeed: 2.5 },
  fall: { safeHeight: 3, damagePerMeter: 2 },
  pitDepth: 4,
} as const;

export type SchemeId = 'purist' | 'standard' | 'chaos';

export interface Scheme {
  id: SchemeId;
  name: string;
  ammo: Record<WeaponId, number>;
  /** R-40: Revenge Turns on/off. */
  revenge: boolean;
  /** Chance of a supply crate after each rally (§8). */
  crateChance: number;
  /** R-52 weapon delays on/off. */
  delays: boolean;
}

const STANDARD_AMMO: Record<WeaponId, number> = {
  frag: 2,
  shock: 3,
  lead: 3,
  cluster: 1,
  ghost: 2,
  mine: 2,
  rocket: -1,
  mortar: 2,
  homing: 1,
  airstrike: 1,
  medkit: 1,
  shield: 1,
};

const mapAmmo = (f: (n: number) => number) =>
  Object.fromEntries(
    Object.entries(STANDARD_AMMO).map(([k, v]) => [k, v < 0 ? v : f(v)]),
  ) as Record<WeaponId, number>;

export const SCHEMES: Record<SchemeId, Scheme> = {
  purist: {
    id: 'purist',
    name: 'Purist',
    ammo: mapAmmo(() => 0),
    revenge: false,
    crateChance: 0,
    delays: true,
  },
  standard: {
    id: 'standard',
    name: 'Standard',
    ammo: STANDARD_AMMO,
    revenge: true,
    crateChance: 0.2,
    delays: true,
  },
  chaos: {
    id: 'chaos',
    name: 'Chaos',
    ammo: mapAmmo((n) => n * 2),
    revenge: true,
    crateChance: 1,
    delays: false,
  },
};
// Purist has no Revenge Turns, so its unlimited Rocket is irrelevant; make it explicit.
SCHEMES.purist.ammo.rocket = 0;
