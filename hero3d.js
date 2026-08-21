// hero3d.js — live WebGL "data network" hero visualization.
// Renders behind the hero headline: ~12 nodes in loose pipeline columns
// (webhook -> transform -> AI -> database -> notify), connected by faint
// edges with bright additive-blend data packets travelling along them.
// Cursor-reactive camera parallax + gentle group lean. Purely decorative —
// touches nothing outside #hero/#heroCanvas, no demo logic anywhere near it.
//
// Gated off entirely (falls back to a static CSS treatment, see index.html's
// #hero.hero-fallback rules) on: viewport <900px, coarse pointer, <=4 CPU
// cores, save-data, or if three.js failed to load. Reduced-motion still gets
// the full scene but rendered once, frozen — no packets/breathing/parallax.
(function () {
  const canvas = document.getElementById('heroCanvas');
  const heroEl = document.getElementById('hero');
  if (!canvas || !heroEl) return;

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const lowPower = window.innerWidth < 900
    || matchMedia('(pointer: coarse)').matches
    || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4)
    || (navigator.connection && navigator.connection.saveData);

  if (lowPower) {
    heroEl.classList.add('hero-fallback');
    return;
  }

  // hero3d.js is loaded with `defer`; three.js (a plain blocking <script src>) is meant
  // to have already executed by then, but don't gamble on load-order edge cases (slow/
  // blocked CDN, unusual proxying) — wait for the window `load` event, which only fires
  // once every external script has settled one way or another, then decide for real.
  if (document.readyState === 'complete') init();
  else addEventListener('load', init, { once: true });

  function init() {
    if (typeof THREE === 'undefined') {
      heroEl.classList.add('hero-fallback');
      return;
    }

  const PALETTE = { amber: 0xe0a85c, aqua: 0x6fd9c4, bg: 0x161a24 };

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(PALETTE.bg, 15, 32);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.z = 17;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
  renderer.setClearColor(0x000000, 0);

  function size() {
    const w = heroEl.clientWidth, h = heroEl.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // pull the camera back on narrow/tall viewports so the network stays fully framed
    camera.position.z = 17 + Math.max(0, (1.35 - camera.aspect) * 9);
    camera.updateProjectionMatrix();
  }
  size();

  // ---- shared glow sprite texture, generated once ----
  function glowTexture() {
    const s = 128;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    return new THREE.CanvasTexture(c);
  }
  const glowTex = glowTexture();

  // ---- node layout: 5 deliberate pipeline columns, 12 nodes ----
  // webhook -> transform -> AI -> database -> notify
  const NODES = [
    { id: 'wh1', x: -8.2, y: 1.7, z: 0.4, c: 'aqua' },
    { id: 'wh2', x: -8.6, y: -1.4, z: -0.7, c: 'aqua' },
    { id: 'tr1', x: -4.1, y: 2.3, z: -0.5, c: 'amber' },
    { id: 'tr2', x: -4.4, y: 0, z: 0.9, c: 'amber' },
    { id: 'tr3', x: -3.8, y: -2.1, z: -0.3, c: 'amber' },
    { id: 'ai1', x: 0, y: 1.6, z: 1.1, c: 'amber' },
    { id: 'ai2', x: 0.3, y: -0.4, z: -0.9, c: 'amber' },
    { id: 'ai3', x: -0.4, y: -2.3, z: 0.5, c: 'amber' },
    { id: 'db1', x: 4.1, y: 1.4, z: -0.5, c: 'aqua' },
    { id: 'db2', x: 4.4, y: -1.6, z: 0.7, c: 'aqua' },
    { id: 'nt1', x: 8.2, y: 1.1, z: 0.3, c: 'aqua' },
    { id: 'nt2', x: 8.6, y: -1.4, z: -0.4, c: 'aqua' }
  ];
  const EDGES = [
    ['wh1', 'tr1'], ['wh1', 'tr2'], ['wh2', 'tr2'], ['wh2', 'tr3'],
    ['tr1', 'ai1'], ['tr2', 'ai1'], ['tr2', 'ai2'], ['tr3', 'ai2'], ['tr3', 'ai3'],
    ['ai1', 'db1'], ['ai2', 'db1'], ['ai2', 'db2'], ['ai3', 'db2'],
    ['db1', 'nt1'], ['db2', 'nt1'], ['db2', 'nt2']
  ];

  const group = new THREE.Group();
  scene.add(group);

  const byId = {};
  const nodeGeo = new THREE.SphereGeometry(0.16, 14, 14);
  NODES.forEach(n => {
    const color = PALETTE[n.c];
    const mesh = new THREE.Mesh(nodeGeo, new THREE.MeshBasicMaterial({ color }));
    mesh.position.set(n.x, n.y, n.z);
    group.add(mesh);

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color, transparent: true, opacity: 0.32,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    glow.scale.setScalar(1.5);
    glow.position.copy(mesh.position);
    group.add(glow);

    byId[n.id] = { x: n.x, y: n.y, z: n.z, c: n.c, mesh, glow, phase: (n.x + n.y) * 1.7 };
  });

  // ---- faint edges ----
  const edgePositions = [];
  EDGES.forEach(([a, b]) => {
    const pa = byId[a], pb = byId[b];
    edgePositions.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z);
  });
  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3));
  const edgeLines = new THREE.LineSegments(
    edgeGeo,
    new THREE.LineBasicMaterial({ color: PALETTE.aqua, transparent: true, opacity: 0.14 })
  );
  group.add(edgeLines);

  // ---- data packets: one per edge, looping along a gentle arc, colored by destination ----
  function bezier(p0, p1, mid, t) {
    const u = 1 - t;
    return {
      x: u * u * p0.x + 2 * u * t * mid.x + t * t * p1.x,
      y: u * u * p0.y + 2 * u * t * mid.y + t * t * p1.y,
      z: u * u * p0.z + 2 * u * t * mid.z + t * t * p1.z
    };
  }
  const packets = EDGES.map(([a, b], i) => {
    const src = byId[a], dest = byId[b];
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: PALETTE[dest.c], transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    sprite.scale.setScalar(0.32);
    group.add(sprite);
    return {
      a: src, b: dest, sprite,
      t: i / EDGES.length,
      speed: 0.05 + Math.random() * 0.025
    };
  });

  // ---- ambient dust ----
  const DUST_COUNT = 220;
  const dustPos = new Float32Array(DUST_COUNT * 3);
  for (let i = 0; i < DUST_COUNT; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * 34;
    dustPos[i * 3 + 1] = (Math.random() - 0.5) * 20;
    dustPos[i * 3 + 2] = (Math.random() - 0.5) * 18 - 4;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    color: 0x9ba0b2, size: 0.045, transparent: true, opacity: 0.32, sizeAttenuation: true
  }));
  scene.add(dust);

  // reduced-motion: render one static, fully-composed frame and stop — no RAF loop at all.
  if (reduce) {
    renderer.render(scene, camera);
    addEventListener('resize', () => { size(); renderer.render(scene, camera); }, { passive: true });
    return;
  }

  // ---- cursor parallax (page-level, so it tracks even while pointer is over hero text) ----
  let px = 0, py = 0, tx = 0, ty = 0;
  addEventListener('pointermove', e => {
    const r = heroEl.getBoundingClientRect();
    tx = (e.clientX - r.left) / r.width - 0.5;
    ty = (e.clientY - r.top) / r.height - 0.5;
  }, { passive: true });

  // ---- visibility gating: pause the loop when the hero is offscreen or the tab is hidden ----
  // The hero is on-screen at load by definition, so the loop starts immediately rather than
  // waiting on the IntersectionObserver's first callback — that callback can (and did, in
  // testing) fire with isIntersecting:false before layout has settled, and since nothing else
  // would ever re-trigger updateRunning() after that, the loop would never start at all.
  let heroVisible = true;
  let running = true;
  requestAnimationFrame(loop);

  function updateRunning() {
    const shouldRun = !document.hidden && heroVisible;
    if (shouldRun && !running) { running = true; requestAnimationFrame(loop); }
    else if (!shouldRun) { running = false; }
  }
  new IntersectionObserver(es => { heroVisible = es[0].isIntersecting; updateRunning(); }, { threshold: 0.05 }).observe(heroEl);
  document.addEventListener('visibilitychange', updateRunning);

  let t = 0;
  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    t += 0.012;

    px += (tx - px) * 0.045;
    py += (ty - py) * 0.045;
    camera.position.x += (px * 1.6 - camera.position.x) * 0.06;
    camera.position.y += (-py * 1.1 - camera.position.y) * 0.06;
    camera.lookAt(0, 0, 0);
    group.rotation.y += (px * 0.12 - group.rotation.y) * 0.04;
    group.rotation.x += (-py * 0.06 - group.rotation.x) * 0.04;

    Object.values(byId).forEach(n => {
      const s = 1.5 + Math.sin(t * 1.6 + n.phase) * 0.32;
      n.glow.scale.setScalar(s);
      n.glow.material.opacity = 0.26 + Math.sin(t * 1.6 + n.phase) * 0.12;
    });

    packets.forEach(p => {
      p.t += p.speed * 0.02;
      if (p.t > 1) p.t -= 1;
      const mid = { x: (p.a.x + p.b.x) / 2, y: (p.a.y + p.b.y) / 2 + 0.4, z: (p.a.z + p.b.z) / 2 };
      const pos = bezier(p.a, p.b, mid, p.t);
      p.sprite.position.set(pos.x, pos.y, pos.z);
      p.sprite.material.opacity = Math.sin(p.t * Math.PI); // fades in/out at each end of its edge
    });

    dust.rotation.y += 0.0003;

    renderer.render(scene, camera);
  }
  updateRunning();

  addEventListener('resize', size, { passive: true });
  } // end init()
})();
