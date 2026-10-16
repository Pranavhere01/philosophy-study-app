/* Orthographic globe renderer — no dependencies, no CDN.
   Expects window.LAND_POINTS (flat [lat,lon,...]) and window.MARKERS (array).
   Canvas 2D with an orthographic projection; land is drawn as a glowing dot grid. */
(function () {
  var cv = document.getElementById('globe');
  if (!cv) return;
  var ctx = cv.getContext('2d');
  var tip = document.getElementById('tip');
  var legend = document.getElementById('legend');

  // ---------- prepare land points once ----------
  var LP = window.LAND_POINTS || [];
  var N = LP.length / 2;
  var sLat = new Float32Array(N), cLat = new Float32Array(N),
      sLon = new Float32Array(N), cLon = new Float32Array(N);
  for (var i = 0; i < N; i++) {
    var la = LP[2 * i] * Math.PI / 180, lo = LP[2 * i + 1] * Math.PI / 180;
    sLat[i] = Math.sin(la); cLat[i] = Math.cos(la);
    sLon[i] = Math.sin(lo); cLon[i] = Math.cos(lo);
  }
  var M = window.MARKERS || [];
  var COLOR = { ok: [52, 211, 153], warn: [251, 191, 36], bad: [248, 113, 113] };

  // ---------- stars ----------
  var stars = [];
  function seedStars(w, h) {
    stars = [];
    var n = Math.round(w * h / 5200);
    for (var k = 0; k < n; k++)
      stars.push({ x: Math.random() * w, y: Math.random() * h,
                   r: Math.random() * 1.25 + 0.25, a: Math.random() * 0.65 + 0.15,
                   tw: Math.random() * Math.PI * 2 });
  }

  // ---------- view state ----------
  var lon0 = 12, lat0 = 22, zoom = 1, spin = 0.055, dragging = false,
      lastX = 0, lastY = 0, lastMove = 0, dpr = 1, W = 0, H = 0, R = 0, cx = 0, cy = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    R = Math.min(W, H) * 0.42 * zoom;
    cx = W / 2; cy = H / 2;
    seedStars(W, H);
  }
  window.addEventListener('resize', resize);

  function project(latD, lonD, o) {
    var la = latD * Math.PI / 180, lo = lonD * Math.PI / 180;
    var sl = Math.sin(la), cl = Math.cos(la);
    var d = lo - o.lon;
    var sd = Math.sin(d), cd = Math.cos(d);
    var c = o.sinLat0 * sl + o.cosLat0 * cl * cd;   // cos of angular distance
    if (c <= 0) return null;
    return { x: cx + R * cl * sd, y: cy - R * (o.cosLat0 * sl - o.sinLat0 * cl * cd), z: c };
  }

  var hovered = -1;

  function frame(t) {
    if (!dragging) {
      var idle = (Date.now() - lastMove) > 1200;
      if (idle) lon0 += spin;
    }
    lon0 = ((lon0 + 540) % 360) - 180;
    lat0 = Math.max(-85, Math.min(85, lat0));

    var o = {
      lon: lon0 * Math.PI / 180,
      sinLat0: Math.sin(lat0 * Math.PI / 180),
      cosLat0: Math.cos(lat0 * Math.PI / 180)
    };

    // background
    ctx.fillStyle = '#05070d';
    ctx.fillRect(0, 0, W, H);

    // stars
    for (var s = 0, sn = stars.length; s < sn; s++) {
      var st = stars[s];
      var tw = 0.62 + 0.38 * Math.sin(t * 0.0016 + st.tw);
      ctx.globalAlpha = st.a * tw;
      ctx.fillStyle = '#cfe3ff';
      ctx.fillRect(st.x, st.y, st.r, st.r);
    }
    ctx.globalAlpha = 1;

    // atmosphere halo
    var halo = ctx.createRadialGradient(cx, cy, R * 0.86, cx, cy, R * 1.30);
    halo.addColorStop(0, 'rgba(56,189,248,0.30)');
    halo.addColorStop(0.45, 'rgba(56,189,248,0.10)');
    halo.addColorStop(1, 'rgba(56,189,248,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.30, 0, 6.2832); ctx.fill();

    // ocean sphere
    var og = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.38, R * 0.12, cx, cy, R * 1.05);
    og.addColorStop(0, '#123049');
    og.addColorStop(0.55, '#0b1d30');
    og.addColorStop(1, '#050b14');
    ctx.fillStyle = og;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.fill();

    // graticule
    ctx.strokeStyle = 'rgba(94,234,212,0.13)';
    ctx.lineWidth = 1;
    var g, p, prev, cur;
    for (g = -60; g <= 60; g += 30) {
      ctx.beginPath(); prev = null;
      for (p = -180; p <= 180; p += 3) {
        cur = project(g, p, o);
        if (!cur) { prev = null; continue; }
        if (prev) { ctx.moveTo(prev.x, prev.y); ctx.lineTo(cur.x, cur.y); }
        prev = cur;
      }
      ctx.stroke();
    }
    for (g = -180; g < 180; g += 30) {
      ctx.beginPath(); prev = null;
      for (p = -88; p <= 88; p += 3) {
        cur = project(p, g, o);
        if (!cur) { prev = null; continue; }
        if (prev) { ctx.moveTo(prev.x, prev.y); ctx.lineTo(cur.x, cur.y); }
        prev = cur;
      }
      ctx.stroke();
    }

    // land dots
    var sinLat0 = o.sinLat0, cosLat0 = o.cosLat0;
    var cosLon = Math.cos(o.lon), sinLon = Math.sin(o.lon);
    var size = Math.max(1.05, R / 210);
    for (var k = 0; k < N; k++) {
      var cl = cLat[k];
      var cd = cLon[k] * cosLon + sLon[k] * sinLon;
      var c = sinLat0 * sLat[k] + cosLat0 * cl * cd;
      if (c <= 0.02) continue;
      var sd2 = sLon[k] * cosLon - cLon[k] * sinLon;
      var X = cx + R * cl * sd2;
      var Y = cy - R * (cosLat0 * sLat[k] - sinLat0 * cl * cd);
      var sh = 0.42 + 0.58 * c;                       // limb darkening
      ctx.fillStyle = 'rgba(' + (56 + 60 * c | 0) + ',' + (200 + 40 * c | 0) + ',' + (190 + 30 * c | 0) + ',' + sh.toFixed(3) + ')';
      ctx.fillRect(X, Y, size, size);
    }

    // limb shadow for depth
    var lg = ctx.createRadialGradient(cx - R * 0.4, cy - R * 0.42, R * 0.1, cx, cy, R);
    lg.addColorStop(0, 'rgba(255,255,255,0.05)');
    lg.addColorStop(0.72, 'rgba(0,0,0,0)');
    lg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = lg;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.fill();

    // markers
    var hit = -1, hi = 1e9;
    for (var m = 0; m < M.length; m++) {
      var mk = M[m];
      var pr = project(mk.lat, mk.lon, o);
      if (!pr) continue;
      var col = COLOR[mk.verdict] || COLOR.warn;
      var pulse = 1 + 0.55 * Math.sin(t * 0.0032 + m);
      var rr = Math.max(2.1, R / 105) * (m === hovered ? 1.7 : 1);
      var rad = rr * pulse * (1.9 + 3.4 * pr.z);
      var gr = ctx.createRadialGradient(pr.x, pr.y, 0, pr.x, pr.y, rad);
      gr.addColorStop(0, 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',0.85)');
      gr.addColorStop(0.4, 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',0.28)');
      gr.addColorStop(1, 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',0)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(pr.x, pr.y, rad, 0, 6.2832); ctx.fill();
      ctx.fillStyle = 'rgb(' + col[0] + ',' + col[1] + ',' + col[2] + ')';
      ctx.beginPath(); ctx.arc(pr.x, pr.y, rr, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(pr.x, pr.y, rr, 0, 6.2832); ctx.stroke();
      var dx = pr.x - mouse.x, dy = pr.y - mouse.y, d2 = dx * dx + dy * dy;
      if (d2 < 260 && d2 < hi) { hi = d2; hit = m; }
    }
    if (hit !== hovered) { hovered = hit; hovered >= 0 ? showTip(M[hovered]) : hideTip(); }
    if (hovered >= 0) {
      var mk2 = M[hovered], p2 = project(mk2.lat, mk2.lon, o);
      if (p2) positionTip(p2.x, p2.y);
    }
    requestAnimationFrame(frame);
  }

  // ---------- tooltip ----------
  var mouse = { x: -999, y: -999 };
  function showTip(mk) {
    tip.innerHTML = '<b>' + mk.uni + '</b><span>' + mk.country + ' · ' + mk.level + '</span>' +
                    '<em>' + mk.amount + '</em><u>Open programme page →</u>';
    tip.style.opacity = '1';
  }
  function hideTip() { tip.style.opacity = '0'; }
  function positionTip(x, y) {
    var w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.min(W - w - 10, Math.max(10, x + 16)) + 'px';
    tip.style.top = Math.min(H - h - 10, Math.max(10, y - h - 14)) + 'px';
  }

  // ---------- interaction ----------
  cv.addEventListener('pointerdown', function (e) {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing';
  });
  cv.addEventListener('pointermove', function (e) {
    var r = cv.getBoundingClientRect();
    mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
    lastMove = Date.now();
    if (!dragging) return;
    lon0 -= (e.clientX - lastX) * 0.28;
    lat0 += (e.clientY - lastY) * 0.28;
    lastX = e.clientX; lastY = e.clientY;
  });
  cv.addEventListener('pointerup', function (e) {
    dragging = false; cv.style.cursor = 'grab';
    if (hovered >= 0) location.href = 'programs/' + M[hovered].slug + '.html';
  });
  cv.addEventListener('pointerleave', function () { mouse.x = -999; mouse.y = -999; });
  cv.addEventListener('wheel', function (e) {
    e.preventDefault();
    zoom = Math.max(0.62, Math.min(2.6, zoom * (e.deltaY < 0 ? 1.09 : 0.92)));
    R = Math.min(W, H) * 0.42 * zoom;
  }, { passive: false });

  // ---------- legend + filtering ----------
  var enabled = { ok: true, warn: true, bad: true };
  var ALL = M.slice();
  function applyFilter() {
    M = ALL.filter(function (m) { return enabled[m.verdict]; });
    var n = document.getElementById('shown');
    if (n) n.textContent = M.length;
    var rows = document.querySelectorAll('#list li');
    for (var i = 0; i < rows.length; i++)
      rows[i].style.display = enabled[rows[i].dataset.verdict] ? '' : 'none';
  }
  if (legend) {
    legend.addEventListener('click', function (e) {
      var b = e.target.closest('[data-v]');
      if (!b) return;
      var v = b.dataset.v;
      enabled[v] = !enabled[v];
      b.classList.toggle('off', !enabled[v]);
      applyFilter();
    });
  }

  cv.style.cursor = 'grab';
  resize();
  applyFilter();
  requestAnimationFrame(frame);
})();
