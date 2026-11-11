/**
 * mat4 — column-major 4x4 matrices stored as plain number[16].
 *
 * Storage convention matches WebGL (column-major): element (column c, row r)
 * lives at index c * 4 + r. Math is performed in float64 so the self-test
 * round trips stay tight; `toFloat32Array` converts at GL upload time.
 */
import { cross, dot, normalize, subtract, type Vec3 } from './vec3';

export type Mat4 = number[];

export function mat4(): Mat4 {
  return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
}

export function identity(): Mat4 {
  const m = mat4();
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  m[15] = 1;
  return m;
}

export function clone(m: Mat4): Mat4 {
  return [...m];
}

export function toFloat32Array(m: Mat4): Float32Array {
  return Float32Array.from(m);
}

/** Column-major element access: m[column * 4 + row]. */
export function get(m: Mat4, column: number, row: number): number {
  const v = m[column * 4 + row];
  if (v === undefined) {
    throw new RangeError(`mat4 index out of range: column=${column} row=${row}`);
  }
  return v;
}

/** Out = A * B (column-major). */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = mat4();
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += get(a, k, r) * get(b, c, k);
      }
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

/** Transform a 3D point with implicit w=1, returning the perspective-divided result. */
export function transformPoint(m: Mat4, p: Vec3): [number, number, number] {
  const x = p[0];
  const y = p[1];
  const z = p[2];
  const outX = get(m, 0, 0) * x + get(m, 1, 0) * y + get(m, 2, 0) * z + get(m, 3, 0);
  const outY = get(m, 0, 1) * x + get(m, 1, 1) * y + get(m, 2, 1) * z + get(m, 3, 1);
  const outZ = get(m, 0, 2) * x + get(m, 1, 2) * y + get(m, 2, 2) * z + get(m, 3, 2);
  const w = get(m, 0, 3) * x + get(m, 1, 3) * y + get(m, 2, 3) * z + get(m, 3, 3);
  if (w === 0) {
    throw new Error('transformPoint produced w=0 (point lies on the projection plane)');
  }
  return [outX / w, outY / w, outZ / w];
}

/**
 * OpenGL perspective projection (column-major).
 * Maps the frustum [near, far] to NDC z in [-1, 1].
 */
export function perspective(fovYRadians: number, aspect: number, near: number, far: number): Mat4 {
  if (!(fovYRadians > 0 && fovYRadians < Math.PI)) {
    throw new Error(`perspective: fovY must be in (0, PI), got ${fovYRadians}`);
  }
  if (!(aspect > 0)) {
    throw new Error(`perspective: aspect must be > 0, got ${aspect}`);
  }
  if (!(near > 0) || !(far > near)) {
    throw new Error(`perspective: require 0 < near < far, got near=${near} far=${far}`);
  }
  const f = 1 / Math.tan(fovYRadians / 2);
  const nf = 1 / (near - far);
  const m = mat4();
  m[0] = f / aspect; // col 0, row 0
  m[5] = f; // col 1, row 1
  m[10] = (far + near) * nf; // col 2, row 2
  m[11] = -1; // col 2, row 3
  m[14] = 2 * far * near * nf; // col 3, row 2
  m[15] = 0; // col 3, row 3
  return m;
}

/**
 * Analytic inverse of `perspective()`. This is the documented inverse
 * projection matrix; self-tests prove it is both the numeric inverse of P
 * and able to recover view-space points from their NDC coordinates.
 */
export function inversePerspective(fovYRadians: number, aspect: number, near: number, far: number): Mat4 {
  if (!(fovYRadians > 0 && fovYRadians < Math.PI)) {
    throw new Error(`inversePerspective: fovY must be in (0, PI), got ${fovYRadians}`);
  }
  if (!(aspect > 0)) {
    throw new Error(`inversePerspective: aspect must be > 0, got ${aspect}`);
  }
  if (!(near > 0) || !(far > near)) {
    throw new Error(`inversePerspective: require 0 < near < far, got near=${near} far=${far}`);
  }
  const tanHalf = Math.tan(fovYRadians / 2);
  const m = mat4();
  m[0] = aspect * tanHalf;
  m[5] = tanHalf;
  m[11] = (near - far) / (2 * near * far);
  m[14] = -1;
  m[15] = (far + near) / (2 * near * far);
  return m;
}

/** Right-handed view matrix looking from `eye` toward `center`, with `up` as the reference up. */
export function lookAt(eye: Vec3, center: Vec3, up: Vec3): Mat4 {
  const forward = normalize(subtract(center, eye)); // -z axis of the camera
  const right = normalize(cross(forward, up)); // x axis
  const trueUp = cross(right, forward); // y axis (re-orthogonalized)

  const m = identity();
  // Rotation block in column-major storage (array index = col*4 + row).
  // Column 0 = right, column 1 = up, column 2 = -forward.
  m[0] = right[0];
  m[1] = trueUp[0];
  m[2] = -forward[0];
  m[4] = right[1];
  m[5] = trueUp[1];
  m[6] = -forward[1];
  m[8] = right[2];
  m[9] = trueUp[2];
  m[10] = -forward[2];
  // Translation column: -R^T * eye.
  m[12] = -dot(right, eye);
  m[13] = -dot(trueUp, eye);
  m[14] = dot(forward, eye);
  return m;
}

/**
 * General 4x4 inverse via Gauss-Jordan elimination with partial pivoting.
 * Throws when the matrix is singular. Used by self-tests to independently
 * verify inversePerspective against perspective.
 */
export function inverse(m: Mat4): Mat4 {
  // Row-major working copy of A plus an identity block: rows[row][col].
  const rows: number[][] = [];
  for (let r = 0; r < 4; r++) {
    const row: number[] = [];
    for (let c = 0; c < 4; c++) {
      row.push(get(m, c, r));
    }
    for (let c = 0; c < 4; c++) {
      row.push(r === c ? 1 : 0);
    }
    rows.push(row);
  }

  // Gauss-Jordan elimination with partial pivoting.
  for (let col = 0; col < 4; col++) {
    let pivot = col;
    for (let r = col + 1; r < 4; r++) {
      if (Math.abs(rows[r]![col]!) > Math.abs(rows[pivot]![col]!)) {
        pivot = r;
      }
    }
    if (Math.abs(rows[pivot]![col]!) < 1e-12) {
      throw new Error('mat4.inverse: matrix is singular');
    }
    const pivotRow = rows[pivot]!;
    const currentRow = rows[col]!;
    if (pivot !== col) {
      rows[col] = pivotRow;
      rows[pivot] = currentRow;
    }
    const normalizedPivot = rows[col]!;
    const pivotValue = normalizedPivot[col]!;
    for (let k = 0; k < 8; k++) {
      normalizedPivot[k] = normalizedPivot[k]! / pivotValue;
    }
    for (let r = 0; r < 4; r++) {
      if (r === col) {
        continue;
      }
      const target = rows[r]!;
      const factor = target[col]!;
      for (let k = 0; k < 8; k++) {
        target[k] = target[k]! - factor * normalizedPivot[k]!;
      }
    }
  }

  // Right half (inverse, row-major) -> column-major output.
  const out = mat4();
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      out[c * 4 + r] = rows[r]![c + 4]!;
    }
  }
  return out;
}
