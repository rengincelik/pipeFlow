'use strict';

/** Base Fluid Class */
export class FluidBase {
	constructor(config) {
		// Eğer config.meta varsa onu kullan, yoksa config'in kendisini meta kabul et
		this.meta = config.meta || config;
	}
	get id() { return this.meta.id; }
	get name() { return this.meta.name; }
}

/** Empirical MODEL (Su dahil tüm sıvılar için katsayı tabanlı) */
/** Sadece newtonian sıvılar için geçerli **/
export class EmpiricalFluidModel extends FluidBase {
	constructor(config) {
		super(config);
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