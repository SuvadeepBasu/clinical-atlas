
"use strict";
const D = window.__ATLAS__;
const REDUCED = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
const lc = s => String(s || "").toLowerCase();

/* ================= Domain model ================= */
const SYS = {
  Nervous:{region:"brain", organ:"Brain", css:"--s-nervous", hex:0x9d8dff},
  Cardiovascular:{region:"heart", organ:"Heart", css:"--s-cardio", hex:0xff6b7c},
  Respiratory:{region:"lungs", organ:"Lungs", css:"--s-resp", hex:0x4cc3ff},
  Digestive:{region:"gut", organ:"Stomach and intestines", css:"--s-digest", hex:0xf2a63a},
  Hepatic:{region:"liver", organ:"Liver", css:"--s-hep", hex:0xd18a5c},
  Renal:{region:"kidneys", organ:"Kidneys", css:"--s-renal", hex:0xe9c46a},
  Musculoskeletal:{region:"knees", organ:"Knee joints", css:"--s-msk", hex:0xa3b8cf},
  Endocrine:{region:"pancreas", organ:"Pancreas", css:"--s-endo", hex:0x3fd6a4}
};
const SYS_NAMES = Object.keys(SYS);
const REGION_SYS = Object.fromEntries(SYS_NAMES.map(s => [SYS[s].region, s]));
const SYS_WORDS = {
  Nervous:["brain","neuro","nervous","migraine","headache","sleep","insomnia","anxiety","mental","cognit"],
  Cardiovascular:["heart","cardio","blood pressure","hypertension","cholesterol","ldl","bp","vascular","circulat"],
  Respiratory:["lung","respirat","asthma","breath","fev1","airway"],
  Digestive:["gut","stomach","digest","bowel","ibs","intestin","abdominal","stool","constipation"],
  Hepatic:["liver","hepat","alt","fatty liver","nafld","masld"],
  Renal:["kidney","renal","egfr","albumin","nephro","ckd"],
  Musculoskeletal:["knee","joint","osteoarthritis","musculo","bone","stiffness","walk","arthritis"],
  Endocrine:["diabetes","glucose","hba1c","insulin","pancrea","endocrin","weight","metabolic"]
};
const DRUGS = D.drugs;
const TRIALS = D.trials;
const TRIAL_BY_ID = Object.fromEntries(TRIALS.map(t => [t.id, t]));
const DRUG_BY_NAME = Object.fromEntries(DRUGS.map(d => [lc(d.name), d]));
const OUTCOMES = D.outcomes;
const sysOfOutcome = o => OUTCOMES[o] ? OUTCOMES[o].sys : null;

function fmt(n, d = 2){ if (n == null || isNaN(n)) return "–"; const s = Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(d); return (n > 0 ? "+" : n < 0 ? "−" : "") + s.replace("-", ""); }
function fmtP(p){ return p <= 0.0001 ? "<0.001" : p < 0.001 ? "<0.001" : p.toFixed(3).replace(/0+$/, "").replace(/\.$/, ".0"); }

function drugTrials(drug){ return TRIALS.filter(t => t.drug === drug); }
function drugOutcomes(drug){
  const s = new Map();
  drugTrials(drug).forEach(t => t.arms.forEach(a => a.results.forEach(r => { if (!s.has(r.o)) s.set(r.o, {o:r.o, sys:r.sys, prim:false, n:0}); const x = s.get(r.o); x.n++; if (r.prim) x.prim = true; })));
  return [...s.values()].sort((a, b) => b.prim - a.prim || b.n - a.n);
}
/* Inverse-variance fixed-effect pool across placebo-controlled arms */
function pool(drug, outcome){
  const rows = [];
  drugTrials(drug).forEach(t => t.arms.forEach(a => a.results.forEach(r => { if (r.o === outcome) rows.push({t, a, r}); })));
  const pc = rows.filter(x => x.t.comparator === "Placebo");
  let sw = 0, swm = 0;
  pc.forEach(x => { const se = (x.r.hi - x.r.lo) / 3.92; const w = 1 / (se * se); x.w = w; sw += w; swm += w * x.r.md; });
  const est = sw ? swm / sw : null, se = sw ? Math.sqrt(1 / sw) : null;
  let Q = 0; pc.forEach(x => { Q += x.w * Math.pow(x.r.md - est, 2); });
  const k = pc.length, I2 = k > 1 && Q > 0 ? Math.max(0, (Q - (k - 1)) / Q) * 100 : 0;
  const z = est != null && se ? est / se : 0;
  const p = se ? Math.min(1, erfc(Math.abs(z) / Math.SQRT2)) : null;
  const meta = OUTCOMES[outcome] || {};
  rows.forEach(x => { x.wp = sw && x.w ? x.w / sw * 100 : null; });
  const tally = {pos:0, neu:0, neg:0}; rows.forEach(x => { tally[x.r.dir === "Positive" ? "pos" : x.r.dir === "Negative" ? "neg" : "neu"]++; });
  return { outcome, rows, k, est, lo: est != null ? est - 1.96 * se : null, hi: est != null ? est + 1.96 * se : null, I2, p, unit: meta.unit, better: meta.better, sys: meta.sys, tally };
}
function erfc(x){ const t = 1 / (1 + 0.5 * x); const r = t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))); return x >= 0 ? r : 2 - r; }
function safety(drug){
  const m = new Map(); let sae = 0, disc = 0, n = 0;
  drugTrials(drug).forEach(t => t.arms.forEach(a => { n++; sae += a.sae; disc += a.disc; a.aes.forEach(e => { if (!m.has(e.ae)) m.set(e.ae, {ae:e.ae, d:0, p:0, k:0}); const x = m.get(e.ae); x.d += e.drug; x.p += e.pbo; x.k++; }); }));
  const aes = [...m.values()].map(x => ({ae:x.ae, drug:x.d / x.k, pbo:x.p / x.k, k:x.k})).sort((a, b) => (b.drug - b.pbo) - (a.drug - a.pbo));
  return { aes, sae: n ? sae / n : 0, disc: n ? disc / n : 0 };
}
function drugSummary(drug){
  const d = DRUG_BY_NAME[lc(drug)]; if (!d) return null;
  const tr = drugTrials(d.name);
  const outs = drugOutcomes(d.name).map(o => { const p = pool(d.name, o.o); return { outcome:o.o, system:o.sys, primary:o.prim, arms:p.rows.length, positive:p.tally.pos, neutral:p.tally.neu, negative:p.tally.neg, pooled_difference: p.est != null ? +p.est.toFixed(2) : null, ci95: p.est != null ? [+p.lo.toFixed(2), +p.hi.toFixed(2)] : null, unit:p.unit, lower_is_better: p.better === -1, I2_percent: Math.round(p.I2), placebo_arms_pooled: p.k }; });
  const s = safety(d.name);
  return { drug:d.name, code:d.code, class:d.cls, indication:d.ind, systems:d.systems, sponsor:d.sponsor, trials:tr.length, arms:tr.reduce((n, t) => n + t.arms.length, 0), participants:tr.reduce((n, t) => n + t.n, 0), phases:[...new Set(tr.map(t => t.phase))].sort(), high_quality_trials:tr.filter(t => t.quality === "High").length, outcomes:outs, safety:{ serious_ae_rate_pct:+s.sae.toFixed(1), discontinuation_pct:+s.disc.toFixed(1), top_adverse_events:s.aes.slice(0, 4).map(e => ({event:e.ae, drug_pct:+e.drug.toFixed(1), placebo_pct:+e.pbo.toFixed(1)})) } };
}
function searchTrials({drug, system, outcome, quality} = {}){
  let ts = TRIALS;
  if (drug) ts = ts.filter(t => lc(t.drug) === lc(drug) || lc(t.code) === lc(drug));
  if (system) ts = ts.filter(t => t.arms.some(a => a.results.some(r => lc(r.sys) === lc(system))));
  if (outcome) ts = ts.filter(t => t.arms.some(a => a.results.some(r => lc(r.o).includes(lc(outcome)))));
  if (quality) ts = ts.filter(t => lc(t.quality) === lc(quality));
  return ts.slice(0, 18).map(t => ({ id:t.id, drug:t.drug, phase:t.phase, year:t.year, design:t.design, quality:t.quality, participants:t.n, duration:t.duration,
    results:t.arms.flatMap(a => a.results.filter(r => outcome ? lc(r.o).includes(lc(outcome)) : system ? lc(r.sys) === lc(system) : r.prim).map(r => ({dose:a.dose, outcome:r.o, difference:r.md, unit:r.unit, ci95:[r.lo, r.hi], p:r.p, result:r.dir}))) }));
}
function trialDetail(id){
  const t = TRIAL_BY_ID[String(id || "").toUpperCase()]; if (!t) return null;
  return { id:t.id, registry:t.reg, title:t.title, drug:t.drug, phase:t.phase, year:t.year, design:t.design, comparator:t.comparator, quality:t.quality, duration:t.duration, population:t.pop, participants:t.n, countries:t.countries, sponsor:t.sponsor, lead_author:t.authors[0],
    arms:t.arms.map(a => ({dose:a.dose, n:a.n, results:a.results.map(r => ({outcome:r.o, primary:r.prim, difference:r.md, unit:r.unit, ci95:[r.lo, r.hi], p:r.p, result:r.dir})), serious_ae_pct:a.sae, discontinuation_pct:a.disc, adverse_events:a.aes.map(e => ({event:e.ae, drug_pct:e.drug, placebo_pct:e.pbo}))})) };
}
function systemDrugs(system){
  return DRUGS.filter(d => drugOutcomes(d.name).some(o => o.sys === system)).map(d => {
    const outs = drugOutcomes(d.name).filter(o => o.sys === system).map(o => pool(d.name, o.o));
    return { d, outs };
  });
}

/* ================= Anatomy engine v2 (procedural, three.js r128) =================
   Skin: smooth signed-distance body meshed with surface nets, rendered as an X-ray / clinical shell.
   Skeleton, organs, vessels and nerves: sculpted from SDFs and tubes, lit with a studio environment. */
const Atlas = (() => {
  const T = THREE, V3 = (x, y, z) => new T.Vector3(x, y, z);

  /* ---------- noise ---------- */
  const PERM = new Uint8Array(512);
  (() => { const p = []; for (let i = 0; i < 256; i++) p[i] = i; let s = 1337; for (let i = 255; i > 0; i--){ s = (s * 16807) % 2147483647; const j = s % (i + 1); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]; })();
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10), lerp = (a, b, t) => a + t * (b - a);
  function grad(h, x, y, z){ const u = (h & 15) < 8 ? x : y, v = (h & 15) < 4 ? y : ((h & 15) === 12 || (h & 15) === 14) ? x : z; return ((h & 1) ? -u : u) + ((h & 2) ? -v : v); }
  function noise(x, y, z){
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255; x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = fade(x), v = fade(y), w = fade(z), A = PERM[X] + Y, AA = PERM[A] + Z, AB = PERM[A + 1] + Z, B = PERM[X + 1] + Y, BA = PERM[B] + Z, BB = PERM[B + 1] + Z;
    return lerp(lerp(lerp(grad(PERM[AA], x, y, z), grad(PERM[BA], x - 1, y, z), u), lerp(grad(PERM[AB], x, y - 1, z), grad(PERM[BB], x - 1, y - 1, z), u), v),
                lerp(lerp(grad(PERM[AA + 1], x, y, z - 1), grad(PERM[BA + 1], x - 1, y, z - 1), u), lerp(grad(PERM[AB + 1], x, y - 1, z - 1), grad(PERM[BB + 1], x - 1, y - 1, z - 1), u), v), w);
  }

  /* ---------- SDF primitives ---------- */
  function ell(px, py, pz, cx, cy, cz, rx, ry, rz){ const x = (px - cx) / rx, y = (py - cy) / ry, z = (pz - cz) / rz; const k0 = Math.sqrt(x * x + y * y + z * z); const k1 = Math.sqrt(x * x / (rx * rx) + y * y / (ry * ry) + z * z / (rz * rz)); return k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -Math.min(rx, ry, rz); }
  function cap(px, py, pz, ax, ay, az, bx, by, bz, ra, rb){
    const pax = px - ax, pay = py - ay, paz = pz - az, bax = bx - ax, bay = by - ay, baz = bz - az;
    let h = (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz); h = h < 0 ? 0 : h > 1 ? 1 : h;
    const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h; return Math.sqrt(dx * dx + dy * dy + dz * dz) - (ra + (rb - ra) * h);
  }
  function smin(a, b, k){ const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
  function smax(a, b, k){ return -smin(-a, -b, k); }
  function chain(px, py, pz, pts, k){ let d = 1e9; for (let i = 0; i < pts.length - 1; i++){ const a = pts[i], b = pts[i + 1]; d = smin(d, cap(px, py, pz, a[0], a[1], a[2], b[0], b[1], b[2], a[3], b[3]), k); } return d; }
  function rotY(x, z, a){ const c = Math.cos(a), s = Math.sin(a); return [c * x + s * z, -s * x + c * z]; }
  function rotZ(x, y, a){ const c = Math.cos(a), s = Math.sin(a); return [c * x - s * y, s * x + c * y]; }

  /* ---------- surface nets mesher ---------- */
  const EDGES = [[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];
  function mesh(sdf, bmin, bmax, step){
    const nx = Math.ceil((bmax[0] - bmin[0]) / step) + 1, ny = Math.ceil((bmax[1] - bmin[1]) / step) + 1, nz = Math.ceil((bmax[2] - bmin[2]) / step) + 1;
    const F = new Float32Array(nx * ny * nz);
    // coarse pass: only refine near the surface
    const C = 4, cx = Math.ceil(nx / C) + 1, cy = Math.ceil(ny / C) + 1, cz = Math.ceil(nz / C) + 1, CF = new Float32Array(cx * cy * cz), band = step * C * 1.9;
    for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) CF[i + cx * (j + cy * k)] = sdf(bmin[0] + i * C * step, bmin[1] + j * C * step, bmin[2] + k * C * step);
    for (let k = 0; k < nz; k++){ const z = bmin[2] + k * step, ck = Math.round(k / C);
      for (let j = 0; j < ny; j++){ const y = bmin[1] + j * step, cj = Math.round(j / C);
        for (let i = 0; i < nx; i++){ const c = CF[Math.round(i / C) + cx * (cj + cy * ck)]; F[i + nx * (j + ny * k)] = Math.abs(c) > band ? c : sdf(bmin[0] + i * step, y, z); } } }
    const vid = new Int32Array(nx * ny * nz).fill(-1), pos = [], corner = new Float32Array(8);
    for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++){
      let mask = 0;
      for (let c = 0; c < 8; c++){ const v = F[(i + (c & 1)) + nx * ((j + ((c >> 1) & 1)) + ny * (k + ((c >> 2) & 1)))]; corner[c] = v; if (v < 0) mask |= 1 << c; }
      if (mask === 0 || mask === 255) continue;
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (const [a, b] of EDGES){ const va = corner[a], vb = corner[b]; if ((va < 0) === (vb < 0)) continue; const t = va / (va - vb);
        sx += (a & 1) + t * ((b & 1) - (a & 1)); sy += ((a >> 1) & 1) + t * (((b >> 1) & 1) - ((a >> 1) & 1)); sz += ((a >> 2) & 1) + t * (((b >> 2) & 1) - ((a >> 2) & 1)); n++; }
      vid[i + nx * (j + ny * k)] = pos.length / 3;
      pos.push(bmin[0] + (i + sx / n) * step, bmin[1] + (j + sy / n) * step, bmin[2] + (k + sz / n) * step);
    }
    const idx = [], at = (i, j, k) => vid[i + nx * (j + ny * k)], f = (i, j, k) => F[i + nx * (j + ny * k)];
    for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++){
      const v0 = f(i, j, k) < 0;
      if (v0 !== (f(i + 1, j, k) < 0)){ const q = [at(i, j - 1, k - 1), at(i, j, k - 1), at(i, j, k), at(i, j - 1, k)]; quad(q, v0); }
      if (v0 !== (f(i, j + 1, k) < 0)){ const q = [at(i - 1, j, k - 1), at(i - 1, j, k), at(i, j, k), at(i, j, k - 1)]; quad(q, v0); }
      if (v0 !== (f(i, j, k + 1) < 0)){ const q = [at(i - 1, j - 1, k), at(i, j - 1, k), at(i, j, k), at(i - 1, j, k)]; quad(q, v0); }
    }
    function quad(q, flip){ if (q.some(v => v < 0)) return; if (flip) idx.push(q[0], q[1], q[2], q[0], q[2], q[3]); else idx.push(q[0], q[2], q[1], q[0], q[3], q[2]); }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    // make winding agree with outward SDF gradients (sampled), then smooth vertex normals
    const ix = g.index.array, e = step * 0.5; let agree = 0, total = 0;
    const stride = Math.max(3, Math.floor(ix.length / 3 / 300)) * 3;
    for (let t = 0; t < ix.length; t += stride){ const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], wx = pos[c] - pos[a], wy = pos[c + 1] - pos[a + 1], wz = pos[c + 2] - pos[a + 2];
      const fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx, x = pos[a], y = pos[a + 1], z = pos[a + 2];
      const gx = sdf(x + e, y, z) - sdf(x - e, y, z), gy = sdf(x, y + e, z) - sdf(x, y - e, z), gz = sdf(x, y, z + e) - sdf(x, y, z - e);
      agree += (fx * gx + fy * gy + fz * gz) > 0 ? 1 : 0; total++; }
    if (agree < total / 2) for (let t = 0; t < ix.length; t += 3){ const s = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = s; }
    g.computeVertexNormals();
    return g;
  }

  /* ---------- tubes with variable radius ---------- */
  function tube(pts, r, opts = {}){
    const curve = new T.CatmullRomCurve3(pts.map(p => V3(p[0], p[1], p[2])), false, "centripetal");
    const segs = opts.segs || Math.max(16, Math.round(curve.getLength() / 0.004)), rad = opts.radial || 10;
    const g = new T.TubeGeometry(curve, segs, 1, rad, false);
    const P = g.attributes.position, N = g.attributes.normal, c = new T.Vector3();
    for (let i = 0; i <= segs; i++){ const t = i / segs; curve.getPointAt(t, c); const rr = typeof r === "function" ? r(t, i) : r;
      for (let j = 0; j <= rad; j++){ const k = i * (rad + 1) + j; P.setXYZ(k, c.x + N.getX(k) * rr, c.y + N.getY(k) * rr, c.z + N.getZ(k) * rr); } }
    P.needsUpdate = true; g.computeVertexNormals(); return g;
  }
  function mirror(pts){ return pts.map(p => [-p[0], p[1], p[2], p[3]]); }
  function sphereAt(r, p, s = [1, 1, 1]){ const g = new T.SphereGeometry(r, 24, 18); g.scale(...s); g.translate(...p); return g; }
  const merge = gs => T.BufferGeometryUtils.mergeBufferGeometries(gs.map(g => g.index ? g : g), false);

  /* ---------- body (skin) ---------- */
  function bodySDF(x, y, z){
    const ax = Math.abs(x);
    if (y > 0.62){ // head and neck
      let d = ell(x, y, z, 0, 0.845, 0.004, 0.077, 0.1, 0.092);
      d = smin(d, ell(x, y, z, 0, 0.775, 0.03, 0.058, 0.052, 0.066), 0.035);
      d = smin(d, ell(x, y, z, 0, 0.738, 0.062, 0.022, 0.018, 0.02), 0.03);                    // chin
      d = smin(d, cap(x, y, z, 0, 0.815, 0.088, 0, 0.787, 0.104, 0.008, 0.012), 0.012);       // nose
      d = smin(d, ell(x, y, z, 0, 0.79, 0.098, 0.016, 0.01, 0.01), 0.01);
      d = smin(d, ell(ax, y, z, 0.078, 0.82, -0.005, 0.012, 0.026, 0.017), 0.012);           // ears
      d = smin(d, ell(x, y, z, 0, 0.843, 0.085, 0.06, 0.012, 0.012), 0.02);                   // brow
      d = smax(d, -ell(ax, y, z, 0.031, 0.825, 0.098, 0.017, 0.011, 0.01), 0.014);            // eye sockets
      d = smin(d, ell(ax, y, z, 0.031, 0.825, 0.088, 0.012, 0.008, 0.008), 0.004);            // eyes
      d = smin(d, ell(x, y, z, 0, 0.765, 0.084, 0.019, 0.006, 0.01), 0.008);                  // lips
      d = smin(d, cap(x, y, z, 0, 0.6, -0.008, 0, 0.76, 0.0, 0.048, 0.043), 0.04);            // neck
      if (y < 0.7) d = smin(d, torso(x, y, z, ax), 0.05);
      return d;
    }
    return torso(x, y, z, ax);
  }
  function torso(x, y, z, ax){
    let d = 1e9;
    if (y > -0.13 && y < 0.73){
    d = cap(ax, y, z, 0, 0.64, -0.01, 0.15, 0.6, -0.012, 0.045, 0.05);                         // trapezius line
    d = smin(d, ell(x, y, z, 0, 0.5, 0.0, 0.158, 0.15, 0.098), 0.05);                          // chest
    d = smin(d, ell(ax, y, z, 0.062, 0.495, 0.048, 0.068, 0.05, 0.048), 0.04);                // pectorals
    d = smin(d, ell(x, y, z, 0, 0.31, 0.004, 0.128, 0.16, 0.086), 0.07);                       // abdomen
    d = smin(d, ell(x, y, z, 0, 0.09, -0.004, 0.148, 0.1, 0.092), 0.06);                       // pelvis
    d = smin(d, ell(ax, y, z, 0.068, 0.035, -0.052, 0.074, 0.078, 0.062), 0.04);              // glutes
    }
    if (ax > 0.1 && y > -0.16 && y < 0.67){
    d = smin(d, ell(ax, y, z, 0.176, 0.586, 0.0, 0.058, 0.056, 0.056), 0.035);                // deltoids
    d = smin(d, cap(ax, y, z, 0.186, 0.57, 0.0, 0.223, 0.29, -0.012, 0.046, 0.036), 0.03);    // upper arm
    d = smin(d, ell(ax, y, z, 0.206, 0.43, 0.018, 0.03, 0.07, 0.03), 0.02);                   // biceps
    d = smin(d, cap(ax, y, z, 0.223, 0.29, -0.012, 0.246, 0.035, 0.033, 0.037, 0.022), 0.025);// forearm
    d = smin(d, ell(ax, y, z, 0.233, 0.22, 0.0, 0.033, 0.07, 0.032), 0.02);
    d = smin(d, ell(ax, y, z, 0.251, -0.024, 0.04, 0.015, 0.046, 0.036), 0.022);              // palm
    d = smin(d, cap(ax, y, z, 0.253, -0.062, 0.042, 0.256, -0.128, 0.044, 0.016, 0.011), 0.02); // fingers
    d = smin(d, cap(ax, y, z, 0.247, 0.0, 0.07, 0.243, -0.042, 0.088, 0.01, 0.007), 0.015);   // thumb
    }
    if (y < 0.14){
    d = smin(d, cap(ax, y, z, 0.083, 0.02, 0.0, 0.094, -0.44, 0.012, 0.08, 0.05), 0.06);      // thigh
    d = smin(d, ell(ax, y, z, 0.094, -0.462, 0.016, 0.046, 0.05, 0.046), 0.03);              // knee
    d = smin(d, cap(ax, y, z, 0.095, -0.48, 0.006, 0.099, -0.905, -0.008, 0.045, 0.027), 0.03); // shin
    d = smin(d, ell(ax, y, z, 0.097, -0.615, -0.022, 0.046, 0.11, 0.048), 0.04);             // calf
    d = smin(d, ell(ax, y, z, 0.1, -0.973, 0.034, 0.034, 0.024, 0.088), 0.03);               // foot
    d = smin(d, ell(ax, y, z, 0.099, -0.965, -0.035, 0.026, 0.028, 0.03), 0.02);             // heel
    }
    return smax(d, -(y + 0.998), 0.01);                                                         // flat soles
  }

  /* ---------- organs ---------- */
  function brainSDF(x, y, z){
    const lx = x, ly = y - 0.862, lz = z + 0.004, ax = Math.abs(lx);
    let d = ell(ax, ly, lz, 0.031, 0.002, 0.0, 0.037, 0.056, 0.079);
    d = smin(d, ell(ax, ly, lz, 0.043, -0.028, 0.012, 0.025, 0.024, 0.042), 0.02);            // temporal lobes
    d = smax(d, -(ly + 0.046), 0.02);
    if (ly > -0.032) d = smax(d, 0.0024 - ax, 0.003);                                          // longitudinal fissure
    const n = noise(x * 70, y * 70, z * 70) + 0.5 * noise(x * 140 + 7, y * 140, z * 140);
    d += 0.0036 * (0.42 - Math.min(1, Math.abs(n) * 1.6));                                     // gyri and sulci
    let cb = ell(lx, ly, lz, 0, -0.036, -0.056, 0.05, 0.024, 0.03);
    cb += 0.0011 * Math.sin(ly * 950 + lz * 160);                                               // cerebellar folia
    d = smin(d, cb, 0.006);
    d = smin(d, cap(lx, ly, lz, 0, -0.03, -0.022, 0, -0.1, -0.032, 0.012, 0.009), 0.01);      // brainstem
    return d;
  }
  function heartSDF(x, y, z){
    let lx = x - 0.024, ly = y - 0.45, lz = z - 0.045;
    [lx, ly] = rotZ(lx, ly, 0.5); [lx, lz] = rotY(lx, lz, -0.35);
    const taper = 1 + Math.max(0, -ly) * 9;
    let d = ell(lx * taper * 0.85, ly, lz * taper * 0.85, 0, -0.006, 0, 0.034, 0.048, 0.03);     // ventricles with apex
    d = smin(d, ell(lx, ly, lz, -0.024, 0.026, 0.004, 0.02, 0.02, 0.022), 0.015);             // right atrium
    d = smin(d, ell(lx, ly, lz, 0.012, 0.03, -0.018, 0.02, 0.016, 0.018), 0.015);             // left atrium
    d += 0.0016 * Math.exp(-Math.pow((lx + 0.004 - ly * 0.25) / 0.003, 2));                   // interventricular groove
    return d;
  }
  function lungSDF(s){ return (x, y, z) => {
    const lx = x - s * 0.072, ly = y - 0.468, lz = z + 0.002;
    let d = ell(lx, ly, lz, 0, 0, 0, 0.058, 0.112, 0.066);
    d = smax(d, -(s * lx) - 0.03, 0.02);                                                        // flat medial face
    d = smax(d, -ell(lx, ly, lz, 0, -0.17, 0.01, 0.12, 0.08, 0.1), 0.02);                      // diaphragm dome
    if (s > 0) d = smax(d, -ell(x, y, z, 0.03, 0.44, 0.05, 0.045, 0.05, 0.045), 0.015);       // cardiac notch
    const fis = (lz * 0.9 + ly * 1.0 + 0.01) / 1.35; d = smax(d, 0.0032 - Math.abs(fis), 0.003); // oblique fissure
    return d + 0.0012 * noise(x * 90, y * 90, z * 90);
  }; }
  function liverSDF(x, y, z){
    const lx = x + 0.048, ly = y - 0.305, lz = z - 0.028;
    let d = ell(lx, ly, lz, -0.03, 0.0, 0.0, 0.075, 0.052, 0.062);
    d = smin(d, ell(lx, ly, lz, 0.05, 0.014, 0.012, 0.055, 0.027, 0.046), 0.03);
    d = smax(d, (-(ly) - 0.022 + lx * 0.18), 0.02);                                            // inferior surface
    d = smax(d, ly - 0.05 + (lx * lx) * 3, 0.03);                                               // diaphragmatic dome
    return d + 0.0009 * noise(x * 60, y * 60, z * 60);
  }
  const stomachPts = [[0.034, 0.338, 0.016, 0.009], [0.06, 0.335, 0.03, 0.03], [0.078, 0.3, 0.05, 0.031], [0.062, 0.26, 0.062, 0.026], [0.03, 0.246, 0.064, 0.019], [0.004, 0.252, 0.06, 0.012], [-0.012, 0.257, 0.056, 0.009]];
  function stomachSDF(x, y, z){ return chain(x, y, z, stomachPts, 0.02) + 0.0008 * noise(x * 120, y * 120, z * 120); }
  function kidneySDF(s){ return (x, y, z) => {
    const lx = x - s * 0.068, ly = y - (s > 0 ? 0.24 : 0.228), lz = z + 0.052; const [rx, ry] = rotZ(lx, ly, s * 0.2);
    let d = ell(rx, ry, lz, 0, 0, 0, 0.022, 0.043, 0.017);
    d = smax(d, -ell(rx, ry, lz, -s * 0.024, 0, 0.004, 0.012, 0.016, 0.012), 0.008);           // hilum
    d = smin(d, ell(rx, ry, lz, s * 0.004, 0.047, -0.002, 0.016, 0.009, 0.01), 0.004);        // adrenal cap
    return d;
  }; }
  const pancPts = [[-0.026, 0.248, 0.028, 0.018], [-0.002, 0.258, 0.014, 0.013], [0.04, 0.268, 0.002, 0.011], [0.088, 0.287, -0.012, 0.009]];
  function pancreasSDF(x, y, z){ return chain(x, y, z, pancPts, 0.012) + 0.0028 * noise(x * 150, y * 150, z * 150); }
  function spleenSDF(x, y, z){ let d = ell(x, y, z, 0.108, 0.305, -0.035, 0.02, 0.042, 0.03); return smax(d, -ell(x, y, z, 0.085, 0.3, -0.03, 0.018, 0.04, 0.03), 0.01); }
  function thyroidSDF(x, y, z){ const ax = Math.abs(x); return smin(ell(ax, y, z, 0.012, 0.684, 0.032, 0.008, 0.016, 0.007), ell(x, y, z, 0, 0.676, 0.038, 0.008, 0.004, 0.004), 0.006); }
  function bladderSDF(x, y, z){ return ell(x, y, z, 0, 0.018, 0.036, 0.034, 0.027, 0.03); }

  /* ---------- skeleton ---------- */
  function skullSDF(x, y, z){
    const ax = Math.abs(x);
    let d = ell(x, y, z, 0, 0.858, -0.006, 0.07, 0.083, 0.087);
    d = smin(d, ell(x, y, z, 0, 0.79, 0.045, 0.046, 0.042, 0.04), 0.02);
    d = smin(d, cap(ax, y, z, 0.048, 0.8, 0.05, 0.067, 0.808, 0.0, 0.006, 0.005), 0.01);       // zygomatic arches
    d = smax(d, -ell(ax, y, z, 0.029, 0.823, 0.078, 0.017, 0.016, 0.02), 0.006);              // orbits
    d = smax(d, -ell(x, y, z, 0, 0.795, 0.088, 0.009, 0.015, 0.02), 0.004);                   // nasal aperture
    const jaw = chain(ax, y, z, [[0.058, 0.81, -0.012, 0.008], [0.055, 0.765, 0.0, 0.009], [0.04, 0.742, 0.05, 0.009], [0.0, 0.736, 0.07, 0.01]], 0.01);
    return smin(d, jaw, 0.004);
  }
  function scapulaSDF(x, y, z){ const ax = Math.abs(x); let [lx, lz] = rotY(ax - 0.1, z + 0.074, 0.45); return smin(ell(lx, y - 0.52, lz, 0, 0, 0, 0.045, 0.06, 0.006), cap(lx, y - 0.52, lz, -0.03, 0.055, 0.0, 0.055, 0.075, 0.03, 0.006, 0.007), 0.01); }
  function pelvisSDF(x, y, z){
    const ax = Math.abs(x);
    let [lx, lz] = rotY(ax - 0.075, z + 0.012, 0.6); let ly; [lx, ly] = rotZ(lx, y - 0.112, -0.28);
    let d = ell(lx, ly, lz, 0, 0, 0, 0.062, 0.058, 0.01);                                       // iliac wings
    d = smin(d, cap(ax, y, z, 0.085, 0.045, 0.004, 0.06, 0.012, 0.05, 0.016, 0.012), 0.015);  // acetabulum to pubis
    d = smin(d, cap(ax, y, z, 0.06, 0.012, 0.05, 0.012, 0.0, 0.066, 0.012, 0.011), 0.01);      // pubic arch
    d = smin(d, cap(ax, y, z, 0.075, 0.03, -0.01, 0.062, -0.025, -0.022, 0.016, 0.013), 0.012);// ischium
    d = smin(d, ell(x, y, z, 0, 0.07, -0.055, 0.038, 0.05, 0.016), 0.02);                      // sacrum
    d = smax(d, -ell(ax, y, z, 0.086, 0.03, 0.004, 0.019, 0.019, 0.019), 0.004);              // hip socket
    return d;
  }
  function longBone(a, b, r, ends = 1.7){ const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const prof = []; for (let i = 0; i <= 24; i++){ const t = i / 24; const flare = Math.pow(Math.abs(t - 0.5) * 2, 6); prof.push(new T.Vector2(r * (1 + (ends - 1) * flare) * (i === 0 || i === 24 ? 0.6 : 1), t * L)); }
    const g = new T.LatheGeometry(prof, 14); const m = new T.Matrix4(), q = new T.Quaternion().setFromUnitVectors(V3(0, 1, 0), V3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize());
    m.compose(V3(...a), q, V3(1, 1, 1)); g.applyMatrix4(m); return g; }

  /* ---------- assets ---------- */
  const COL = { skinX:0x58d6ff, bone:0xd8c9ab, cart:0xa9d3dc, brain:0xe7a29b, heart:0xb3302d, lung:0xd98680, liver:0x7e2219, gall:0x4f7a3a, stomach:0xe0907e, small:0xe7927a, colon:0xcf7e66, kidney:0x8a2b28, adrenal:0xd9a64e, panc:0xefbd73, spleen:0x6d2738, thyroid:0xa9433d, bladder:0xe8b49b, artery:0xc4222a, vein:0x2f4fb3, nerve:0xf2c94c, trachea:0xd9c3b8, eso:0xd98f86 };
  function organMat(hex, opt = {}){ const c = new T.Color(hex).convertSRGBToLinear(); return new T.MeshPhysicalMaterial(Object.assign({ color:c, roughness:0.42, metalness:0, clearcoat:0.55, clearcoatRoughness:0.35, emissive:c.clone(), emissiveIntensity:0.0, envMapIntensity:0.55, transparent:true, opacity:1 }, opt)); }

  let renderer, scene, camera, controls, canvas, labelHost, tip, skin, skinMat, onPick = () => {}, onHover = () => {};
  const regions = {}, layers = { skin:[], skeleton:[], organs:[], vessels:[], nerves:[] }, pickables = [], labels = {};
  let active = new Set(), t = 0, visible = true, animating = null, mode = "xray", ready = false, readyCbs = [];
  const goal = { pos:V3(0, 0, 4.1), tgt:V3(0, -0.02, 0) };
  const VIEWS = { body:[[0, 0.0, 4.1], [0, -0.02, 0]], brain:[[0.55, 0.92, 0.72], [0, 0.845, 0]], heart:[[0.35, 0.5, 0.95], [0.02, 0.46, 0.02]], lungs:[[0.2, 0.52, 1.25], [0, 0.47, 0]],
    liver:[[-0.45, 0.36, 0.95], [-0.04, 0.3, 0.02]], gut:[[0.12, 0.2, 1.15], [0, 0.17, 0.03]], kidneys:[[-0.15, 0.3, -1.05], [0, 0.23, -0.04]], pancreas:[[0.3, 0.32, 0.95], [0.03, 0.27, 0.02]], knees:[[0.45, -0.38, 1.05], [0, -0.47, 0.01]], torso:[[0, 0.3, 2.3], [0, 0.28, 0]] };
  const ANCHOR = { brain:[0, 0.9, 0.02], heart:[0.03, 0.47, 0.07], lungs:[-0.09, 0.52, 0.04], liver:[-0.085, 0.32, 0.07], gut:[0.03, 0.15, 0.08], kidneys:[-0.075, 0.25, -0.05], pancreas:[0.045, 0.27, 0.01], knees:[-0.095, -0.45, 0.055] };
  const REGION_NAMES = { brain:"Brain", heart:"Heart", lungs:"Lungs", liver:"Liver", gut:"Stomach and intestines", kidneys:"Kidneys", pancreas:"Pancreas", knees:"Knee joints" };

  function add(layer, geo, mat, name, region){
    const m = new T.Mesh(geo, mat); m.userData = { name, region, layer }; m.renderOrder = layer === "skin" ? 10 : layer === "vessels" || layer === "nerves" ? 2 : 1;
    layers[layer].push(m); if (region){ (regions[region] = regions[region] || []).push(m); }
    if (layer !== "skin") pickables.push(m);
    scene.add(m); return m;
  }

  function skinMaterial(){
    return new T.ShaderMaterial({ transparent:true, depthWrite:false, side:T.FrontSide,
      uniforms:{ uBase:{value:new T.Color(0x0c4f6c)}, uRim:{value:new T.Color(0x7fe9ff)}, uOp:{value:0.08}, uRimOp:{value:0.9}, uPow:{value:1.9}, uScan:{value:0}, uScanOn:{value:1}, uFade:{value:1} },
      vertexShader:`varying vec3 vN; varying vec3 vV; varying float vY;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); vY = position.y; gl_Position = projectionMatrix*mv; }`,
      fragmentShader:`uniform vec3 uBase; uniform vec3 uRim; uniform float uOp; uniform float uRimOp; uniform float uPow; uniform float uScan; uniform float uScanOn; uniform float uFade; varying vec3 vN; varying vec3 vV; varying float vY;
        void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); float rim = pow(f, uPow);
          float band = uScanOn * smoothstep(0.03, 0.0, abs(vY - uScan));
          vec3 c = mix(uBase, uRim, rim) + band * uRim * 0.6; float a = (uOp + rim * uRimOp + band * 0.25) * uFade; gl_FragColor = vec4(c, a); }` });
  }

  async function build(progress){
    const tick = (p, label) => new Promise(r => { progress(p, label); setTimeout(r, 0); });
    await tick(0.05, "Shaping body");
    skinMat = skinMaterial(); skin = add("skin", mesh(bodySDF, [-0.3, -1.0, -0.13], [0.3, 0.955, 0.14], 0.0072), skinMat, "Skin");
    await tick(0.3, "Building skeleton");
    const bone = organMat(COL.bone, { clearcoat:0.1, roughness:0.68, envMapIntensity:0.4 }), skullM = organMat(COL.bone, { clearcoat:0.1, roughness:0.68, envMapIntensity:0.4, opacity:0.32, depthWrite:false });
    const cart = organMat(COL.cart, { clearcoat:0.4, roughness:0.4 });
    const sk = add("skeleton", mesh(skullSDF, [-0.08, 0.72, -0.1], [0.08, 0.95, 0.11], 0.0035), skullM, "Skull"); sk.userData.skull = true;
    const spine = [[0, 0.74, -0.012], [0, 0.66, -0.02], [0, 0.6, -0.045], [0, 0.5, -0.062], [0, 0.4, -0.063], [0, 0.3, -0.052], [0, 0.2, -0.038], [0, 0.12, -0.044]];
    const sc = new T.CatmullRomCurve3(spine.map(p => V3(...p))); const verts = [];
    for (let i = 0; i < 24; i++){ const u = i / 23, p = sc.getPointAt(u), tg = sc.getTangentAt(u), r = 0.0065 + u * 0.009;
      const body = new T.CylinderGeometry(r, r, r * 1.15, 14); const proc = new T.BoxGeometry(r * 0.35, r * 0.7, r * 2.0); proc.translate(0, -r * 0.25, -r * 1.55);
      const trans = new T.BoxGeometry(r * 3.2, r * 0.45, r * 0.5); trans.translate(0, 0, -r * 0.9);
      const v = merge([body.toNonIndexed(), proc.toNonIndexed(), trans.toNonIndexed()]); const q = new T.Quaternion().setFromUnitVectors(V3(0, 1, 0), tg);
      v.applyMatrix4(new T.Matrix4().compose(p, q, V3(1, 1, 1))); verts.push(v); }
    add("skeleton", merge(verts), bone, "Vertebral column");
    const ribs = [];
    const A = [0.058, 0.082, 0.098, 0.108, 0.116, 0.121, 0.123, 0.122, 0.118, 0.11, 0.098, 0.085];
    for (let i = 0; i < 12; i++) for (const s of [1, -1]){
      const yb = 0.6 - i * 0.021, zb = -0.052, zf = 0.072 - Math.max(0, i - 6) * 0.004, zc = (zb + zf) / 2, bz = (zf - zb) / 2, drop = 0.045 + i * 0.004;
      const end = i < 10 ? Math.PI * 0.74 : Math.PI * (0.5 - (i - 10) * 0.08), pt = tt => [s * A[i] * Math.sin(tt), yb - drop * (1 - Math.cos(tt)) / 2, zc - bz * Math.cos(tt)];
      const bonePts = []; for (let k = 0; k <= 16; k++) bonePts.push(pt(0.12 + (end - 0.12) * k / 16));
      ribs.push(tube(bonePts, tt => 0.0042 * (1 - 0.25 * tt), { radial:7 }));
      if (i < 10){ const cp = []; const tEnd = Math.PI * 0.97; for (let k = 0; k <= 8; k++){ const tt = end + (tEnd - end) * k / 8; const p = pt(tt); if (i >= 7){ p[1] += (k / 8) * (i - 6) * 0.03; } cp.push(p); }
        if (i < 7) cp.push([s * 0.012, 0.565 - i * 0.022, 0.082]); add("skeleton", tube(cp, 0.0036, { radial:7 }), cart, "Costal cartilage"); }
    }
    add("skeleton", merge(ribs), bone, "Ribs");
    const misc = [];
    add("skeleton", mesh((x, y, z) => smin(ell(x, y, z, 0, 0.552, 0.084, 0.018, 0.022, 0.006), ell(x, y, z, 0, 0.47, 0.09, 0.013, 0.07, 0.006), 0.01), [-0.03, 0.38, 0.07], [0.03, 0.58, 0.105], 0.003), bone, "Sternum");
    for (const s of [1, -1]){
      misc.push(tube([[s * 0.016, 0.586, 0.07], [s * 0.07, 0.6, 0.075], [s * 0.13, 0.606, 0.032], [s * 0.162, 0.602, 0.0]], 0.0055, { radial:8 }));
      misc.push(longBone([s * 0.183, 0.58, -0.004], [s * 0.222, 0.305, -0.012], 0.0085, 2.0)); misc.push(sphereAt(0.02, [s * 0.178, 0.585, -0.004]));
      misc.push(longBone([s * 0.222, 0.3, -0.004], [s * 0.244, 0.05, 0.036], 0.0055, 1.7)); misc.push(longBone([s * 0.218, 0.305, -0.018], [s * 0.247, 0.05, 0.024], 0.005, 1.8));
      misc.push(sphereAt(0.013, [s * 0.249, 0.028, 0.034], [0.8, 0.9, 1.4]));
      for (let f = 0; f < 4; f++){ const zz = 0.02 + f * 0.013; misc.push(longBone([s * 0.25, 0.012, zz + 0.006], [s * 0.252, -0.055, zz], 0.0032, 1.6)); misc.push(longBone([s * 0.253, -0.06, zz], [s * 0.256, -0.122 + (f === 0 || f === 3 ? 0.01 : 0), zz + 0.002], 0.0026, 1.5)); }
      misc.push(longBone([s * 0.248, 0.015, 0.06], [s * 0.244, -0.035, 0.084], 0.0032, 1.5));
      misc.push(sphereAt(0.02, [s * 0.083, 0.03, 0.004])); misc.push(longBone([s * 0.085, 0.028, 0.004], [s * 0.112, 0.002, 0.0], 0.01, 1.2)); misc.push(sphereAt(0.014, [s * 0.12, 0.012, -0.006]));
      misc.push(longBone([s * 0.108, 0.0, 0.0], [s * 0.094, -0.448, 0.008], 0.0105, 2.3));
      misc.push(longBone([s * 0.094, -0.478, 0.008], [s * 0.096, -0.915, -0.002], 0.0105, 2.4)); misc.push(longBone([s * 0.116, -0.49, -0.008], [s * 0.113, -0.925, -0.01], 0.0045, 1.6));
      misc.push(sphereAt(0.02, [s * 0.1, -0.95, 0.0], [0.8, 0.75, 1.6]));
      for (let f = 0; f < 5; f++){ const xx = s * (0.084 + f * 0.0075); misc.push(longBone([xx, -0.962, 0.025], [xx * 1.02, -0.988, 0.09 - f * 0.006], 0.003, 1.6)); misc.push(longBone([xx * 1.02, -0.99, 0.093 - f * 0.006], [xx * 1.03, -0.995, 0.118 - f * 0.01], 0.0026, 1.4)); }
    }
    add("skeleton", merge(misc.map(g => g.index ? g.toNonIndexed() : g)), bone, "Skeleton");
    add("skeleton", mesh(scapulaSDF, [-0.17, 0.43, -0.12], [0.17, 0.62, -0.03], 0.004), bone, "Scapula");
    add("skeleton", mesh(pelvisSDF, [-0.15, -0.05, -0.08], [0.15, 0.19, 0.08], 0.0036), bone, "Pelvis");
    await tick(0.55, "Placing organs");
    add("organs", mesh(brainSDF, [-0.08, 0.75, -0.1], [0.08, 0.93, 0.09], 0.0023), organMat(COL.brain, { roughness:0.5, clearcoat:0.5 }), "Brain", "brain");
    await tick(0.68, "Placing organs");
    add("organs", mesh(heartSDF, [-0.04, 0.38, -0.02], [0.09, 0.52, 0.1], 0.0026), organMat(COL.heart, { clearcoat:0.7 }), "Heart", "heart");
    add("organs", tube([[0.008, 0.485, 0.05], [0.004, 0.53, 0.042], [0.012, 0.548, 0.012], [0.016, 0.52, -0.03], [0.014, 0.45, -0.042]], 0.0085), organMat(COL.artery), "Aortic arch", "heart");
    add("organs", tube([[0.02, 0.478, 0.068], [0.028, 0.51, 0.06], [0.05, 0.52, 0.035]], 0.008), organMat(0x9c3a63), "Pulmonary trunk", "heart");
    add("organs", tube([[-0.022, 0.47, 0.035], [-0.022, 0.53, 0.028], [-0.02, 0.57, 0.02]], 0.0075), organMat(COL.vein), "Superior vena cava", "heart");
    add("organs", merge([tube([[0.0, 0.478, 0.072], [0.02, 0.455, 0.08], [0.04, 0.425, 0.07], [0.05, 0.405, 0.05]], 0.0016, { radial:5 }), tube([[-0.012, 0.47, 0.07], [-0.02, 0.44, 0.07], [-0.008, 0.41, 0.07]], 0.0016, { radial:5 })]), organMat(0xe03a3a, { clearcoat:0.8 }), "Coronary arteries", "heart");
    for (const s of [1, -1]) add("organs", mesh(lungSDF(s), [s > 0 ? 0.0 : -0.14, 0.34, -0.075], [s > 0 ? 0.14 : 0.0, 0.6, 0.075], 0.0032), organMat(COL.lung, { roughness:0.55, clearcoat:0.25 }), s > 0 ? "Left lung" : "Right lung", "lungs");
    add("organs", merge([tube([[0, 0.69, 0.018], [0, 0.6, 0.012], [0, 0.55, 0.004]], tt => 0.0085 * (1 + 0.08 * Math.sin(tt * 90))), tube([[0, 0.555, 0.004], [0.03, 0.53, 0.0], [0.055, 0.505, -0.004]], 0.0055), tube([[0, 0.555, 0.004], [-0.03, 0.53, 0.0], [-0.058, 0.505, -0.004]], 0.0058)]), organMat(COL.trachea, { roughness:0.5 }), "Trachea and bronchi", "lungs");
    await tick(0.8, "Placing organs");
    add("organs", mesh(liverSDF, [-0.16, 0.24, -0.05], [0.12, 0.37, 0.1], 0.003), organMat(COL.liver, { clearcoat:0.8, clearcoatRoughness:0.2 }), "Liver", "liver");
    add("organs", mesh((x, y, z) => ell(x, y, z, -0.042, 0.268, 0.078, 0.011, 0.02, 0.011), [-0.06, 0.24, 0.06], [-0.025, 0.295, 0.095], 0.002), organMat(COL.gall, { clearcoat:0.9 }), "Gallbladder", "liver");
    add("organs", mesh(stomachSDF, [-0.03, 0.22, -0.02], [0.12, 0.38, 0.1], 0.0028), organMat(COL.stomach), "Stomach", "gut");
    add("organs", tube([[0.0, 0.66, -0.008], [0.0, 0.55, -0.025], [0.008, 0.43, -0.03], [0.022, 0.36, -0.005], [0.034, 0.338, 0.016]], 0.0055), organMat(COL.eso), "Oesophagus", "gut");
    add("organs", tube([[-0.012, 0.257, 0.056], [-0.036, 0.252, 0.042], [-0.042, 0.226, 0.03], [-0.024, 0.205, 0.028], [0.006, 0.21, 0.03]], 0.0095), organMat(COL.small), "Duodenum", "gut");
    // small intestine: serpentine rows with superimposed coils, so it reads as a packed pile of loops
    const sp = [[0.006, 0.21, 0.03]]; let dir = 1;
    for (let layer = 0; layer < 2; layer++){ const zz = 0.06 - layer * 0.026;
      for (let row = 0; row < 4; row++){ const yy = 0.178 - row * 0.036 - layer * 0.016;
        for (let k = 0; k <= 60; k++){ const u = k / 60, th = u * Math.PI * 2 * 4.5 + row * 1.7 + layer, n = noise(row * 3.1 + u * 4, layer * 5.3, u * 2.7);
          const xx = dir * (-0.06 + 0.12 * u) + 0.013 * Math.cos(th) + 0.006 * n;
          sp.push([xx, yy + 0.014 * Math.sin(th) + 0.008 * n, zz + 0.012 * Math.sin(th * 0.5 + row) + 0.005 * n]); }
        dir = -dir; } }
    sp.push([-0.07, 0.07, 0.045], [-0.078, 0.06, 0.045]);
    add("organs", tube(sp, tt => 0.0092 * (1 + 0.05 * Math.sin(tt * 600)), { segs:2400, radial:9 }), organMat(COL.small, { clearcoat:0.8 }), "Small intestine", "gut");
    const colon = [[0.0, -0.035, -0.028], [0.002, 0.0, -0.02], [0.02, 0.04, 0.03], [0.06, 0.03, 0.052], [0.096, 0.07, 0.038], [0.1, 0.16, 0.035], [0.092, 0.24, 0.042], [0.05, 0.218, 0.074], [0.0, 0.198, 0.082], [-0.05, 0.214, 0.074], [-0.088, 0.232, 0.05], [-0.098, 0.15, 0.04], [-0.092, 0.06, 0.04], [-0.085, 0.04, 0.042]].reverse();
    add("organs", tube(colon, tt => 0.0165 * (1 + 0.16 * Math.max(0, Math.sin(tt * 160))), { segs:700, radial:12 }), organMat(COL.colon), "Large intestine", "gut");
    for (const s of [1, -1]) add("organs", mesh(kidneySDF(s), s > 0 ? [0.03, 0.17, -0.08] : [-0.105, 0.16, -0.08], s > 0 ? [0.105, 0.3, -0.025] : [-0.03, 0.29, -0.025], 0.0024), organMat(COL.kidney, { clearcoat:0.8 }), s > 0 ? "Left kidney" : "Right kidney", "kidneys");
    add("organs", merge([tube([[0.05, 0.225, -0.045], [0.04, 0.15, -0.04], [0.03, 0.07, -0.02], [0.012, 0.03, 0.02]], 0.0024, { radial:6 }), tube([[-0.05, 0.215, -0.045], [-0.04, 0.15, -0.04], [-0.03, 0.07, -0.02], [-0.012, 0.03, 0.02]], 0.0024, { radial:6 })]), organMat(0xd9b46a), "Ureters", "kidneys");
    add("organs", mesh(bladderSDF, [-0.04, -0.015, 0.0], [0.04, 0.05, 0.07], 0.0028), organMat(COL.bladder), "Bladder", "kidneys");
    add("organs", mesh(pancreasSDF, [-0.05, 0.225, -0.03], [0.105, 0.305, 0.05], 0.0024), organMat(COL.panc, { roughness:0.55, clearcoat:0.4 }), "Pancreas", "pancreas");
    add("organs", mesh(thyroidSDF, [-0.025, 0.66, 0.02], [0.025, 0.705, 0.045], 0.0016), organMat(COL.thyroid), "Thyroid gland", "pancreas");
    add("organs", mesh(spleenSDF, [0.08, 0.25, -0.07], [0.13, 0.355, 0.0], 0.0026), organMat(COL.spleen, { clearcoat:0.7 }), "Spleen", null);
    const knee = [];
    for (const s of [1, -1]){
      knee.push(sphereAt(0.0145, [s * 0.084, -0.458, 0.005])); knee.push(sphereAt(0.0145, [s * 0.105, -0.458, 0.005]));
      const men = new T.TorusGeometry(0.016, 0.0035, 8, 28); men.rotateX(Math.PI / 2); men.translate(s * 0.094, -0.472, 0.007); knee.push(men);
      knee.push(sphereAt(0.014, [s * 0.095, -0.452, 0.04], [1, 1.25, 0.5]));
      knee.push(tube([[s * 0.095, -0.465, 0.042], [s * 0.095, -0.5, 0.034]], 0.004, { radial:6 }));
    }
    add("organs", merge(knee.map(g => g.index ? g.toNonIndexed() : g)), organMat(COL.cart, { clearcoat:0.6 }), "Knee joint (cartilage, menisci, patella)", "knees");
    await tick(0.9, "Tracing vessels and nerves");
    const art = [], vein = [], nerve = [];
    art.push(tube([[0.014, 0.45, -0.042], [0.012, 0.3, -0.036], [0.008, 0.1, -0.022]], 0.0068));
    for (const s of [1, -1]){
      art.push(tube([[0.008, 0.1, -0.022], [s * 0.05, 0.05, -0.004], [s * 0.082, -0.02, 0.016], [s * 0.088, -0.3, 0.004], [s * 0.093, -0.47, -0.028], [s * 0.096, -0.7, -0.012], [s * 0.098, -0.93, 0.02]], 0.0036));
      art.push(tube([[s * 0.006, 0.54, 0.028], [s * 0.022, 0.62, 0.03], [s * 0.026, 0.72, 0.03], [s * 0.032, 0.79, 0.004], [s * 0.05, 0.84, -0.01]], 0.0032));
      art.push(tube([[s * 0.008, 0.545, 0.026], [s * 0.09, 0.588, 0.012], [s * 0.168, 0.565, 0.004], [s * 0.212, 0.32, 0.006], [s * 0.232, 0.17, 0.02], [s * 0.244, 0.03, 0.036]], 0.0028));
      art.push(tube([[0.011, 0.232, -0.036], [s * 0.035, 0.234, -0.045], [s * 0.05, 0.232, -0.05]], 0.0026));
      vein.push(tube([[-0.012, 0.09, -0.016], [s * 0.042, 0.045, 0.002], [s * 0.074, -0.02, 0.022], [s * 0.08, -0.3, 0.012], [s * 0.085, -0.47, -0.02], [s * 0.09, -0.7, 0.0], [s * 0.094, -0.93, 0.03]], 0.0034));
      vein.push(tube([[s * 0.018, 0.55, 0.02], [s * 0.034, 0.62, 0.022], [s * 0.04, 0.72, 0.02], [s * 0.045, 0.79, -0.012]], 0.003));
      nerve.push(tube([[s * 0.03, 0.08, -0.05], [s * 0.07, -0.02, -0.035], [s * 0.092, -0.3, -0.03], [s * 0.094, -0.46, -0.035], [s * 0.1, -0.7, -0.03], [s * 0.1, -0.93, 0.0]], 0.0028));
      nerve.push(tube([[s * 0.03, 0.62, -0.03], [s * 0.1, 0.58, -0.01], [s * 0.18, 0.55, -0.008], [s * 0.212, 0.31, -0.004], [s * 0.24, 0.12, 0.02], [s * 0.25, 0.03, 0.04]], 0.0022));
    }
    vein.push(tube([[-0.012, 0.09, -0.016], [-0.016, 0.3, -0.02], [-0.02, 0.43, 0.02]], 0.0062));
    nerve.push(tube(spine.map(p => [p[0], p[1], p[2] - 0.012]), 0.0035));
    add("vessels", merge(art), organMat(COL.artery, { clearcoat:0.8, opacity:0.95 }), "Arteries");
    add("vessels", merge(vein), organMat(COL.vein, { clearcoat:0.8, opacity:0.95 }), "Veins");
    add("nerves", merge(nerve), organMat(COL.nerve, { clearcoat:0.5, emissiveIntensity:0.08 }), "Nerves");
    layers.nerves.forEach(m => m.visible = false);
    await tick(1, "Ready");
  }

  function labelEls(){
    Object.keys(ANCHOR).forEach(r => { const el = document.createElement("button"); el.type = "button"; el.className = "olabel"; el.style.opacity = "0"; el.tabIndex = -1;
      el.style.setProperty("--c", `var(${SYS[REGION_SYS[r]].css})`);
      el.innerHTML = `<span class="pin" aria-hidden="true">+</span><span class="tx">${REGION_NAMES[r]}<small>${REGION_SYS[r]}</small></span>`;
      el.addEventListener("click", () => onPick(REGION_SYS[r])); labelHost.appendChild(el); labels[r] = el; });
  }

  function init(cv, host, tooltip, cbs = {}){
    canvas = cv; labelHost = host; tip = tooltip; onPick = cbs.onPick || onPick; onHover = cbs.onHover || onHover;
    renderer = new T.WebGLRenderer({ canvas, antialias:true, alpha:true, powerPreference:"high-performance" });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.setClearColor(0x000000, 0);
    renderer.outputEncoding = T.sRGBEncoding; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    scene = new T.Scene();
    const pm = new T.PMREMGenerator(renderer); scene.environment = pm.fromScene(new T.RoomEnvironment(), 0.04).texture;
    camera = new T.PerspectiveCamera(30, 1, 0.02, 40); camera.position.copy(goal.pos);
    const key = new T.DirectionalLight(0xffffff, 1.1); key.position.set(1.5, 2.5, 3); scene.add(key);
    const rim = new T.DirectionalLight(0x9fd8ff, 0.8); rim.position.set(-2.5, 1.2, -2); scene.add(rim);
    scene.add(new T.HemisphereLight(0xffffff, 0x334455, 0.35));
    controls = new T.OrbitControls(camera, canvas); controls.enableDamping = true; controls.dampingFactor = 0.08; controls.target.copy(goal.tgt);
    controls.minDistance = 0.35; controls.maxDistance = 7; controls.autoRotate = !REDUCED; controls.autoRotateSpeed = 0.55; controls.rotateSpeed = 0.7; controls.zoomSpeed = 0.8;
    controls.addEventListener("start", () => { animating = null; });
    labelEls();
    const ray = new T.Raycaster(), ndc = new T.Vector2(); let hoverReq = null, down = null;
    const pick = e => { const r = canvas.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera);
      return ray.intersectObjects(pickables.filter(m => m.visible && m.material.opacity > 0.3), false)[0]; };
    canvas.addEventListener("pointermove", e => { if (hoverReq || e.pointerType === "touch") return; hoverReq = requestAnimationFrame(() => { hoverReq = null; if (!ready) return;
      const h = pick(e); canvas.style.cursor = h ? (h.object.userData.region ? "pointer" : "crosshair") : "grab";
      if (h){ const r = canvas.getBoundingClientRect(); tip.hidden = false; tip.style.left = (e.clientX - r.left + 14) + "px"; tip.style.top = (e.clientY - r.top + 12) + "px";
        tip.innerHTML = `<b>${h.object.userData.name}</b>${h.object.userData.region ? `<span>${REGION_SYS[h.object.userData.region]} system · click to focus</span>` : `<span>${h.object.userData.layer === "skeleton" ? "Skeleton" : h.object.userData.layer === "vessels" ? "Circulation" : h.object.userData.layer === "nerves" ? "Nervous system" : "Anatomy"}</span>`}`; }
      else tip.hidden = true; }); });
    canvas.addEventListener("pointerleave", () => { tip.hidden = true; });
    canvas.addEventListener("pointerdown", e => { down = { x:e.clientX, y:e.clientY }; });
    canvas.addEventListener("pointerup", e => { if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || !ready) return; const h = pick(e); if (h && h.object.userData.region) onPick(REGION_SYS[h.object.userData.region]); });
    new ResizeObserver(resize).observe(canvas);
    if ("IntersectionObserver" in window) new IntersectionObserver(es => { visible = es[0].isIntersecting; }).observe(canvas);
    resize(); loop();
    return build(cbs.onProgress || (() => {})).then(() => { ready = true; setMode(mode); applyFocus(true); readyCbs.forEach(f => f()); });
  }
  function resize(){ const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }

  const tmp = new T.Vector3();
  function loop(){
    requestAnimationFrame(loop); if (!visible) return; t += 0.016;
    if (animating){ const k = REDUCED ? 1 : 0.075; camera.position.lerp(goal.pos, k); controls.target.lerp(goal.tgt, k); if (camera.position.distanceTo(goal.pos) < 0.002) animating = null; }
    controls.update();
    if (skinMat){ skinMat.uniforms.uScan.value = REDUCED ? 9 : -1.0 + ((t * 0.16) % 1) * 2.0; }
    const focusing = active.size > 0;
    for (const layer of ["organs", "skeleton", "vessels", "nerves"]) for (const m of layers[layer]){
      const reg = m.userData.region, on = reg && active.has(reg);
      let target = 1;
      if (layer === "skeleton") target = m.userData.skull ? (focusing ? 0.1 : 0.32) : (!focusing ? 1 : active.has("knees") ? 0.85 : 0.16);
      else if (layer === "organs") target = !focusing || on ? 1 : 0.13;
      else target = focusing ? 0.12 : 0.95;
      const mat = m.material; mat.opacity += (target - mat.opacity) * 0.1; mat.depthWrite = mat.opacity > 0.96;
      if (layer === "organs") mat.emissiveIntensity = on ? 0.12 + (REDUCED ? 0.06 : 0.12 * (0.5 + 0.5 * Math.sin(t * 3))) : 0;
    }
    if (regions.heart && active.has("heart") && !REDUCED){ const s = 1 + 0.03 * Math.max(0, Math.sin(t * 6.5)) ; regions.heart.forEach(m => { m.scale.setScalar(s); m.position.set(0.024 * (1 - s), 0.45 * (1 - s), 0.045 * (1 - s)); }); }
    else if (regions.heart) regions.heart.forEach(m => { m.scale.setScalar(1); m.position.set(0, 0, 0); });
    const w = canvas.clientWidth, h = canvas.clientHeight, placed = [];
    for (const r in labels){ const el = labels[r]; if (!ready || !active.has(r)){ el.style.opacity = "0"; el.style.pointerEvents = "none"; continue; }
      tmp.set(...ANCHOR[r]); tmp.project(camera); const px = (tmp.x + 1) / 2 * w, py = (1 - tmp.y) / 2 * h;
      const vis = tmp.z < 1 && px > 0 && px < w && py > 0 && py < h; el.style.opacity = vis ? "1" : "0"; el.style.pointerEvents = vis ? "auto" : "none";
      el.style.transform = `translate(${px}px, ${py}px)`; placed.push({ el, py }); }
    placed.sort((a, b) => a.py - b.py); let last = -1e9; placed.forEach(p => { const ty = Math.max(p.py, last + 34); last = ty; p.el.querySelector(".tx").style.marginTop = (ty - p.py) + "px"; });
    renderer.render(scene, camera);
  }
  function viewFor(rs){ if (rs.size === 1) return VIEWS[[...rs][0]]; if (rs.size > 1 && [...rs].every(r => r !== "brain" && r !== "knees")) return VIEWS.torso; return VIEWS.body; }
  function applyFocus(instant){ const v = viewFor(active); goal.pos.set(...v[0]); goal.tgt.set(...v[1]); if (instant){ camera.position.copy(goal.pos); controls.target.copy(goal.tgt); animating = null; } else animating = true; }
  function focus(systems){ const rs = new Set((systems || []).filter(s => SYS[s]).map(s => SYS[s].region)); const same = rs.size === active.size && [...rs].every(r => active.has(r)); active = rs; if (!same || !ready) applyFocus(!ready); }
  function setMode(m){ mode = m; if (!skinMat) return; const u = skinMat.uniforms;
    if (m === "xray"){ u.uBase.value.set(0x0f6a8c); u.uRim.value.set(0x86ecff); u.uOp.value = 0.085; u.uRimOp.value = 0.95; u.uPow.value = 1.9; u.uScanOn.value = 1; skinMat.blending = T.AdditiveBlending; renderer.toneMappingExposure = 1.05; }
    else { u.uBase.value.set(0xf1d9c9); u.uRim.value.set(0xa98f80); u.uOp.value = 0.07; u.uRimOp.value = 0.55; u.uPow.value = 2.6; u.uScanOn.value = 0; skinMat.blending = T.NormalBlending; renderer.toneMappingExposure = 1.15; }
    skinMat.needsUpdate = true; }
  function setLayer(name, on){ (layers[name] || []).forEach(m => m.visible = on); }
  function resetView(){ active = new Set(); goal.pos.set(...VIEWS.body[0]); goal.tgt.set(...VIEWS.body[1]); animating = true; }
  function zoom(f){ const d = camera.position.clone().sub(controls.target).multiplyScalar(f); goal.pos.copy(controls.target).add(d); goal.tgt.copy(controls.target); animating = true; }
  function setAutoRotate(on){ controls.autoRotate = on; }
  function onReady(f){ ready ? f() : readyCbs.push(f); }
  return { init, focus, setMode, setLayer, resetView, zoom, setAutoRotate, onReady, REGION_NAMES };
})();


/* ================= Markdown (escaped, small subset) ================= */
function esc(s){ return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
const DRUG_RE = new RegExp("\\b(" + DRUGS.map(d => d.name).join("|") + ")\\b", "g");
function inline(s){
  let h = esc(s);
  h = h.replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[\s(])_([^_]+)_(?=[\s).,;:]|$)/g, "$1<em>$2</em>");
  h = h.replace(/\[?\b([A-Z]{3}-\d{3})\b\]?/g, (m, id) => TRIAL_BY_ID[id] ? `<button class="ref" data-trial="${id}">${id}</button>` : m);
  h = h.replace(DRUG_RE, (m) => `<button class="dref" data-drug="${m}">${m}</button>`);
  return h;
}
function md(src){
  const lines = String(src || "").replace(/\r/g, "").split("\n"); let out = "", list = null, i = 0;
  const close = () => { if (list){ out += `</${list}>`; list = null; } };
  while (i < lines.length){
    const l = lines[i];
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])){
      close(); const row = x => x.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
      out += "<table><thead><tr>" + row(l).map(c => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>"; i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])){ out += "<tr>" + row(lines[i]).map(c => `<td>${inline(c)}</td>`).join("") + "</tr>"; i++; }
      out += "</tbody></table>"; continue;
    }
    let m;
    if ((m = l.match(/^\s*#{1,4}\s+(.*)/))){ close(); out += `<h4>${inline(m[1])}</h4>`; }
    else if ((m = l.match(/^\s*[-*•]\s+(.*)/))){ if (list !== "ul"){ close(); out += "<ul>"; list = "ul"; } out += `<li>${inline(m[1])}</li>`; }
    else if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))){ if (list !== "ol"){ close(); out += "<ol>"; list = "ol"; } out += `<li>${inline(m[1])}</li>`; }
    else if (!l.trim()){ close(); }
    else { close(); out += `<p>${inline(l)}</p>`; }
    i++;
  }
  close(); return out;
}

/* ================= Agent ================= */
const CATALOGUE = DRUGS.map(d => `${d.name} (${d.code}) | ${d.cls} | ${d.ind} | systems: ${d.systems.join(", ")} | trials: ${drugTrials(d.name).length}`).join("\n");
const OUTCOME_LIST = SYS_NAMES.map(s => `${s}: ${Object.keys(OUTCOMES).filter(o => OUTCOMES[o].sys === s).join("; ")}`).join("\n");
const RULES = `You are Clinical Atlas, an evidence assistant inside a web app. You answer questions about a SYNTHETIC clinical-trial database. Every medicine, trial, sponsor and result in it is fictional and exists only for this demo.

Medicines in the database (name (code) | class | indication | body systems | trial count):
${CATALOGUE}

Outcomes by body system:
${OUTCOME_LIST}

How to work:
- Get every number from the tools. Never estimate, recall or invent figures, trials or medicines. If the tools return nothing, say so.
- Use summarize_drug for a medicine overview (it returns pooled placebo-controlled differences, tallies and safety already computed), search_trials to find trials, get_trial for one trial's detail.
- Whenever your answer is about a medicine or a body system, call show_in_atlas so the 3D body map and evidence panel follow the conversation. Call it once per answer, with the main medicine and/or system.
- Cite trials by their ID in square brackets, e.g. [CLV-211]; the app turns them into links to the study report.
- Differences are versus comparator; "lower_is_better" tells you which direction is favourable. Say "improved" or "worsened" accordingly, with units and 95% CI where useful.
- Style: start with a one or two sentence direct answer, then a few bullets or a small markdown table. Keep it under 220 words unless asked for more. Plain, precise clinical language. No headings larger than ###.
- If someone asks for personal medical advice, say this database is fictional and they should speak to a clinician, then answer about the data only.`;

const TOOL_DEFS = (ui) => [
  { name:"summarize_drug", description:"Overview of one medicine: trial counts, phases, per-outcome tallies (positive/neutral/negative arms), pooled placebo-controlled difference with 95% CI and I2, and safety summary. Returns JSON.",
    inputSchema:{ type:"object", properties:{ drug:{ type:"string", description:"Medicine name or code, e.g. Glucendra or GLD-903" } }, required:["drug"] },
    execute: (inp) => { ui.step("Summarising " + inp.drug); const name = resolveDrug(String(inp.drug || "")); const r = name ? drugSummary(name) : null; ui.done(r ? `Summarised ${name}` : "No such medicine"); if (!r) throw new Error("No medicine called " + inp.drug + ". Known: " + DRUGS.map(d => d.name).join(", ")); return r; } },
  { name:"search_trials", description:"Find trials by medicine, body system, outcome text and/or quality (High, Moderate, Low). Returns up to 18 trials with their results for the matching outcome (or primary outcome).",
    inputSchema:{ type:"object", properties:{ drug:{ type:"string" }, system:{ type:"string", enum:SYS_NAMES }, outcome:{ type:"string", description:"Outcome name or part of it, e.g. HbA1c" }, quality:{ type:"string", enum:["High","Moderate","Low"] } } },
    execute: (inp) => { ui.step("Searching trials"); const drug = inp.drug ? resolveDrug(String(inp.drug)) || String(inp.drug) : undefined; const r = searchTrials({ drug, system:inp.system, outcome:inp.outcome, quality:inp.quality }); ui.done(`Searched trials · ${r.length} found`); return r; } },
  { name:"get_trial", description:"Full detail for one trial ID, e.g. GLD-212: design, population, every arm's outcome results with CI and p, and adverse events.",
    inputSchema:{ type:"object", properties:{ trial_id:{ type:"string" } }, required:["trial_id"] },
    execute: (inp) => { const id = String(inp.trial_id || "").toUpperCase().replace(/[\[\]]/g, ""); ui.step("Reading " + id); const r = trialDetail(id); ui.done(r ? "Read " + id : "Trial not found"); if (!r) throw new Error("No trial " + id); return r; } },
  { name:"show_in_atlas", description:"Point the app's 3D body map and evidence panel at a medicine and/or body system (and optionally an outcome). Call once per answer about a medicine or system.",
    inputSchema:{ type:"object", properties:{ drug:{ type:"string" }, system:{ type:"string", enum:SYS_NAMES }, outcome:{ type:"string" } } },
    execute: (inp) => { const drug = inp.drug ? resolveDrug(String(inp.drug)) : null; ui.select({ drug, system:inp.system && SYS[inp.system] ? inp.system : null, outcome:inp.outcome ? matchOutcome(String(inp.outcome), drug) : null }); ui.done("Updated body map"); return "Displayed"; } }
];
function resolveDrug(s){ const x = lc(s).trim(); const d = DRUGS.find(d => lc(d.name) === x || lc(d.code) === x) || DRUGS.find(d => x.includes(lc(d.name)) || x.includes(lc(d.code))); return d ? d.name : null; }
function matchOutcome(s, drug){ const pool_ = drug ? drugOutcomes(drug).map(o => o.o) : Object.keys(OUTCOMES); const x = lc(s); return pool_.find(o => lc(o) === x) || pool_.find(o => lc(o).includes(x) || x.includes(lc(o).split(" (")[0])) || null; }
function article(s){ return /^[aeiou]/i.test(s) || (/^[A-Z]{2}/.test(s) && "FHLMNRSX".includes(s[0])) ? "an" : "a"; }
function lcClass(s){ return /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s; }
function findOutcome(t){
  let best = null;
  for (const o of Object.keys(OUTCOMES)){
    const base = lc(o).replace(/\s*\(.*\)/, ""); const words = base.split(" ");
    const cands = [base]; if (words.length >= 3) cands.push(words.slice(1).join(" "));
    for (const c of cands) if (c.length >= 4 && t.includes(c) && (!best || c.length > best.len)) best = { o, len:c.length };
  }
  return best && best.o;
}
function detectSystems(text){ const t = lc(text); return SYS_NAMES.filter(s => SYS_WORDS[s].some(w => new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(t))); }

/* Offline agent: deterministic answers from the same functions */
function localAnswer(text, ui){
  const t = lc(text);
  const drugs = DRUGS.filter(d => t.includes(lc(d.name)) || t.includes(lc(d.code))).map(d => d.name);
  const systems = detectSystems(text);
  const outcomeHit = findOutcome(t);
  if (drugs.length >= 2){
    ui.select({ drug:drugs[0], system:null, outcome:null, compare:drugs });
    const rows = drugs.map(n => { const s = drugSummary(n); const prim = s.outcomes.find(o => o.primary) || s.outcomes[0]; return `| ${n} | ${s.indication} | ${s.trials} | ${prim.outcome} | ${fmt(prim.pooled_difference)} ${prim.unit} | ${prim.positive}/${prim.arms} |`; });
    return `Here is how ${drugs.join(" and ")} compare on their primary outcomes. They target different conditions, so these are side-by-side summaries, not a head-to-head result.\n\n| Medicine | Indication | Trials | Primary outcome | Pooled difference | Positive arms |\n|---|---|---|---|---|---|\n${rows.join("\n")}`;
  }
  if (drugs.length === 1){
    const s = drugSummary(drugs[0]);
    const sysFilter = systems.find(x => s.systems.includes(x) || s.outcomes.some(o => o.system === x));
    const outs = s.outcomes.filter(o => outcomeHit ? o.outcome === outcomeHit : sysFilter ? o.system === sysFilter : true).slice(0, 5);
    ui.select({ drug:s.drug, system:sysFilter || null, outcome:outcomeHit || (outs[0] && outs[0].outcome) || null });
    if (/safety|adverse|side effect|tolerab/.test(t)){
      return `${s.drug} had a serious adverse event rate of ${s.safety.serious_ae_rate_pct}% and ${s.safety.discontinuation_pct}% discontinuation, averaged across ${s.arms} arms.\n\n` + s.safety.top_adverse_events.map(e => `- **${e.event}**: ${e.drug_pct}% on ${s.drug} vs ${e.placebo_pct}% on comparator`).join("\n");
    }
    if (/trial/.test(t)){
      const want = /high/.test(t) ? "High" : /low/.test(t) ? "Low" : null;
      const ts = drugTrials(s.drug).filter(x => !want || x.quality === want).sort((a, b) => b.year - a.year);
      if (!ts.length) return `No ${want ? lc(want) + "-quality " : ""}trials of ${s.drug} are in the database.`;
      return `${ts.length} of ${s.trials} ${s.drug} trials ${want ? `are rated ${lc(want)} quality` : "are in the database"}:\n\n| Trial | Phase | Year | Design | N | Primary result |\n|---|---|---|---|---|---|\n` +
        ts.map(x => { const r = x.arms.flatMap(a => a.results.filter(q => q.prim))[0]; return `| [${x.id}] | ${x.phase} | ${x.year} | ${x.design} | ${x.n} | ${r ? r.dir + " (" + fmt(r.md) + " " + r.unit + ")" : "–"} |`; }).join("\n");
    }
    const tr = drugTrials(s.drug).filter(x => x.quality === "High").slice(0, 3).map(x => `[${x.id}]`).join(", ");
    return `**${s.drug}** (${s.code}) is ${article(lcClass(s.class))} ${lcClass(s.class)} studied for ${lc(s.indication)} in ${s.trials} trials (${s.participants.toLocaleString()} participants, ${s.high_quality_trials} rated high quality).\n\n` +
      outs.map(o => `- **${o.outcome}**: pooled ${fmt(o.pooled_difference)} ${o.unit}${o.ci95 ? ` (95% CI ${fmt(o.ci95[0])} to ${fmt(o.ci95[1])})` : ""}; positive in ${o.positive} of ${o.arms} arms${o.I2_percent >= 50 ? `, with notable heterogeneity (I² ${o.I2_percent}%)` : ""}.`).join("\n") +
      (tr ? `\n\nKey high-quality trials: ${tr}.` : "");
  }
  if (systems.length){
    const sys = outcomeHit ? OUTCOMES[outcomeHit].sys : systems[0]; let list = systemDrugs(sys);
    ui.select({ drug:null, system:sys, outcome:null });
    if (outcomeHit){
      const rows = DRUGS.map(d => ({ d, p:pool(d.name, outcomeHit) })).filter(x => x.p.rows.length).sort((a, b) => (b.p.tally.pos / b.p.rows.length) - (a.p.tally.pos / a.p.rows.length));
      if (!rows.length) return `No medicine in the database reports ${lc(outcomeHit)}.`;
      const good = rows.filter(x => x.p.tally.pos > 0);
      return `${good.length} of ${rows.length} medicines that measured ${lc(outcomeHit)} showed a significant improvement in at least one arm (${OUTCOMES[outcomeHit].better === -1 ? "lower" : "higher"} is better):\n\n| Medicine | Pooled difference | 95% CI | Positive arms |\n|---|---|---|---|\n` +
        rows.map(x => `| ${x.d.name} | ${x.p.est != null ? fmt(x.p.est) + " " + x.p.unit : "–"} | ${x.p.est != null ? fmt(x.p.lo) + " to " + fmt(x.p.hi) : "–"} | ${x.p.tally.pos}/${x.p.rows.length} |`).join("\n");
    }
    if (!list.length) return `No medicine in the database reports ${sys.toLowerCase()} outcomes.`;
    return `${list.length} medicine${list.length > 1 ? "s" : ""} report ${sys.toLowerCase()} outcomes:\n\n` + list.map(({d, outs}) => { const b = outs.filter(p => p.est != null).sort((a, b2) => (b2.tally.pos / b2.rows.length) - (a.tally.pos / a.rows.length))[0]; return `- **${d.name}** (${d.ind}): ${b ? `${b.outcome} pooled ${fmt(b.est)} ${b.unit}, positive in ${b.tally.pos} of ${b.rows.length} arms` : "no placebo-controlled pool"}`; }).join("\n");
  }
  ui.select({ drug:null, system:null, outcome:null });
  return `I can answer questions about ${DRUGS.length} fictional medicines across ${SYS_NAMES.length} body systems. Try naming a medicine, such as Glucendra, or a body system, such as the kidneys or blood pressure.`;
}

/* ================= UI ================= */
const { useState, useEffect, useRef, useMemo, useCallback, Fragment } = React;
const html = htm.bind(React.createElement);
const SUGGEST = ["Summarise the evidence for Glucendra","Which medicines lower blood pressure?","Is Hepatrisol good for the liver?","What are the safety signals for Arteval?","Compare Calvenor and Dormelith","Which Bronquel trials were high quality?"];
const sysColor = s => `var(${SYS[s].css})`;
const pillCls = d => d === "Positive" ? "p-pos" : d === "Negative" ? "p-neg" : "p-neu";

function Logo(){ return html`<div className="mark" aria-hidden="true"><svg width="19" height="19" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="4.6" r="2.6" stroke="#fff" strokeWidth="2"/><path d="M6 10h12M12 10v5.5M8.5 21.5l3.5-6 3.5 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></div>`; }

const ICONS = {
  reset:"M3 12a9 9 0 1 0 3-6.7M3 4v5h5", plus:"M12 5v14M5 12h14", minus:"M5 12h14", play:"M7 5l12 7-12 7z", pause:"M8 5v14M16 5v14",
  layers:"M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5", full:"M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5", search:"M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4",
  copy:"M9 9h10v10H9zM5 15V5h10", spark:"M12 3l2.2 6.3L20 12l-5.8 2.7L12 21l-2.2-6.3L4 12l5.8-2.7z", body:"M12 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM6 10h12M12 10v6M8 22l4-6 4 6"
};
function Icon({ n, s = 18, w = 2 }){ return html`<svg width=${s} height=${s} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d=${ICONS[n]} stroke="currentColor" strokeWidth=${w} strokeLinecap="round" strokeLinejoin="round"/></svg>`; }
const ORGAN_FACTS = {
  Nervous:"Controls thought, sleep, mood and the processing of pain signals.",
  Cardiovascular:"Pumps blood around the body. Blood pressure, cholesterol and heart-rate outcomes map here.",
  Respiratory:"Exchanges oxygen and carbon dioxide. Lung function and exacerbation outcomes map here.",
  Digestive:"Breaks down food and absorbs nutrients. Bowel symptom outcomes map here.",
  Hepatic:"Processes nutrients, filters blood and stores fat. Liver enzyme and liver-fat outcomes map here.",
  Renal:"Filter blood and balance fluids. Kidney function and albuminuria outcomes map here.",
  Musculoskeletal:"Weight-bearing joints cushioned by cartilage. Pain, stiffness and walking outcomes map here.",
  Endocrine:"Releases insulin and other hormones. Glucose, HbA1c and body-weight outcomes map here."
};
const LAYERS = [["skin", "Skin", "#6fd6f2"], ["skeleton", "Skeleton", "#d8c9ab"], ["organs", "Organs", "#d98680"], ["vessels", "Blood vessels", "#c4222a"], ["nerves", "Nerves", "#f2c94c"]];
function readPref(k, d){ try { return localStorage.getItem(k) || d; } catch (_){ return d; } }
function writePref(k, v){ try { localStorage.setItem(k, v); } catch (_){} }

function Stage({ sel, onPick, onAsk, setSel }){
  const stageRef = useRef(null), cv = useRef(null), layer = useRef(null), tipRef = useRef(null);
  const [progress, setProgress] = useState({ p:0, label:"Preparing anatomy" });
  const [mode, setModeS] = useState(() => readPref("atlas-mode", "xray"));
  const [rotate, setRotate] = useState(!REDUCED);
  const [showLayers, setShowLayers] = useState(false);
  const [vis, setVis] = useState({ skin:true, skeleton:true, organs:true, vessels:true, nerves:false });
  const [card, setCard] = useState(true);
  useEffect(() => { try { Atlas.init(cv.current, layer.current, tipRef.current, { onPick, onProgress:(p, label) => setProgress({ p, label }) }).then(() => setProgress({ p:1, label:"Ready" })).catch(e => { console.warn(e); setProgress({ p:1, label:"3D view unavailable", err:true }); }); } catch (e) { console.warn("3D view unavailable", e); setProgress({ p:1, label:"3D view unavailable on this device", err:true }); } }, []);
  const systems = sel.system ? [sel.system] : sel.drug ? (DRUG_BY_NAME[lc(sel.drug)] || {}).systems || [] : [];
  useEffect(() => { try { Atlas.focus(systems); } catch (_){} setCard(true); }, [systems.join("|")]);
  useEffect(() => { try { Atlas.setMode(mode); } catch (_){} writePref("atlas-mode", mode); }, [mode]);
  useEffect(() => { try { Atlas.setAutoRotate(rotate); } catch (_){} }, [rotate]);
  useEffect(() => { Object.entries(vis).forEach(([k, v]) => { try { Atlas.setLayer(k, v); } catch (_){} }); }, [vis]);
  const d = sel.drug ? DRUG_BY_NAME[lc(sel.drug)] : null;
  const focusSys = sel.system || (d && d.systems.length === 1 ? d.systems[0] : null);
  const organList = focusSys ? systemDrugs(focusSys).map(({ d:dd, outs }) => { const pos = outs.reduce((n, p) => n + p.tally.pos, 0), all = outs.reduce((n, p) => n + p.rows.length, 0); return { name:dd.name, pos, all }; }).sort((a, b) => b.pos / (b.all || 1) - a.pos / (a.all || 1)) : [];
  const full = () => { const el = stageRef.current; try { if (document.fullscreenElement) document.exitFullscreen(); else if (el.requestFullscreen) el.requestFullscreen().catch(() => {}); } catch (_){} };
  const tool = (icon, label, onClick, pressed) => html`<button className="tool" onClick=${onClick} aria-label=${label} aria-pressed=${pressed === undefined ? undefined : pressed}><${Icon} n=${icon} s=${17} /><span className="tt">${label}</span></button>`;
  return html`<section className="stage" data-mode=${mode} ref=${stageRef} aria-label="3D anatomy viewer">
    <div className="grid-bg"></div>
    <canvas ref=${cv} aria-hidden="true"></canvas>
    <div ref=${layer} style=${{position:"absolute", inset:0, zIndex:2, pointerEvents:"none"}}></div>
    <div ref=${tipRef} className="tip" hidden></div>
    <div className="loader" style=${{opacity:progress.p >= 1 && !progress.err ? 0 : 1}}><div className="box"><div className="lbl">${progress.label}</div>${!progress.err && html`<div className="track"><span style=${{width:Math.round(progress.p * 100) + "%"}}></span></div>`}</div></div>
    <div className="hud ctx glass">
      <div className="k">${d ? d.code + " · " + d.cls : sel.system ? "Body system" : "Anatomy"}</div>
      <div className="v">${d ? d.name : sel.system ? SYS[sel.system].organ : "Whole body"}</div>
      <div className="d">${d ? d.ind : sel.system ? sel.system + " system" : "Ask a question, search, or select an organ"}</div>
      ${d && html`<div className="chips">${d.systems.map(s => html`<span key=${s} style=${{"--c":sysColor(s)}}><i></i>${SYS[s].organ}</span>`)}</div>`}
    </div>
    <div className="hud modes glass" role="group" aria-label="Rendering style">
      <button aria-pressed=${mode === "xray"} onClick=${() => setModeS("xray")}>X-ray</button>
      <button aria-pressed=${mode === "clinical"} onClick=${() => setModeS("clinical")}>Clinical</button>
    </div>
    <div className="hud tools glass">
      ${tool("reset", "Reset view", () => { setSel({ drug:null, system:null, outcome:null }); try { Atlas.resetView(); } catch (_){} })}
      ${tool("plus", "Zoom in", () => Atlas.zoom(0.75))}
      ${tool("minus", "Zoom out", () => Atlas.zoom(1.33))}
      <div className="sep"></div>
      ${tool(rotate ? "pause" : "play", rotate ? "Pause rotation" : "Rotate", () => setRotate(r => !r), rotate)}
      ${tool("layers", "Layers", () => setShowLayers(v => !v), showLayers)}
      ${tool("full", "Full screen", full)}
    </div>
    ${showLayers && html`<div className="hud layers glass"><h4>Layers</h4>${LAYERS.map(([k, l, c]) => html`<label key=${k}><input type="checkbox" id=${"layer-" + k} checked=${vis[k]} onChange=${e => setVis(v => ({ ...v, [k]:e.target.checked }))} /><span className="sw" style=${{"--c":c}}></span>${l}</label>`)}</div>`}
    ${focusSys && card && html`<div className="hud organ glass" style=${{"--c":sysColor(focusSys)}}>
      <div className="top"><div><span className="badge2"><i></i>${focusSys} system</span><h3>${SYS[focusSys].organ}</h3></div><button className="x" onClick=${() => setCard(false)} aria-label="Close organ card">×</button></div>
      <p>${ORGAN_FACTS[focusSys]}</p>
      ${organList.length > 0 && html`<ul>${organList.slice(0, 5).map(o => html`<li key=${o.name}><button onClick=${() => setSel({ drug:o.name, system:focusSys, outcome:null })}><b>${o.name}</b><span className="bar"><span style=${{width:(o.all ? o.pos / o.all * 100 : 0) + "%"}}></span></span><span className="n">${o.pos}/${o.all}</span></button></li>`)}</ul>`}
      <button className="btn primary ask" onClick=${() => onAsk(d ? `How does ${d.name} affect the ${SYS[focusSys].organ.toLowerCase()}?` : `Which medicines have the strongest evidence for the ${SYS[focusSys].organ.toLowerCase()}?`)}><${Icon} n="spark" s=${14} />Ask Health AI</button>
    </div>`}
    <div className="hud hint">Drag to rotate · scroll to zoom · right-drag to pan</div>
    <div className="hud sysbar">${SYS_NAMES.map(s => html`<button key=${s} className=${"sys" + (systems.includes(s) ? " on" : "")} style=${{"--c":sysColor(s)}} onClick=${() => onPick(s)}><i></i>${s}</button>`)}</div>
  </section>`;
}

function Palette({ onClose, onDrug, onSystem, onTrial, onAsk }){
  const [q, setQ] = useState(""); const [i, setI] = useState(0); const inp = useRef(null);
  useEffect(() => { inp.current && inp.current.focus(); }, []);
  const ql = lc(q).trim();
  const items = [];
  if (ql) items.push({ g:"Ask", label:`Ask Health AI: "${q.trim()}"`, run:() => onAsk(q.trim()) });
  DRUGS.filter(d => !ql || lc(d.name + " " + d.code + " " + d.ind + " " + d.cls).includes(ql)).slice(0, 6).forEach(d => items.push({ g:"Medicines", label:d.name, sub:d.code + " · " + d.ind, c:sysColor(d.systems[0]), run:() => onDrug(d.name) }));
  SYS_NAMES.filter(s => !ql || lc(s + " " + SYS[s].organ + " " + SYS_WORDS[s].join(" ")).includes(ql)).slice(0, 8).forEach(s => items.push({ g:"Body systems", label:SYS[s].organ, sub:s + " system", c:sysColor(s), run:() => onSystem(s) }));
  if (ql) TRIALS.filter(t => lc(t.id + " " + t.drug + " " + t.title).includes(ql)).slice(0, 6).forEach(t => items.push({ g:"Trials", label:t.id, sub:t.drug + " · " + t.phase + " · " + t.year, run:() => onTrial(t.id) }));
  const sel = Math.min(i, Math.max(0, items.length - 1));
  const key = e => { if (e.key === "ArrowDown"){ e.preventDefault(); setI(sel + 1 >= items.length ? 0 : sel + 1); } else if (e.key === "ArrowUp"){ e.preventDefault(); setI(sel <= 0 ? items.length - 1 : sel - 1); } else if (e.key === "Enter" && items[sel]){ e.preventDefault(); items[sel].run(); onClose(); } else if (e.key === "Escape"){ onClose(); } };
  let lastG = null;
  return html`<div className="palette-bg" onMouseDown=${e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="palette" role="dialog" aria-modal="true" aria-label="Search">
      <div className="in"><${Icon} n="search" /><input id="palette-input" ref=${inp} value=${q} onInput=${e => { setQ(e.target.value); setI(0); }} onKeyDown=${key} placeholder="Search medicines, organs and trials, or ask a question" aria-label="Search" /><span className="kbd">Esc</span></div>
      <div className="list" role="listbox">${items.length ? items.map((it, k) => { const head = it.g !== lastG; lastG = it.g; return html`<${Fragment} key=${k}>${head && html`<div className="grp">${it.g}</div>`}<button className="it" role="option" aria-selected=${k === sel} onMouseEnter=${() => setI(k)} onClick=${() => { it.run(); onClose(); }}>${it.g === "Ask" ? html`<${Icon} n="spark" s=${15} />` : html`<i style=${{"--c":it.c}}></i>`}<span>${it.label}</span>${it.sub && html`<small>${it.sub}</small>`}</button></${Fragment}>`; }) : html`<div className="grp">No matches</div>`}</div>
      <div className="foot2"><span>↑↓ to move</span><span>Enter to open</span><span>Esc to close</span></div>
    </div>
  </div>`;
}

function Forest({ drug, outcome, onOpen }){
  const p = useMemo(() => pool(drug, outcome), [drug, outcome]);
  if (!p.rows.length) return html`<p className="empty">No results for this outcome.</p>`;
  const rows = p.rows.slice().sort((a, b) => a.t.year - b.t.year);
  const vals = rows.flatMap(x => [x.r.lo, x.r.hi]).concat([0, p.lo ?? 0, p.hi ?? 0]);
  let mn = Math.min(...vals), mx = Math.max(...vals); const pad = (mx - mn) * 0.08 || 1; mn -= pad; mx += pad;
  const W = 820, L = 230, R = 170, rowH = 30, top = 34, H = top + rows.length * rowH + 74;
  const x = v => L + (v - mn) / (mx - mn) * (W - L - R);
  const step = niceStep((mx - mn) / 5); const ticks = []; for (let v = Math.ceil(mn / step) * step; v <= mx; v += step) ticks.push(+v.toFixed(6));
  const favLeft = p.better === -1 ? `Favours ${drug}` : "Favours comparator", favRight = p.better === -1 ? "Favours comparator" : `Favours ${drug}`;
  const maxW = Math.max(...rows.map(r => r.wp || 0), 1);
  return html`<div className="scroll"><svg className="forest" viewBox=${`0 0 ${W} ${H}`} width="100%" style=${{minWidth:640, display:"block"}} role="img" aria-label=${`Forest plot of ${outcome} for ${drug}`}>
    <text x="0" y="16" fill="var(--faint)" fontSize="10.5" fontFamily="var(--f-mono)" letterSpacing="0.06em">TRIAL · DOSE · N</text>
    <text x=${W - R + 16} y="16" fill="var(--faint)" fontSize="10.5" fontFamily="var(--f-mono)">DIFFERENCE [95% CI]</text>
    <text x=${W - 6} y="16" fill="var(--faint)" fontSize="10.5" fontFamily="var(--f-mono)" textAnchor="end">WT</text>
    ${ticks.map(v => html`<line key=${"g" + v} x1=${x(v)} x2=${x(v)} y1=${top - 8} y2=${top + rows.length * rowH + 8} stroke="var(--line-2)" />`)}
    <line x1=${x(0)} x2=${x(0)} y1=${top - 10} y2=${top + rows.length * rowH + 40} stroke="var(--muted)" strokeDasharray="3 3" />
    ${rows.map((r, i) => { const y = top + i * rowH + rowH / 2; const sz = r.wp ? 5 + 7 * Math.sqrt(r.wp / maxW) : 5; const col = r.r.dir === "Positive" ? "var(--pos)" : r.r.dir === "Negative" ? "var(--neg)" : "var(--neu)";
      return html`<g key=${i} style=${{cursor:"pointer"}} onClick=${() => onOpen(r.t.id, outcome)}>
        <rect x="0" y=${y - rowH / 2} width=${W} height=${rowH} fill="transparent" />
        <text x="0" y=${y + 4} fill="var(--accent)" fontSize="12.5" fontFamily="var(--f-mono)" fontWeight="600">${r.t.id}</text>
        <text x="74" y=${y + 4} fill="var(--ink)" fontSize="12.5">${r.a.dose}</text>
        <text x="148" y=${y + 4} fill="var(--muted)" fontSize="12">${r.t.comparator === "Placebo" ? "n=" + r.a.n : r.t.comparator === "Standard of care" ? "vs SoC" : "single arm"}</text>
        <line x1=${x(r.r.lo)} x2=${x(r.r.hi)} y1=${y} y2=${y} stroke=${col} strokeWidth="1.6" />
        <rect x=${x(r.r.md) - sz / 2} y=${y - sz / 2} width=${sz} height=${sz} fill=${col} rx="1.5" />
        <text x=${W - R + 16} y=${y + 4} fill="var(--ink)" fontSize="12" fontFamily="var(--f-mono)">${fmt(r.r.md)} [${fmt(r.r.lo)}, ${fmt(r.r.hi)}]</text>
        <text x=${W - 6} y=${y + 4} fill="var(--muted)" fontSize="11.5" fontFamily="var(--f-mono)" textAnchor="end">${r.wp ? r.wp.toFixed(0) + "%" : "–"}</text>
      </g>`; })}
    ${p.est != null && (() => { const y = top + rows.length * rowH + 22; return html`<g>
      <line x1="0" x2=${W} y1=${y - 13} y2=${y - 13} stroke="var(--line)" />
      <text x="0" y=${y + 4} fill="var(--ink)" fontSize="12.5" fontWeight="650">Pooled, placebo-controlled (k=${p.k})</text>
      <polygon points=${`${x(p.lo)},${y} ${x(p.est)},${y - 7} ${x(p.hi)},${y} ${x(p.est)},${y + 7}`} fill="var(--accent)" />
      <text x=${W - R + 16} y=${y + 4} fill="var(--ink)" fontSize="12" fontFamily="var(--f-mono)" fontWeight="600">${fmt(p.est)} [${fmt(p.lo)}, ${fmt(p.hi)}]</text>
      <text x=${W - 6} y=${y + 4} fill="var(--muted)" fontSize="11.5" fontFamily="var(--f-mono)" textAnchor="end">I² ${Math.round(p.I2)}%</text>
    </g>`; })()}
    ${ticks.map(v => html`<text key=${"t" + v} x=${x(v)} y=${H - 22} fill="var(--muted)" fontSize="11" fontFamily="var(--f-mono)" textAnchor="middle">${+v.toFixed(3)}</text>`)}
    <text x=${x(0) - 8} y=${H - 6} fill="var(--muted)" fontSize="11" textAnchor="end">← ${favLeft}</text>
    <text x=${x(0) + 8} y=${H - 6} fill="var(--muted)" fontSize="11">${favRight} →</text>
  </svg></div>
  <p className="note">${outcome} in ${p.unit}; ${p.better === -1 ? "lower" : "higher"} is better. Squares are sized by inverse-variance weight in the placebo-controlled pool; green marks a statistically significant improvement (${"p < 0.05"}). Select a row to open its study report at the results table.</p>`;
}
function niceStep(raw){ const p = Math.pow(10, Math.floor(Math.log10(raw))); const f = raw / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; }

function Safety({ drug }){
  const s = useMemo(() => safety(drug), [drug]);
  const top = s.aes.slice(0, 7), max = Math.max(...top.map(e => Math.max(e.drug, e.pbo)), 1);
  const W = 720, L = 190, R = 90, rowH = 30, H = 30 + top.length * rowH + 10;
  const x = v => L + v / max * (W - L - R);
  return html`<div>
    <div className="kpis"><div className="kpi"><b>${s.sae.toFixed(1)}%</b><span>Serious adverse events (mean across arms)</span></div><div className="kpi"><b>${s.disc.toFixed(1)}%</b><span>Discontinued for adverse events</span></div></div>
    <div className="scroll"><svg viewBox=${`0 0 ${W} ${H}`} width="100%" style=${{minWidth:520, display:"block"}} role="img" aria-label=${"Adverse event rates for " + drug}>
      <circle cx=${L} cy="12" r="5" fill="var(--accent)" /><text x=${L + 10} y="16" fill="var(--muted)" fontSize="12">${drug}</text>
      <circle cx=${L + 110} cy="12" r="5" fill="none" stroke="var(--muted)" strokeWidth="1.6" /><text x=${L + 120} y="16" fill="var(--muted)" fontSize="12">Comparator</text>
      ${top.map((e, i) => { const y = 40 + i * rowH; return html`<g key=${e.ae}>
        <text x="0" y=${y + 4} fill="var(--ink)" fontSize="12.5">${e.ae}</text>
        <line x1=${L} x2=${W - R} y1=${y} y2=${y} stroke="var(--line-2)" />
        <line x1=${x(Math.min(e.drug, e.pbo))} x2=${x(Math.max(e.drug, e.pbo))} y1=${y} y2=${y} stroke=${e.drug > e.pbo + 2 ? "var(--neg)" : "var(--muted)"} strokeWidth="3" strokeLinecap="round" opacity="0.6" />
        <circle cx=${x(e.pbo)} cy=${y} r="5" fill="var(--surface)" stroke="var(--muted)" strokeWidth="1.6" />
        <circle cx=${x(e.drug)} cy=${y} r="5.5" fill="var(--accent)" />
        <text x=${W - 4} y=${y + 4} fill="var(--muted)" fontSize="11.5" fontFamily="var(--f-mono)" textAnchor="end">${e.drug.toFixed(1)} vs ${e.pbo.toFixed(1)}%</text>
      </g>`; })}
    </svg></div>
    <p className="note">Event rates averaged across all arms of all ${drug} trials. Red links mark events at least 2 percentage points more frequent on ${drug}.</p>
  </div>`;
}

function Trials({ drug, system, onOpen }){
  const ts = TRIALS.filter(t => (drug ? t.drug === drug : true) && (system ? t.arms.some(a => a.results.some(r => r.sys === system)) : true)).sort((a, b) => b.year - a.year);
  return html`<div className="scroll"><table className="t">
    <thead><tr><th>Trial</th><th>Medicine</th><th>Phase</th><th>Design</th><th>N</th><th>Primary result</th><th></th></tr></thead>
    <tbody>${ts.map(t => { const pr = t.arms.flatMap(a => a.results.filter(r => r.prim).map(r => ({a, r}))); const best = pr.sort((x, y) => (y.r.dir === "Positive") - (x.r.dir === "Positive"))[0];
      return html`<tr key=${t.id}>
        <td><div className="mono" style=${{fontWeight:600}}>${t.id}</div><div style=${{fontSize:12, color:"var(--muted)"}}>${t.authors[0].split(". ")[1]} et al., ${t.year}</div></td>
        <td>${t.drug}<div style=${{fontSize:12, color:"var(--muted)"}}>${t.arms.map(a => a.dose).join(", ")}</div></td>
        <td>${t.phase}</td>
        <td><span className=${"q q-" + t.quality}>${t.quality}</span><div style=${{fontSize:12, color:"var(--muted)", marginTop:4, maxWidth:220}}>${t.design}</div></td>
        <td className="mono">${t.n}</td>
        <td>${best ? html`<span className=${"pill " + pillCls(best.r.dir)}>${best.r.dir}</span><div style=${{fontSize:12, color:"var(--muted)", marginTop:4}}>${best.r.o}: ${fmt(best.r.md)} ${best.r.unit}</div>` : "–"}</td>
        <td><button className="btn" onClick=${() => onOpen(t.id, best && best.r.o)}>Open report</button></td>
      </tr>`; })}</tbody></table></div>`;
}

function Evidence({ sel, setSel, onOpen }){
  const [tab, setTab] = useState("efficacy");
  const d = sel.drug ? DRUG_BY_NAME[lc(sel.drug)] : null;
  useEffect(() => { if (!d) setTab(t => t === "safety" ? "efficacy" : t); }, [sel.drug]);
  if (!d){
    const list = sel.system ? systemDrugs(sel.system).map(x => x.d) : DRUGS;
    return html`<section className="panel ev">
      <div className="ev-head"><div><h2 className="ev-title">${sel.system ? sel.system + " system" : "All medicines"}</h2><div className="ev-sub">${list.length} medicines · select one to see its evidence</div></div></div>
      <div className="tabs" role="tablist"><button className="tab" role="tab" aria-selected=${tab !== "trials"} onClick=${() => setTab("efficacy")}>Medicines</button><button className="tab" role="tab" aria-selected=${tab === "trials"} onClick=${() => setTab("trials")}>Trials</button></div>
      <div className="ev-body">${tab === "trials" ? html`<${Trials} drug=${null} system=${sel.system} onOpen=${onOpen} />` : html`<div className="cards">${list.map(x => { const n = drugTrials(x.name).length; return html`<button key=${x.name} className="dcard" onClick=${() => setSel({ drug:x.name, system:null, outcome:null })}>
        <b>${x.name}</b><span className="meta mono">${x.code} · ${n} trials</span><span>${x.ind}</span>
        <span className="row" style=${{gap:6, marginTop:4}}>${x.systems.map(s => html`<span key=${s} style=${{display:"inline-flex", alignItems:"center", gap:5, fontSize:11.5, color:"var(--muted)"}}><i style=${{width:7, height:7, borderRadius:"50%", background:sysColor(s), display:"inline-block"}}></i>${s}</span>`)}</span></button>`; })}</div>`}</div>
    </section>`;
  }
  const outs = drugOutcomes(d.name);
  const outcome = sel.outcome && outs.some(o => o.o === sel.outcome) ? sel.outcome : (outs.find(o => sel.system && o.sys === sel.system) || outs[0]).o;
  const s = drugSummary(d.name); const p = pool(d.name, outcome);
  return html`<section className="panel ev">
    <div className="ev-head">
      <div style=${{minWidth:0, flex:1}}><h2 className="ev-title">${d.name} <span className="mono" style=${{fontSize:13, color:"var(--muted)", fontWeight:500}}>${d.code}</span></h2><div className="ev-sub">${d.cls} · ${d.ind} · ${d.sponsor}</div></div>
      <button className="btn" onClick=${() => setSel({ drug:null, system:null, outcome:null })}>All medicines</button>
    </div>
    <div className="tabs" role="tablist">
      ${[["efficacy", "Efficacy"], ["trials", `Trials · ${s.trials}`], ["safety", "Safety"]].map(([k, l]) => html`<button key=${k} className="tab" role="tab" aria-selected=${tab === k} onClick=${() => setTab(k)}>${l}</button>`)}
    </div>
    <div className="ev-body">
      ${tab === "efficacy" && html`<${Fragment}>
        <div className="kpis">
          <div className="kpi"><b>${s.trials}</b><span>Trials · ${s.phases.join(", ")}</span></div>
          <div className="kpi"><b>${s.participants.toLocaleString()}</b><span>Participants</span></div>
          <div className="kpi"><b>${s.high_quality_trials}/${s.trials}</b><span>High-quality trials</span></div>
          <div className="kpi"><b>${p.est != null ? fmt(p.est) : "–"}</b><span>Pooled ${outcome} (${p.unit})</span></div>
          <div className="kpi"><b>${p.tally.pos}/${p.rows.length}</b><span>Arms with significant improvement</span></div>
        </div>
        <div className="row" style=${{marginBottom:10}}>
          <label htmlFor="outcome-sel" style=${{fontSize:13, color:"var(--muted)"}}>Outcome</label>
          <select id="outcome-sel" className="sel" value=${outcome} onChange=${e => setSel({ ...sel, outcome:e.target.value })}>
            ${outs.map(o => html`<option key=${o.o} value=${o.o}>${o.o}${o.prim ? " (primary)" : ""} · ${o.sys}</option>`)}
          </select>
        </div>
        <${Forest} drug=${d.name} outcome=${outcome} onOpen=${onOpen} />
      </${Fragment}>`}
      ${tab === "trials" && html`<${Trials} drug=${d.name} onOpen=${onOpen} />`}
      ${tab === "safety" && html`<${Safety} drug=${d.name} />`}
    </div>
  </section>`;
}

function Report({ id, focusOutcome, onClose }){
  const t = TRIAL_BY_ID[id]; const ref = useRef(null);
  useEffect(() => {
    const k = e => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k);
    const tm = setTimeout(() => { const el = ref.current && focusOutcome ? ref.current.querySelector(`[data-o="${CSS.escape(focusOutcome)}"]`) : null; if (el){ el.scrollIntoView({ behavior:REDUCED ? "auto" : "smooth", block:"center" }); el.classList.add("hl"); setTimeout(() => el.classList.remove("hl"), 2400); } }, 250);
    return () => { window.removeEventListener("keydown", k); clearTimeout(tm); };
  }, [id, focusOutcome]);
  if (!t) return null;
  const prim = t.arms.flatMap(a => a.results.filter(r => r.prim).map(r => ({a, r})));
  const totalN = t.n;
  const abstract = {
    bg:`${t.drug} (${t.code}) is ${article(lcClass(DRUG_BY_NAME[lc(t.drug)].cls))} ${lcClass(DRUG_BY_NAME[lc(t.drug)].cls)} in development for ${lc(DRUG_BY_NAME[lc(t.drug)].ind)}.`,
    m:`${t.design} ${lc(t.phase)} trial in ${lc(t.pop)} across ${t.countries.length} countr${t.countries.length > 1 ? "ies" : "y"}. Participants received ${t.arms.map(a => a.dose).join(" or ")}${t.comparator === "None (baseline)" ? "" : " or " + lc(t.comparator)} for ${t.duration}. The primary endpoint was change in ${lc(prim[0].r.o)}.`,
    r:`${totalN} participants were randomised. ` + prim.map(({a, r}) => `At ${a.dose}, the difference in ${lc(r.o)} was ${fmt(r.md)} ${r.unit} (95% CI ${fmt(r.lo)} to ${fmt(r.hi)}; p ${r.p <= 0.001 ? "< 0.001" : "= " + fmtP(r.p)}).`).join(" "),
    c: prim.some(x => x.r.dir === "Positive") ? `${t.drug} improved ${lc(prim[0].r.o)} versus ${lc(t.comparator)} with an acceptable safety profile over ${t.duration}.` : `${t.drug} did not significantly change ${lc(prim[0].r.o)} versus ${lc(t.comparator)} over ${t.duration}.`
  };
  const fname = `${t.id}_${t.drug}_${t.year}_study_report.pdf`;
  return html`<div className="sheet" role="dialog" aria-modal="true" aria-label=${"Study report " + t.id} onClick=${e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="sheet-wrap" ref=${ref}>
      <div className="sheet-bar"><span className="fn">${fname}</span><span className="row"><a className="btn" href=${"/api/report/" + t.id} target="_blank" rel="noopener">Open PDF</a><button className="btn primary" onClick=${onClose}>Close</button></span></div>
      <article className="paper">
        <span className="synth">SYNTHETIC</span>
        <div className="jr"><span>${t.journal}</span><span>${t.year} · ${t.phase}</span></div>
        <h2>${t.title}</h2>
        <div className="au">${t.authors.join(", ")}</div>
        <div className="reg">Registry ${t.reg} · Trial ${t.id} · Sponsor ${t.sponsor}</div>
        <div className="abs">
          <p><b>Background.</b> ${abstract.bg}</p><p><b>Methods.</b> ${abstract.m}</p><p><b>Results.</b> ${abstract.r}</p><p style=${{marginBottom:0}}><b>Conclusions.</b> ${abstract.c}</p>
        </div>
        <h3>Methods</h3>
        <p>Design: ${t.design}. Comparator: ${t.comparator}. Duration: ${t.duration}. Sites in ${t.countries.join(", ")}. Population: ${t.pop}. Arms: ${t.arms.map(a => `${a.dose} (n=${a.n})`).join("; ")}.</p>
        <div className="cap">Table 2. Efficacy outcomes, difference versus ${lc(t.comparator)}</div>
        <div className="tw"><table><thead><tr><th>Dose</th><th>Outcome</th><th>Difference</th><th>95% CI</th><th>p</th><th>Result</th></tr></thead>
          <tbody>${t.arms.flatMap(a => a.results.map(r => html`<tr key=${a.dose + r.o} data-o=${r.o}><td>${a.dose}</td><td>${r.o}${r.prim ? " *" : ""}</td><td>${fmt(r.md)} ${r.unit}</td><td>${fmt(r.lo)} to ${fmt(r.hi)}</td><td>${fmtP(r.p)}</td><td>${r.dir}</td></tr>`))}</tbody></table></div>
        <p style=${{fontSize:12, marginTop:6}}>* Primary endpoint.</p>
        <div className="cap">Table 3. Adverse events, % of participants</div>
        <div className="tw"><table><thead><tr><th>Dose</th><th>Event</th><th>${t.drug}</th><th>Comparator</th></tr></thead>
          <tbody>${t.arms.flatMap(a => a.aes.map(e => html`<tr key=${a.dose + e.ae}><td>${a.dose}</td><td>${e.ae}</td><td>${e.drug}%</td><td>${e.pbo}%</td></tr>`))}
          ${t.arms.map(a => html`<tr key=${"s" + a.dose}><td>${a.dose}</td><td>Serious adverse events</td><td>${a.sae}%</td><td>–</td></tr>`)}</tbody></table></div>
        <span className="pg">Synthetic document · not a real publication</span>
      </article>
    </div>
  </div>`;
}

function Chat({ agent, onLink }){
  const { msgs, busy, send, stop, reset, mode, setMode, live } = agent;
  const [text, setText] = useState("");
  const box = useRef(null), end = useRef(null);
  useEffect(() => { const el = box.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs]);
  const submit = e => { e && e.preventDefault(); if (!text.trim() || busy) return; send(text.trim()); setText(""); };
  const click = e => { const b = e.target.closest("[data-trial],[data-drug]"); if (!b) return; onLink(b.dataset.trial ? { trial:b.dataset.trial } : { drug:b.dataset.drug }); };
  return html`<section className="panel chat">
    <div className="chat-head"><h2>Assistant</h2><span className="spacer"></span>
      <button type="button" className="reset" onClick=${() => { setText(""); reset(); }} disabled=${msgs.length <= 1 && !busy} title="Clear this conversation and start again" aria-label="New chat"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>New chat</button>
      <div className="seg" role="group" aria-label="Response mode">${[["quick", "Fast"], ["default", "Thorough"]].map(([k, l]) => html`<button key=${k} aria-pressed=${mode === k} onClick=${() => setMode(k)} disabled=${!live} title=${live ? "" : "Health AI is in offline mode in this view"}>${l}</button>`)}</div>
    </div>
    <div className="msgs" ref=${box} onClick=${click} aria-live="polite">
      ${msgs.map((m, i) => html`<div key=${i} className=${"msg " + (m.role === "user" ? "user" : "ai")}>
        ${m.role !== "user" && html`<span className="who"><span className="av"><${Icon} n="spark" s=${12} w=${2.4} /></span>${m.offline ? "Health AI · offline" : "Health AI"}</span>`}
        ${m.steps && m.steps.length > 0 && html`<div className="steps">${m.steps.map((s, j) => html`<span key=${j} className=${"step " + (s.done ? "done" : "run")}>${s.label}</span>`)}</div>`}
        <div className="bubble">${m.role === "user" ? m.text : (m.text ? html`<div className="md" dangerouslySetInnerHTML=${{ __html:md(m.text) }}></div>` : html`<span className="thinking"><i></i><i></i><i></i></span>`)}</div>
        ${m.error && html`<span className="fine">${m.error}</span>`}
        ${m.role !== "user" && m.text && i > 0 && html`<div className="msg-actions"><button className="mini" onClick=${e => { const b = e.currentTarget; const done = () => { b.lastChild.textContent = "Copied"; setTimeout(() => { b.lastChild.textContent = "Copy"; }, 1400); }; try { navigator.clipboard.writeText(m.text).then(done, () => {}); } catch (_){} }}><${Icon} n="copy" s=${13} /><span>Copy</span></button></div>`}
      </div>`)}
      <div ref=${end}></div>
    </div>
    ${msgs.length <= 1 && html`<div className="suggest">${SUGGEST.map(s => html`<button key=${s} className="sg" onClick=${() => send(s)}>${s}</button>`)}</div>`}
    <form className="composer" onSubmit=${submit}>
      <div className="cbox">
        <textarea id="ask" rows="1" value=${text} placeholder="Ask about a medicine, organ or trial…" onInput=${e => { setText(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(140, e.target.scrollHeight) + "px"; }} onKeyDown=${e => { if (e.key === "Enter" && !e.shiftKey){ e.preventDefault(); submit(); } }} aria-label="Message"></textarea>
        ${busy ? html`<button type="button" className="send stop" onClick=${stop} aria-label="Stop"><svg width="12" height="12" viewBox="0 0 12 12"><rect width="12" height="12" rx="2" fill="currentColor"/></svg></button>`
               : html`<button type="submit" className="send" disabled=${!text.trim()} aria-label="Send"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg></button>`}
      </div>
      <p className="fine">Fictional medicines and trials for demonstration. Not medical advice.</p>
    </form>
  </section>`;
}

const GREETING = () => [{ role:"ai", text:`Hello. I can answer questions about **${DRUGS.length} fictional medicines** and **${TRIALS.length} synthetic trials** across ${SYS_NAMES.length} body systems. The body map and evidence panel follow the conversation, and trial IDs like [${TRIALS[0].id}] open the study report.` }];
const START_SEL = { drug:"Glucendra", system:null, outcome:null };
function useAgent(setSel){
  const [msgs, setMsgs] = useState(GREETING);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState("quick");
  const [live, setLive] = useState(null);
  const ctlRef = useRef(null);
  useEffect(() => { fetch("/api/health").then(r => r.json()).then(h => setLive(!!h.ai)).catch(() => setLive(false)); }, []);
  const patch = (fn) => setMsgs(ms => { const c = ms.slice(); c[c.length - 1] = fn({ ...c[c.length - 1] }); return c; });
  const select = (s) => setSel(cur => ({ drug:s.drug !== undefined ? s.drug : cur.drug, system:s.system !== undefined ? s.system : cur.system, outcome:s.outcome !== undefined ? s.outcome : null }));
  const send = useCallback(async (text) => {
    const history = msgs.filter(m => m.text && !m.error && m !== msgs[0]).slice(-10).map(m => ({ role:m.role === "user" ? "user" : "assistant", content:m.text }));
    setMsgs(ms => [...ms, { role:"user", text }, { role:"ai", text:"", steps:[{ label:"Working", done:false }] }]);
    setBusy(true);
    const offline = (why) => { const steps = []; const lui = { step:() => {}, done:(l) => steps.push({ label:l, done:true }), select };
      lui.done("Searched local index"); const ans = localAnswer(text, lui); patch(m => ({ ...m, text:ans, steps, offline:true, error:why })); };
    if (live === false){ offline("Health AI is in offline mode, so this answer comes from the built-in evidence index."); setBusy(false); return; }
    const ctl = new AbortController(); ctlRef.current = ctl;
    try {
      const r = await fetch("/api/chat", { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ messages:[...history, { role:"user", content:text }], mode }), signal:ctl.signal });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || ("HTTP " + r.status));
      const out = await r.json();
      patch(m => ({ ...m, text:out.text || "No answer was returned.", steps:(out.steps || []).map(l => ({ label:l, done:true })) }));
      if (out.ui){
        const drug = out.ui.drug ? resolveDrug(String(out.ui.drug)) : null;
        const system = out.ui.system && SYS[out.ui.system] ? out.ui.system : null;
        select({ drug, system, outcome:out.ui.outcome ? matchOutcome(String(out.ui.outcome), drug) : null });
      }
    } catch (e) {
      if (e.name === "AbortError") patch(m => ({ ...m, text:"Stopped.", steps:[] }));
      else offline("Health AI did not respond (" + String(e.message || e).slice(0, 120) + "), so this answer comes from the built-in evidence index.");
    } finally { setBusy(false); ctlRef.current = null; }
  }, [msgs, mode, live]);
  const stop = () => ctlRef.current && ctlRef.current.abort();
  const reset = useCallback(() => {
    if (ctlRef.current) ctlRef.current.abort();
    ctlRef.current = null; setBusy(false);
    setMsgs(GREETING()); setSel(START_SEL);
  }, [setSel]);
  return { msgs, busy, send, stop, reset, mode, setMode, live };
}

function App(){
  const [sel, setSel] = useState(START_SEL);
  const [report, setReport] = useState(null);
  const agent = useAgent(setSel);
  const pick = useCallback((system) => setSel(cur => ({ drug:cur.drug && (DRUG_BY_NAME[lc(cur.drug)].systems.includes(system) || drugOutcomes(cur.drug).some(o => o.sys === system)) ? cur.drug : null, system:cur.system === system && !cur.drug ? null : system, outcome:null })), []);
  const open = (id, outcome) => setReport({ id, outcome });
  const onLink = (x) => { if (x.trial) open(x.trial, null); else if (x.drug) setSel({ drug:x.drug, system:null, outcome:null }); };
  const [palette, setPalette] = useState(false);
  useEffect(() => { const k = e => { if ((e.metaKey || e.ctrlKey) && lc(e.key) === "k"){ e.preventDefault(); setPalette(p => !p); } }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, []);
  const ask = (text) => { if (!agent.busy) agent.send(text); };
  return html`
    <header className="appbar">
      <${Logo} />
      <div><h1>Clinical Atlas</h1><div className="sub">Evidence explorer · synthetic trial data</div></div>
      <button className="search" onClick=${() => setPalette(true)} aria-label="Search"><${Icon} n="search" s=${16} /><span>Search medicines, organs, trials…</span><span className="kbd">⌘K</span></button>
      <span className=${"badge" + (agent.live ? " live" : "")}><span className="dot"></span>${agent.live === null ? "Health AI · starting" : agent.live ? "Health AI" : "Health AI · offline mode"}</span>
      <span className="badge" title=${D.meta && D.meta.version ? "Last refresh " + D.meta.version : ""}>Evidence Vault · ${TRIALS.length} trials${D.meta && D.meta.version ? " · refreshed " + new Date(D.meta.version.replace(" ", "T") + "Z").toLocaleDateString(undefined, { day:"numeric", month:"short" }) : ""}</span>
    </header>
    <div className="layout">
      <${Chat} agent=${agent} onLink=${onLink} />
      <div className="work">
        <${Stage} sel=${sel} onPick=${pick} onAsk=${ask} setSel=${setSel} />
        <${Evidence} sel=${sel} setSel=${setSel} onOpen=${open} />
      </div>
    </div>
    <p className="foot">All medicines, sponsors, authors, registries and results in Clinical Atlas are generated for demonstration and do not describe real products or studies. Pooled estimates use a fixed-effect inverse-variance model over placebo-controlled arms.</p>
    ${report && html`<${Report} id=${report.id} focusOutcome=${report.outcome} onClose=${() => setReport(null)} />`}
    ${palette && html`<${Palette} onClose=${() => setPalette(false)} onDrug=${n => setSel({ drug:n, system:null, outcome:null })} onSystem=${s => setSel({ drug:null, system:s, outcome:null })} onTrial=${id => open(id, null)} onAsk=${ask} />`}`;
}

ReactDOM.createRoot(document.getElementById("app")).render(html`<${App} />`);
