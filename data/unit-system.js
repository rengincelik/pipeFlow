'use strict';

// ═══════════════════════════════════════════════════════════
// UNIT SYSTEM
// Tüm iç hesaplar SI'da kalır.
// Bu modül sadece görüntüleme katmanında dönüşüm yapar.
// engine, store, hesaplar hiç değişmez.
// ═══════════════════════════════════════════════════════════

// Dönüşüm katsayıları
const CONV = {
  bar_to_psi:   14.5038,
  ms_to_fts:    3.28084,
  lpm_to_gpm:   0.264172,
  mm_to_inch:   0.0393701,
  m_to_ft:      3.28084,
};

class UnitSystemClass {
  constructor() {
    this._current  = 'metric';  // 'metric' | 'imperial'
    this._listeners = [];
  }

  get current()    { return this._current; }
  get isMetric()   { return this._current === 'metric'; }
  get isImperial() { return this._current === 'imperial'; }

  toggle() {
    this._current = this.isMetric ? 'imperial' : 'metric';
    this._listeners.forEach(fn => fn(this._current));
  }

  onChange(fn) {
    this._listeners.push(fn);
    return this;
  }

  // ── Format fonksiyonları ──────────────────────────────────
  // Her fonksiyon hem sayı+birim string'i döner.

  /** bar → bar veya psi */
  pressure(bar, decimals) {
    if (this.isMetric) {
      const d = decimals ?? 3;
      return `${bar.toFixed(d)} bar`;
    }
    const d = decimals ?? 2;
    return `${(bar * CONV.bar_to_psi).toFixed(d)} psi`;
  }

  /** m/s → m/s veya ft/s */
  velocity(ms, decimals) {
    if (this.isMetric) {
      const d = decimals ?? 2;
      return `${ms.toFixed(d)} m/s`;
    }
    const d = decimals ?? 2;
    return `${(ms * CONV.ms_to_fts).toFixed(d)} ft/s`;
  }

  /** L/min → L/min veya GPM */
  flow(lpm, decimals) {
    if (this.isMetric) {
      const d = decimals ?? 1;
      return `${lpm.toFixed(d)} L/min`;
    }
    const d = decimals ?? 2;
    return `${(lpm * CONV.lpm_to_gpm).toFixed(d)} GPM`;
  }

  /** mm → mm veya inch */
  diameter(mm, decimals) {
    if (this.isMetric) {
      const d = decimals ?? 1;
      return `${mm.toFixed(d)} mm`;
    }
    const d = decimals ?? 3;
    return `${(mm * CONV.mm_to_inch).toFixed(d)}"`;
  }

  /** m → m veya ft */
  length(m, decimals) {
    if (this.isMetric) {
      const d = decimals ?? 2;
      return `${m.toFixed(d)} m`;
    }
    const d = decimals ?? 2;
    return `${(m * CONV.m_to_ft).toFixed(d)} ft`;
  }

  /** °C → °C veya °F */
  temp(c, decimals) {
    if (this.isMetric) {
      const d = decimals ?? 0;
      return `${Number(c).toFixed(d)}°C`;
    }
    const d = decimals ?? 1;
    return `${(c * 9 / 5 + 32).toFixed(d)}°F`;
  }

  // ── Eksen label'ları (grafik için) ───────────────────────

  pressureLabel() { return this.isMetric ? 'Pressure (bar)' : 'Pressure (psi)'; }
  velocityLabel() { return this.isMetric ? 'Velocity (m/s)' : 'Velocity (ft/s)'; }
  flowLabel()     { return this.isMetric ? 'Flow (L/min)'   : 'Flow (GPM)'; }

  // ── Ham sayı dönüşümleri (label olmadan, grafik için) ────

  pressureVal(bar)  { return this.isMetric ? bar               : bar * CONV.bar_to_psi; }
  velocityVal(ms)   { return this.isMetric ? ms                : ms  * CONV.ms_to_fts;  }
  flowVal(lpm)      { return this.isMetric ? lpm               : lpm * CONV.lpm_to_gpm; }
  diameterVal(mm)   { return this.isMetric ? mm                : mm  * CONV.mm_to_inch; }
  lengthVal(m)      { return this.isMetric ? m                 : m   * CONV.m_to_ft;    }
  tempVal(c)        { return this.isMetric ? c                 : c   * 9 / 5 + 32;       }
}

export const Units = new UnitSystemClass();
