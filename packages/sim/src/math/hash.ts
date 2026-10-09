// Structural FNV-1a hash of plain data. Numbers are hashed by their exact IEEE-754 bits, so
// two states hash equal only if they are bit-for-bit identical. Used for desync detection
// and determinism tests.

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

function mix(h: number, v: number): number {
  return Math.imul(h ^ v, 16777619) >>> 0;
}

function hashString(h: number, s: string): number {
  for (let i = 0; i < s.length; i++) h = mix(h, s.charCodeAt(i));
  return h;
}

function walk(h: number, v: unknown): number {
  if (v === null || v === undefined) return mix(h, 0x6e);
  switch (typeof v) {
    case 'number':
      f64[0] = v;
      return mix(mix(h, u32[0]!), u32[1]!);
    case 'boolean':
      return mix(h, v ? 0x74 : 0x66);
    case 'string':
      return hashString(mix(h, 0x73), v);
    case 'object': {
      if (Array.isArray(v)) {
        h = mix(h, 0x5b);
        for (const item of v) h = walk(h, item);
        return mix(h, 0x5d);
      }
      h = mix(h, 0x7b);
      for (const key of Object.keys(v as object).sort()) {
        h = hashString(h, key);
        h = walk(h, (v as Record<string, unknown>)[key]);
      }
      return mix(h, 0x7d);
    }
    default:
      throw new Error(`Cannot hash value of type ${typeof v}`);
  }
}

export function hashValue(v: unknown): number {
  return walk(2166136261, v);
}
