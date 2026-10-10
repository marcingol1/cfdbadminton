export type ArenaId = 'hall' | 'rooftop';

export interface Arena {
  id: ArenaId;
  name: string;
  /** Wind is uniform in [-windMax, windMax] m/s, re-rolled every rally. */
  windMax: number;
  /** Ceiling height in meters, or null for open-air arenas. */
  ceiling: number | null;
  /** Walls at the end of the run-off (Hall). Without walls the run-off ends in a pit. */
  walls: boolean;
  /** Beyond the run-off is a pit: falling in is an instant KO (GAME_DESIGN §4). */
  pits: boolean;
}

export const ARENAS: Record<ArenaId, Arena> = {
  hall: { id: 'hall', name: 'Sports Hall', windMax: 1, ceiling: 10, walls: true, pits: false },
  rooftop: { id: 'rooftop', name: 'Rooftop', windMax: 4, ceiling: null, walls: false, pits: true },
};
