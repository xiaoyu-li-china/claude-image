/**
 * Math library self-tests.
 *
 * Four required cases (each with explicit, non-weakened tolerances):
 *   1. identity matrix behaves as the multiplicative identity;
 *   2. perspective projection round trip — inversePerspective is the
 *      numeric inverse of perspective and agrees with the generic inverse();
 *   3. lookAt orthogonality — camera axes are unit, mutually perpendicular,
 *      right-handed (R^T R = I);
 *   4. inverse projection recovers view-space points from their NDC coords.
 *
 * Assertions never silently relax: every check records the observed maximum
 * absolute error against a fixed tolerance. Results are shown in the HUD and
 * printed to the console, and exposed to headless automation.
 */
import {
  get,
  identity,
  inverse,
  inversePerspective,
  lookAt,
  multiply,
  perspective,
  transformPoint,
  type Mat4,
} from './mat4';
import { cross, dot, normalize, subtract, type Vec3 } from './vec3';

export interface SelfTestResult {
  id: string;
  name: string;
  ok: boolean;
  detail: string;
  maxError: number;
  tolerance: number;
}

const EPS_IDENTITY = 1e-12;
const EPS_ORTHOGONAL = 1e-10;
const EPS_ROUNDTRIP = 1e-10;
const EPS_NDC = 1e-9;

function maxAbsDiff(a: Mat4, b: Mat4): number {
  let max = 0;
  for (let i = 0; i < 16; i++) {
    max = Math.max(max, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  }
  return max;
}

function maxVecDiff(a: readonly number[], b: readonly number[]): number {
  let max = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    max = Math.max(max, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  }
  return max;
}

/** Case 1 — identity: I*I = I and I leaves points unchanged. */
function testIdentity(): SelfTestResult {
  const i = identity();
  const product = multiply(i, i);
  const matrixError = maxAbsDiff(product, i);

  const probe: Vec3 = [3.5, -7.25, 11.125];
  const untouched = transformPoint(i, probe);
  const pointError = maxVecDiff(untouched, probe);

  // Structural check too: exact unit diagonal / zero off-diagonal positions.
  const structural =
    get(i, 0, 0) === 1 &&
    get(i, 1, 1) === 1 &&
    get(i, 2, 2) === 1 &&
    get(i, 3, 3) === 1 &&
    get(i, 3, 0) === 0 &&
    get(i, 3, 1) === 0 &&
    get(i, 3, 2) === 0;

  const maxError = Math.max(matrixError, pointError);
  return {
    id: 'identity',
    name: '单位矩阵：I*I=I 且对点变换恒等',
    ok: maxError <= EPS_IDENTITY && structural,
    detail: `矩阵误差=${matrixError.toExponential(3)}，点变换误差=${pointError.toExponential(3)}，结构检查=${structural}`,
    maxError,
    tolerance: EPS_IDENTITY,
  };
}

/**
 * Case 2 — perspective round trip:
 *   inversePerspective() * perspective() == I, and the analytic inverse
 *   matches the generic Gauss-Jordan inverse() entry for entry.
 */
function testPerspectiveRoundTrip(): SelfTestResult {
  const fov = Math.PI / 3;
  const aspect = 16 / 9;
  const near = 0.1;
  const far = 100;
  const p = perspective(fov, aspect, near, far);
  const invAnalytic = inversePerspective(fov, aspect, near, far);
  const invGeneric = inverse(p);

  const product = multiply(invAnalytic, p);
  const identityError = maxAbsDiff(product, identity());
  const inverseAgreement = maxAbsDiff(invAnalytic, invGeneric);
  const maxError = Math.max(identityError, inverseAgreement);

  return {
    id: 'perspective-roundtrip',
    name: '透视投影往返：invPerspective * perspective = I',
    ok: maxError <= EPS_ROUNDTRIP,
    detail: `invP*P 与 I 误差=${identityError.toExponential(3)}，解析逆与通用逆矩阵误差=${inverseAgreement.toExponential(3)}`,
    maxError,
    tolerance: EPS_ROUNDTRIP,
  };
}

/** Case 3 — lookAt orthogonality of the embedded rotation. */
function testLookAtOrthogonality(): SelfTestResult {
  const eye: Vec3 = [2.5, 4, 6.5];
  const center: Vec3 = [0, 1, 0];
  const up: Vec3 = [0, 1, 0];
  const view = lookAt(eye, center, up);

  // Extract the three camera axes (rows of the rotation block; storage is
  // column-major so the row r components live at columns 0..2, row r).
  const right: Vec3 = [get(view, 0, 0), get(view, 1, 0), get(view, 2, 0)];
  const camUp: Vec3 = [get(view, 0, 1), get(view, 1, 1), get(view, 2, 1)];
  const back: Vec3 = [get(view, 0, 2), get(view, 1, 2), get(view, 2, 2)];

  const unitErrors = [right, camUp, back].map((axis) => Math.abs(dot(axis, axis) - 1));
  const perpendicularErrors = [
    Math.abs(dot(right, camUp)),
    Math.abs(dot(camUp, back)),
    Math.abs(dot(back, right)),
  ];
  // Right-handedness: right x up == back.
  const handednessError = maxVecDiff(cross(right, camUp), back);
  // R^T R = I over the 3x3 rotation block.
  const rtrError = (() => {
    let max = 0;
    const axes = [right, camUp, back];
    for (let c = 0; c < 3; c++) {
      for (let r = 0; r < 3; r++) {
        const expected = c === r ? 1 : 0;
        max = Math.max(max, Math.abs(dot(axes[c]!, axes[r]!) - expected));
      }
    }
    return max;
  })();
  // Sanity: the forward direction actually points at the target.
  const forward = normalize(subtract(center, eye));
  const extractedForward: Vec3 = [-back[0], -back[1], -back[2]];
  const aimError = maxVecDiff(extractedForward, forward);

  // End-to-end view-space convention: eye maps to the origin and the target
  // lands on the -z axis at distance |center - eye|. A transposed rotation
  // block fails here even when the extracted axes look orthonormal.
  const eyeInView = transformPoint(view, eye);
  const eyeError = maxVecDiff(eyeInView, [0, 0, 0]);
  const targetInView = transformPoint(view, center);
  const expectedTarget: Vec3 = [0, 0, -Math.hypot(center[0] - eye[0], center[1] - eye[1], center[2] - eye[2])];
  const targetError = maxVecDiff(targetInView, expectedTarget);

  const maxError = Math.max(
    ...unitErrors,
    ...perpendicularErrors,
    handednessError,
    rtrError,
    aimError,
    eyeError,
    targetError,
  );
  return {
    id: 'lookat-orthogonality',
    name: 'lookAt 正交性：轴单位长度、两两垂直、右手系 (R^T R = I)',
    ok: maxError <= EPS_ORTHOGONAL,
    detail: `R^T R 误差=${rtrError.toExponential(3)}，右手系误差=${handednessError.toExponential(3)}，视空间落点误差=${Math.max(eyeError, targetError).toExponential(3)}`,
    maxError,
    tolerance: EPS_ORTHOGONAL,
  };
}

/**
 * Case 4 — unproject NDC: project frustum points to NDC with perspective(),
 * then recover them with inversePerspective(). Includes corners of the
 * near/far NDC boxes so the full depth range is exercised.
 */
function testUnprojectNdc(): SelfTestResult {
  const fov = Math.PI / 2;
  const aspect = 1.5;
  const near = 0.25;
  const far = 250;
  const p = perspective(fov, aspect, near, far);
  const invP = inversePerspective(fov, aspect, near, far);

  const viewPoints: Vec3[] = [
    [0, 0, -1],
    [1.25, -0.5, -4],
    [-3, 2.25, -16],
    [0.75, 0.75, -64],
  ];
  // NDC box corners at the near and far planes must map back exactly.
  for (const z of [near, far]) {
    for (const nx of [-1, 1]) {
      for (const ny of [-1, 1]) {
        const h = Math.tan(fov / 2) * z;
        viewPoints.push([nx * h * aspect, ny * h, -z]);
      }
    }
  }

  let maxError = 0;
  let checked = 0;
  for (const point of viewPoints) {
    const ndc = transformPoint(p, point);
    if (ndc.some((v) => !Number.isFinite(v))) {
      throw new Error(`NDC projection produced non-finite value for ${point.join(', ')}`);
    }
    // NDC must live in the [-1, 1] cube for frustum-contained points.
    if (ndc.some((v) => v < -1 - EPS_NDC || v > 1 + EPS_NDC)) {
      throw new Error(`Projected point left the NDC cube: ${ndc.join(', ')} from ${point.join(', ')}`);
    }
    const recovered = transformPoint(invP, ndc);
    maxError = Math.max(maxError, maxVecDiff(recovered, point));
    checked += 1;
  }

  return {
    id: 'unproject-ndc',
    name: '逆投影还原 NDC：投影→NDC→逆投影还原视空间点',
    ok: maxError <= EPS_NDC,
    detail: `${checked} 个采样点（含近/远平面四角），最大还原误差=${maxError.toExponential(3)}`,
    maxError,
    tolerance: EPS_NDC,
  };
}

const TESTS: ReadonlyArray<() => SelfTestResult> = [
  testIdentity,
  testPerspectiveRoundTrip,
  testLookAtOrthogonality,
  testUnprojectNdc,
];

export function runAllSelfTests(): SelfTestResult[] {
  return TESTS.map((test) => {
    try {
      return test();
    } catch (err) {
      return {
        id: test.name,
        name: test.name,
        ok: false,
        detail: `测试抛出异常：${err instanceof Error ? err.message : String(err)}`,
        maxError: Number.POSITIVE_INFINITY,
        tolerance: 0,
      };
    }
  });
}

/** Console-friendly report; also used by the HUD button. */
export function logSelfTestResults(results: ReadonlyArray<SelfTestResult>): void {
  const passed = results.filter((r) => r.ok).length;
  console.group(`[math self-test] ${passed}/${results.length} passed`);
  for (const r of results) {
    const line = `${r.ok ? 'PASS' : 'FAIL'} ${r.name} (maxError=${Number.isFinite(r.maxError) ? r.maxError.toExponential(3) : 'Infinity'}, tolerance=${r.tolerance.toExponential(0)}) — ${r.detail}`;
    if (r.ok) {
      console.log(line);
    } else {
      console.error(line);
    }
  }
  console.groupEnd();
}
