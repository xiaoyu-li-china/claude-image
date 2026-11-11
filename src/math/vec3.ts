/**
 * vec3 — minimal 3D vector math on plain readonly tuples.
 * Functional style: every operation returns a new tuple, inputs are never
 * mutated. Components are ordinary JS numbers (float64); conversion to
 * float32 happens only when data is uploaded to a GL buffer.
 */
export type Vec3 = readonly [number, number, number];
export type MutableVec3 = [number, number, number];

export function vec3(x = 0, y = 0, z = 0): MutableVec3 {
  return [x, y, z];
}

export function add(a: Vec3, b: Vec3): MutableVec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function subtract(a: Vec3, b: Vec3): MutableVec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a: Vec3, s: number): MutableVec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): MutableVec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize(a: Vec3): MutableVec3 {
  const len = length(a);
  if (len === 0) {
    throw new Error('Cannot normalize a zero-length vec3');
  }
  const inv = 1 / len;
  return [a[0] * inv, a[1] * inv, a[2] * inv];
}

export function approxEqual(a: Vec3, b: Vec3, epsilon = 1e-6): boolean {
  return Math.abs(a[0] - b[0]) <= epsilon && Math.abs(a[1] - b[1]) <= epsilon && Math.abs(a[2] - b[2]) <= epsilon;
}
