/**
 * Small numeric helpers for the models: normal CDF, a seeded PRNG with a normal sampler,
 * summary statistics and rounding. No dependencies, deterministic everywhere.
 */

/** Standard normal CDF. erfc from Numerical Recipes (fractional error < 1.2e-7 everywhere). */
export function normalCdf(z: number): number {
  if (z === Number.POSITIVE_INFINITY) return 1;
  if (z === Number.NEGATIVE_INFINITY) return 0;
  const x = -z / Math.SQRT2;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.5 * a);
  const r =
    t *
    Math.exp(
      -a * a -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  const erfc = x >= 0 ? r : 2 - r;
  return Math.min(1, Math.max(0, 0.5 * erfc));
}

/** 32-bit FNV-1a hash of a string, used to derive default seeds. */
export function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Standard normal draw. */
  normal(): number;
}

/**
 * sfc32 seeded through splitmix32, with a Marsaglia polar normal sampler (the spare draw is
 * cached). Same seed, same sequence, on every platform.
 */
export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  const splitmix = () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
  let a = splitmix();
  let b = splitmix();
  let c = splitmix();
  let d = splitmix();
  const next = () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  // Warm up so nearby seeds decorrelate.
  for (let i = 0; i < 12; i++) next();

  let spare: number | null = null;
  const normal = () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u: number;
    let v: number;
    let q: number;
    do {
      u = 2 * next() - 1;
      v = 2 * next() - 1;
      q = u * u + v * v;
    } while (q >= 1 || q === 0);
    const f = Math.sqrt((-2 * Math.log(q)) / q);
    spare = v * f;
    return u * f;
  };
  return { next, normal };
}

export function mean(xs: readonly number[]): number {
  if (!xs.length) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Sample standard deviation (n - 1). 0 for fewer than two values. */
export function sampleSd(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / (xs.length - 1));
}

export const round = (n: number, digits = 2): number => {
  const f = 10 ** digits;
  return Math.round((n + Number.EPSILON * Math.sign(n)) * f) / f;
};
