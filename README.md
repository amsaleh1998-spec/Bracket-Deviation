# Bracket Deviation

Measures how far a placed orthodontic bracket deviates from its planned
(reference) position. Load two STL files of the same bracket: the reference
position from the planning software and the placed position. The app reports:

- **Linear deviation** ΔX, ΔY, ΔZ (mm) and the 3D distance, measured at the
  bracket centroid, its bounding-box center or a point you enter
- **Angular deviation** about X, Y and Z (degrees) and the total rotation angle
- The fit error, so you can see how well the two meshes matched
- A 3D overlay of both brackets

Everything runs in the browser. The STL files are never uploaded anywhere.

## Running it

Open `index.html` in Chrome, Edge, Firefox or Safari (double-clicking works).
The 3D view loads three.js from a CDN, so it needs an internet connection; the
numbers work offline.

`samples/` has a reference and a placed bracket with a known deviation
(+0.21, −0.34, +0.12 mm; +3.0°, −1.5°, +4.5° at the centroid) to try it with.

## How the deviation is computed

1. Both STLs are read (binary or ASCII).
2. The rigid transform `placed = R · reference + t` is found:
   - If both files list the same triangles in the same order (the usual case
     when the planning software exports the same bracket model at two
     positions), vertices correspond one to one and a least-squares fit
     (Horn's quaternion method) gives the exact transform.
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

All values are placed minus reference, in the coordinate system of the
planning software (assumed millimetres).

### Reading the angles clinically

If the software's axes line up with the tooth (X mesiodistal, Y
occlusogingival, Z buccolingual), rotation about X is torque, about Y is
in/out rotation, and about Z is tip. With arch-wide axes this holds only
roughly, and less so for teeth far from the midline.

## Development

```
npm test          # registration, STL and Euler-angle tests (Node 18+)
npm run samples   # regenerate samples/*.stl
```

| File | Purpose |
| --- | --- |
| `src/registration.js` | Rigid fit, ICP, k-d tree, Euler angles, deviation |
| `src/stl.js` | STL reader and writer |
| `src/sample.js` | Generated example bracket |
| `src/viewer.js` | three.js overlay |
| `src/app.js` | Page logic |
