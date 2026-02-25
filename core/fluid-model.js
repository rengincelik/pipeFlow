'use strict';

/**
 * Temel Sıvı Sınıfı
 */
class FluidBase {
  constructor(meta) {
    this.meta = meta;
  }
  get id() { return this.meta.id; }
  get name() { return this.meta.name; }
}

/**
 * AMPİRİK MODEL (Su dahil tüm sıvılar için katsayı tabanlı)
 */
class EmpiricalFluidModel extends FluidBase {
  constructor(config) {
    super(config.meta);
    this.coeffs = config.coeffs;
  }

  getProps(T_C) {
    const warnings = [];
    const { T_min_C, T_max_C } = this.meta.valid_range;
    if (T_C < T_min_C || T_C > T_max_C)
       warnings.push(`T=${T_C}°C limit dışı [${T_min_C}-${T_max_C}]`);

    // 1. Yoğunluk (Polynomial): rho = A + BT + CT^2 + DT^3
    const [rA, rB, rC, rD = 0] = this.coeffs.rho;
    const rho = rA + rB * T_C + rC * Math.pow(T_C, 2) + rD * Math.pow(T_C, 3);

    // 2. Viskozite (Vogel): mu = A * exp(B / (T_C + C))
    const [vA, vB, vC] = this.coeffs.mu_vogel;
    const mu_mPas = vA * Math.exp(vB / (T_C + vC));

    // 3. Isı Sığası (Cp): A + BT
    const [cA, cB] = this.coeffs.cp;
    const cp = cA + cB * T_C;

    return {
      rho,
      mu_mPas,
      nu_mm2s: (mu_mPas / 1000 / rho) * 1e6,
      cp,
      warnings
    };
  }
}

// ── REGISTRY VE VERİLER ───────────────────────────────────────

export const fluidRegistry = new Map();

// 1. SAF SU (0-150°C arası çok yüksek hassasiyetli katsayılar)
fluidRegistry.set('water', new EmpiricalFluidModel({
  meta: { id: 'water', name: 'Su (H2O)', valid_range: { T_min_C: 0, T_max_C: 150 } },
  coeffs: {
    // rho için IAPWS-95'e yakınsadılmış polinom katsayıları
    rho: [999.84, 0.067, -0.0089, 0.000035],
    // mu için Vogel katsayıları
    mu_vogel: [0.0241, 514.4, 133.5],
    cp: [4.18, 0.0001]
  }
}));

// 2. ETİLEN GLİKOL %50
fluidRegistry.set('eg50', new EmpiricalFluidModel({
  meta: { id: 'eg50', name: 'Etilen Glikol %50', valid_range: { T_min_C: -30, T_max_C: 120 } },
  coeffs: {
    rho: [1085.1, -0.523, -0.0018],
    mu_vogel: [0.0125, 1205.5, 155.2],
    cp: [3.3, 0.005]
  }
}));

