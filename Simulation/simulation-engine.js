'use strict';

import { fitHQCurve, evalHQ } from '../utils/hq-math.js';

// <editor-fold desc="Constants">
const GRAVITY       = 9.81;
const TICK_MS       = 100;
const PHYS_DT       = 0.1;
const RAMP_DURATION = 2.0;
const MAX_ITER_CW   = 50;
const CW_TOL        = 1e-8;
const DEADHEAD_WARN = 5.0;
const MAX_ITER_OP   = 50;
const OP_TOL        = 1e-6;
const P_ATM         = 101325;

const MAX_PRV_ITER  = 6;
const PRV_TOL       = 1e-4;   // m³/s
const PRV_K_MAX     = 1000;
const PRV_V_MIN     = 0.01;   // sıfır bölme koruması
// </editor-fold>

// <editor-fold desc="State enums">
export const SysState = Object.freeze({
	IDLE:    'idle',
	RUNNING: 'running',
	ALARM:   'alarm',
});

export const PumpState = Object.freeze({
	STOPPED:  'stopped',
	RAMPING:  'ramping',
	RUNNING:  'running',
	OVERLOAD: 'overload',
});

export const NodeState = Object.freeze({
	DRY:     'dry',
	FILLING: 'filling',
	FLOWING: 'flowing',
	BLOCKED: 'blocked',
});
// </editor-fold>

// <editor-fold desc="Helper functions">
function frictionFactor(Re, eps, D) {
	if (Re < 1e-9) return 0;
	if (Re < 2300) return 64 / Re;
	const r = (eps / D) / 3.7;
	let f = 0.02;
	for (let i = 0; i < MAX_ITER_CW; i++) {
		const f_new = 1 / Math.pow(-2 * Math.log10(r + 2.51 / (Re * Math.sqrt(f))), 2);
		if (Math.abs(f_new - f) < CW_TOL) return f_new;
		f = f_new;
	}
	return f;
}

function area(D_mm) {
	const D = D_mm / 1000;
	return (Math.PI * D * D) / 4;
}

function velocity(Q_m3s, D_mm) {
	const A = area(D_mm);
	return A > 0 ? Q_m3s / A : 0;
}

function reynolds(v, D_mm, rho, mu) {
	return mu > 0 ? (rho * v * (D_mm / 1000)) / mu : 0;
}

function minorLoss(K, v, rho) {
	return K * 0.5 * rho * v * v;
}

function rampFactor(t, rampDuration) {
	if (t >= rampDuration) return 1.0;
	const x = t / rampDuration;
	return x * x * (3 - 2 * x);
}

function valveK(subtype, opening, K_table) {
	if (opening > 1) opening = opening / 100;
	if (opening <= 0) return 1e9;
	if (K_table && K_table.length >= 2) {
		const sorted = [...K_table].sort((a, b) => a.opening - b.opening);
		if (opening <= sorted[0].opening) return sorted[0].K;
		if (opening >= sorted[sorted.length - 1].opening) return sorted[sorted.length - 1].K;
		for (let i = 0; i < sorted.length - 1; i++) {
			const lo = sorted[i], hi = sorted[i + 1];
			if (opening >= lo.opening && opening <= hi.opening) {
				const t = (opening - lo.opening) / (hi.opening - lo.opening);
				return lo.K + t * (hi.K - lo.K);
			}
		}
	}
	const fallback = { gate: 0.2, globe: 10, butterfly: 0.3, ball: 0.05 };
	const baseK = fallback[subtype] ?? 1.0;
	return baseK * Math.pow(10, 2 * (1 - opening));
}
// </editor-fold>

// <editor-fold desc="Component calculation functions">
function calcPump(params, P_in, Q_m3s, rampF) {
	const H_actual = evalHQ(params.hq_coeffs, Q_m3s) * rampF;
	const P_out    = P_in + params.fluid.rho * GRAVITY * H_actual;
	const v        = velocity(Q_m3s, params.diameter_mm);
	const eta      = Math.max(0.01, params.efficiency);
	const P_shaft  = (params.fluid.rho * GRAVITY * H_actual * Q_m3s) / eta;

	return {
		P_out,
		D_out_mm: params.diameter_mm,
		dP_major: 0,
		dP_minor: 0,
		v,
		Re: reynolds(v, params.diameter_mm, params.fluid.rho, params.fluid.mu),
		H_actual,
		P_shaft,
		nodeState: NodeState.FLOWING,
	};
}

function calcPipe(params, P_in, Q_m3s, fluid) {
	const D  = params.diameter_mm;
	const v  = velocity(Q_m3s, D);
	const Re = reynolds(v, D, fluid.rho, fluid.mu);
	const f  = frictionFactor(Re, params.eps_mm, D);
	const L  = params.length_m;
	const h  = params.height_m ?? 0;

	const dP_major   = f * (L / (D / 1000)) * 0.5 * fluid.rho * v * v;
	const dP_gravity = fluid.rho * GRAVITY * h;
	const P_out      = P_in - dP_major - dP_gravity;

	return {
		P_out,
		D_out_mm: D,
		dP_major,
		dP_minor: 0,
		v, Re, f,
		negativePressure: P_out < 0,
		nodeState: NodeState.FLOWING,
	};
}

function calcElbow(params, P_in, Q_m3s, fluid) {
	const D_mm    = params.diameter_mm;
	const v       = velocity(Q_m3s, D_mm);
	const dynamicK = params.K;
	const dP      = minorLoss(dynamicK, v, fluid.rho);
	const P_out   = P_in - dP;

	return {
		P_out,
		D_out_mm: D_mm,
		dP_major: 0,
		dP_minor: dP,
		v,
		Re: reynolds(v, D_mm, fluid.rho, fluid.mu),
		K: dynamicK,
		nodeState: NodeState.FLOWING,
	};
}

function calcTransition(params, P_in, Q_m3s, fluid) {
	const D_in  = params.d_in_mm;
	const D_out = params.d_out_mm;
	const v_in  = velocity(Q_m3s, D_in);
	const v_out = velocity(Q_m3s, D_out);

	let dP_minor;
	if (params.subtype === 'expander') {
		dP_minor = 0.5 * fluid.rho * Math.pow(v_in - v_out, 2);
	} else {
		const ratio = (D_out / D_in) ** 2;
		const K_c   = 0.5 * (1 - ratio);
		dP_minor    = minorLoss(K_c, v_out, fluid.rho);
	}

	const dP_bernoulli = 0.5 * fluid.rho * (v_in * v_in - v_out * v_out);
	const P_out        = P_in + dP_bernoulli - dP_minor;
	const Re           = reynolds(v_in, D_in, fluid.rho, fluid.mu);

	return {
		P_out,
		D_out_mm: D_out,
		dP_major: 0,
		dP_minor,
		v: v_out, v_in, Re,
		negativePressure: P_out < 0,
		nodeState: NodeState.FLOWING,
	};
}

function calcValve(params, P_in, Q_m3s, fluid) {
	const D       = params.diameter_mm;
	const v       = velocity(Q_m3s, D);
	const Re      = reynolds(v, D, fluid.rho, fluid.mu);
	const K       = valveK(params.subtype, params.opening, params.K_table);
	const dP      = minorLoss(K, v, fluid.rho);
	const blocked = params.opening <= 0;
	const P_out   = blocked ? P_in : (P_in - dP);

	return {
		P_out,
		D_out_mm: D,
		dP_major: 0,
		dP_minor: dP,
		v:        blocked ? 0 : v,
		Re, K,
		opening:  params.opening,
		negativePressure: !blocked && P_out < 0,
		nodeState: blocked ? NodeState.BLOCKED : NodeState.FLOWING,
	};
}

function calcPRV(params, P_in, Q_m3s, fluid, K_override = null) {
	const D     = params.diameter_mm;
	const v     = velocity(Q_m3s, D);
	const Re    = reynolds(v, D, fluid.rho, fluid.mu);
	const P_set = params.P_set_Pa;

	const active = P_in > P_set;
	let K = 0;
	if (K_override !== null) {
		K = K_override;
	} else if (active && v > PRV_V_MIN) {
		K = (P_in - P_set) / (0.5 * fluid.rho * v * v);
	}

	const dP_prv = 0.5 * fluid.rho * v * v * K;
	const P_out  = Math.max(0, P_in - dP_prv);

	return {
		P_out,
		D_out_mm:        D,
		dP_major:        0,
		dP_minor:        dP_prv,
		v, Re, K,
		prvState:        active ? 'active' : 'inactive',
		negativePressure: P_out < 0,
		nodeState:       NodeState.FLOWING,
	};
}
// </editor-fold>

// <editor-fold desc="Operating point calculation">
function evaluateSystem(components, pumpParams, Q_m3s, rampF, fluid, prvOverrides = {}) {
	const nodes = [];
	let P_current = P_ATM;
	let D_current = pumpParams.diameter_mm;
	let isBlocked = false;

	for (let i = 0; i < components.length; i++) {
		const comp   = components[i];
		const params = { ...comp.getSafeParams(), fluid };
		let result;

		if (isBlocked) {
			result = {
				P_out: P_current, D_out_mm: D_current,
				dP_major: 0, dP_minor: 0, v: 0, Re: 0,
				negativePressure: false,
				nodeState: NodeState.DRY,
			};
		} else {
			switch (comp.type) {
				case 'pump':
					result = calcPump(params, P_current, Q_m3s, rampF);
					break;
				case 'pipe':
					result = calcPipe(params, P_current, Q_m3s, fluid);
					break;
				case 'elbow':
					result = calcElbow(params, P_current, Q_m3s, fluid);
					break;
				case 'transition':
					result = calcTransition(params, P_current, Q_m3s, fluid);
					break;
				case 'valve':
					if (params.subtype === 'prv') {
						// prvOverrides'dan K al — iteration'dan geliyorsa override, yoksa null (calcPRV kendi hesaplar)
						const K_override = prvOverrides.hasOwnProperty(comp.id)
							? prvOverrides[comp.id]
							: null;
						result = calcPRV(params, P_current, Q_m3s, fluid, K_override);
					} else {
						result = calcValve(params, P_current, Q_m3s, fluid);
						if (result.nodeState === NodeState.BLOCKED) isBlocked = true;
					}
					break;
				default:
					result = {
						P_out: P_current, D_out_mm: D_current,
						dP_major: 0, dP_minor: 0, v: 0, Re: 0,
						negativePressure: false,
						nodeState: NodeState.FLOWING,
					};
			}
		}

		nodes.push({
			id:              comp.id,
			type:            comp.type,
			subtype:         comp.subtype,
			name:            comp.name,
			P_in:            P_current,
			P_out:           result.P_out,
			dP_major:        result.dP_major  ?? 0,
			dP_minor:        result.dP_minor  ?? 0,
			dP_total:        (result.dP_major ?? 0) + (result.dP_minor ?? 0),
			v:               result.v,
			Re:              result.Re,
			f:               result.f,
			K:               result.K,
			opening:         result.opening,
			H_actual:        result.H_actual,
			P_shaft:         result.P_shaft,
			prvState:        result.prvState,
			nodeState:       result.nodeState,
			negativePressure: result.negativePressure ?? false,
			P_set_Pa:        comp.type === 'valve' && comp.subtype === 'prv' ? params.P_set_Pa : undefined,
		});

		P_current = result.P_out;
		D_current = result.D_out_mm;
	}

	return { P_final: P_current, nodes, isBlocked };
}

function findOperatingPoint(components, pumpParams, rampF, fluid, Q_prev, prvOverrides = {}) {
	const Q_max = pumpParams.hq_coeffs
		? Math.sqrt(-pumpParams.hq_coeffs.a0 / (pumpParams.hq_coeffs.a2 || -1e-6))
		: pumpParams.Q_nom * 2;

	let Q_lo = 1e-6;
	let Q_hi = Math.max(Q_max * 1.1, Q_prev * 2, 0.01);

	const F = (Q) => {
		const { P_final } = evaluateSystem(components, pumpParams, Q, rampF, fluid, prvOverrides);
		return P_final - P_ATM;
	};

	const F_lo = F(Q_lo);
	const F_hi = F(Q_hi);

	if (F_lo * F_hi > 0) {
		return { Q_op: Q_prev, converged: false, iterations: 0, nodes: null, isBlocked: false };
	}

	let Q_mid = Q_lo;
	let iter  = 0;

	for (iter = 0; iter < MAX_ITER_OP; iter++) {
		Q_mid = (Q_lo + Q_hi) / 2;
		const F_mid = F(Q_mid);

		if (Math.abs(Q_hi - Q_lo) < OP_TOL) break;

		if (F_lo * F_mid <= 0) {
			Q_hi = Q_mid;
		} else {
			Q_lo = Q_mid;
		}
	}

	const converged        = Math.abs(Q_hi - Q_lo) < OP_TOL * 10;
	const { nodes, isBlocked } = evaluateSystem(components, pumpParams, Q_mid, rampF, fluid, prvOverrides);

	return { Q_op: Q_mid, converged, iterations: iter, nodes, isBlocked };
}
// </editor-fold>

// <editor-fold desc="SimulationEngine class">
export class SimulationEngine {
	constructor(pipelineStore, fluid) {
		this._store   = pipelineStore;
		this._fluid   = fluid;

		this._sysState  = SysState.IDLE;
		this._pumpState = PumpState.STOPPED;

		this._t          = 0;
		this._intervalId = null;
		this._deadheadT  = 0;

		this._totalVolume_m3 = 0;
		this._snapshots      = [];
		this._alarms         = [];

		this._Q_operating = 0.001;

		this._onTick        = null;
		this._onAlarm       = null;
		this._onStateChange = null;

		this._diagnosticEngine = null;
	}

	/** @param {import('../diagnostics/diagnostic-engine.js').DiagnosticEngine} de */
	setDiagnosticEngine(de) {
		this._diagnosticEngine = de;
	}

	// <editor-fold desc="Public API">
	start() {
		if (this._sysState === SysState.ALARM) this.stop();
		if (this._sysState === SysState.RUNNING) return;

		this._t              = 0;
		this._deadheadT      = 0;
		this._totalVolume_m3 = 0;
		this._snapshots      = [];
		this._alarms         = [];
		this._pumpState      = PumpState.RAMPING;
		this._setSysState(SysState.RUNNING);
		this._intervalId = setInterval(() => this._tick(), TICK_MS);
	}

	stop() {
		if (this._intervalId) {
			clearInterval(this._intervalId);
			this._intervalId = null;
		}
		this._pumpState = PumpState.STOPPED;
		this._setSysState(SysState.IDLE);
	}

	reset() {
		this.stop();
		this._t              = 0;
		this._deadheadT      = 0;
		this._totalVolume_m3 = 0;
		this._snapshots      = [];
		this._alarms         = [];
		this._Q_operating    = 0.001;
	}

	setComponentProp(componentId, prop, value) {
		const comp = this._store.components.find(c => c.id === componentId);
		if (!comp) return;
		if (typeof comp.override === 'function') comp.override(prop, value, true);
	}

	setFluid(fluid) { this._fluid = fluid; }

	onTick(fn)        { this._onTick        = fn; return this; }
	onAlarm(fn)       { this._onAlarm       = fn; return this; }
	onStateChange(fn) { this._onStateChange = fn; return this; }

	get sysState()       { return this._sysState; }
	get pumpState()      { return this._pumpState; }
	get elapsedTime()    { return this._t; }
	get totalVolume_m3() { return this._totalVolume_m3; }
	get snapshots()      { return this._snapshots; }
	get lastSnapshot()   { return this._snapshots[this._snapshots.length - 1] ?? null; }
	// </editor-fold>

	// <editor-fold desc="_tick">
	_tick() {
		this._t += PHYS_DT;
		const components = this._store.components;
		if (!components.length) return;

		if (!this._fluid || !isFinite(this._fluid.rho) || this._fluid.rho <= 0) {
			console.warn('[Engine] Invalid fluid — skipping tick:', this._fluid);
			return;
		}

		const pumpComp   = components[0];
		const pumpParams = { ...pumpComp.getSafeParams(), fluid: this._fluid };

		const c = pumpParams.hq_coeffs;
		if (!c || !isFinite(c.a0) || c.a2 >= 0) {
			console.warn('[Engine] Invalid pump H-Q coefficients — skipping tick:', c);
			return;
		}

		const rampF = rampFactor(this._t, RAMP_DURATION);

		if (this._pumpState === PumpState.RAMPING && rampF >= 1.0) {
			this._pumpState = PumpState.RUNNING;
			this._notifyStateChange();
		}

		const validationWarnings = [];
		components.forEach(comp => {
			const p = comp.getSafeParams();
			if (p.__invalid) validationWarnings.push(...(p.__warnings ?? []));
		});

		// PRV bileşenlerini bir kez bul
		const prvComps = components.filter(c => c.type === 'valve' && c.subtype === 'prv');

		// <editor-fold desc="PRV inner iteration">
		let prvOverrides = {};
		let Q_prev       = this._Q_operating;

		if (prvComps.length > 0) {
			for (let iter = 0; iter < MAX_PRV_ITER; iter++) {
				const { Q_op, converged, nodes: iterNodes } = findOperatingPoint(
					components, pumpParams, rampF, this._fluid, Q_prev, prvOverrides
				);

				if (!iterNodes) break;

				let maxDeltaK = 0;

				for (const prv of prvComps) {
					const node  = iterNodes.find(n => n.id === prv.id);
					const P_in  = node?.P_in  ?? 0;
					const P_set = prv.getParams().P_set_Pa;
					const v     = node?.v     ?? 0;
					const rho   = this._fluid.rho;

					const dP_excess = P_in - P_set;
					let K_new = 0;

					if (dP_excess > 0 && v > PRV_V_MIN) {
						K_new = Math.min(dP_excess / (0.5 * rho * v * v), PRV_K_MAX);
					}

					const K_old              = prvOverrides[prv.id] ?? 0;
					maxDeltaK                = Math.max(maxDeltaK, Math.abs(K_new - K_old));
					prvOverrides[prv.id]     = K_new;
				}

				const dQ = Math.abs(Q_op - Q_prev);
				Q_prev   = Q_op;

				if (dQ < PRV_TOL && maxDeltaK < 1.0) break;
			}
		}
		// </editor-fold>

		// Son Q ve node'ları PRV override'larıyla hesapla
		const { Q_op, converged, iterations, nodes: opNodes, isBlocked: opBlocked } =
			findOperatingPoint(components, pumpParams, rampF, this._fluid, Q_prev, prvOverrides);

		let Q_effective;
		let convergenceFailed = false;
		let nodes;
		let isBlocked;

		if (converged) {
			Q_effective       = Q_op;
			this._Q_operating = Q_op;
			nodes             = opNodes;
			isBlocked         = opBlocked;
		} else {
			Q_effective       = 0;
			this._Q_operating = 0.001;
			convergenceFailed = true;
			const fallback    = evaluateSystem(components, pumpParams, 0, rampF, this._fluid, prvOverrides);
			nodes             = fallback.nodes;
			isBlocked         = fallback.isBlocked;
		}

		this._totalVolume_m3 += Q_effective * PHYS_DT;

		const alarms = this._checkAlarms(nodes, isBlocked, Q_effective, convergenceFailed, validationWarnings);

		const snapshot = {
			t:              this._t,
			pumpState:      this._pumpState,
			sysState:       this._sysState,
			Q_m3s:          Q_effective,
			rampFactor:     rampF,
			nodes,
			totalVolume_m3: this._totalVolume_m3,
			alarms,
			_debug: { converged, iterations },
		};

		this._snapshots.push(snapshot);
		if (this._snapshots.length > 600) this._snapshots.shift();

		this._diagnosticEngine?.evaluate(snapshot);

		if (this._onTick) this._onTick(snapshot);
	}
	// </editor-fold>

	// <editor-fold desc="_checkAlarms">
	_checkAlarms(nodes, isBlocked, Q_effective, convergenceFailed, validationWarnings = []) {
		const alarms = [];

		validationWarnings.forEach(w => {
			alarms.push({ code: 'VALIDATION_WARNING', level: 'warning', message: w, t: this._t });
		});

		if (convergenceFailed) {
			alarms.push({
				code:    'CONVERGENCE_FAILURE',
				level:   'info',
				message: 'Could not calculate operating point — check if line is closed or pipeline config',
				t:       this._t,
			});
		}

		if (this._pumpState !== PumpState.STOPPED && Q_effective <= 1e-6) {
			const prvActive = nodes.some(n => n.subtype === 'prv' && n.prvState === 'active');

			if (prvActive) {
				// PRV regüle ediyor — deadhead sayacını sıfırla, alarm basma
				this._deadheadT = 0;
			} else {
				this._deadheadT += PHYS_DT;
				alarms.push({
					code:    'DEADHEAD',
					level:   this._deadheadT > DEADHEAD_WARN ? 'critical' : 'warning',
					message: `Pump in deadhead condition (${this._deadheadT.toFixed(1)}s)`,
					t:       this._t,
				});
				if (this._deadheadT > DEADHEAD_WARN) {
					this._pumpState = PumpState.OVERLOAD;
					this._setSysState(SysState.ALARM);
				}
			}
		} else {
			this._deadheadT = 0;
		}

		nodes.forEach(n => {
			if (n.P_out < 0) {
				alarms.push({
					code:    'NEGATIVE_PRESSURE',
					level:   'warning',
					message: `Negative pressure at ${n.name || n.type} outlet — cavitation risk`,
					nodeId:  n.id,
					t:       this._t,
				});
			}
			if (n.type === 'pipe' && n.v > 3.0) {
				alarms.push({
					code:    'HIGH_VELOCITY',
					level:   'info',
					message: `High velocity in ${n.name || n.type}: ${n.v.toFixed(2)} m/s`,
					nodeId:  n.id,
					t:       this._t,
				});
			}
			if (n.subtype === 'prv' && n.prvState === 'active') {
				alarms.push({
					code:    'PRV_ACTIVE',
					level:   'info',
					message: `${n.name || 'PRV'} active — inlet pressure exceeds setpoint`,
					nodeId:  n.id,
					t:       this._t,
				});
			}
		});

		this._alarms = alarms;
		if (alarms.length && this._onAlarm) this._onAlarm(alarms);
		return alarms;
	}
	// </editor-fold>

	// <editor-fold desc="State management">
	_setSysState(state) {
		if (this._sysState === state) return;
		this._sysState = state;
		this._notifyStateChange();
	}

	_notifyStateChange() {
		if (this._onStateChange) this._onStateChange(this._sysState, this._pumpState);
	}
	// </editor-fold>
}
// </editor-fold>