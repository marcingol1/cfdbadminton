import { HALF_COURT, WALL_X } from '@deadminton/sim';

// 480 × 270 internal resolution, 24 px per meter (GAME_DESIGN §15).
export const VIEW_W = 480;
export const VIEW_H = 270;
export const PX_PER_M = 24;
export const FLOOR_Y = 252;
export const CENTER_X = VIEW_W / 2;

export const sx = (x: number) => Math.round(CENTER_X + x * PX_PER_M);
export const sy = (y: number) => Math.round(FLOOR_Y - y * PX_PER_M);

export const BASELINE_PX = HALF_COURT * PX_PER_M;
export const WALL_PX = WALL_X * PX_PER_M;
