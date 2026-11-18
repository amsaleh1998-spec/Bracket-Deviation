/*
 * 3D overlay of the reference and placed brackets (three.js r128, global THREE).
 * Returns null when three.js could not be loaded; the numbers still work.
 */
(function (root) {
  'use strict';

  function createViewer(container) {
    const THREE = root.THREE;
    if (!THREE || !THREE.OrbitControls) return null;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(root.devicePixelRatio || 1);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 0.75));
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.6);
    camera.add(keyLight);
    keyLight.position.set(1, 2, 3);
    scene.add(camera);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.addEventListener('change', render);

    const groups = { reference: new THREE.Group(), placed: new THREE.Group(), fit: new THREE.Group(), guides: new THREE.Group() };
    Object.values(groups).forEach((g) => scene.add(g));

    function render() {
      renderer.render(scene, camera);
    }

    function resize() {
      const w = container.clientWidth, h = container.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      render();
    }
    new ResizeObserver(resize).observe(container);

    function clear(group) {
      for (const child of group.children.slice()) {
        group.remove(child);
        child.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) o.material.dispose();
        });
      }
    }

    function geometry(positions) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(positions), 3));
      g.computeVertexNormals();
      return g;
    }

    function mesh(positions, color, opacity) {
      return new THREE.Mesh(
        geometry(positions),
        new THREE.MeshPhongMaterial({
          color,
          shininess: 60,
          transparent: opacity < 1,
          opacity,
          depthWrite: opacity >= 1,
          side: THREE.DoubleSide,
        })
      );
    }

    function marker(p, color, radius) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), new THREE.MeshBasicMaterial({ color }));
      m.position.set(p[0], p[1], p[2]);
      return m;
    }

    let framed = false;

    // guide: { from, to, axes } in software coordinates; axes columns are the
    // directions drawn as X, Y, Z. colors: CSS color strings.
    function show(data) {
      Object.values(groups).forEach(clear);
      const { reference, placed, moved, guide, colors, bbox } = data;
      if (reference) groups.reference.add(mesh(reference, colors.reference, 0.55));
      if (placed) groups.placed.add(mesh(placed, colors.placed, 0.55));
      if (moved) {
        const edges = new THREE.EdgesGeometry(geometry(moved), 20);
        groups.fit.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: colors.fit })));
      }
      if (guide && bbox) {
        const size = bbox.diagonal;
        const origin = new THREE.Vector3(...guide.from);
        [colors.x, colors.y, colors.z].forEach((c, k) => {
          const dir = new THREE.Vector3(guide.axes[0][k], guide.axes[1][k], guide.axes[2][k]);
          groups.guides.add(new THREE.ArrowHelper(dir, origin, size * 0.45, new THREE.Color(c).getHex(), size * 0.06, size * 0.03));
        });
        groups.guides.add(marker(guide.from, colors.reference, size * 0.015));
        groups.guides.add(marker(guide.to, colors.placed, size * 0.015));
        const line = new THREE.BufferGeometry().setFromPoints([origin, new THREE.Vector3(...guide.to)]);
        groups.guides.add(new THREE.Line(line, new THREE.LineBasicMaterial({ color: colors.ink })));
      }
      if (bbox && !framed) frame(bbox);
      render();
    }

    function frame(bbox) {
      const c = new THREE.Vector3(...bbox.center);
      const d = bbox.diagonal || 1;
      controls.target.copy(c);
      camera.position.copy(c).add(new THREE.Vector3(0.9, -1.1, 1.3).normalize().multiplyScalar(d * 1.9));
      camera.up.set(0, 0, 1);
      camera.near = d / 100;
      camera.far = d * 100;
      camera.updateProjectionMatrix();
      controls.update();
      framed = true;
      render();
    }

    return {
      show,
      reframe(bbox) {
        frame(bbox);
      },
      resetFraming() {
        framed = false;
      },
      setVisible(name, visible) {
        groups[name].visible = visible;
        render();
      },
    };
  }

  root.BracketViewer = { createViewer };
})(typeof self !== 'undefined' ? self : this);
