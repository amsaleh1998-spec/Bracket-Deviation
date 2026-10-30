/*
 * Rigid registration of two copies of the same bracket mesh, and the
 * deviation report (linear X/Y/Z, angular X/Y/Z) derived from it.
 *
 * Convention used throughout:
 *   placed = R · reference + t
 * Matrices are 3x3 arrays of rows. Point sets are flat Float64Arrays
 * [x0, y0, z0, x1, y1, z1, ...].
 *
 * Works in the browser (global `BracketMath`) and in Node (require).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BracketMath = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEG = 180 / Math.PI;

  // ---------------------------------------------------------------------------
  // Small linear algebra helpers
  // ---------------------------------------------------------------------------

  function identity3() {
    return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  }

  function matMul(A, B) {
    const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        C[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
      }
    }
    return C;
  }

  function transpose(A) {
    return [[A[0][0], A[1][0], A[2][0]], [A[0][1], A[1][1], A[2][1]], [A[0][2], A[1][2], A[2][2]]];
  }

  function matVec(A, v) {
    return [
      A[0][0] * v[0] + A[0][1] * v[1] + A[0][2] * v[2],
      A[1][0] * v[0] + A[1][1] * v[1] + A[1][2] * v[2],
      A[2][0] * v[0] + A[2][1] * v[1] + A[2][2] * v[2],
    ];
  }

  function det3(A) {
    return (
      A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) -
      A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) +
      A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0])
    );
  }

  // Eigen-decomposition of a symmetric n x n matrix (cyclic Jacobi).
  // Returns eigenvalues in descending order; vectors[k] is the k-th eigenvector.
  function jacobiEigen(M) {
    const n = M.length;
    const a = M.map((row) => row.slice());
    const V = [];
    for (let i = 0; i < n; i++) {
      V.push(new Array(n).fill(0));
      V[i][i] = 1;
    }
    for (let sweep = 0; sweep < 100; sweep++) {
      let off = 0;
      for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
      if (off < 1e-30) break;
      for (let p = 0; p < n; p++) {
        for (let q = p + 1; q < n; q++) {
          if (a[p][q] === 0) continue;
          const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
          const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
          const c = 1 / Math.sqrt(t * t + 1);
          const s = t * c;
          for (let k = 0; k < n; k++) {
            const akp = a[k][p], akq = a[k][q];
            a[k][p] = c * akp - s * akq;
            a[k][q] = s * akp + c * akq;
          }
          for (let k = 0; k < n; k++) {
            const apk = a[p][k], aqk = a[q][k];
            a[p][k] = c * apk - s * aqk;
            a[q][k] = s * apk + c * aqk;
          }
          for (let k = 0; k < n; k++) {
            const vkp = V[k][p], vkq = V[k][q];
            V[k][p] = c * vkp - s * vkq;
            V[k][q] = s * vkp + c * vkq;
          }
        }
      }
    }
    const order = [];
    for (let i = 0; i < n; i++) order.push(i);
    order.sort((i, j) => a[j][j] - a[i][i]);
    return {
      values: order.map((i) => a[i][i]),
      vectors: order.map((i) => V.map((row) => row[i])),
    };
  }

  // ---------------------------------------------------------------------------
  // Mesh helpers
  // ---------------------------------------------------------------------------

  // STL repeats every shared vertex once per triangle; collapse duplicates.
  function uniqueVertices(positions) {
    const seen = new Map();
    const out = [];
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i], y = positions[i + 1], z = positions[i + 2];
      const key = Math.round(x * 1e5) + ',' + Math.round(y * 1e5) + ',' + Math.round(z * 1e5);
      if (!seen.has(key)) {
        seen.set(key, true);
        out.push(x, y, z);
      }
    }
    return Float64Array.from(out);
  }

  function boundingBox(points) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < points.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (points[i + k] < min[k]) min[k] = points[i + k];
        if (points[i + k] > max[k]) max[k] = points[i + k];
      }
    }
    const center = [0, 1, 2].map((k) => (min[k] + max[k]) / 2);
    const diagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    return { min, max, center, diagonal };
  }

  // Area-weighted centroid of the triangle surface (independent of how
  // finely the surface is tessellated).
  function surfaceCentroid(positions) {
    let area = 0;
    const c = [0, 0, 0];
    for (let i = 0; i < positions.length; i += 9) {
      const ux = positions[i + 3] - positions[i], uy = positions[i + 4] - positions[i + 1], uz = positions[i + 5] - positions[i + 2];
      const vx = positions[i + 6] - positions[i], vy = positions[i + 7] - positions[i + 1], vz = positions[i + 8] - positions[i + 2];
      const a = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
      area += a;
      for (let k = 0; k < 3; k++) c[k] += (a * (positions[i + k] + positions[i + 3 + k] + positions[i + 6 + k])) / 3;
    }
    if (area === 0) return mean(positions);
    return c.map((v) => v / area);
  }

  function mean(points) {
    const n = points.length / 3;
    const c = [0, 0, 0];
    for (let i = 0; i < points.length; i += 3) {
      c[0] += points[i];
      c[1] += points[i + 1];
      c[2] += points[i + 2];
    }
    return c.map((v) => v / n);
  }

  // Centroid and principal axes (as columns of a proper rotation matrix).
  function principalFrame(points) {
    const c = mean(points);
    const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < points.length; i += 3) {
      const d = [points[i] - c[0], points[i + 1] - c[1], points[i + 2] - c[2]];
      for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) C[r][s] += d[r] * d[s];
    }
    const { values, vectors } = jacobiEigen(C);
    let E = transpose(vectors); // columns = eigenvectors
    if (det3(E) < 0) E = E.map((row) => [row[0], row[1], -row[2]]);
    return { centroid: c, axes: E, values };
  }

  function applyTransform(R, t, points, out) {
    out = out || new Float64Array(points.length);
    for (let i = 0; i < points.length; i += 3) {
      const x = points[i], y = points[i + 1], z = points[i + 2];
      out[i] = R[0][0] * x + R[0][1] * y + R[0][2] * z + t[0];
      out[i + 1] = R[1][0] * x + R[1][1] * y + R[1][2] * z + t[1];
      out[i + 2] = R[2][0] * x + R[2][1] * y + R[2][2] * z + t[2];
    }
    return out;
  }

  // Every n-th point, so at most maxCount points remain.
  function subsample(points, maxCount) {
    const n = points.length / 3;
    if (n <= maxCount) return points;
    const step = n / maxCount;
    const out = new Float64Array(maxCount * 3);
    for (let k = 0; k < maxCount; k++) {
      const i = Math.floor(k * step) * 3;
      out[3 * k] = points[i];
      out[3 * k + 1] = points[i + 1];
      out[3 * k + 2] = points[i + 2];
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Least-squares rigid transform between corresponding points (Horn 1987)
  // Finds R, t minimising sum |R·P_i + t − Q_i|².
  // ---------------------------------------------------------------------------

  function bestFitTransform(P, Q) {
    const cp = mean(P);
    const cq = mean(Q);
    let Sxx = 0, Sxy = 0, Sxz = 0, Syx = 0, Syy = 0, Syz = 0, Szx = 0, Szy = 0, Szz = 0;
    for (let i = 0; i < P.length; i += 3) {
      const px = P[i] - cp[0], py = P[i + 1] - cp[1], pz = P[i + 2] - cp[2];
      const qx = Q[i] - cq[0], qy = Q[i + 1] - cq[1], qz = Q[i + 2] - cq[2];
      Sxx += px * qx; Sxy += px * qy; Sxz += px * qz;
      Syx += py * qx; Syy += py * qy; Syz += py * qz;
      Szx += pz * qx; Szy += pz * qy; Szz += pz * qz;
    }
    const N = [
      [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
      [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
      [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
      [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
    ];
    const [w, x, y, z] = jacobiEigen(N).vectors[0];
    const R = [
      [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
      [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
      [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
    ];
    const Rcp = matVec(R, cp);
    return { R, t: [cq[0] - Rcp[0], cq[1] - Rcp[1], cq[2] - Rcp[2]] };
  }

  // ---------------------------------------------------------------------------
  // k-d tree for nearest-neighbour queries (implicit, built in place)
  // ---------------------------------------------------------------------------

  function KdTree(points) {
    this.pts = points;
    this.n = points.length / 3;
    this.idx = new Int32Array(this.n);
    for (let i = 0; i < this.n; i++) this.idx[i] = i;
    this._build(0, this.n, 0);
  }

  KdTree.prototype._build = function (lo, hi, depth) {
    if (hi - lo <= 1) return;
    const axis = depth % 3;
    const pts = this.pts;
    const sub = Array.from(this.idx.subarray(lo, hi));
    sub.sort((a, b) => pts[3 * a + axis] - pts[3 * b + axis]);
    this.idx.set(sub, lo);
    const mid = (lo + hi) >> 1;
    this._build(lo, mid, depth + 1);
    this._build(mid + 1, hi, depth + 1);
  };

  // Returns the index of the nearest point; squared distance in this.bestD.
  KdTree.prototype.nearest = function (x, y, z) {
    this.bestD = Infinity;
    this.bestI = -1;
    this._search(0, this.n, 0, x, y, z);
    return this.bestI;
  };

  KdTree.prototype._search = function (lo, hi, depth, x, y, z) {
    if (lo >= hi) return;
    const mid = (lo + hi) >> 1;
    const i = this.idx[mid];
    const p = this.pts;
    const dx = x - p[3 * i], dy = y - p[3 * i + 1], dz = z - p[3 * i + 2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < this.bestD) {
      this.bestD = d2;
      this.bestI = i;
    }
    const axis = depth % 3;
    const diff = axis === 0 ? dx : axis === 1 ? dy : dz;
    if (diff < 0) {
      this._search(lo, mid, depth + 1, x, y, z);
      if (diff * diff < this.bestD) this._search(mid + 1, hi, depth + 1, x, y, z);
    } else {
      this._search(mid + 1, hi, depth + 1, x, y, z);
      if (diff * diff < this.bestD) this._search(lo, mid, depth + 1, x, y, z);
    }
  };

  // ---------------------------------------------------------------------------
  // Iterative closest point
  // ---------------------------------------------------------------------------

  // Distance from each transformed source point to the nearest target point.
  function residuals(R, t, src, tree) {
    const moved = applyTransform(R, t, src);
    let sum = 0, max = 0;
    for (let i = 0; i < moved.length; i += 3) {
      tree.nearest(moved[i], moved[i + 1], moved[i + 2]);
      sum += tree.bestD;
      if (tree.bestD > max) max = tree.bestD;
    }
    return { rms: Math.sqrt(sum / (src.length / 3)), max: Math.sqrt(max) };
  }

  function icp(src, tree, R, t, maxIter) {
    const moved = new Float64Array(src.length);
    const matched = new Float64Array(src.length);
    const tgt = tree.pts;
    let prev = Infinity;
    let iterations = 0;
    for (; iterations < maxIter; iterations++) {
      applyTransform(R, t, src, moved);
      let sum = 0;
      for (let i = 0; i < moved.length; i += 3) {
        const j = tree.nearest(moved[i], moved[i + 1], moved[i + 2]);
        sum += tree.bestD;
        matched[i] = tgt[3 * j];
        matched[i + 1] = tgt[3 * j + 1];
        matched[i + 2] = tgt[3 * j + 2];
      }
      const rms = Math.sqrt(sum / (src.length / 3));
      const fit = bestFitTransform(src, matched);
      R = fit.R;
      t = fit.t;
      if (rms < 1e-9 || prev - rms < 1e-10) break;
      prev = rms;
    }
    return { R, t, rms: residuals(R, t, src, tree).rms, iterations };
  }

  // Angle (degrees) of the rotation that takes R1 to R2.
  function rotationDifference(R1, R2) {
    return axisAngle(matMul(transpose(R1), R2)).angle;
  }

  // ---------------------------------------------------------------------------
  // Registration: find R, t with placed ≈ R · reference + t
  // ---------------------------------------------------------------------------

  function register(refPositions, placedPositions) {
    const warnings = [];
    const scale = boundingBox(refPositions).diagonal || 1;

    // 1. Same triangles in the same order: vertices correspond one-to-one and
    //    a single least-squares fit gives the exact transform.
    if (refPositions.length === placedPositions.length) {
      const fit = bestFitTransform(refPositions, placedPositions);
      const moved = applyTransform(fit.R, fit.t, refPositions);
      let sum = 0, max = 0;
      for (let i = 0; i < moved.length; i += 3) {
        const d2 =
          (moved[i] - placedPositions[i]) ** 2 +
          (moved[i + 1] - placedPositions[i + 1]) ** 2 +
          (moved[i + 2] - placedPositions[i + 2]) ** 2;
        sum += d2;
        if (d2 > max) max = d2;
      }
      const rms = Math.sqrt(sum / (moved.length / 3));
      if (rms <= 0.01 * scale) {
        return { R: fit.R, t: fit.t, rms, maxError: Math.sqrt(max), method: 'vertex', warnings };
      }
    }

    // 2. Otherwise match the surfaces with ICP, started from several poses:
    //    centroids aligned with no rotation, and the four ways of lining up
    //    the principal axes of the two meshes.
    const A = uniqueVertices(refPositions);
    const B = uniqueVertices(placedPositions);
    const countA = A.length / 3, countB = B.length / 3;
    if (Math.abs(countA - countB) > 0.01 * Math.max(countA, countB)) {
      warnings.push(
        `The two files have different vertex counts (${countA} vs ${countB}). ` +
          'Check that both are the same bracket model; the result is a best surface fit.'
      );
    }
    const tree = new KdTree(B);
    const fa = principalFrame(A);
    const fb = principalFrame(B);

    const starts = [{ R: identity3(), t: fb.centroid.map((v, k) => v - fa.centroid[k]) }];
    const flips = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
    for (const f of flips) {
      const Eb = fb.axes.map((row) => [row[0] * f[0], row[1] * f[1], row[2] * f[2]]);
      const R = matMul(Eb, transpose(fa.axes));
      const Rc = matVec(R, fa.centroid);
      starts.push({ R, t: fb.centroid.map((v, k) => v - Rc[k]) });
    }

    const coarse = subsample(A, 1500);
    const rough = starts.map((s) => icp(coarse, tree, s.R, s.t, 60)).sort((a, b) => a.rms - b.rms);

    // Refine the distinct coarse solutions on every vertex.
    const distinct = [];
    for (const r of rough) {
      if (distinct.every((d) => rotationDifference(d.R, r.R) > 2)) distinct.push(r);
    }
    const fine = distinct.slice(0, 3).map((r) => icp(A, tree, r.R, r.t, 200)).sort((a, b) => a.rms - b.rms);
    // A near-symmetric bracket can fit equally well in more than one
    // orientation. Placement errors are small, so prefer the smallest rotation.
    const tolerance = 3 * fine[0].rms + 0.002 * scale;
    const ties = fine.filter((f) => f.rms <= tolerance);
    const best = ties.reduce((a, b) => (axisAngle(b.R).angle < axisAngle(a.R).angle ? b : a));
    const other = ties.find((f) => f !== best && rotationDifference(best.R, f.R) > 5);
    if (other) {
      warnings.push(
        `The bracket fits almost equally well in another orientation, ${rotationDifference(best.R, other.R).toFixed(1)}° ` +
          'away (it is close to symmetric). The smaller rotation is reported. To remove the doubt, export both STLs ' +
          'from the same source mesh so their vertices correspond one to one.'
      );
    }

    const res = residuals(best.R, best.t, A, tree);
    if (res.rms > 0.005 * scale) {
      warnings.push(
        `The surfaces do not overlap closely (RMS ${res.rms.toFixed(3)}). ` +
          'The placed bracket may be a different model or a scanned surface.'
      );
    }
    return { R: best.R, t: best.t, rms: res.rms, maxError: res.max, method: 'icp', warnings };
  }

  // ---------------------------------------------------------------------------
  // Reporting
  // ---------------------------------------------------------------------------

  // R = Rz(z) · Ry(y) · Rx(x): rotate about the fixed X axis first, then the
  // fixed Y axis, then the fixed Z axis. Angles in degrees.
  function rotationFromEuler(xDeg, yDeg, zDeg) {
    const x = xDeg / DEG, y = yDeg / DEG, z = zDeg / DEG;
    const Rx = [[1, 0, 0], [0, Math.cos(x), -Math.sin(x)], [0, Math.sin(x), Math.cos(x)]];
    const Ry = [[Math.cos(y), 0, Math.sin(y)], [0, 1, 0], [-Math.sin(y), 0, Math.cos(y)]];
    const Rz = [[Math.cos(z), -Math.sin(z), 0], [Math.sin(z), Math.cos(z), 0], [0, 0, 1]];
    return matMul(Rz, matMul(Ry, Rx));
  }

  function eulerXYZ(R) {
    const sy = Math.min(1, Math.max(-1, -R[2][0]));
    const y = Math.asin(sy);
    let x, z;
    if (Math.abs(sy) < 0.999999) {
      x = Math.atan2(R[2][1], R[2][2]);
      z = Math.atan2(R[1][0], R[0][0]);
    } else {
      x = 0; // gimbal lock: only x ± z is defined
      z = Math.atan2(-R[0][1], R[1][1]);
    }
    return { x: x * DEG, y: y * DEG, z: z * DEG };
  }

  // Total rotation angle (degrees) and unit axis.
  function axisAngle(R) {
    let axis = [R[2][1] - R[1][2], R[0][2] - R[2][0], R[1][0] - R[0][1]];
    let len = Math.hypot(axis[0], axis[1], axis[2]);
    // atan2 stays accurate for small angles, where acos of the trace does not
    const angle = Math.atan2(len / 2, (R[0][0] + R[1][1] + R[2][2] - 1) / 2);
    if (len < 1e-9) {
      if (angle < 1e-6) return { angle: 0, axis: [0, 0, 1] };
      // 180°: axis from the largest column of (R + I) / 2
      const B = [0, 1, 2].map((i) => [0, 1, 2].map((j) => (R[i][j] + (i === j ? 1 : 0)) / 2));
      const k = [0, 1, 2].reduce((m, i) => (B[i][i] > B[m][m] ? i : m), 0);
      axis = [B[0][k], B[1][k], B[2][k]];
      len = Math.hypot(axis[0], axis[1], axis[2]);
    }
    return { angle: angle * DEG, axis: axis.map((v) => v / len) };
  }

  // Deviation of a point on the reference bracket and the bracket's rotation.
  function computeDeviation(R, t, point) {
    const Rp = matVec(R, point);
    const to = [Rp[0] + t[0], Rp[1] + t[1], Rp[2] + t[2]];
    const delta = [to[0] - point[0], to[1] - point[1], to[2] - point[2]];
    const aa = axisAngle(R);
    return {
      from: point.slice(),
      to,
      delta,
      distance: Math.hypot(delta[0], delta[1], delta[2]),
      rotation: eulerXYZ(R),
      angle: aa.angle,
      axis: aa.axis,
    };
  }

  return {
    identity3,
    matMul,
    matVec,
    transpose,
    det3,
    jacobiEigen,
    uniqueVertices,
    boundingBox,
    surfaceCentroid,
    principalFrame,
    applyTransform,
    bestFitTransform,
    KdTree,
    icp,
    rotationDifference,
    register,
    rotationFromEuler,
    eulerXYZ,
    axisAngle,
    computeDeviation,
  };
});
