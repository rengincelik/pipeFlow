'use strict';

import { ComponentBase, registerComponentType } from './base.js';
import { svgEl, drawSpec } from '../renderer/svg-utils.js';
import { Units } from '../data/unit-system.js';
import { validateParams } from '../components/validation.js';
const ARM = 10;
const S   = 10;
const T   = 8;

function closedX(cx, cy) {
  return [
    { tag: 'line', cls: 'valve-closed-x', x1: cx - 7, y1: cy - 7, x2: cx + 7, y2: cy + 7 },
    { tag: 'line', cls: 'valve-closed-x', x1: cx + 7, y1: cy - 7, x2: cx - 7, y2: cy + 7 },
  ];
}

// Vana tipi başına sabit K değerleri
const VALVE_DEFS = {
  gate:      { name: 'Gate Valve',  K: 0.20 },
  ball:      { name: 'Ball Valve',  K: 0.10 },
  butterfly: { name: 'Butterfly',   K: 0.80 },
  globe:     { name: 'Globe Valve', K: 6.00 },
  check:     { name: 'Check Valve', K: 2.50 },
};

export class ValveComponent extends ComponentBase {

  static get CONSTRAINTS() {
    return {
      opening_pct: { min: 0, max: 100, step: 1, unit: '%' },
    };
  }

  constructor(subtype = 'gate') {
    super('valve', subtype);
    const d   = VALVE_DEFS[subtype] ?? VALVE_DEFS.gate;
    this.name = d.name;
    this.K    = d.K;
    this.open = true;
    this._lenPx = 54;
  }

  getParams() {
    return {
      type:        'valve',
      subtype:     this.subtype,
      diameter_mm: this.resolve('diameter_mm'),
      opening:     this.opening ?? 1.0,
      K_table:     this.K_table,
    };
  }

  shapeSpec(layout) {
    const { ix, iy } = layout;
    const len = this._lenPx;
    const mx  = ix + len / 2;
    const my  = iy;

    const stems = [
      { tag: 'line', cls: 'valve-stem', x1: ix,       y1: iy, x2: mx - ARM, y2: my },
      { tag: 'line', cls: 'valve-stem', x1: mx + ARM, y1: my, x2: ix + len, y2: iy },
    ];
    const triangles = [
      { tag: 'polygon', cls: 'valve-tri', points: `${mx - S},${my - T} ${mx + S},${my} ${mx - S},${my + T}` },
      { tag: 'polygon', cls: 'valve-tri', points: `${mx + S},${my - T} ${mx - S},${my} ${mx + S},${my + T}` },
    ];
    const closedMark = this.open ? [] : closedX(mx, my);

    return {
      itemShape:   [...stems, ...triangles, ...closedMark],
      anchors:     [{ type: 'label', x: mx, y: my }],
      orientation: this.entryDir,
    };
  }

  renderPropsHTML() {
    const vTypes = [
      { value: 'gate',      label: 'Gate Valve'  },
      { value: 'ball',      label: 'Ball Valve'  },
      { value: 'butterfly', label: 'Butterfly'   },
      { value: 'globe',     label: 'Globe Valve' },
      { value: 'check',     label: 'Check Valve' },
    ];

    const pct  = this.opening_pct ?? (this.open ? 100 : 0);
    const dVal = this.diameter_mm;

    return [
      this.row('Type',
        this.select('subtype', vTypes, this.subtype)),

      this.row('Diameter',
        this.value(dVal) +
        this.hint(dVal, v => Units.diameter(v)), 'mm'),

      this.row('K value',
        this.value(this.K)),

      // slider — min/max/step CONSTRAINTS'ten otomatik gelir
      this.row('Opening',
        this.slider('opening_pct', pct)),

      this.row('State', `<span class="valve-status-tag ${pct > 0 ? 'on' : 'off'}">
        ${pct > 0 ? 'OPEN' : 'CLOSED'}</span>`),
    ].join('');
  }

  serialize() {
    return { ...super.serialize(), open: this.open, K: this.K };
  }

  applySerializedData(d) {
    super.applySerializedData(d);
    if (d.K    != null) this.K    = d.K;
    if (d.open != null) this.open = d.open;
    return this;
  }
}

['gate', 'ball', 'butterfly', 'globe', 'check'].forEach(s =>
  registerComponentType('valve', s, () => new ValveComponent(s))
);

