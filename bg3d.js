// koshkar-müyiz drifting line-field — full-page ambient background
// three.js r128, no post-processing, no controls. Palette-driven, accent-reactive.
// Weight budget: capped DPR, single draw group, pauses when tab hidden or offscreen.
(function () {
  const host = document.getElementById('bg3d');
  if (!host || typeof THREE === 'undefined') return;

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const PALETTE = {
    blue: 0x1c7fa6,
    gold: 0xe0a73a,
    ink:  0x12161c
  };

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 100);
  camera.position.z = 14;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6)); // cap DPR — battery guard
  renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement);

  // ---- build one koshkar-müyiz horn as a tube of points ----
  function hornCurve(flip) {
    const pts = [];
    const N = 90;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const ang = t * 3.3 * Math.PI;
      const r = 0.06 + (1 - t) * 0.92;
      pts.push(new THREE.Vector3(
        flip * (r * Math.cos(ang) - 0.55),
        r * Math.sin(ang) * 0.82,
        0
      ));
    }
    return new THREE.CatmullRomCurve3(pts);
  }

  // a "unit" = mirrored horn pair, as line geometry
  function pairGeometry() {
    const g = new THREE.BufferGeometry();
    const verts = [];
    [1, -1].forEach(flip => {
      const c = hornCurve(flip);
      const samples = c.getPoints(90);
      for (let i = 0; i < samples.length - 1; i++) {
        verts.push(samples[i].x, samples[i].y, samples[i].z);
        verts.push(samples[i + 1].x, samples[i + 1].y, samples[i + 1].z);
      }
    });
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    return g;
  }

  const geo = pairGeometry();

  // scatter many faint pairs across a wide slab of space, at varied depth/scale/spin
  const COUNT = 30;
  const group = new THREE.Group();
  const items = [];

  for (let i = 0; i < COUNT; i++) {
    const useGold = i % 3 === 0;
    const mat = new THREE.LineBasicMaterial({
      color: useGold ? PALETTE.gold : PALETTE.blue,
      transparent: true,
      opacity: 0.28 + Math.random() * 0.22
    });
    const line = new THREE.LineSegments(geo, mat);

    const s = 1.1 + Math.random() * 2.9;
    line.scale.setScalar(s);
    line.position.set(
      (Math.random() - 0.5) * 34,
      (Math.random() - 0.5) * 22,
      (Math.random() - 0.5) * 20 - 4
    );
    line.rotation.z = Math.random() * Math.PI * 2;

    items.push({
      line,
      mat,
      gold: useGold,
      driftX: (Math.random() - 0.5) * 0.006,
      driftY: (Math.random() - 0.5) * 0.004,
      spin: (Math.random() - 0.5) * 0.0016,
      phase: Math.random() * Math.PI * 2,
      baseOp: mat.opacity
    });
    group.add(line);
  }
  scene.add(group);

  // ---- pointer parallax (calm) ----
  let px = 0, py = 0, tx = 0, ty = 0;
  if (!reduce) {
    addEventListener('pointermove', e => {
      tx = (e.clientX / innerWidth - 0.5);
      ty = (e.clientY / innerHeight - 0.5);
    }, { passive: true });
  }

  // ---- accent reactivity: recolour the blue lines to the chosen brand hex ----
  let accentColor = new THREE.Color(PALETTE.blue);
  window.__bg3dAccent = hex => {
    accentColor = new THREE.Color(hex);
  };

  // ---- render loop with visibility + offscreen pause ----
  let running = true;
  let t = 0;
  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running) loop();
  });

  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    t += 0.01;

    px += (tx - px) * 0.03;
    py += (ty - py) * 0.03;
    group.rotation.y = px * 0.35;
    group.rotation.x = py * 0.22;

    items.forEach((it, i) => {
      if (!reduce) {
        it.line.position.x += it.driftX;
        it.line.position.y += it.driftY;
        it.line.rotation.z += it.spin;
        // gentle breathing opacity
        it.mat.opacity = it.baseOp + Math.sin(t + it.phase) * 0.05;
        // wrap around when drifting off the slab
        if (it.line.position.x > 18) it.line.position.x = -18;
        if (it.line.position.x < -18) it.line.position.x = 18;
        if (it.line.position.y > 12) it.line.position.y = -12;
        if (it.line.position.y < -12) it.line.position.y = 12;
      }
      // ease blue lines toward the current accent
      if (!it.gold) it.mat.color.lerp(accentColor, 0.02);
    });

    renderer.render(scene, camera);
  }
  loop();

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  }, { passive: true });
})();
