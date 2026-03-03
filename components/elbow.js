'use strict';

import { ComponentBase, registerComponentType, DIR_VEC } from './base.js';
import { Units } from '../data/unit-system.js';
import { validateParams } from '../components/validation.js';

const ARM = 27;

export class ElbowComponent extends ComponentBase {

  // Dirsek için kullanıcının değiştirebileceği prop yok (K readonly),
  // CONSTRAINTS boş — ileride K override eklenirse buraya gelir.
  static get CONSTRAINTS() {
    return {};
  }

  constructor(subtype = 'rd') {
    super('elbow', subtype);
    this.name   = 'Elbow';
    this._lenPx = ARM;

    const dirs = {
      rd: ['right', 'down'],
      ru: ['right', 'up'  ],
      ur: ['up',    'right'],
      dr: ['down',  'right'],
    };
    [this.entryDir, this.exitDir] = dirs[subtype] ?? ['right', 'down'];
    // K SystemConfig'ten resolve edilir — override gerekmez
  }

  getParams() {
    return {
      type:        'elbow',
      subtype:     this.subtype,
      K:           this.resolve('K'),
      diameter_mm: this.resolve('diameter_mm'),
    };
  }

  computeExit(ix, iy) {
    const eVec    = DIR_VEC[this.entryDir];
    const xVec    = DIR_VEC[this.exitDir];
    const cornerX = ix + eVec.dx * ARM;
    const cornerY = iy + eVec.dy * ARM;
    return {
      ox:      cornerX + xVec.dx * ARM,
      oy:      cornerY + xVec.dy * ARM,
      exitDir: this.exitDir,
      cornerX,
      cornerY,
    };
  }

  shapeSpec(layout) {
    const { ix, iy, ox, oy, cornerX, cornerY } = layout;
    if (ix === undefined) return { itemShape: [], anchors: [] };

    const cx = cornerX ?? (ix === ox ? ix : ox);
    const cy = cornerY ?? (iy === oy ? iy : oy);

    return {
      itemShape: [
        {
          tag: 'path',
          cls: 'elbow-path',
          d: `M ${ix} ${iy} Q ${cx} ${cy} ${ox} ${oy}`,
          fill: 'none',
          stroke: '#333',
          'stroke-width': '3',
        },
      ],
      anchors:     [{ type: 'label', x: ix, y: iy }],
      orientation: 'static',
    };
  }

  renderPropsHTML() {
    const dVal = this.diameter_mm;

    return [
      this.row('Turn',
        this.value(`${this.entryDir} → ${this.exitDir}`)),

      this.row('Diameter',
        this.value(dVal) +
        this.hint(dVal, v => Units.diameter(v)), 'mm'),

      this.row('K value',
        this.value(this.resolve('K'))),
    ].join('');
  }
}

['rd', 'ru', 'ur', 'dr'].forEach(s =>
  registerComponentType('elbow', s, () => new ElbowComponent(s))
);
