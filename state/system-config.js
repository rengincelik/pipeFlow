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

			// ── Boru / General ────────────────────────
			diameter_mm: 53.1,       // DN50
			material_id: 'steel_new',
			eps_mm:      0.046,
			length_m:    5,

			// ── Pump ───────────────────────────────
			// H-Q eğrisi 3 nokta: (0, H_shutoff), (Q_nom, H_nom), (Q_max, 0)
			H_shutoff_m: 50,     // shutoff head (m) — zero debi de
			head_m:      40,     // nominal head (m)
			Q_nom_lps:   1.0,    // nominal debi (L/s)
			Q_max_lps:   2.0,    // max debi (L/s) — zero head
			efficiency:  0.70,
			pump_type:   'centrifugal',

			// ── Valve ────────────────────────────────
			opening:     1.0,


		};
		this._values = { ...this._defaults };

	}

	set(key, value) {
		this._values[key] = value;
		this.emit('change', { key, value });
	}

	get(key) { return this._values[key]; }

	snapshot() { return { ...this._values }; }

	// S3: After reset, both 'reset' and 'change' (all values) are emitted —
	// listeners can use the 'change' event for a full re-render.
	reset() {
		this._values = { ...this._defaults };
		this.emit('reset');
		this.emit('change', this._values);
	}
}

export const SystemConfig = new SystemConfigClass();