const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/registration.js');
const { parseSTL, writeBinarySTL } = require('../src/stl.js');
const { makeSampleBracket, makeSampleCase } = require('../src/sample.js');

function near(actual, expected, tol, label) {
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: expected ${expected}, got ${actual}`);
}

function checkDeviation(dev, expected, linTol, angTol) {
  ['x', 'y', 'z'].forEach((axis, k) => {
    near(dev.delta[k], expected.delta[k], linTol, `Δ${axis}`);
    near(dev.rotation[axis], expected.rotation[axis], angTol, `R${axis}`);
  });
}

// Triangle order shuffled and each triangle's vertices cycled: same surface,
// no vertex-to-vertex correspondence by index.
function shuffleTriangles(positions, seed) {
  const n = positions.length / 9;
  const order = Array.from({ length: n }, (_, i) => i);
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const out = new Float64Array(positions.length);
  order.forEach((src, dst) => {
    const shift = dst % 3;
    for (let v = 0; v < 3; v++) {
      const from = src * 9 + ((v + shift) % 3) * 3;
      out.set(positions.subarray(from, from + 3), dst * 9 + v * 3);
    }
  });
  return out;
}

test('Jacobi eigen-decomposition reconstructs a symmetric matrix', () => {
  const A = [[4, 1, -2, 0.5], [1, 3, 0, 1], [-2, 0, 5, 2], [0.5, 1, 2, 1]];
  const { values, vectors } = M.jacobiEigen(A);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += vectors[k][i] * values[k] * vectors[k][j];
      near(sum, A[i][j], 1e-10, `A[${i}][${j}]`);
    }
  }
  assert.ok(values[0] >= values[1] && values[1] >= values[2] && values[2] >= values[3]);
});

test('Euler angles round-trip', () => {
  for (const [x, y, z] of [[3, -1.5, 4.5], [-40, 25, 170], [0, 0, 0], [10, 89, -20]]) {
    const e = M.eulerXYZ(M.rotationFromEuler(x, y, z));
    const back = M.rotationFromEuler(e.x, e.y, e.z);
    near(M.rotationDifference(back, M.rotationFromEuler(x, y, z)), 0, 1e-5, `angles ${x},${y},${z}`);
  }
  const e = M.eulerXYZ(M.rotationFromEuler(3, -1.5, 4.5));
  near(e.x, 3, 1e-9, 'x');
  near(e.y, -1.5, 1e-9, 'y');
  near(e.z, 4.5, 1e-9, 'z');
});

test('best-fit transform recovers a known rigid motion', () => {
  const P = makeSampleBracket();
  const R = M.rotationFromEuler(20, -35, 60);
  const t = [5, -3, 12];
  const fit = M.bestFitTransform(P, M.applyTransform(R, t, P));
  near(M.rotationDifference(fit.R, R), 0, 1e-6, 'rotation');
  t.forEach((v, k) => near(fit.t[k], v, 1e-9, `t${k}`));
  near(M.det3(fit.R), 1, 1e-12, 'det');
});

test('same mesh, same vertex order: exact deviation', () => {
  const { reference, placed, expected } = makeSampleCase();
  const reg = M.register(reference, placed);
  assert.equal(reg.method, 'vertex');
  assert.deepEqual(reg.warnings, []);
  const dev = M.computeDeviation(reg.R, reg.t, M.surfaceCentroid(reference));
  checkDeviation(dev, expected, 1e-9, 1e-7);
  near(dev.distance, Math.hypot(...expected.delta), 1e-9, '3D distance');
});

test('round trip through binary STL (float32) keeps micron accuracy', () => {
  const { reference, placed, expected } = makeSampleCase();
  const ref = parseSTL(writeBinarySTL(reference));
  const plc = parseSTL(writeBinarySTL(placed));
  assert.equal(ref.format, 'binary');
  assert.equal(ref.triangleCount, reference.length / 9);
  const reg = M.register(ref.positions, plc.positions);
  const dev = M.computeDeviation(reg.R, reg.t, M.surfaceCentroid(ref.positions));
  checkDeviation(dev, expected, 1e-4, 1e-3);
});

test('shuffled triangles: surface matching finds the same deviation', () => {
  const { reference, placed, expected } = makeSampleCase();
  const reg = M.register(reference, shuffleTriangles(placed, 7));
  assert.equal(reg.method, 'icp');
  assert.ok(reg.rms < 1e-6, `rms ${reg.rms}`);
  const dev = M.computeDeviation(reg.R, reg.t, M.surfaceCentroid(reference));
  checkDeviation(dev, expected, 1e-5, 1e-4);
});

test('shuffled triangles with a large rotation are still registered', () => {
  const reference = makeSampleBracket();
  const R = M.rotationFromEuler(-70, 40, 135);
  const t = [30, -12, 4];
  const placed = shuffleTriangles(M.applyTransform(R, t, reference), 3);
  const reg = M.register(reference, placed);
  near(M.rotationDifference(reg.R, R), 0, 1e-4, 'rotation error (deg)');
  t.forEach((v, k) => near(reg.t[k], v, 1e-5, `t${k}`));
});

test('ASCII STL is parsed', () => {
  const text = [
    'solid bracket',
    'facet normal 0 0 1',
    ' outer loop',
    '  vertex 0 0 0',
    '  vertex 1.5 0 0',
    '  vertex 0 2.5e0 -1E-1',
    ' endloop',
    'endfacet',
    'endsolid bracket',
  ].join('\n');
  const stl = parseSTL(new TextEncoder().encode(text).buffer);
  assert.equal(stl.format, 'ascii');
  assert.equal(stl.triangleCount, 1);
  assert.deepEqual(Array.from(stl.positions), [0, 0, 0, 1.5, 0, 0, 0, 2.5, -0.1]);
});

test('deviation depends on the chosen reference point, rotation does not', () => {
  const { reference, placed } = makeSampleCase();
  const reg = M.register(reference, placed);
  const a = M.computeDeviation(reg.R, reg.t, M.surfaceCentroid(reference));
  const b = M.computeDeviation(reg.R, reg.t, M.boundingBox(reference).min);
  assert.notDeepEqual(a.delta, b.delta);
  assert.deepEqual(a.rotation, b.rotation);
});
