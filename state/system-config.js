'use strict';

// ═══════════════════════════════════════════════════════════
// SYSTEM CONFIG — global defaults + per-component override zinciri
//
// Kullanım:
//   SystemConfig.set('diameter_mm', 53.1)   → tüm override'sız elemanları etkiler
//   comp.override('diameter_mm', 26.9)       → sadece o eleman
//   comp.resolve('diameter_mm')              → override varsa o, yoksa SystemConfig
// ═══════════════════════════════════════════════════════════

import { EventEmitter } from '../core/event-emitter.js';

class SystemConfigClass extends EventEmitter {
  constructor() {
    super();
    this._defaults = {
      fluid_id:    'water',
      diameter_mm: 53.1,      // DN50
      material_id: 'steel_new',
      eps_mm:      0.046,
      length_m:    5,
      Q_lpm:       30,
      P_in_bar:    2.0,
      T_in_C:      20,
      T_out_C:     20,
      // ── Pompa ───────────────────────────────
      pump_P_w:    500,        // motor gücü [W]
      pump_eta:    0.70,       // verim [0-1]
      pump_type:   'centrifugal',
    };
    this._values = { ...this._defaults };
  }

  /** Sistem geneli değer ata */
  set(key, value) {
    this._values[key] = value;
    this.emit('change', { key, value });
  }

  /** Sistem geneli değer oku */
  get(key) { return this._values[key]; }

  /** Tüm değerleri döner (snapshot) */
  snapshot() { return { ...this._values }; }

  /** Fabrika sıfırlama */
  reset() { this._values = { ...this._defaults }; this.emit('reset'); }
}

export const SystemConfig = new SystemConfigClass();

// ── OVERRIDE MİXIN ──────────────────────────────────────────
/**
 * Bir nesneye override zinciri ekler.
 * Kullanım: Object.assign(myObj, OverrideMixin)
 * ya da ComponentBase'e mixin olarak kullan.
 */
export const OverrideMixin = {
  _overrides: null,

  _ensureOverrides() {
    if (!this._overrides) this._overrides = {};
  },

  /** Bu eleman için değeri override et */
  override(key, value) {
    this._ensureOverrides();
    if (value === null || value === undefined) {
      delete this._overrides[key];
    } else {
      this._overrides[key] = value;
    }
    this._onOverrideChange?.(key, value);
    return this;
  },

  /** Override varsa döner, yoksa null */
  getOverride(key) {
    return this._overrides?.[key] ?? null;
  },

  /** Override → SystemConfig zinciri */
  resolve(key) {
    return this._overrides?.[key] ?? SystemConfig.get(key);
  },

  /** Override'ı sil (sisteme geri döner) */
  clearOverride(key) {
    this._ensureOverrides();
    delete this._overrides[key];
    this._onOverrideChange?.(key, undefined);
    return this;
  },

  /** Tüm override'ları sil */
  clearAllOverrides() {
    this._overrides = {};
    this._onOverrideChange?.('*', undefined);
    return this;
  },

  /** Override'ı var mı? */
  hasOverride(key) {
    return Boolean(this._overrides && key in this._overrides);
  },

  /** Override map'ini serialize et */
  serializeOverrides() {
    return this._overrides ? { ...this._overrides } : {};
  },
};
