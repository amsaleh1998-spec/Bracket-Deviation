/* Page wiring: file loading, registration, report and 3D view. */
(function () {
  'use strict';

  const M = window.BracketMath;
  const $ = (id) => document.getElementById(id);

  const state = {
    reference: null, // { name, positions, triangleCount, format }
    placed: null,
    example: false,
    registration: null,
    deviation: null,
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
        // The first real file replaces the example in both slots.
        state.example = false;
        state.reference = null;
        state.placed = null;
        $('example-note').hidden = true;
        if (viewer) viewer.resetFraming();
      }
      state[slot] = Object.assign({ name: file.name }, parsed);
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
      : 'Drop an STL here or choose a file';
    $(`${slot}-zone`).classList.toggle('loaded', !!data);
  }

  // ---------------------------------------------------------------------------
  // Computing
  // ---------------------------------------------------------------------------

  function update() {
    renderSlot('reference');
    renderSlot('placed');
    state.registration = null;
    if (!state.reference || !state.placed) {
      showReport();
      return;
    }
    $('status').textContent = 'Matching the brackets…';
    $('status').hidden = false;
    // let the status paint before the (blocking) computation
    setTimeout(() => {
      try {
        state.registration = M.register(state.reference.positions, state.placed.positions);
      } catch (err) {
        $('status').textContent = `The brackets could not be matched: ${err.message}`;
        return;
      }
      $('status').hidden = true;
      onPointModeChange();
    }, 30);
  }

  function referencePoint() {
    const mode = document.querySelector('input[name="point"]:checked').value;
    const ref = state.reference.positions;
    if (mode === 'centroid') return M.surfaceCentroid(ref);
    if (mode === 'bbox') return M.boundingBox(ref).center;
    return ['x', 'y', 'z'].map((a) => parseFloat($(`point-${a}`).value) || 0);
  }

  function onPointModeChange() {
    const custom = document.querySelector('input[name="point"]:checked').value === 'custom';
    $('custom-point').hidden = !custom;
    if (custom && state.reference && $('point-x').value === '') {
      const c = M.surfaceCentroid(state.reference.positions);
      ['x', 'y', 'z'].forEach((a, k) => ($(`point-${a}`).value = c[k].toFixed(3)));
    }
    showReport();
  }

  // ---------------------------------------------------------------------------
  // Report
  // ---------------------------------------------------------------------------

  const fmt = (v, digits) => {
    const s = (Math.abs(v) < 0.5 * Math.pow(10, -digits) ? 0 : v).toFixed(digits);
    if (s === (0).toFixed(digits)) return s;
    return v > 0 ? '+' + s : '\u2212' + s.slice(1);
  };
  const coords = (p) => p.map((v) => v.toFixed(3)).join(', ');

  function showReport() {
    const reg = state.registration;
    $('report').classList.toggle('empty', !reg);
    if (!reg) {
      state.deviation = null;
      $('report-hint').textContent = !state.reference
        ? 'Load the reference bracket STL.'
        : !state.placed
        ? 'Load the placed bracket STL.'
        : 'Matching the brackets…';
      ['dx', 'dy', 'dz', 'd3', 'rx', 'ry', 'rz', 'ra'].forEach((id) => ($(id).textContent = '—'));
      $('fit-method').textContent = '—';
      $('fit-rms').textContent = '—';
      $('point-from').textContent = '—';
      $('point-to').textContent = '—';
      $('axis').textContent = '—';
      $('matrix').textContent = '';
      $('warnings').replaceChildren();
      drawViewer();
      return;
    }
    const dev = M.computeDeviation(reg.R, reg.t, referencePoint());
    state.deviation = dev;
    $('dx').textContent = fmt(dev.delta[0], 3);
    $('dy').textContent = fmt(dev.delta[1], 3);
    $('dz').textContent = fmt(dev.delta[2], 3);
    $('d3').textContent = dev.distance.toFixed(3);
    $('rx').textContent = fmt(dev.rotation.x, 2);
    $('ry').textContent = fmt(dev.rotation.y, 2);
    $('rz').textContent = fmt(dev.rotation.z, 2);
    $('ra').textContent = dev.angle.toFixed(2);
    $('fit-method').textContent = reg.method === 'vertex' ? 'Vertex correspondence' : 'Surface matching (ICP)';
    $('fit-rms').textContent = `${reg.rms.toFixed(4)} mm RMS · ${reg.maxError.toFixed(4)} mm max`;
    $('point-from').textContent = coords(dev.from);
    $('point-to').textContent = coords(dev.to);
    $('axis').textContent = dev.axis.map((v) => v.toFixed(3)).join(', ');
    $('matrix').textContent = [0, 1, 2]
      .map((i) => reg.R[i].map((v) => v.toFixed(6).padStart(10)).join(' ') + '  │ ' + reg.t[i].toFixed(4).padStart(10))
      .join('\n');
    $('warnings').replaceChildren(
      ...reg.warnings.map((w) => {
        const li = document.createElement('li');
        li.textContent = w;
        return li;
      })
    );
    drawViewer();
  }

  function token(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function drawViewer() {
    if (!viewer) return;
    const reg = state.registration;
    const ref = state.reference && state.reference.positions;
    const plc = state.placed && state.placed.positions;
    const all = ref && plc ? Float64Array.from([...M.uniqueVertices(ref), ...M.uniqueVertices(plc)]) : ref || plc;
    viewer.show({
      reference: ref,
      placed: plc,
      moved: reg && ref.length <= 3e6 ? M.applyTransform(reg.R, reg.t, ref) : null,
      deviation: state.deviation,
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
    const header = [
      'Reference file', 'Placed file', 'Reference point', 'Point X', 'Point Y', 'Point Z',
      'dX (mm)', 'dY (mm)', 'dZ (mm)', '3D (mm)', 'rX (deg)', 'rY (deg)', 'rZ (deg)', 'Total rotation (deg)',
      'Fit RMS (mm)', 'Method',
    ];
    const row = [
      state.reference.name, state.placed.name, pointLabel, ...dev.from.map((v) => v.toFixed(4)),
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

  setupSlot('reference');
  setupSlot('placed');
  document.querySelectorAll('input[name="point"]').forEach((r) => r.addEventListener('change', onPointModeChange));
  ['x', 'y', 'z'].forEach((a) => $(`point-${a}`).addEventListener('input', showReport));
  ['reference', 'placed', 'fit'].forEach((g) =>
    $(`show-${g}`).addEventListener('change', (e) => viewer && viewer.setVisible(g, e.target.checked))
  );
  $('reframe').addEventListener('click', () => {
    if (!viewer || (!state.reference && !state.placed)) return;
    const pts = [state.reference, state.placed].filter(Boolean).map((s) => M.uniqueVertices(s.positions));
    viewer.reframe(M.boundingBox(Float64Array.from(pts.flatMap((p) => Array.from(p)))));
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', drawViewer);
  new MutationObserver(drawViewer).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // Open on an example so the report shows what it measures.
  const example = window.BracketSample.makeSampleCase();
  state.example = true;
  state.reference = { name: 'example_reference.stl', positions: example.reference, triangleCount: example.reference.length / 9, format: 'binary' };
  state.placed = { name: 'example_placed.stl', positions: example.placed, triangleCount: example.placed.length / 9, format: 'binary' };
  update();
})();
