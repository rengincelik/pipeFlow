'use strict';

// ═══════════════════════════════════════════════════════════
// HYDRAULICS CORE — saf hesap fonksiyonları, UI bağımsız
// ═══════════════════════════════════════════════════════════

export const G       = 9.80665;   // [m/s²]
export const P_ATM   = 101325;    // [Pa]

// ── REYNOLDS ────────────────────────────────────────────────
/** @returns {number} Reynolds sayısı, nu<=0 ise Infinity */
export function reynolds(v, D, nu) {
  if (nu <= 0 || D <= 0) return Infinity;
  return (v * D) / nu;
}

// ── AKIŞ REJİMİ ─────────────────────────────────────────────
/** @returns {{ label:string, code:'L'|'Tr'|'T', cssClass:string }} */
export function flowRegime(Re) {
  if (Re < 2300) return { label: 'Laminer',      code: 'L',  cssClass: 'regime-laminar' };
  if (Re < 4000) return { label: 'Geçiş',        code: 'Tr', cssClass: 'regime-trans'  };
  return               { label: 'Türbülanslı',   code: 'T',  cssClass: 'regime-turb'   };
}

// ── DARCY SÜRTÜNME FAKTÖRÜ ───────────────────────────────────
/**
 * Laminer  : f = 64/Re
 * Geçiş    : lineer interpolasyon (Re 2300→4000)
 * Türb.    : Colebrook-White (Newton-Raphson, Swamee-Jain başlangıç)
 */
export function frictionFactor(Re, D_m, eps_mm) {
  if (Re < 1e-9) return 64;
  const eps = (eps_mm / 1000) / D_m;
  if (Re <= 2300) return 64 / Re;

  const f_turb = _colebrook(Re, eps);
  if (Re < 4000) {
    const f_lam = 64 / 2300;
    const t = (Re - 2300) / 1700;
    return f_lam * (1 - t) + f_turb * t;
  }
  return f_turb;
}

function _colebrook(Re, eps) {
  let f = 0.25 / Math.pow(Math.log10(eps / 3.7 + 5.74 / Math.pow(Re, 0.9)), 2);
  for (let i = 0; i < 50; i++) {
    const sqf = Math.sqrt(f);
    const rhs = -2.0 * Math.log10(eps / 3.7 + 2.51 / (Re * sqf));
    const fn  = 1.0 / (rhs * rhs);
    if (Math.abs(fn - f) < 1e-12) break;
    f = fn;
  }
  return f;
}

// ── YÜK KAYIPLARI ────────────────────────────────────────────

/** Darcy-Weisbach: hf = f*(L/D)*v²/(2g)  [m] */
export function hLoss_friction(f, L, D, v) {
  return f * (L / D) * (v * v) / (2 * G);
}

/** Bağlantı elemanı: hm = K*v²/(2g)  [m] */
export function hLoss_fitting(K, v) {
  return K * (v * v) / (2 * G);
}

/** Ani genişleme — Borda-Carnot: hexp = (v1-v2)²/(2g)  [m] */
export function hLoss_expansion(v1, v2) {
  const dv = v1 - v2;
  return (dv * dv) / (2 * G);
}

/** Ani daralma — Borda-Carnot yaklaşımı: Kc=0.5*(1-A2/A1)  [m] */
export function hLoss_contraction(D1_m, D2_m, v2) {
  const aRatio = Math.min((D2_m * D2_m) / (D1_m * D1_m), 1);
  const Kc = 0.5 * (1 - aRatio);
  return Kc * (v2 * v2) / (2 * G);
}

// ── TEK SEGMENT HESABI ───────────────────────────────────────
/**
 * @param {{ diameter_mm, length_m, dz_m, eps_mm, K_fittings }} seg
 * @param {number} Q_m3s
 * @param {{ rho, mu_mPas }} fluid
 * @param {{ diameter_mm }|null} prevSeg
 * @returns {SegmentResult}
 */
export function calcSegment(seg, Q_m3s, fluid, prevSeg = null) {
  const D   = seg.diameter_mm / 1000;
  const A   = Math.PI * D * D / 4;
  const v   = Q_m3s / A;
  const nu  = (fluid.mu_mPas / 1000) / fluid.rho;  // m²/s

  const Re     = reynolds(v, D, nu);
  const regime = flowRegime(Re);
  const f      = frictionFactor(Re, D, seg.eps_mm);

  const hf_friction  = hLoss_friction(f, seg.length_m, D, v);
  const hf_fittings  = hLoss_fitting(seg.K_fittings ?? 0, v);
  const hf_elevation = seg.dz_m ?? 0;

  let hf_transition = 0;
  let transitionType = null;
  if (prevSeg) {
    const Dp = prevSeg.diameter_mm / 1000;
    if (Math.abs(D - Dp) > 1e-4) {
      if (D < Dp) {
        hf_transition = hLoss_contraction(Dp, D, v);
        transitionType = 'contraction';
      } else {
        const vp = Q_m3s / (Math.PI * Dp * Dp / 4);
        hf_transition = hLoss_expansion(vp, v);
        transitionType = 'expansion';
      }
    }
  }

  const hf_total  = hf_friction + hf_fittings + hf_elevation + hf_transition;
  const dP_Pa     = fluid.rho * G * hf_total;

  return {
    v, Re, regime, f,
    hf: { friction: hf_friction, fittings: hf_fittings,
          elevation: hf_elevation, transition: hf_transition, total: hf_total },
    transitionType,
    dP_Pa,
    dP_bar: dP_Pa / 1e5,
  };
}

// ── TÜM SİSTEM ──────────────────────────────────────────────
/** @returns {{ segments, P_out_bar, totals, status }} */
export function calcSystem(componentResults) {
  // componentResults: her komponent calcHydraulics() çağrısının çıktısı
  const totals = componentResults.reduce((acc, r) => {
    acc.dP_bar  += r.dP_bar  ?? 0;
    acc.hf      += r.hf?.total ?? 0;
    return acc;
  }, { dP_bar: 0, hf: 0 });

  return { totals };
}
