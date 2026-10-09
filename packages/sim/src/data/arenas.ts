export type ArenaId = 'hall';

export interface Arena {
  id: ArenaId;
  name: string;
  /** Wind is uniform in [-windMax, windMax] m/s, re-rolled every rally. */
  windMax: number;
  /** Ceiling height in meters, or null for open-air arenas. */
  ceiling: number | null;
}

export const ARENAS: Record<ArenaId, Arena> = {
  hall: { id: 'hall', name: 'Sports Hall', windMax: 1, ceiling: 10 },
};
