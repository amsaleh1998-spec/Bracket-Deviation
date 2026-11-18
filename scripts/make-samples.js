// Writes samples/reference_bracket.stl and samples/placed_bracket.stl (the same
// bracket before and after a known deviation) and samples/bracket_model.stl
// (the bracket in its own coordinates), for trying the app.
const fs = require('fs');
const path = require('path');
const { writeBinarySTL } = require('../src/stl.js');
const { makeSampleCase } = require('../src/sample.js');

const { local, reference, placed, expected } = makeSampleCase();
const dir = path.join(__dirname, '..', 'samples');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'reference_bracket.stl'), Buffer.from(writeBinarySTL(reference, 'reference bracket')));
fs.writeFileSync(path.join(dir, 'placed_bracket.stl'), Buffer.from(writeBinarySTL(placed, 'placed bracket')));
fs.writeFileSync(path.join(dir, 'bracket_model.stl'), Buffer.from(writeBinarySTL(local, 'bracket model, own coordinates')));
console.log('Expected deviation at the bracket centroid, in software axes:');
console.log(`  dX ${expected.delta[0]} mm, dY ${expected.delta[1]} mm, dZ ${expected.delta[2]} mm`);
console.log(`  rX ${expected.rotation.x} deg, rY ${expected.rotation.y} deg, rZ ${expected.rotation.z} deg`);
