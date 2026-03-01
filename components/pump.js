'use strict';

import { ComponentBase, registerComponentType } from './base.js';
import { Units } from '../data/unit-system.js';

export class PumpComponent extends ComponentBase {

  static get CONSTRAINTS() {
    return {
      head_m:         { min: 1,   max: 500,  step: 1,   unit: 'm'   },
      // Q_m3s slider L/s cinsinden gösterilir, constraint L/s'e göre
      Q_lps:          { min: 0.1, max: 100,  step: 0.1, unit: 'L/s' },
      efficiency_pct: { min: 10,  max: 100,  step: 1,   unit: '%'   },
    };
  }

  constructor() {
    super('pump', 'centrifugal');
    this.name   = 'Centrifugal';
    this._lenPx = 64;
    // Defaults SystemConfig'ten gelir (head_m:20, Q_m3s:0.001, efficiency:0.70)
    // Constructor'da hardcoded değer yok — resolve() zinciri yeterli
  }

  getParams() {
    return {
      type:        'pump',
      subtype:     this.subtype,
      Q_m3s:       this.resolve('Q_m3s'),
      H_m:         this.resolve('head_m'),
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
        { tag: 'path',   cls: 'pump-blade',  d: `M${mx},${iy} L${mx - 5},${iy - 7} L${mx + 7},${iy - 3} Z` },
      ],
      anchors:     [{ type: 'label', x: mx, y: iy }],
      orientation: this.entryDir,
    };
  }

  renderPropsHTML() {
    const headVal = this.resolve('head_m');
    const Q_lps   = +(this.resolve('Q_m3s') * 1000).toFixed(1);
    const etaPct  = Math.round(this.resolve('efficiency') * 100);

    return [
      // input — min/max/step CONSTRAINTS'ten otomatik gelir
      this.row('Head',
        this.input('head_m', headVal) +
        this.hint(headVal, v => Units.length(v)), 'm'),

      // slider prop adı Q_lps, listener m³/s'e çevirir (main.js'te)
      this.row('Flow',
        this.slider('Q_lps', Q_lps)),

      this.row('Efficiency',
        this.slider('efficiency_pct', etaPct)),

      this.row('Status', `<span class="p-status-tag ${this.isRunning ? 'running' : 'idle'}">
        ${this.isRunning ? 'RUNNING' : 'IDLE'}</span>`),
    ].join('');
  }

  serialize() {
    return { ...super.serialize() };
    // head_m, Q_m3s, efficiency overrides üzerinden serialize edilir
  }
}

registerComponentType('pump', 'centrifugal', () => new PumpComponent());
