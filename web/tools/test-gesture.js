/* 강공격 커맨드 인식기 테스트 — 사람 손처럼 흔들린 가짜 궤적을 많이 만들어 정확도를 잰다.
 *   node tools/test-gesture.js   (npm run test:gesture) */
const G = require('../public/gesture.js');
let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const R = (a, b) => a + (b - a) * rnd();
const DEG = Math.PI / 180;
// 꼭짓점 목록 → 사람이 그은 듯한 점열(점 간격 불규칙 + 손떨림 + 시간)
function stroke(vs, { noise = 2, step = [3, 9], ms = 6 } = {}) {
  const out = []; let t = 0;
  for (let i = 1; i < vs.length; i++) {
    const a = vs[i - 1], b = vs[i], L = Math.hypot(b.x - a.x, b.y - a.y);
    for (let d = 0; d < L; d += R(step[0], step[1])) {
      const k = d / L; t += ms;
      out.push({ x: a.x + (b.x - a.x) * k + R(-noise, noise), y: a.y + (b.y - a.y) * k + R(-noise, noise), t });
    }
  }
  const z = vs[vs.length - 1]; out.push({ x: z.x, y: z.y, t: t + ms });
  return out;
}
const at = (cx, cy, r, ang) => ({ x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) });
function star() {
  const cx = 200, cy = 300, r = R(60, 130), rot = R(0, 360) * DEG, sx = R(0.8, 1.2), sy = R(0.8, 1.2);
  const v = [0, 1, 2, 3, 4].map(k => { const p = at(0, 0, r * R(0.88, 1.12), rot - 90 * DEG + k * 72 * DEG + R(-7, 7) * DEG); return { x: cx + p.x * sx, y: cy + p.y * sy }; });
  const s0 = Math.floor(R(0, 5)), dir = rnd() < 0.5 ? 2 : 3;   // 시작 꼭짓점·방향 무작위
  const seq = []; for (let i = 0; i <= 5; i++) seq.push(v[(s0 + i * dir) % 5]);
  if (rnd() < 0.4) seq[5] = { x: seq[5].x + R(-r * 0.15, r * 0.15), y: seq[5].y + R(-r * 0.15, r * 0.15) };   // 끝을 대충 닫음
  return stroke(seq, { noise: R(1, 3.5) });
}
function arc(sweepMin = 70, sweepMax = 300) {
  const cx = 200, cy = 300, r = R(55, 150), a0 = R(0, 360) * DEG, sw = R(sweepMin, sweepMax) * DEG * (rnd() < 0.5 ? 1 : -1);
  const n = 24, vs = []; for (let i = 0; i <= n; i++) vs.push(at(cx, cy, r * R(0.97, 1.03), a0 + sw * i / n));
  return stroke(vs, { noise: R(1, 3), ms: 4 });
}
function line(len = [60, 220]) {
  const a = { x: 200, y: 300 }, ang = R(0, 360) * DEG, L = R(len[0], len[1]);
  return stroke([a, { x: a.x + Math.cos(ang) * L * 0.5 + R(-4, 4), y: a.y + Math.sin(ang) * L * 0.5 + R(-4, 4) }, at(a.x, a.y, L, ang)], { noise: R(0.5, 2.5) });
}
function polygon(n, rot = R(0, 360) * DEG) { const r = R(60, 130), v = []; for (let k = 0; k <= n; k++) v.push(at(200, 300, r, rot + k * 2 * Math.PI / n)); return stroke(v, { noise: 2 }); }
function zigzag() { const v = []; const w = R(20, 45), h = R(40, 90); for (let k = 0; k < 6; k++) v.push({ x: 100 + k * w, y: 300 + (k % 2) * h }); return stroke(v); }
function vee() { return stroke([{ x: 120, y: 200 }, { x: 180 + R(-20, 20), y: 330 }, { x: 260, y: 190 + R(-30, 30) }]); }
function scribble() { const v = [{ x: 200, y: 300 }]; for (let k = 0; k < 9; k++) v.push({ x: v[k].x + R(-90, 90), y: v[k].y + R(-90, 90) }); return stroke(v); }
function rate(gen, fn, n = 400) { let ok = 0; for (let i = 0; i < n; i++) if (fn(gen())) ok++; return ok / n; }
const isStar = s => G.judge('star', s).ok, isArc = s => G.judge('arc', s).ok, isLine = s => G.judge('line', s).ok;

let fail = 0;
function expect(label, v, cmp, th) {
  const pass = cmp === '>=' ? v >= th : v <= th;
  if (!pass) fail++;
  console.log(`  ${pass ? '✓' : '✗'} ${label}: ${(v * 100).toFixed(1)}% (기준 ${cmp} ${(th * 100).toFixed(0)}%)`);
}
console.log('[✨ 별]');
expect('흔들린 별 인식', rate(star, isStar), '>=', 0.9);
expect('원 → 별 오인', rate(() => polygon(40), isStar), '<=', 0.02);
expect('삼각형 → 별 오인', rate(() => polygon(3), isStar), '<=', 0.02);
expect('사각형 → 별 오인', rate(() => polygon(4), isStar), '<=', 0.02);
expect('오각형 → 별 오인', rate(() => polygon(5), isStar), '<=', 0.05);
expect('지그재그 → 별 오인', rate(zigzag, isStar), '<=', 0.02);
expect('아무렇게나 → 별 오인', rate(scribble, isStar), '<=', 0.05);
console.log('[⚔️ 호]');
expect('호(70~300°) 인식', rate(() => arc(), isArc), '>=', 0.95);
expect('직선 → 호 오인', rate(() => line(), isArc), '<=', 0.02);
expect('V자 → 호 오인', rate(vee, isArc), '<=', 0.03);
expect('지그재그 → 호 오인', rate(zigzag, isArc), '<=', 0.02);
expect('별 → 호 오인', rate(star, isArc), '<=', 0.02);
console.log('[🏹 직선]');
expect('직선 인식(방향 무관)', rate(() => line(), isLine), '>=', 0.95);
expect('호(90°+) → 직선 오인', rate(() => arc(90, 300), isLine), '<=', 0.03);
expect('V자 → 직선 오인', rate(vee, isLine), '<=', 0.02);
// 방향: 몬스터(위) 반대쪽(아래)으로 당겨야
const tgt = { x: 200, y: 100 };
const pullDown = stroke([{ x: 200, y: 260 }, { x: 205, y: 420 }]), pullUp = stroke([{ x: 200, y: 260 }, { x: 198, y: 160 }]);
const d1 = G.judge('line', pullDown, { target: tgt }), d2 = G.judge('line', pullUp, { target: tgt });
console.log(`  ${d1.ok ? '✓' : '✗'} 몬스터 반대로 당김 → 발사 (위력 ${(d1.power * 100) | 0}%)`); if (!d1.ok) fail++;
console.log(`  ${!d2.ok && d2.why === 'direction' ? '✓' : '✗'} 몬스터 쪽으로 밀면 → 실패(direction)`); if (d2.ok || d2.why !== 'direction') fail++;
console.log('[🛡️ 꾹 누르기]');
const hold = [{ x: 200, y: 300, t: 0 }, { x: 203, y: 302, t: 400 }, { x: 201, y: 299, t: 850 }];
const h1 = G.judge('hold', hold), h2 = G.judge('hold', hold, { heldMs: 500 }), h3 = G.judge('hold', [{ x: 0, y: 0, t: 0 }, { x: 40, y: 0, t: 900 }]);
console.log(`  ${h1.ok ? '✓' : '✗'} 0.85초 → 강타`); if (!h1.ok) fail++;
console.log(`  ${!h2.ok && h2.guard ? '✓' : '✗'} 0.5초 → 막기 자세만`); if (h2.ok || !h2.guard) fail++;
console.log(`  ${!h3.ok && h3.why === 'moved' ? '✓' : '✗'} 움직이면 → 실패(moved)`); if (h3.ok || h3.why !== 'moved') fail++;
console.log('[안내]');
const looks = G.judge('arc', star());
console.log(`  ${looks.looks === 'star' ? '✓' : '✗'} 검으로 별을 그리면 '별 커맨드' 로 안내 (looks=${looks.looks})`); if (looks.looks !== 'star') fail++;
console.log(fail ? `\n실패 ${fail}` : '\n전부 통과');
process.exit(fail ? 1 : 0);
