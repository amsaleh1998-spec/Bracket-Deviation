/*
 * STL reading and writing (binary and ASCII).
 * Positions are a flat Float64Array: 9 numbers (3 vertices) per triangle.
 *
 * Works in the browser (global `BracketSTL`) and in Node (require).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BracketSTL = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function parseSTL(buffer) {
    const view = new DataView(buffer);
    if (buffer.byteLength >= 84) {
      const count = view.getUint32(80, true);
      if (84 + count * 50 === buffer.byteLength) return parseBinary(view, count);
    }
    const text = new TextDecoder().decode(new Uint8Array(buffer));
    if (/^\s*solid/i.test(text) && /facet/i.test(text)) return parseASCII(text);
    if (buffer.byteLength >= 84) return parseBinary(view, Math.floor((buffer.byteLength - 84) / 50));
    throw new Error('This file is not a valid STL (it is too short to hold any triangles).');
  }

  function parseBinary(view, count) {
    const positions = new Float64Array(count * 9);
    let offset = 84;
    for (let i = 0; i < count; i++) {
      offset += 12; // skip the facet normal
      for (let k = 0; k < 9; k++) {
        positions[i * 9 + k] = view.getFloat32(offset, true);
        offset += 4;
      }
      offset += 2; // attribute byte count
    }
    if (count === 0) throw new Error('The STL file contains no triangles.');
    return { positions, triangleCount: count, format: 'binary' };
  }

  function parseASCII(text) {
    const values = [];
    const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
    let m;
    while ((m = re.exec(text))) values.push(+m[1], +m[2], +m[3]);
    const count = Math.floor(values.length / 9);
    if (count === 0) throw new Error('The STL file contains no triangles.');
    return { positions: Float64Array.from(values.slice(0, count * 9)), triangleCount: count, format: 'ascii' };
  }

  function writeBinarySTL(positions, header) {
    const count = positions.length / 9;
    const buffer = new ArrayBuffer(84 + count * 50);
    const view = new DataView(buffer);
    const label = (header || 'bracket-deviation').slice(0, 80);
    for (let i = 0; i < label.length; i++) view.setUint8(i, label.charCodeAt(i));
    view.setUint32(80, count, true);
    let offset = 84;
    for (let i = 0; i < count; i++) {
      const p = positions.subarray(i * 9, i * 9 + 9);
      const ux = p[3] - p[0], uy = p[4] - p[1], uz = p[5] - p[2];
      const vx = p[6] - p[0], vy = p[7] - p[1], vz = p[8] - p[2];
      const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      const len = Math.hypot(n[0], n[1], n[2]) || 1;
      for (let k = 0; k < 3; k++) {
        view.setFloat32(offset, n[k] / len, true);
        offset += 4;
      }
      for (let k = 0; k < 9; k++) {
        view.setFloat32(offset, p[k], true);
        offset += 4;
      }
      offset += 2;
    }
    return buffer;
  }

  return { parseSTL, writeBinarySTL };
});
