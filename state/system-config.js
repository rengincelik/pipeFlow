'use strict';

import { EventEmitter } from '../core/event-emitter.js';

class SystemConfigClass extends EventEmitter {
  constructor() {
    super();
    this._defaults = {
      // ── Fluid ───────────────────────────────
      fluid_id:    'water',
      T_in_C:      20,
      P_in_bar:    2.0,

      // ── Boru / Genel ────────────────────────
      diameter_mm: 53.1,       // DN50
      material_id: 'steel_new',
      eps_mm:      0.046,
      length_m:    5,

      // ── Pompa ───────────────────────────────
      // H-Q eğrisi 3 nokta: (0, H_shutoff), (Q_nom, H_nom), (Q_max, 0)
      H_shutoff_m: 25,     // shutoff head (m) — sıfır debide
      head_m:      20,     // nominal head (m)
      Q_nom_lps:   1.0,    // nominal debi (L/s)
      Q_max_lps:   2.0,    // max debi (L/s) — sıfır head
      efficiency:  0.70,
      pump_type:   'centrifugal',

      // ── Vana ────────────────────────────────
      opening:     1.0,

      // ── Dirsek ──────────────────────────────
      K:           0.9,

      // ── Transition ──────────────────────────

    };
    this._values = { ...this._defaults };
  }

  set(key, value) {
    this._values[key] = value;
    this.emit('change', { key, value });
  }

  get(key) { return this._values[key]; }

  snapshot() { return { ...this._values }; }

  reset() { this._values = { ...this._defaults }; this.emit('reset'); }
}

export const SystemConfig = new SystemConfigClass();

// ── OVERRIDE MİXIN ──────────────────────────────────────────
export const OverrideMixin = {
  _overrides: null,

  _ensureOverrides() {
    if (!this._overrides) this._overrides = {};
  },

  /**
   * Prop değerini override et.
   * @param {string}  key
   * @param {*}       value
   * @param {boolean} isUserSet — true: kullanıcı set etti (prop panel)
   *                              false: sistem set etti (propagasyon, miras)
   */
  override(key, value, isUserSet = false) {
    this._ensureOverrides();
    if (value === null || value === undefined) {
      delete this._overrides[key];
    } else {
      this._overrides[key] = value;
    }
    this._userOverrides = this._userOverrides ?? new Set();
    if (isUserSet) this._userOverrides.add(key);
    else           this._userOverrides.delete(key);
    this._onOverrideChange?.(key, value);
    return this;
  },

  getOverride(key) {
    return this._overrides?.[key] ?? null;
  },

  /** Override → SystemConfig zinciri */
  resolve(key) {
    return this._overrides?.[key] ?? SystemConfig.get(key);
  },

  clearOverride(key) {
    this._ensureOverrides();
    delete this._overrides[key];
    this._userOverrides?.delete(key);
    this._onOverrideChange?.(key, undefined);
    return this;
  },

  clearAllOverrides() {
    this._overrides = {};
    this._userOverrides = new Set();
    this._onOverrideChange?.('*', undefined);
    return this;
  },

  hasOverride(key) {
    return Boolean(this._overrides && key in this._overrides);
  },

  hasUserOverride(key) {
    return this._userOverrides?.has(key) ?? false;
  },

  serializeOverrides() {
    return this._overrides ? { ...this._overrides } : {};
  },
};
