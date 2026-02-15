/**
 * hydraulics.js
 * Hidrolik hesap motoru. Saf JS, bağımlılık yok.
 *
 * Birimler (dahili):
 *   uzunluk: m  |  basınç: Pa  |  debi: m³/s
 *   viskozite: Pa·s  |  yoğunluk: kg/m³
 */

'use strict';

const G = 9.80665;

const REGIME = {
  LAMINAR:    'Laminer',
  TRANSITION: 'Geçiş',
  TURBULENT:  'Türbülanslı',
};

// ── TEMEL FONKSİYONLAR ────────────────────────────────────

function pipeArea(D_m)          { return Math.PI * D_m * D_m / 4; }
function velocity(Q_m3s, D_m)   { return Q_m3s / pipeArea(D_m); }
function reynoldsNumber(v, D, nu) { return (v * D) / nu; }

function flowRegime(Re) {
  if (Re < 2300) return REGIME.LAMINAR;
  if (Re < 4000) return REGIME.TRANSITION;
  return REGIME.TURBULENT;
}

// ── SÜRTÜNME FAKTÖRÜ ─────────────────────────────────────

function colebrookWhite(Re, relRoughness) {
  let f = swameeJain(Re, relRoughness);
  for (let i = 0; i < 100; i++) {
    const rhs  = -2.0 * Math.log10(relRoughness / 3.7 + 2.51 / (Re * Math.sqrt(f)));
    const fNew = 1.0 / (rhs * rhs);
    if (Math.abs(fNew - f) < 1e-10) return fNew;
    f = fNew;
  }
  return f;
}

function swameeJain(Re, eps) {
  return 0.25 / Math.pow(Math.log10(eps / 3.7 + 5.74 / Math.pow(Re, 0.9)), 2);
}

function frictionFactor(Re, D_m, epsilon_mm) {
  if (Re < 1e-9) return 64;
  const eps = (epsilon_mm / 1000) / D_m;
  if (Re < 2300) return 64 / Re;
  if (Re < 4000) {
    const fL = 64 / 2300;
    const fT = colebrookWhite(4000, eps);
    const t  = (Re - 2300) / 1700;
    return fL * (1 - t) + fT * t;
  }
  return colebrookWhite(Re, eps);
}

// ── YÜK KAYIPLARI [m] ────────────────────────────────────

function headLossFriction(f, L, D, v) {
  return f * (L / D) * (v * v) / (2 * G);
}
function headLossFitting(K, v) {
  return K * (v * v) / (2 * G);
}
function headLossElevation(dz) { return dz; }

function headLossContraction(v_down, A_up, A_down) {
  if (A_up <= A_down) return 0;
  const Kc = 0.5 * (1 - A_down / A_up);
  return Kc * (v_down * v_down) / (2 * G);
}
function headLossExpansion(v_up, v_down) {
  if (v_up <= v_down) return 0;
  return Math.pow(v_up - v_down, 2) / (2 * G);
}

function headToPressure(hL, rho) { return rho * G * hL; }

// ── SEGMENT HESABI ────────────────────────────────────────
/**
 * @param {object} seg - {
 *   length_m, diameter_mm, dz_m,
 *   fittings: { key: count },
 *   fittingKValues: { key: K },
 *   epsilon_mm
 * }
 * @param {number}      Q_m3s
 * @param {object}      props  - { rho, mu [mPa·s] }
 * @param {object|null} prevSeg
 */
function calcSegment(seg, Q_m3s, props, prevSeg = null) {
  const D  = seg.diameter_mm / 1000;
  const A  = pipeArea(D);
  const v  = Q_m3s / A;
  const nu = (props.mu / 1000) / props.rho;   // m²/s

  const Re     = reynoldsNumber(v, D, nu);
  const regime = flowRegime(Re);
  const f      = frictionFactor(Re, D, seg.epsilon_mm);

  // K toplamı
  let K_total = 0;
  if (seg.fittings && seg.fittingKValues) {
    for (const [key, count] of Object.entries(seg.fittings)) {
      const K = seg.fittingKValues[key];
      if (K !== undefined && count > 0) K_total += count * K;
    }
  }

  const hf_friction  = headLossFriction(f, seg.length_m, D, v);
  const hf_fittings  = headLossFitting(K_total, v);
  const hf_elevation = headLossElevation(seg.dz_m);

  let hf_transition = 0;
  if (prevSeg) {
    const D_p = prevSeg.diameter_mm / 1000;
    const A_p = pipeArea(D_p);
    const v_p = Q_m3s / A_p;
    if (D < D_p)      hf_transition = headLossContraction(v, A_p, A);
    else if (D > D_p) hf_transition = headLossExpansion(v_p, v);
  }

  const hf_total  = hf_friction + hf_fittings + hf_elevation + hf_transition;
  const deltaP_Pa = headToPressure(hf_total, props.rho);

  return {
    D_mm: seg.diameter_mm, L_m: seg.length_m, dz_m: seg.dz_m,
    v_ms:   +v.toFixed(5),
    Re:     +Re.toFixed(2),
    regime,
    f:      +f.toFixed(8),
    K_total: +K_total.toFixed(4),
    hf_friction:   +hf_friction.toFixed(6),
    hf_fittings:   +hf_fittings.toFixed(6),
    hf_elevation:  +hf_elevation.toFixed(6),
    hf_transition: +hf_transition.toFixed(6),
    hf_total:      +hf_total.toFixed(6),
    deltaP_Pa:  +deltaP_Pa.toFixed(4),
    deltaP_bar: +(deltaP_Pa / 1e5).toFixed(6),
  };
}

// ── SİSTEM HESABI (seri) ─────────────────────────────────
/**
 * @param {object[]} segments
 * @param {number}   Q_lpm
 * @param {number}   P_in_bar
 * @param {object}   props   - FluidModel.getProps(T) çıktısı
 */
function calcSystem(segments, Q_lpm, P_in_bar, props) {
  const Q_m3s = Q_lpm / 60000;
  let P_Pa = P_in_bar * 1e5;
  const segResults = [];
  let totalHL = 0, hl_f = 0, hl_fit = 0, hl_el = 0, hl_tr = 0;

  segments.forEach((seg, i) => {
    const res = calcSegment(seg, Q_m3s, props, i > 0 ? segments[i-1] : null);
    res.P_in_bar  = +(P_Pa / 1e5).toFixed(5);
    P_Pa         -= res.deltaP_Pa;
    res.P_out_bar = +(P_Pa / 1e5).toFixed(5);
    totalHL += res.hf_total;
    hl_f    += res.hf_friction;
    hl_fit  += res.hf_fittings;
    hl_el   += res.hf_elevation;
    hl_tr   += res.hf_transition;
    segResults.push(res);
  });

  return {
    Q_in_lpm: Q_lpm, Q_out_lpm: Q_lpm, Q_m3s,
    P_in_bar,
    P_out_bar:  +(P_Pa / 1e5).toFixed(5),
    deltaP_bar: +(P_in_bar - P_Pa / 1e5).toFixed(5),
    totalHL:    +totalHL.toFixed(4),
    breakdown: {
      friction:   +hl_f.toFixed(4),
      fittings:   +hl_fit.toFixed(4),
      elevation:  +hl_el.toFixed(4),
      transition: +hl_tr.toFixed(4),
    },
    fluid: {
      T_C: props.T, rho: props.rho,
      mu: props.mu, nu: props.nu,
      source: props.source,
    },
    warnings: [...(props.warnings || [])],
    segments: segResults,
  };
}

export {
  G, REGIME,
  pipeArea, velocity, reynoldsNumber, flowRegime,
  frictionFactor, colebrookWhite,
  headLossFriction, headLossFitting, headLossElevation,
  headLossContraction, headLossExpansion, headToPressure,
  calcSegment, calcSystem,
};
