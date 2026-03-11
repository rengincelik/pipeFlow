'use strict';

import { ComponentBase, registerComponentType } from './base.js';
import { fitHQCurve }                           from '../Simulation/SimulationEngine.js';
import { Units }                                from '../data/unit-system.js';
import { validateParams } from '../components/validation.js';

export class PumpComponent extends ComponentBase {

  static get CONSTRAINTS() {
    return {
      H_shutoff_m: { min: 1,   max: 600, step: 1,   unit: 'm'   },
      head_m:      { min: 1,   max: 500, step: 1,   unit: 'm'   },
      Q_nom_lps:   { min: 0.1, max: 500, step: 0.1, unit: 'L/s' },
      Q_max_lps:   { min: 0.1, max: 500, step: 0.1, unit: 'L/s' },
      efficiency:  { min: 10,  max: 100, step: 1,   unit: '%'   },
    };
  }

  constructor() {
    super('pump', 'centrifugal');
    this.name   = 'Centrifugal';
    this._lenPx = 64;
    this._hq_coeffs = null;
    this._hq_dirty  = true;
  }

  _onOverrideChange(key) {
    super._onOverrideChange?.(key);
    if (['H_shutoff_m', 'head_m', 'Q_nom_lps', 'Q_max_lps'].includes(key)) {
      this._hq_dirty = true;
    }
  }

  get hq_coeffs() {
    if (!this._hq_dirty && this._hq_coeffs) return this._hq_coeffs;

    const H_shutoff = this.resolve('H_shutoff_m');
    const Q_nom     = this.resolve('Q_nom_lps') / 1000;
    const H_nom     = this.resolve('head_m');
    const Q_max     = this.resolve('Q_max_lps') / 1000;

    this._hq_coeffs = fitHQCurve(H_shutoff, Q_nom, H_nom, Q_max);
    this._hq_dirty  = false;
    return this._hq_coeffs;
  }

  getParams() {
    return {
      type:        'pump',
      subtype:     this.subtype,
      hq_coeffs:   this.hq_coeffs,
      efficiency:  this.resolve('efficiency'),
      diameter_mm: this.resolve('diameter_mm'),
    };
  }

  shapeSpec(layout) {
    const { ix, iy } = layout;
    const len = this._lenPx;
    const mx  = ix + len / 2;
    const R   = 12;

    return {
      itemShape: [
        { tag: 'line',   cls: 'pump-stem',   x1: ix,     y1: iy, x2: mx - R,   y2: iy },
        { tag: 'line',   cls: 'pump-stem',   x1: mx + R, y1: iy, x2: ix + len, y2: iy },
        { tag: 'circle', cls: 'pump-circle', cx: mx, cy: iy, r: R },

	  ],
      anchors:     [{ type: 'label', x: mx, y: iy }],
      orientation: this.entryDir,
    };
  }

  renderPropsHTML() {
    const H_shutoff = this.resolve('H_shutoff_m');
    const H_nom     = this.resolve('head_m');
    const Q_nom_lps = this.resolve('Q_nom_lps');
    const Q_max_lps = this.resolve('Q_max_lps');
    const etaPct    = Math.round(this.resolve('efficiency') * 100);

    return [
      `<div class="prop-section-label">H-Q Curve</div>`,

      this.row('Shutoff Head',
        this.input('H_shutoff_m', H_shutoff) +
        this.hint(H_shutoff, v => Units.length(v)), 'm'),

      this.row('Nominal Head',
        this.input('head_m', H_nom) +
        this.hint(H_nom, v => Units.length(v)), 'm'),

      this.row('Nominal Flow',
        this.input('Q_nom_lps', Q_nom_lps), 'L/s'),

      this.row('Max Flow',
        this.input('Q_max_lps', Q_max_lps), 'L/s'),

      this.row('Efficiency',
        this.slider('efficiency', etaPct)),

      this.row('Status', `<span class="p-status-tag ${this.isRunning ? 'running' : 'idle'}">
        ${this.isRunning ? 'RUNNING' : 'IDLE'}</span>`),

      // Anlık güç — data-live ile main.js tarafından tick'te doldurulur
      this.row('Shaft Power',
        `<span class="prop-value" data-live="P_shaft">—</span>`, 'W'),
    ].join('');
  }

  serialize() {
    return { ...super.serialize() };
  }
}

registerComponentType('pump', 'centrifugal', () => new PumpComponent());