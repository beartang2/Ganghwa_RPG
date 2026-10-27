/*
 * gesture.js — 무기별 강공격 커맨드 인식 + 트레일 효과 (강화 RPG)
 * ------------------------------------------------------------------
 * 1) 인식기 (순수 함수 — 노드에서도 require 해서 테스트한다)
 *    stroke = [{ x, y, t }]   (화면 CSS px, ms)
 *    judge(cmd, stroke, ctx) → { ok, power, why, looks }
 *      'arc'  ⚔️ 검      한 방향으로 매끄럽게 휜 호(원의 일부)
 *      'line' 🏹 활      몬스터 반대쪽으로 곧게 당긴 선 — 당긴 길이 = 위력
 *      'star' ✨ 지팡이  한 붓 별 — $1 Unistroke Recognizer 로 '별' 템플릿과 비교
 *      'hold' 🛡️ 방패    거의 안 움직이고 꾹 누르기
 *    $1 Unistroke Recognizer: Wobbrock, Wilson, Li (UIST 2007), New BSD License.
 *      https://depts.washington.edu/acelab/proj/dollar/index.html
 *      선을 64점으로 다시 찍고 → 첫 점 방향으로 회전을 맞추고 → 크기·위치를 맞춘 뒤
 *      → 템플릿들과 점 사이 평균 거리를 비교(±45° 안에서 가장 잘 맞는 각도로)한다.
 *      별 말고도 원·삼각형·오각형·지그재그 같은 '헷갈리는 모양' 템플릿을 같이 넣어서,
 *      제일 가까운 게 별일 때만 별로 인정한다(아무렇게나 그은 선이 별로 잡히지 않게).
 *
 * 2) 트레일 (브라우저 전용) — createTrail()
 *    화면 맨 위 투명 캔버스(터치는 통과)에 무기마다 다른 궤적을 그린다.
 *    blade(검) · string(활시위) · magic(마법 잉크) · 꾹 누르기 링(방패) · 성공 플래시 · 실패(회색으로 흩어짐).
 *    빛을 더하는 합성(lighter)은 쓰지 않는다 — 밝은 곳에서 흰색으로 타는 문제(강화 버튼 때)를 피하려고.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Gesture = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- 기하 도우미 ---------- */
  const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const DEG = Math.PI / 180;
  function pathLength(pts) { let d = 0; for (let i = 1; i < pts.length; i++) d += dist(pts[i - 1], pts[i]); return d; }
  function centroid(pts) { let x = 0, y = 0; for (const p of pts) { x += p.x; y += p.y; } return { x: x / pts.length, y: y / pts.length }; }
  function bbox(pts) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) { if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y; }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  // 경로를 같은 간격 n 점으로 다시 찍는다($1 의 resample). 그리는 속도·기기 이벤트 빈도 차이를 없앤다.
  function resample(points, n) {
    const pts = points.map(p => ({ x: p.x, y: p.y }));
    const I = pathLength(pts) / (n - 1);
    const out = [{ x: pts[0].x, y: pts[0].y }];
    if (!(I > 0)) { while (out.length < n) out.push({ x: pts[0].x, y: pts[0].y }); return out; }
    let D = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = dist(pts[i - 1], pts[i]);
      if (d > 0 && D + d >= I) {
        const k = (I - D) / d;
        const q = { x: pts[i - 1].x + k * (pts[i].x - pts[i - 1].x), y: pts[i - 1].y + k * (pts[i].y - pts[i - 1].y) };
        out.push(q); pts.splice(i, 0, q); D = 0;
      } else D += d;
    }
    const last = pts[pts.length - 1];
    while (out.length < n) out.push({ x: last.x, y: last.y });
    return out.slice(0, n);
  }
  function rotateBy(pts, rad) {
    const c = centroid(pts), cos = Math.cos(rad), sin = Math.sin(rad);
    return pts.map(p => ({ x: (p.x - c.x) * cos - (p.y - c.y) * sin + c.x, y: (p.x - c.x) * sin + (p.y - c.y) * cos + c.y }));
  }
  // 점들이 시작점→끝점을 잇는 직선에서 가장 멀리 벗어난 거리
  function maxDeviation(pts) {
    const a = pts[0], b = pts[pts.length - 1], L = dist(a, b) || 1;
    let m = 0;
    for (const p of pts) m = Math.max(m, Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / L);
    return m;
  }
  function maxDisplacement(pts) { let m = 0; for (const p of pts) m = Math.max(m, dist(pts[0], p)); return m; }

  /* ---------- $1 Unistroke Recognizer ---------- */
  const N = 64, SIZE = 250, HALF_DIAG = 0.5 * Math.sqrt(2 * SIZE * SIZE);
  const PHI = 0.5 * (-1 + Math.sqrt(5)), RANGE = 45 * DEG, PRECISION = 2 * DEG;
  function normalize(points) {
    let pts = resample(points, N);
    const c = centroid(pts);
    pts = rotateBy(pts, -Math.atan2(c.y - pts[0].y, c.x - pts[0].x));   // '첫 점 → 중심' 방향을 0°로
    const b = bbox(pts), w = Math.max(b.w, 1e-6), h = Math.max(b.h, 1e-6);
    pts = pts.map(p => ({ x: p.x * (SIZE / w), y: p.y * (SIZE / h) }));
    const c2 = centroid(pts);
    return pts.map(p => ({ x: p.x - c2.x, y: p.y - c2.y }));
  }
  function pathDistance(a, b) { let d = 0; for (let i = 0; i < a.length; i++) d += dist(a[i], b[i]); return d / a.length; }
  function distanceAtAngle(pts, tpl, rad) { return pathDistance(rotateBy(pts, rad), tpl); }
  function distanceAtBestAngle(pts, tpl) {
    let a = -RANGE, b = RANGE;
    let x1 = PHI * a + (1 - PHI) * b, f1 = distanceAtAngle(pts, tpl, x1);
    let x2 = (1 - PHI) * a + PHI * b, f2 = distanceAtAngle(pts, tpl, x2);
    while (Math.abs(b - a) > PRECISION) {
      if (f1 < f2) { b = x2; x2 = x1; f2 = f1; x1 = PHI * a + (1 - PHI) * b; f1 = distanceAtAngle(pts, tpl, x1); }
      else { a = x1; x1 = x2; f1 = f2; x2 = (1 - PHI) * a + PHI * b; f2 = distanceAtAngle(pts, tpl, x2); }
    }
    return Math.min(f1, f2);
  }
  // 꼭짓점들을 잇고 변마다 점을 촘촘히 — 템플릿 원본
  function poly(vs, closed) {
    const seq = closed ? vs.concat([vs[0]]) : vs, out = [];
    for (let i = 1; i < seq.length; i++) for (let k = 0; k < 12; k++) {
      const t = k / 12; out.push({ x: seq[i - 1].x + (seq[i].x - seq[i - 1].x) * t, y: seq[i - 1].y + (seq[i].y - seq[i - 1].y) * t });
    }
    out.push(seq[seq.length - 1]);
    return out;
  }
  const ring = (n, a0, step) => Array.from({ length: n }, (_, k) => ({ x: Math.cos(a0 + k * step), y: Math.sin(a0 + k * step) }));
  const STAR_V = ring(5, -90 * DEG, 72 * DEG);
  const starPath = [0, 2, 4, 1, 3].map(i => STAR_V[i]);   // 오각별: 꼭짓점을 하나씩 건너뛰며 한 붓
  const circle = n => { const o = []; for (let k = 0; k <= n; k++) o.push({ x: Math.cos(k / n * 2 * Math.PI), y: Math.sin(k / n * 2 * Math.PI) }); return o; };
  const rev = a => a.slice().reverse();
  const RAW_TEMPLATES = [
    ['star', poly(starPath, true)], ['star', rev(poly(starPath, true))],
    // 헷갈리는 모양들 — 이것들이 더 가까우면 별이 아니다
    ['circle', circle(48)], ['circle', rev(circle(48))],
    ['triangle', poly(ring(3, -90 * DEG, 120 * DEG), true)], ['triangle', rev(poly(ring(3, -90 * DEG, 120 * DEG), true))],
    ['square', poly(ring(4, -45 * DEG, 90 * DEG), true)], ['square', rev(poly(ring(4, -45 * DEG, 90 * DEG), true))],
    ['pentagon', poly(ring(5, -90 * DEG, 72 * DEG), true)], ['pentagon', rev(poly(ring(5, -90 * DEG, 72 * DEG), true))],
    ['zigzag', poly([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }, { x: 3, y: 1 }, { x: 4, y: 0 }], false)],
    ['caret', poly([{ x: 0, y: 1 }, { x: 0.5, y: 0 }, { x: 1, y: 1 }], false)],
    ['check', poly([{ x: 0, y: 0.55 }, { x: 0.35, y: 1 }, { x: 1, y: 0 }], false)],
    ['semicircle', circle(48).slice(0, 25)], ['semicircle', rev(circle(48).slice(0, 25))],
    ['infinity', Array.from({ length: 65 }, (_, k) => { const t = k / 64 * 2 * Math.PI; return { x: Math.sin(t), y: Math.sin(t) * Math.cos(t) }; })],
  ];
  const TEMPLATES = RAW_TEMPLATES.map(([name, pts]) => ({ name, pts: normalize(pts.map(p => ({ x: p.x * 100, y: p.y * 100 }))) }));
  function recognize(points) {
    if (points.length < 8) return { name: null, score: 0 };
    const pts = normalize(points);
    let best = null, bestD = Infinity;
    for (const t of TEMPLATES) { const d = distanceAtBestAngle(pts, t.pts); if (d < bestD) { bestD = d; best = t.name; } }
    return { name: best, score: 1 - bestD / HALF_DIAG };
  }

  /* ---------- 커맨드 판정 ---------- */
  const CFG = {
    tapSlop: 10,            // 이 안에서만 움직이면 '탭'(일반 공격)
    arcMinLen: 75, arcMinTurn: 50, arcMaxTurn: 400, arcConsistency: 0.65, arcMaxStep: 62, arcMaxPeak: 0.6, arcMaxDur: 3000,
    lineMinLen: 55, lineStraight: 0.9, lineMaxDev: 0.2, lineAway: 0.55, lineFullLen: 180,
    starMinLen: 220, starMinScore: 0.78, starMaxDur: 8000, starTrimHead: [0, 0.07, 0.14, 0.2], starTrimTail: [0, 0.1],
    holdMs: 800, holdGuardMs: 400, holdSlop: 14,
  };
  // 휘는 정도: 매끄럽게 다듬어 21점으로 다시 찍은 경로에서 이웃한 마디끼리의 방향 변화(부호 있음)를 더한다
  function smooth(p, r) {   // 이동 평균 — 손떨림 지그재그를 걷어 내서 '전체적으로 휘는 정도' 만 남긴다
    return p.map((_, i) => { let x = 0, y = 0, n = 0; for (let j = Math.max(0, i - r); j <= Math.min(p.length - 1, i + r); j++) { x += p[j].x; y += p[j].y; n++; } return { x: x / n, y: y / n }; });
  }
  function turning(pts) {
    const p = resample(smooth(resample(pts, 41), 3), 21);
    let sum = 0, abs = 0, maxStep = 0, prev = null;
    const steps = [];
    for (let i = 1; i < p.length; i++) {
      const dx = p[i].x - p[i - 1].x, dy = p[i].y - p[i - 1].y;
      if (Math.hypot(dx, dy) < 1e-6) continue;
      const a = Math.atan2(dy, dx);
      if (prev !== null) {
        let d = a - prev; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        sum += d; abs += Math.abs(d); maxStep = Math.max(maxStep, Math.abs(d)); steps.push(Math.abs(d));
      }
      prev = a;
    }
    // 휜 정도가 한 곳에 몰렸나(꺾인 V·L 자) — 연속 5마디에 전체 휨의 몇 %가 모였는지. 호는 고르게 퍼져 약 1/4.
    let peak = 0;
    for (let i = 0; i + 5 <= steps.length; i++) { let w = 0; for (let j = i; j < i + 5; j++) w += steps[j]; peak = Math.max(peak, w); }
    return { sum: sum / DEG, abs: abs / DEG, maxStep: maxStep / DEG, peak: abs > 0 ? peak / abs : 1 };
  }
  const dur = s => (s.length ? s[s.length - 1].t - s[0].t : 0);
  function isTap(s) { return maxDisplacement(s) < CFG.tapSlop; }
  function judgeArc(s) {
    const L = pathLength(s);
    if (L < CFG.arcMinLen) return { ok: false, why: 'short' };
    const tn = turning(s), turn = Math.abs(tn.sum);
    const chordRatio = dist(s[0], s[s.length - 1]) / L;
    const ok = turn >= CFG.arcMinTurn && turn <= CFG.arcMaxTurn && tn.abs > 0 && turn / tn.abs >= CFG.arcConsistency
      && tn.maxStep <= CFG.arcMaxStep && tn.peak <= CFG.arcMaxPeak && chordRatio <= 0.97 && dur(s) <= CFG.arcMaxDur;
    return { ok, power: 1, why: ok ? null : 'shape', turn: Math.round(turn) };
  }
  function judgeLine(s, ctx) {
    const a = s[0], b = s[s.length - 1], chord = dist(a, b), L = pathLength(s);
    if (chord < CFG.lineMinLen) return { ok: false, why: 'short' };
    const straight = chord / (L || 1) >= CFG.lineStraight && maxDeviation(s) <= Math.max(10, CFG.lineMaxDev * chord);
    let away = true;
    if (ctx && ctx.target) away = dist(b, ctx.target) - dist(a, ctx.target) >= CFG.lineAway * chord;   // 몬스터에게서 멀어지게 당겼나
    const ok = straight && away;
    // 위력: 당긴 길이 55px → 40%, 180px 이상 → 100%
    const power = clamp(0.4 + 0.6 * (chord - CFG.lineMinLen) / (CFG.lineFullLen - CFG.lineMinLen), 0.4, 1);
    return { ok, power: ok ? power : 0, why: ok ? null : (!straight ? 'shape' : 'direction') };
  }
  function judgeStar(s) {
    if (pathLength(s) < CFG.starMinLen) return { ok: false, why: 'short' };
    // 몬스터를 누르고 꼭짓점까지 '들어가는 선', 다 그리고 살짝 삐친 '나가는 선' 이 붙으면 별 모양이 흐트러진다.
    // 그래서 시작 쪽 최대 20%, 끝 쪽 최대 10% 를 잘라 본 경우들 중 가장 별다운 것을 쓴다.
    let best = null;
    for (const a of CFG.starTrimHead) for (const b of CFG.starTrimTail) {
      const sub = a || b ? trimPath(s, a, b) : s;
      if (sub.length < 8) continue;
      const r = recognize(sub);
      if (!best || (r.name === 'star') > (best.name === 'star') || ((r.name === 'star') === (best.name === 'star') && r.score > best.score)) best = r;
    }
    const ok = best.name === 'star' && best.score >= CFG.starMinScore && dur(s) <= CFG.starMaxDur;
    return { ok, power: 1, why: ok ? null : 'shape', match: best.name, score: +best.score.toFixed(3) };
  }
  // 경로 길이 기준으로 앞 a, 뒤 b 비율만큼 잘라 낸 부분 경로
  function trimPath(s, a, b) {
    const L = pathLength(s), from = L * a, to = L * (1 - b), out = [];
    let acc = 0;
    for (let i = 0; i < s.length; i++) {
      if (i) acc += dist(s[i - 1], s[i]);
      if (acc >= from && acc <= to) out.push(s[i]);
    }
    return out;
  }
  function judgeHold(s, ctx) {
    const held = ctx && ctx.heldMs != null ? ctx.heldMs : dur(s);
    const still = maxDisplacement(s) <= CFG.holdSlop;
    const ok = still && held >= CFG.holdMs;
    return { ok, power: 1, why: ok ? null : (!still ? 'moved' : 'short'), guard: still && held >= CFG.holdGuardMs };
  }
  const JUDGES = { arc: judgeArc, line: judgeLine, star: judgeStar, hold: judgeHold };
  // 지금 무기의 커맨드로 판정. 실패하면 '다른 무기 커맨드처럼 보였는지(looks)' 도 알려 줘서 안내에 쓴다.
  function judge(cmd, s, ctx) {
    const r = (JUDGES[cmd] || judgeArc)(s, ctx);
    if (!r.ok && cmd !== 'hold' && !isTap(s)) {
      for (const k of ['star', 'line', 'arc']) if (k !== cmd && JUDGES[k](s, ctx).ok) { r.looks = k; break; }
    }
    return r;
  }

  /* ---------- 트레일 (브라우저) ---------- */
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const rgba = (c, a) => 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + clamp(a, 0, 1).toFixed(3) + ')';
  const STYLES = {
    // 검: 굵은 머리 → 가는 꼬리, 금빛→쇳물 주황, 빨리 사라짐
    blade: { life: 360, w: 11, head: [255, 214, 107], tail: [255, 122, 26], glow: 0.3 },
    // 활: 당기는 동안은 활시위(시작점↔손가락), 꼬리는 옅은 하늘색
    string: { life: 200, w: 3, head: [127, 212, 255], tail: [90, 160, 220], glow: 0.2 },
    // 지팡이: 오래 남는 보랏빛 마법 잉크 + 반짝이 — 별 모양을 끝까지 보면서 그리게
    magic: { life: 2400, w: 4.5, head: [233, 201, 255], tail: [167, 112, 239], glow: 0.45, sparkle: true },
    // 방패를 끌었을 때 등 '커맨드가 아닌' 선
    plain: { life: 300, w: 4, head: [210, 200, 186], tail: [150, 140, 128], glow: 0.15 },
  };
  const FAIL = [138, 129, 120], GOLD = [255, 214, 107];
  function createTrail(opts) {
    const o = Object.assign({ z: 115 }, opts);
    const cv = document.createElement('canvas');
    cv.setAttribute('aria-hidden', 'true');
    cv.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:' + o.z;
    document.body.appendChild(cv);
    const ctx = cv.getContext('2d');
    let W = 0, H = 0, dpr = 1;
    const fit = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1); W = window.innerWidth; H = window.innerHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    };
    fit(); window.addEventListener('resize', fit);
    let stroke = null;            // 지금 그리는 선
    const fading = [];            // 손을 뗀 뒤 사라지는 선들
    const fx = [];                // 플래시·화살·충격파·링
    let raf = 0;
    const now = () => performance.now();
    const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };

    function drawPath(pts, st, t, override) {
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i], q = pts[i - 1];
        const life = override ? override.life : st.life;
        const age = override ? (t - override.t0) : (t - p.t);
        const a = 1 - age / life;
        if (a <= 0) continue;
        const col = override ? override.color : mix(st.tail, st.head, a);
        const w = (override ? override.w : st.w) * (0.25 + 0.75 * a);
        if (st.glow) { ctx.strokeStyle = rgba(col, a * st.glow); ctx.lineWidth = w * 2.6; ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(p.x, p.y); ctx.stroke(); }
        ctx.strokeStyle = rgba(col, a); ctx.lineWidth = w;
        ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      }
    }
    function drawString(s, t) {   // 활시위: 시작점(화살 끝)에서 손가락까지, 당길수록 굵고 금빛
      const a = s.pts[0], b = s.pts[s.pts.length - 1];
      const pw = clamp((dist(a, b) - CFG.lineMinLen) / (CFG.lineFullLen - CFG.lineMinLen), 0, 1);
      const col = mix([127, 212, 255], GOLD, pw);
      ctx.strokeStyle = rgba(col, 0.25); ctx.lineWidth = 9 + 6 * pw; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = rgba(col, 0.95); ctx.lineWidth = 2 + 3 * pw; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      // 화살촉: 당기는 반대(=쏠 방향)를 가리킨다
      const ang = Math.atan2(a.y - b.y, a.x - b.x), r = 9 + 4 * pw;
      ctx.fillStyle = rgba(col, 0.95); ctx.beginPath();
      ctx.moveTo(a.x + Math.cos(ang) * r, a.y + Math.sin(ang) * r);
      ctx.lineTo(a.x + Math.cos(ang + 2.5) * r * 0.8, a.y + Math.sin(ang + 2.5) * r * 0.8);
      ctx.lineTo(a.x + Math.cos(ang - 2.5) * r * 0.8, a.y + Math.sin(ang - 2.5) * r * 0.8);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = rgba(col, 0.9); ctx.beginPath(); ctx.arc(b.x, b.y, 4 + 2 * pw, 0, Math.PI * 2); ctx.fill();
    }
    function frame() {
      raf = 0;
      const t = now();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (stroke) {
        if (stroke.style === 'string') drawString(stroke, t);
        else drawPath(stroke.pts, STYLES[stroke.style] || STYLES.plain, t);
        if (stroke.sparks) for (const sp of stroke.sparks) {
          const a = 1 - (t - sp.t) / 700; if (a <= 0) continue;
          ctx.fillStyle = rgba(sp.c, a); ctx.beginPath(); ctx.arc(sp.x + sp.vx * (t - sp.t) / 16, sp.y + sp.vy * (t - sp.t) / 16, sp.r * a, 0, Math.PI * 2); ctx.fill();
        }
      }
      for (let i = fading.length - 1; i >= 0; i--) {
        const f = fading[i], st = STYLES[f.style] || STYLES.plain;
        const age = t - f.t0;
        if (age > f.life) { fading.splice(i, 1); continue; }
        drawPath(f.pts, st, t, { life: f.life, t0: f.t0, color: f.color, w: f.w });
      }
      for (let i = fx.length - 1; i >= 0; i--) {
        const e = fx[i], age = t - e.t0;
        if (e.kind === 'ring') {   // 방패: 꾹 누르는 동안 차오르는 링(app 이 progress 를 넣어 준다)
          if (e.dead) { fx.splice(i, 1); continue; }
          const full = e.p >= 1, r = 30 + (full ? 3 * Math.sin(t / 70) : 0);
          ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 7; ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, Math.PI * 2); ctx.stroke();
          const col = full ? GOLD : [127, 180, 214];
          ctx.strokeStyle = rgba(col, 0.95); ctx.lineWidth = 5;
          ctx.beginPath(); ctx.arc(e.x, e.y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(e.p, 0, 1)); ctx.stroke();
          if (full) { ctx.strokeStyle = rgba(GOLD, 0.25); ctx.lineWidth = 14; ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, Math.PI * 2); ctx.stroke(); }
          continue;
        }
        if (age > e.dur) { fx.splice(i, 1); continue; }
        const k = age / e.dur, a = 1 - k;
        if (e.kind === 'flash') {          // 성공: 그린 궤적 전체가 금빛으로 확 켜졌다 사라짐
          ctx.strokeStyle = rgba(e.color, a * 0.3); ctx.lineWidth = e.w * 3; ctx.beginPath();
          e.pts.forEach((p, j) => (j ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
          ctx.strokeStyle = rgba(e.color, a); ctx.lineWidth = e.w * (1 - 0.4 * k); ctx.stroke();
        } else if (e.kind === 'arrow') {   // 활: 시작점 → 몬스터로 날아가는 빛줄기
          const p = Math.min(1, age / (e.dur * 0.6));
          const hx = e.a.x + (e.b.x - e.a.x) * p, hy = e.a.y + (e.b.y - e.a.y) * p;
          const tx = e.a.x + (e.b.x - e.a.x) * Math.max(0, p - 0.35), ty = e.a.y + (e.b.y - e.a.y) * Math.max(0, p - 0.35);
          ctx.strokeStyle = rgba(GOLD, a * 0.35); ctx.lineWidth = 12; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
          ctx.strokeStyle = rgba(GOLD, a); ctx.lineWidth = 4; ctx.stroke();
        } else if (e.kind === 'shock') {   // 방패 강타: 퍼지는 충격파
          const r = 20 + e.r * (1 - (1 - k) ** 3);
          ctx.strokeStyle = rgba(e.color, a * 0.9); ctx.lineWidth = 6 * a + 1; ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, Math.PI * 2); ctx.stroke();
          ctx.strokeStyle = rgba(e.color, a * 0.3); ctx.lineWidth = 16 * a + 2; ctx.stroke();
        }
      }
      if (stroke || fading.length || fx.length) raf = requestAnimationFrame(frame);
    }
    return {
      begin(style, pts) {
        stroke = { style, pts: pts.slice(), sparks: STYLES[style] && STYLES[style].sparkle ? [] : null };
        kick();
      },
      add(p) {
        if (!stroke) return;
        stroke.pts.push(p);
        if (stroke.sparks && Math.random() < 0.35) {
          stroke.sparks.push({ x: p.x + (Math.random() - 0.5) * 8, y: p.y + (Math.random() - 0.5) * 8, vx: (Math.random() - 0.5) * 0.8, vy: -Math.random() * 0.8,
            r: 1.2 + Math.random() * 1.8, t: p.t, c: Math.random() < 0.5 ? [255, 233, 168] : [214, 176, 255] });
          if (stroke.sparks.length > 160) stroke.sparks.splice(0, stroke.sparks.length - 160);
        }
        kick();
      },
      // ok: 성공 플래시 / 실패: 회색으로 빨리 흩어짐
      end(ok, extra) {
        if (!stroke) return;
        const s = stroke; stroke = null;
        const t = now();
        if (s.style === 'string') {
          if (ok && extra && extra.target) fx.push({ kind: 'arrow', a: s.pts[0], b: extra.target, t0: t, dur: 260 });
          else fading.push({ style: 'plain', pts: [s.pts[0], s.pts[s.pts.length - 1]], t0: t, life: 260, color: FAIL, w: 3 });
        } else if (ok) {
          fx.push({ kind: 'flash', pts: s.pts, t0: t, dur: s.style === 'magic' ? 650 : 240, color: GOLD, w: s.style === 'magic' ? 7 : 12 });
        } else {
          fading.push({ style: s.style, pts: s.pts, t0: t, life: 300, color: FAIL, w: 4 });
        }
        kick();
      },
      cancel() { stroke = null; kick(); },
      ring(x, y, p) {     // p<0 이면 링을 지운다
        let r = fx.find(e => e.kind === 'ring');
        if (p < 0) { if (r) r.dead = true; kick(); return; }
        if (!r) { r = { kind: 'ring', x, y, p, t0: now() }; fx.push(r); }
        r.x = x; r.y = y; r.p = p; r.dead = false; kick();
      },
      shock(x, y, color) { fx.push({ kind: 'shock', x, y, t0: now(), dur: 420, r: 90, color: color || GOLD }); kick(); },
      get active() { return !!stroke; },
    };
  }

  return { judge, recognize, isTap, resample, pathLength, maxDisplacement, CFG, createTrail, _templates: TEMPLATES.map(t => t.name) };
});
