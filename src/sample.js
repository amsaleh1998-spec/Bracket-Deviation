/*
 * A simplified twin-wing bracket built from boxes, used for the demo that the
 * app opens with, for the sample STL files and for the tests.
 * Local axes: X mesiodistal, Y occlusogingival, Z buccolingual (pad at Z = 0).
 *
 * Works in the browser (global `BracketSample`) and in Node (require).
 */
(function (root, factory) {
  const api = factory(root.BracketMath || (typeof require === 'function' ? require('./registration.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BracketSample = api;
})(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';

  // Axis-aligned box with each face split into an n x n grid, outward-facing triangles.
  function box(out, min, max, n) {
    for (let a = 0; a < 3; a++) {
      const b = (a + 1) % 3, c = (a + 2) % 3;
      for (const side of [0, 1]) {
        const corner = [min[0], min[1], min[2]];
        corner[a] = side ? max[a] : min[a];
        let u = [0, 0, 0], v = [0, 0, 0];
        u[b] = max[b] - min[b];
        v[c] = max[c] - min[c];
        if (!side) [u, v] = [v, u];
        const p = (i, j) => [0, 1, 2].map((k) => corner[k] + (i / n) * u[k] + (j / n) * v[k]);
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            out.push(...p(i, j), ...p(i + 1, j), ...p(i + 1, j + 1));
            out.push(...p(i, j), ...p(i + 1, j + 1), ...p(i, j + 1));
          }
        }
      }
    }
  }

  function makeSampleBracket() {
    const out = [];
    box(out, [-1.8, -1.5, 0], [1.8, 1.5, 0.3], 6); // bonding pad
    box(out, [-1.2, -1.0, 0.3], [1.2, -0.28, 1.5], 4); // occlusal body
    box(out, [-1.2, 0.28, 0.3], [1.2, 1.0, 1.5], 4); // gingival body
    box(out, [-1.2, -0.28, 0.3], [1.2, 0.28, 0.8], 4); // slot floor (0.022" slot)
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const x = sx > 0 ? [0.6, 1.4] : [-1.4, -0.6];
        const y = sy > 0 ? [1.0, 1.45] : [-1.45, -1.0];
        box(out, [x[0], y[0], 0.9], [x[1], y[1], 1.5], 3); // tie wing
      }
    }
    box(out, [0.95, 1.45, 1.2], [1.35, 1.65, 1.5], 2); // distogingival ID mark
    return Float64Array.from(out);
  }

  // A reference bracket somewhere on the arch, and the same bracket after a
  // known deviation about its centroid.
  function makeSampleCase() {
    const local = makeSampleBracket();
    const reference = M.applyTransform(M.rotationFromEuler(8, -5, 32), [-12.4, 18.7, 6.3], local);
    const expected = { delta: [0.21, -0.34, 0.12], rotation: { x: 3.0, y: -1.5, z: 4.5 } };
    const c = M.surfaceCentroid(reference);
    const R = M.rotationFromEuler(expected.rotation.x, expected.rotation.y, expected.rotation.z);
    const Rc = M.matVec(R, c);
    const t = [0, 1, 2].map((k) => c[k] + expected.delta[k] - Rc[k]);
    const placed = M.applyTransform(R, t, reference);
    return { reference, placed, expected };
  }

  return { makeSampleBracket, makeSampleCase };
});
