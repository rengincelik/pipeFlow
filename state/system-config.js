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
			cone_angle_deg: 10,   // D2/S4: konik açı (yarı açı, derece)

		};
		this._values = { ...this._defaults };
		//TODO: buraya angle eklenebilir.
	}

	set(key, value) {
		this._values[key] = value;
		this.emit('change', { key, value });
	}

	get(key) { return this._values[key]; }

	snapshot() { return { ...this._values }; }

	// S3: reset sonrası hem 'reset' hem 'change' (tüm değerler) emit edilir —
	// dinleyiciler yeniden render için 'change' eventini kullanabilir
	reset() {
		this._values = { ...this._defaults };
		this.emit('reset');
		this.emit('change', this._values);
	}
}

export const SystemConfig = new SystemConfigClass();