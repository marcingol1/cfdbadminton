// World units are meters and seconds. x = 0 is the net; player 0 owns x < 0, player 1 owns
// x > 0. y = 0 is the floor, y grows upward.

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
/** Shuttle integration substeps per tick (a 60 m/s smash moves 0.25 m per substep). */
export const SHUTTLE_SUBSTEPS = 4;

export const HALF_COURT = 6.7;
export const NET_HEIGHT = 1.55;
export const SHORT_SERVICE_LINE = 1.98;
export const RUNOFF = 2.0;
export const WALL_X = HALF_COURT + RUNOFF;

export const PLAYER_HALF_WIDTH = 0.22;
/** Torso hitbox for shuttle body hits (R-22), measured up from the feet. */
export const BODY_BOTTOM = 0.1;
export const BODY_TOP = 1.6;
export const SHOULDER_HEIGHT = 1.45;
export const SHOULDER_FORWARD = 0.1;
/** The closest a player's center can get to the net plane. */
export const NET_CLEARANCE = PLAYER_HALF_WIDTH + 0.03;
/** Where the server holds the shuttle relative to their feet. */
export const SERVE_HAND_FORWARD = 0.35;
export const SERVE_HAND_HEIGHT = 0.85;
/** R-12: a serve's contact point must be below this height. */
export const SERVE_MAX_CONTACT_HEIGHT = 1.15;
