'use strict';

// ═══════════════════════════════════════════════════════════
// FLUID MODEL — JSON-tabanlı, spline interpolasyon
// ═══════════════════════════════════════════════════════════

import { splineInterp } from './interpolation.js';

export class FluidModel {
  /** @param {object} data — { meta, table: [{T_C, rho, mu, ...}] } */
  constructor(data) {
    this.meta = data.meta;
    this._buildIndex(data.table);
  }

  _buildIndex(rows) {
    const cols = Object.keys(rows[0]).filter(k => k !== 'T_C');
    this._T = rows.map(r => r.T_C);
    this._cols = {};
    cols.forEach(col => { this._cols[col] = rows.map(r => r[col]); });
  }

  /**
   * T_C'de sıvı özelliklerini döner.
   * @returns {{ rho, mu_mPas, nu_mm2s, cp, k, Pr, warnings:string[] }}
   */
  getProps(T_C) {
    const warnings = [];
    const { T_min_C, T_max_C } = this.meta.valid_range;
    if (T_C < T_min_C || T_C > T_max_C)
      warnings.push(`T=${T_C}°C aralık dışı [${T_min_C}–${T_max_C}°C]`);

    const get = col => {
      if (!this._cols[col]) return null;
      const r = splineInterp(this._T, this._cols[col], T_C);
      if (r.warning) warnings.push(`${col}: ${r.warning}`);
      return r.value;
    };

    const rho = get('rho');
    const mu  = get('mu');          // mPa·s
    const nu  = (mu / 1000) / rho * 1e6;   // mm²/s

    return {
      rho,
      mu_mPas: mu,
      nu_mm2s: nu,
      cp:  get('cp'),
      k:   get('k'),
      Pr:  get('Pr'),
      warnings,
    };
  }

  get id()   { return this.meta.id; }
  get name() { return this.meta.name; }
  get validRange() { return this.meta.valid_range; }
}

// ── FLUID REGISTRY ───────────────────────────────────────────
class FluidRegistry {
  constructor() { this._map = new Map(); }

  /** FluidModel'i kaydet (inline veri için) */
  register(model) { this._map.set(model.id, model); }

  /** fetch ile JSON'dan yükle ve kaydet */
  async load(id, url) {
    if (this._map.has(id)) return this._map.get(id);
    const res  = await fetch(url);
    if (!res.ok) throw new Error(`Fluid yüklenemedi: ${url} (${res.status})`);
    const data = await res.json();
    const model = new FluidModel(data);
    this._map.set(id, model);
    return model;
  }

  get(id) {
    if (!this._map.has(id)) throw new Error(`Bilinmeyen fluid: "${id}"`);
    return this._map.get(id);
  }

  list() { return [...this._map.values()].map(m => ({ id: m.id, name: m.name })); }
}

export const fluidRegistry = new FluidRegistry();

// ── İNLINE SU VERİSİ ────────────────────────────────────────
// Bu bölüm ileride data/fluids/water.json'a taşınacak.
// Şimdilik bundle içinde kalıyor, import bağımlılığı yok.
const WATER_DATA = {
  meta: {
    id: 'water', name: 'Su (H₂O)',
    valid_range: { T_min_C: 0, T_max_C: 150 },
  },
  table: [
    {T_C:0,   rho:999.8, mu:1.7921, cp:4217, k:0.5610, Pr:13.44},
    {T_C:5,   rho:999.9, mu:1.5188, cp:4202, k:0.5710, Pr:11.16},
    {T_C:10,  rho:999.7, mu:1.3077, cp:4192, k:0.5800, Pr:9.45 },
    {T_C:15,  rho:999.1, mu:1.1382, cp:4186, k:0.5890, Pr:8.09 },
    {T_C:20,  rho:998.2, mu:1.0020, cp:4182, k:0.5980, Pr:7.01 },
    {T_C:25,  rho:997.0, mu:0.8910, cp:4180, k:0.6070, Pr:6.14 },
    {T_C:30,  rho:995.7, mu:0.7975, cp:4178, k:0.6150, Pr:5.42 },
    {T_C:35,  rho:994.0, mu:0.7194, cp:4178, k:0.6230, Pr:4.83 },
    {T_C:40,  rho:992.2, mu:0.6533, cp:4179, k:0.6310, Pr:4.32 },
    {T_C:45,  rho:990.2, mu:0.5963, cp:4180, k:0.6370, Pr:3.91 },
    {T_C:50,  rho:988.1, mu:0.5471, cp:4181, k:0.6440, Pr:3.55 },
    {T_C:55,  rho:985.7, mu:0.5040, cp:4183, k:0.6490, Pr:3.25 },
    {T_C:60,  rho:983.2, mu:0.4665, cp:4185, k:0.6540, Pr:2.99 },
    {T_C:65,  rho:980.4, mu:0.4335, cp:4187, k:0.6590, Pr:2.75 },
    {T_C:70,  rho:977.5, mu:0.4042, cp:4190, k:0.6630, Pr:2.55 },
    {T_C:75,  rho:974.8, mu:0.3781, cp:4193, k:0.6670, Pr:2.38 },
    {T_C:80,  rho:971.8, mu:0.3550, cp:4197, k:0.6700, Pr:2.22 },
    {T_C:85,  rho:968.6, mu:0.3342, cp:4201, k:0.6730, Pr:2.09 },
    {T_C:90,  rho:965.3, mu:0.3150, cp:4205, k:0.6750, Pr:1.96 },
    {T_C:95,  rho:961.9, mu:0.2974, cp:4209, k:0.6780, Pr:1.84 },
    {T_C:100, rho:958.4, mu:0.2818, cp:4216, k:0.6800, Pr:1.75 },
    {T_C:110, rho:950.9, mu:0.2535, cp:4232, k:0.6840, Pr:1.57 },
    {T_C:120, rho:942.8, mu:0.2294, cp:4250, k:0.6870, Pr:1.42 },
    {T_C:130, rho:934.1, mu:0.2085, cp:4270, k:0.6890, Pr:1.29 },
    {T_C:140, rho:924.9, mu:0.1905, cp:4293, k:0.6900, Pr:1.18 },
    {T_C:150, rho:915.1, mu:0.1748, cp:4319, k:0.6900, Pr:1.09 },
  ],
};

fluidRegistry.register(new FluidModel(WATER_DATA));
