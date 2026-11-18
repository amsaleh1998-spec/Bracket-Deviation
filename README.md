# Bracket Deviation

Measures how far a placed orthodontic bracket deviates from its planned
(reference) position. Load two STL files of the same bracket: the reference
position from the planning software and the placed position. Optionally load
a third: the bracket model in its own coordinates (the library STL). The app
reports:

- **Linear deviation** ΔX, ΔY, ΔZ (mm) and the 3D distance, measured at the
  bracket origin, centroid, bounding-box center or a point you enter
- **Angular deviation** about X, Y and Z (degrees) and the total rotation angle
- Either along the **planning software's axes**, or, with the bracket model,
  along the **bracket's own axes**: mesiodistal, occlusogingival and
  buccolingual, so the rotations read as torque, rotation and tip
- The fit error, so you can see how well the two meshes matched
- A 3D overlay of both brackets

Everything runs in the browser. The STL files are never uploaded anywhere.

## Running it

Open `index.html` in Chrome, Edge, Firefox or Safari (double-clicking works).
The 3D view loads three.js from a CDN, so it needs an internet connection; the
numbers work offline.

`samples/` has a reference and a placed bracket with a known deviation
(+0.21, −0.34, +0.12 mm; +3.0°, −1.5°, +4.5° at the centroid, in software
axes) and the bracket model in its own coordinates, to try it with.

## How the deviation is computed

1. Both STLs are read (binary or ASCII).
2. The rigid transform `placed = R · reference + t` is found:
   - If both files list the same triangles in the same order (the usual case
     when the planning software exports the same bracket model at two
     positions), vertices correspond one to one and a least-squares fit
     (Horn's quaternion method) gives the transform directly. It is exact for
     an exact export and tolerates small rounding differences between files.
   - Otherwise the surfaces are matched with ICP (iterative closest point),
     started from several initial poses. If the bracket fits almost equally
     well in two orientations (a near-symmetric bracket), the smaller rotation
     is reported and a warning is shown.
3. The deviation is read from the transform:
   - **Linear:** `R · p + t − p` for the chosen point `p` on the reference
     bracket. This depends on `p`; the rotation does not.
   - **Angular:** `R` is split into rotations about the fixed X, then Y, then Z
     axes (`R = Rz · Ry · Rx`), right-hand rule. The total rotation is the
     single equivalent angle about one axis.

All values are placed minus reference (assumed millimetres).

### Bracket axes

Planning software axes follow the arch, not the tooth. To report along the
bracket's own axes, load the bracket model: the same bracket in its own
coordinates, as in the manufacturer's library file (X along the slot, Y
occlusogingival, Z buccolingual, origin usually at the slot or bracket
center). The model is fitted onto the planned bracket the same way as above,
giving the frame `reference = F · model + o`. The deviation is then expressed
in that frame:

- linear: `Fᵀ · (R · p + t − p)`
- angular: `Fᵀ · R · F`, split into X, Y, Z as above

So rotation about X is torque, about Y is rotation, and about Z is tip, on
every tooth. Which direction counts as positive (mesial or distal, crown
labial or lingual) depends on the axis directions in the bracket file and on
the side of the arch. The 3D distance and total rotation are the same in
either set of axes.

## Development

```
npm test          # registration, STL and Euler-angle tests (Node 18+)
npm run samples   # regenerate samples/*.stl
```

| File | Purpose |
| --- | --- |
| `src/registration.js` | Rigid fit, ICP, k-d tree, Euler angles, deviation (software or bracket axes) |
| `src/stl.js` | STL reader and writer |
| `src/sample.js` | Generated example bracket |
| `src/viewer.js` | three.js overlay |
| `src/app.js` | Page logic |
