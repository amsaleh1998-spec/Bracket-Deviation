/* Page wiring: file loading, registration, report and 3D view. */
(function () {
  'use strict';

  const M = window.BracketMath;
  const $ = (id) => document.getElementById(id);
  const SLOTS = ['reference', 'placed', 'model'];

  const state = {
    reference: null, // { name, positions, triangleCount, format }
    placed: null,
    model: null, // the bracket in its own coordinates (optional)
    example: false,
    registration: null, // reference -> placed
    frame: null, // model -> reference: the reference bracket's own axes
    deviation: null, // as displayed (software or bracket axes)
    useBracketAxesNext: false,
  };

  const AXIS_LABELS = {
    software: { lin: ['ΔX', 'ΔY', 'ΔZ'], ang: ['about X', 'about Y', 'about Z'] },
    bracket: {
      lin: ['ΔX mesiodistal', 'ΔY occlusogingival', 'ΔZ buccolingual'],
      ang: ['about X · torque', 'about Y · rotation', 'about Z · tip'],
    },
  };

  const viewer = window.BracketViewer.createViewer($('viewer'));
  if (!viewer) $('viewer-offline').hidden = false;

  // ---------------------------------------------------------------------------
  // Loading files
  // ---------------------------------------------------------------------------

  function setupSlot(slot) {
    const zone = $(`${slot}-zone`);
    const input = $(`${slot}-file`);
    input.addEventListener('change', () => {
      if (input.files[0]) loadFile(slot, input.files[0]);
      input.value = '';
    });
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('dragging');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragging'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragging');
      const file = e.dataTransfer.files[0];
      if (file) loadFile(slot, file);
    });
  }

  function loadFile(slot, file) {
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try {
        parsed = window.BracketSTL.parseSTL(reader.result);
      } catch (err) {
        showSlotError(slot, `${file.name}: ${err.message}`);
        return;
      }
      if (state.example) {
        // The first real file replaces the example in every slot.
        state.example = false;
        SLOTS.forEach((s) => (state[s] = null));
        $('example-note').hidden = true;
        if (viewer) viewer.resetFraming();
      }
      state[slot] = Object.assign({ name: file.name }, parsed);
      if (slot === 'model') state.useBracketAxesNext = true;
      update();
    };
    reader.onerror = () => showSlotError(slot, `${file.name} could not be read.`);
    reader.readAsArrayBuffer(file);
  }

  function showSlotError(slot, message) {
    const el = $(`${slot}-error`);
    el.textContent = message;
    el.hidden = false;
  }

  function renderSlot(slot) {
    const data = state[slot];
    $(`${slot}-error`).hidden = true;
    $(`${slot}-name`).textContent = data ? data.name : 'No file loaded';
    $(`${slot}-meta`).textContent = data
      ? `${data.triangleCount.toLocaleString()} triangles · ${data.format === 'ascii' ? 'ASCII' : 'binary'} STL`
      : $(`${slot}-meta`).dataset.empty;
    $(`${slot}-zone`).classList.toggle('loaded', !!data);
  }

  // ---------------------------------------------------------------------------
  // Computing
  // ---------------------------------------------------------------------------

  function update() {
    SLOTS.forEach(renderSlot);
    $('model-clear').hidden = !state.model;
    state.registration = null;
    state.frame = null;
    $('status').hidden = false;
    $('status').textContent = 'Matching the brackets…';
    // let the status paint before the (blocking) computation
    setTimeout(() => {
      try {
        if (state.reference && state.placed) {
          state.registration = M.register(state.reference.positions, state.placed.positions);
        }
        if (state.model && state.reference) {
          state.frame = M.register(state.model.positions, state.reference.positions);
        }
      } catch (err) {
        $('status').textContent = `The brackets could not be matched: ${err.message}`;
        return;
      }
      $('status').hidden = true;
      if (state.frame && state.useBracketAxesNext) {
        state.useBracketAxesNext = false;
        $('axes-bracket').checked = true;
        $('point-origin').checked = true;
        $('point-x').value = '';
      }
      onOptionsChange();
    }, 30);
  }

  const axesMode = () => (state.frame && $('axes-bracket').checked ? 'bracket' : 'software');
  const pointMode = () => document.querySelector('input[name="point"]:checked').value;

  // Bracket coordinates -> software coordinates and back.
  const toSoftware = (p) => M.matVec(state.frame.R, p).map((v, k) => v + state.frame.t[k]);
  const toBracket = (p) => M.matVec(M.transpose(state.frame.R), p.map((v, k) => v - state.frame.t[k]));

  // The chosen point on the reference bracket, in software coordinates.
  function referencePoint() {
    const mode = pointMode();
    const ref = state.reference.positions;
    if (mode === 'centroid') return M.surfaceCentroid(ref);
    if (mode === 'bbox') return M.boundingBox(ref).center;
    if (mode === 'origin') return state.frame.t.slice();
    const p = ['x', 'y', 'z'].map((a) => parseFloat($(`point-${a}`).value) || 0);
    return axesMode() === 'bracket' ? toSoftware(p) : p;
  }

  let customAxes = 'software'; // the axes the custom point's numbers are in

  function onOptionsChange() {
    // Bracket-axes options need the bracket model.
    $('axes-bracket').disabled = !state.frame;
    $('point-origin').disabled = !state.frame;
    if (!state.frame) {
      $('axes-software').checked = true;
      if ($('point-origin').checked) $('point-centroid').checked = true;
    }
    const axes = axesMode();
    const custom = pointMode() === 'custom';
    $('custom-point').hidden = !custom;
    if (custom && state.reference) {
      if (customAxes !== axes && $('point-x').value !== '') {
        if (state.frame) {
          // keep the same physical point when switching axes
          const p = ['x', 'y', 'z'].map((a) => parseFloat($(`point-${a}`).value) || 0);
          writeCustom(axes === 'bracket' ? toBracket(p) : toSoftware(p));
        } else {
          $('point-x').value = ''; // bracket coordinates mean nothing without the model
        }
      }
      if ($('point-x').value === '') {
        const c = M.surfaceCentroid(state.reference.positions);
        writeCustom(axes === 'bracket' ? toBracket(c) : c);
      }
    }
    customAxes = axes;
    $('custom-axes').textContent = axes === 'bracket' ? 'in bracket coordinates' : 'in software coordinates';
    showReport();
  }

  function writeCustom(p) {
    ['x', 'y', 'z'].forEach((a, k) => ($(`point-${a}`).value = p[k].toFixed(4)));
  }

  // ---------------------------------------------------------------------------
  // Report
  // ---------------------------------------------------------------------------

  const fmt = (v, digits) => {
    const s = (Math.abs(v) < 0.5 * Math.pow(10, -digits) ? 0 : v).toFixed(digits);
    if (s === (0).toFixed(digits)) return s;
    return v > 0 ? '+' + s : '−' + s.slice(1);
  };
  const coords = (p) => p.map((v) => v.toFixed(3)).join(', ');
  const fitText = (r) =>
    `${r.rms.toFixed(4)} mm RMS, ${r.maxError.toFixed(4)} max (${r.method === 'vertex' ? 'by vertices' : 'by surface'})`;

  function listItem(text) {
    const li = document.createElement('li');
    li.textContent = text;
    return li;
  }

  function showReport() {
    const reg = state.registration;
    const axes = axesMode();
    const labels = AXIS_LABELS[axes];
    ['dx', 'dy', 'dz'].forEach((id, k) => ($(`lab-${id}`).textContent = labels.lin[k]));
    ['rx', 'ry', 'rz'].forEach((id, k) => ($(`lab-${id}`).textContent = labels.ang[k]));
    $('report-axes').textContent = axes === 'bracket' ? "along the bracket's own axes" : "along the planning software's axes";
    $('point-from-label').textContent = axes === 'bracket' ? 'Point, bracket coords' : 'Point, reference';
    $('point-to-label').textContent = axes === 'bracket' ? 'Moved to, bracket coords' : 'Point, placed';
    $('model-fit-row').hidden = !state.frame;
    $('model-fit').textContent = state.frame ? fitText(state.frame) : '';
    $('report').classList.toggle('empty', !reg);

    if (!reg) {
      state.deviation = null;
      $('report-hint').textContent = !state.reference
        ? 'Load the reference bracket STL.'
        : !state.placed
        ? 'Load the placed bracket STL.'
        : 'Matching the brackets…';
      ['dx', 'dy', 'dz', 'd3', 'rx', 'ry', 'rz', 'ra'].forEach((id) => ($(id).textContent = '—'));
      ['fit-rms', 'point-from', 'point-to', 'axis'].forEach((id) => ($(id).textContent = '—'));
      $('matrix').textContent = '';
      $('warnings').replaceChildren();
      drawViewer(null);
      return;
    }

    const point = referencePoint();
    const global = M.computeDeviation(reg.R, reg.t, point);
    const dev = axes === 'bracket' ? M.computeDeviationInFrame(reg.R, reg.t, point, state.frame) : global;
    state.deviation = dev;
    $('dx').textContent = fmt(dev.delta[0], 3);
    $('dy').textContent = fmt(dev.delta[1], 3);
    $('dz').textContent = fmt(dev.delta[2], 3);
    $('d3').textContent = dev.distance.toFixed(3);
    $('rx').textContent = fmt(dev.rotation.x, 2);
    $('ry').textContent = fmt(dev.rotation.y, 2);
    $('rz').textContent = fmt(dev.rotation.z, 2);
    $('ra').textContent = dev.angle.toFixed(2);
    $('fit-rms').textContent = fitText(reg);
    $('point-from').textContent = coords(dev.from);
    $('point-to').textContent = coords(dev.to);
    $('axis').textContent = dev.axis.map((v) => v.toFixed(3)).join(', ');
    $('matrix').textContent = [0, 1, 2]
      .map((i) => reg.R[i].map((v) => v.toFixed(6).padStart(10)).join(' ') + '  │ ' + reg.t[i].toFixed(4).padStart(10))
      .join('\n');
    $('warnings').replaceChildren(
      ...reg.warnings.map(listItem),
      ...(state.frame ? state.frame.warnings.map((w) => listItem('Bracket model: ' + w)) : [])
    );
    drawViewer(global);
  }

  function token(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function drawViewer(global) {
    if (!viewer) return;
    const reg = state.registration;
    const ref = state.reference && state.reference.positions;
    const plc = state.placed && state.placed.positions;
    const all = ref && plc ? Float64Array.from([...M.uniqueVertices(ref), ...M.uniqueVertices(plc)]) : ref || plc;
    viewer.show({
      reference: ref,
      placed: plc,
      moved: reg && ref.length <= 3e6 ? M.applyTransform(reg.R, reg.t, ref) : null,
      guide: global && {
        from: global.from,
        to: global.to,
        axes: axesMode() === 'bracket' ? state.frame.R : M.identity3(),
      },
      bbox: all ? M.boundingBox(all) : null,
      colors: {
        reference: token('--ref'),
        placed: token('--placed'),
        fit: token('--ink'),
        ink: token('--ink'),
        x: token('--axis-x'),
        y: token('--axis-y'),
        z: token('--axis-z'),
      },
    });
    ['reference', 'placed', 'fit'].forEach((g) => viewer.setVisible(g, $(`show-${g}`).checked));
  }

  // ---------------------------------------------------------------------------
  // Copy results (tab-separated, pastes straight into a spreadsheet)
  // ---------------------------------------------------------------------------

  function resultsTable() {
    const dev = state.deviation, reg = state.registration;
    const pointLabel = document.querySelector('input[name="point"]:checked').dataset.label;
    const bracket = axesMode() === 'bracket';
    const header = [
      'Reference file', 'Placed file', 'Bracket model file', 'Axes', 'Reference point', 'Point X', 'Point Y', 'Point Z',
      'dX (mm)', 'dY (mm)', 'dZ (mm)', '3D (mm)', 'rX (deg)', 'rY (deg)', 'rZ (deg)', 'Total rotation (deg)',
      'Fit RMS (mm)', 'Method',
    ];
    const row = [
      state.reference.name, state.placed.name, state.model ? state.model.name : '',
      bracket ? 'bracket (X mesiodistal, Y occlusogingival, Z buccolingual)' : 'planning software',
      pointLabel, ...dev.from.map((v) => v.toFixed(4)),
      ...dev.delta.map((v) => v.toFixed(4)), dev.distance.toFixed(4),
      dev.rotation.x.toFixed(3), dev.rotation.y.toFixed(3), dev.rotation.z.toFixed(3), dev.angle.toFixed(3),
      reg.rms.toFixed(5), reg.method === 'vertex' ? 'vertex correspondence' : 'ICP',
    ];
    return header.join('\t') + '\n' + row.join('\t');
  }

  $('copy').addEventListener('click', () => {
    if (!state.deviation) return;
    const text = resultsTable();
    const done = (msg) => {
      $('copy-status').textContent = msg;
      setTimeout(() => ($('copy-status').textContent = ''), 2500);
    };
    const fallback = () => {
      const box = $('copy-fallback');
      box.hidden = false;
      box.value = text;
      box.select();
      done('Press Ctrl+C (⌘C on Mac) to copy the selected text.');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => done('Copied. Paste into Excel or Sheets.'), fallback);
    } else fallback();
  });

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------

  SLOTS.forEach(setupSlot);
  $('model-clear').addEventListener('click', (e) => {
    e.preventDefault();
    state.model = null;
    update();
  });
  document
    .querySelectorAll('input[name="point"], input[name="axes"]')
    .forEach((r) => r.addEventListener('change', onOptionsChange));
  ['x', 'y', 'z'].forEach((a) => $(`point-${a}`).addEventListener('input', showReport));
  ['reference', 'placed', 'fit'].forEach((g) =>
    $(`show-${g}`).addEventListener('change', (e) => viewer && viewer.setVisible(g, e.target.checked))
  );
  $('reframe').addEventListener('click', () => {
    if (!viewer || (!state.reference && !state.placed)) return;
    const pts = [state.reference, state.placed].filter(Boolean).map((s) => M.uniqueVertices(s.positions));
    viewer.reframe(M.boundingBox(Float64Array.from(pts.flatMap((p) => Array.from(p)))));
  });
  const redraw = () => showReport();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw);
  new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // Open on an example so the report shows what it measures.
  const example = window.BracketSample.makeSampleCase();
  const asFile = (name, positions) => ({ name, positions, triangleCount: positions.length / 9, format: 'binary' });
  state.example = true;
  state.reference = asFile('example_reference.stl', example.reference);
  state.placed = asFile('example_placed.stl', example.placed);
  state.model = asFile('example_bracket_model.stl', example.local);
  update();
})();
