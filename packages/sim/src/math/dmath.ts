// Deterministic math. JavaScript only guarantees IEEE-exact results for + - * / and
// Math.sqrt; Math.sin & co. may differ between V8 and JavaScriptCore, which would desync
// online matches between Android and iOS. Everything here is built from exact operations.

export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;
const SQRT3 = 1.7320508075688772;
const TAN_PI_12 = 0.2679491924311227;

export function degToRad(deg: number): number {
  return (deg * PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / PI;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function sign(v: number): -1 | 0 | 1 {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

/** Odd Taylor series of sin around 0; error < 1e-11 on [-PI/2, PI/2]. */
function sinPoly(x: number): number {
  const x2 = x * x;
  return (
    x *
    (1 +
      x2 *
        (-1 / 6 +
          x2 *
            (1 / 120 +
              x2 *
                (-1 / 5040 +
                  x2 *
                    (1 / 362880 +
                      x2 * (-1 / 39916800 + x2 * (1 / 6227020800 + x2 * (-1 / 1307674368000))))))))
  );
}

export function sin(x: number): number {
  // Reduce to [-PI, PI].
  let r = x - Math.round(x / TAU) * TAU;
  // Fold to [-PI/2, PI/2] using sin(PI - r) = sin(r).
  if (r > HALF_PI) r = PI - r;
  else if (r < -HALF_PI) r = -PI - r;
  return sinPoly(r);
}

export function cos(x: number): number {
  return sin(x + HALF_PI);
}

function atanSmall(x: number): number {
  // |x| <= tan(PI/12): Taylor series converges fast (error < 1e-12).
  const x2 = x * x;
  let term = x;
  let sum = x;
  for (let n = 3; n <= 21; n += 2) {
    term *= -x2;
    sum += term / n;
  }
  return sum;
}

export function atan(x: number): number {
  if (x < 0) return -atan(-x);
  if (x > 1) return HALF_PI - atan(1 / x);
  if (x > TAN_PI_12) return PI / 6 + atanSmall((x * SQRT3 - 1) / (SQRT3 + x));
  return atanSmall(x);
}

export function atan2(y: number, x: number): number {
  if (x > 0) return atan(y / x);
  if (x < 0) return y >= 0 ? atan(y / x) + PI : atan(y / x) - PI;
  if (y > 0) return HALF_PI;
  if (y < 0) return -HALF_PI;
  return 0;
}

export function hypot2(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}
