'use strict';

// SIMULATION ENGINE
// Boru hattı dinamik simülasyon motoru.
// PipelineStore'dan bağımsız çalışır — component'lara dokunmaz.
// Her tick'te zinciri baştan sona koşturur, snapshot üretir.

// ── Sabitler ───────────────────────────────────────────────────────────────
const GRAVITY        = 9.81;   // m/s²
const TICK_MS        = 100;    // ms — UI güncelleme aralığı
const PHYS_DT        = 0.1;    // s  — her tick'in fiziksel karşılığı
const RAMP_DURATION  = 2.0;    // s  — pompanın nominal değere ulaşma süresi
const MAX_ITER_CW    = 50;     // Colebrook-White max iterasyon
const CW_TOL         = 1e-8;   // Colebrook-White yakınsama toleransı
const DEADHEAD_WARN  = 5.0;    // s  — deadhead alarm süresi

// Çalışma noktası bisection parametreleri
const MAX_ITER_OP    = 50;     // max iterasyon
const OP_TOL         = 1e-6;   // m³/s yakınsama toleransı

// ── Sistem State ───────────────────────────────────────────────────────────
export const SysState = Object.freeze({
  IDLE:    'idle',
  RUNNING: 'running',
  ALARM:   'alarm',
});


// ── Pompa State ────────────────────────────────────────────────────────────
export const PumpState = Object.freeze({
  STOPPED:  'stopped',
  RAMPING:  'ramping',
  RUNNING:  'running',
  OVERLOAD: 'overload',
});


// ── Eleman State ───────────────────────────────────────────────────────────
export const NodeState = Object.freeze({
  DRY:     'dry',
  FILLING: 'filling',
  FLOWING: 'flowing',
  BLOCKED: 'blocked',
});

// ── YARDIMCI FONKSİYONLAR ─────────────────────────────────────────────────

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


// ── H-Q POLİNOM ───────────────────────────────────────────────────────────

/**
 * 3 noktadan ikinci dereceden H-Q polinomu fit eder.
 * Noktalar: (0, H_shutoff), (Q_nom, H_nom), (Q_max, 0)
 *
 * H(Q) = a0 + a1*Q + a2*Q²
 *
 * Matris çözümü (3x3 Vandermonde):
 * [1  0       0        ] [a0]   [H_shutoff]
 * [1  Q_nom   Q_nom²   ] [a1] = [H_nom    ]
 * [1  Q_max   Q_max²   ] [a2]   [0        ]
 */
export function fitHQCurve(H_shutoff, Q_nom, H_nom, Q_max) {
  // Satır 0: Q=0,     H=H_shutoff  → a0 = H_shutoff
  // Satır 1: Q=Q_nom, H=H_nom
  // Satır 2: Q=Q_max, H=0

  const a0 = H_shutoff;
  // a0 + a1*Q_max + a2*Q_max² = 0
  // a0 + a1*Q_nom + a2*Q_nom² = H_nom

  // İki denklem, iki bilinmeyen (a1, a2):
  // a1*Q_nom + a2*Q_nom² = H_nom - a0   ... (i)
  // a1*Q_max + a2*Q_max² = -a0           ... (ii)

  const rhs1 = H_nom - a0;
  const rhs2 = -a0;

  // Cramer:
  const det = Q_nom * Q_max * Q_max - Q_max * Q_nom * Q_nom;
  if (Math.abs(det) < 1e-12) {
    // Dejenere — sabit head fallback
    return { a0: H_shutoff, a1: 0, a2: 0 };
  }

  const a1 = (rhs1 * Q_max * Q_max - rhs2 * Q_nom * Q_nom) / det;
  const a2 = (Q_nom * rhs2 - Q_max * rhs1) / det;

  return { a0, a1, a2 };
}

/**
 * H-Q polinomunu Q'da değerlendir.
 * Negatif head döndürme — fiziksel anlamsız.
 */
export function evalHQ(coeffs, Q) {
  const H = coeffs.a0 + coeffs.a1 * Q + coeffs.a2 * Q * Q;
  return Math.max(0, H);
}


// ── ELEMAN HESAP FONKSİYONLARI ────────────────────────────────────────────

/**
 * Pompa: H-Q eğrisinden head üretir.
 * Q dışarıdan verilir (çalışma noktası iterasyonundan).
 */

function calcPump(params, Q_m3s, rampF) {
  const H_actual = evalHQ(params.hq_coeffs, Q_m3s) * rampF;
  const P_out    = params.fluid.rho * GRAVITY * H_actual;
  const v        = velocity(Q_m3s, params.diameter_mm);

  // Şaft gücü: P = rho * g * H * Q / eta
  const eta      = Math.max(0.01, params.efficiency);
  const P_shaft  = (params.fluid.rho * GRAVITY * H_actual * Q_m3s) / eta;

  return {
    P_out,
    D_out_mm:  params.diameter_mm,
    dP_major:  0,
    dP_minor:  0,
    v,
    Re:        0,
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
  const P_out      = Math.max(0, P_in - dP_major - dP_gravity);

  return { P_out, D_out_mm: D, dP_major, dP_minor: 0, v, Re, f, nodeState: NodeState.FLOWING };
}
function calcElbow(params, P_in, Q_m3s, fluid) {
  const D  = params.diameter_mm;
  const v  = velocity(Q_m3s, D);
  const Re = reynolds(v, D, fluid.rho, fluid.mu);
  const dP = minorLoss(params.K, v, fluid.rho);
  return {
    P_out:     Math.max(0, P_in - dP),
    D_out_mm:  D,
    dP_major:  0,
    dP_minor:  dP,
    v, Re,
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
  const P_out        = Math.max(0, P_in + dP_bernoulli - dP_minor);
  const Re           = reynolds(v_in, D_in, fluid.rho, fluid.mu);

  return {
    P_out, D_out_mm: D_out,
    dP_major: 0, dP_minor,
    v: v_out, v_in, Re,
    nodeState: NodeState.FLOWING,
  };
}
function calcValve(params, P_in, Q_m3s, fluid) {
  const D      = params.diameter_mm;
  const v      = velocity(Q_m3s, D);
  const Re     = reynolds(v, D, fluid.rho, fluid.mu);
  const K      = valveK(params.subtype, params.opening, params.K_table);
  const dP     = minorLoss(K, v, fluid.rho);
  const blocked = params.opening <= 0;

  return {
    P_out:     blocked ? P_in : Math.max(0, P_in - dP),
    D_out_mm:  D,
    dP_major:  0,
    dP_minor:  dP,
    v:         blocked ? 0 : v,
    Re, K,
    opening:   params.opening,
    nodeState: blocked ? NodeState.BLOCKED : NodeState.FLOWING,
  };
}
function calcPRV(params, P_in, Q_m3s, fluid) {
  const D     = params.diameter_mm;
  const v     = velocity(Q_m3s, D);
  const Re    = reynolds(v, D, fluid.rho, fluid.mu);
  const P_set = params.P_set_Pa;

  let P_out;
  let prvState;   // 'active' | 'inactive'

  if (P_in > P_set) {
    // PRV devrede — çıkışı P_set'e sabitle
    P_out    = P_set;
    prvState = 'active';
  } else {
    // PRV etkisiz — geçirgen
    P_out    = P_in;
    prvState = 'inactive';
  }

  return {
    P_out,
    D_out_mm:  D,
    dP_major:  0,
    dP_minor:  Math.max(0, P_in - P_out),   // düşürülen basınç kayıp olarak raporlanır
    v,
    Re,
    prvState,
    nodeState: NodeState.FLOWING,
  };
}


// ── ÇALIŞMA NOKTASI HESABI ────────────────────────────────────────────────

/**
 * Verilen Q için zinciri koştur, pompa head'ini ve sistem head'ini döndür.
 * Çalışma noktası: H_pump(Q) = H_system(Q)
 *
 * H_system(Q) = (P_pump_out - P_atm) / (rho*g) + elevation
 * Biz gauge basınç kullandığımız için:
 *   H_system(Q) = toplam basınç kaybı / (rho*g)
 *
 * @returns {{ H_pump, H_system, nodes, isBlocked }}
 */
function evaluateSystem(components, pumpParams, Q_m3s, rampF, fluid) {
  const nodes = [];
  let P_current = 0;
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
        nodeState: NodeState.DRY,
      };
    } else {
      switch (comp.type) {
        case 'pump':
          result = calcPump(params, Q_m3s, rampF);
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
            result = calcPRV(params, P_current, Q_m3s, fluid);
          } else {
            result = calcValve(params, P_current, Q_m3s, fluid);
            if (result.nodeState === NodeState.BLOCKED) {
              isBlocked = true;
            }
          }
          break;
        default:
          result = {
            P_out: P_current, D_out_mm: D_current,
            dP_major: 0, dP_minor: 0, v: 0, Re: 0,
            nodeState: NodeState.FLOWING,
          };
      }
    }

    nodes.push({
      id:        comp.id,
      type:      comp.type,
      subtype:   comp.subtype,
      name:      comp.name,
      P_in:      P_current,
      P_out:     result.P_out,
      dP_major:  result.dP_major  ?? 0,
      dP_minor:  result.dP_minor  ?? 0,
      dP_total:  (result.dP_major ?? 0) + (result.dP_minor ?? 0),
      v:         result.v,
      Re:        result.Re,
      f:         result.f,
      K:         result.K,
      opening:   result.opening,
      H_actual:  result.H_actual,
      P_shaft:   result.P_shaft,
      prvState:  result.prvState,
      nodeState: result.nodeState,
      P_set_Pa: comp.type === 'valve' && comp.subtype === 'prv' ? params.P_set_Pa : undefined,
    });

    P_current = result.P_out;
    D_current = result.D_out_mm;
  }

  // Pompa head'i: H_pump(Q) * rampF
  const H_pump = evalHQ(pumpParams.hq_coeffs, Q_m3s) * rampF;

  // Sistem head'i: zincir sonundaki net basınç kaybı / (rho*g)
  // Boru çıkışı atmosfere açık → P_out = 0 hedefleniyor.
  // H_system = toplam enerji tüketimi = H_pump - P_son / (rho*g)
  // Denge noktasında P_son → 0 (hat atmosfere açıksa)
  const P_final  = P_current;                           // son node çıkış basıncı
  const H_system = H_pump - P_final / (fluid.rho * GRAVITY);

  return { H_pump, H_system, P_final, nodes, isBlocked };
}

/**
 * Bisection ile çalışma noktasını bul.
 * F(Q) = H_pump(Q) - H_system(Q) = 0
 *
 * H_pump artan Q ile azalır.
 * H_system artan Q ile artar (sürtünme kayıpları ∝ Q²).
 * → F(Q) monoton azalan → bisection güvenli.
 *
 * @returns {{ Q_op, converged, iterations }}
 */
function findOperatingPoint(components, pumpParams, rampF, fluid, Q_prev) {
  // Arama aralığı: [0, Q_max * 1.1]
  const Q_max = pumpParams.hq_coeffs
    ? Math.sqrt(-pumpParams.hq_coeffs.a0 / (pumpParams.hq_coeffs.a2 || -1e-6))
    : pumpParams.Q_nom * 2;

  let Q_lo = 1e-6;
  let Q_hi = Math.max(Q_max * 1.1, Q_prev * 2, 0.01);

  // F(Q) = P_final_after_chain / (rho*g) — sıfırda dengede
  // Pompadan çıkan basınç zincirde tüketilir, son nokta atmosfer.
  // Daha net: F(Q) = H_pump(Q)*rampF - H_loss(Q)
  // H_loss(Q): zincirdeki tüm kayıplar toplamı (hız, sürtünme, minör)
  //
  // Pratik hesap: zinciri Q ile koş, P_final döner.
  // Denge: P_final = 0 (açık deşarj).
  // F(Q) = P_final(Q) → bunu sıfırla.

  const F = (Q) => {
    const { P_final } = evaluateSystem(components, pumpParams, Q, rampF, fluid);
    return P_final;
  };

  const F_lo = F(Q_lo);
  const F_hi = F(Q_hi);

  // Aynı işaretliyse (hat tamamen kapalı vb.) yakınsama yok
  if (F_lo * F_hi > 0) {
    return { Q_op: Q_prev, converged: false, iterations: 0 };
  }

  let Q_mid;
  let iter = 0;

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

  return {
    Q_op:      Q_mid,
    converged: Math.abs(Q_hi - Q_lo) < OP_TOL * 10,
    iterations: iter,
  };
}


// ── SIMULATION ENGINE ──────────────────────────────────────────────────────

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

    // Çalışma noktası — önceki Q başlatıcı tahmin olarak kullanılır
    this._Q_operating = 0.001;   // m³/s başlangıç tahmini

    this._onTick        = null;
    this._onAlarm       = null;
    this._onStateChange = null;
  }

  // ── Public API ────────────────────────────────────────────────────────

  start() {
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
    if (typeof comp.override === 'function') {
      comp.override(prop, value, true);
    }
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


  // ── TICK ──────────────────────────────────────────────────────────────

  _tick() {
    this._t += PHYS_DT;

    const components = this._store.components;
    if (!components.length) return;

    // ── Fluid guard ──────────────────────────────────────────────────────
    // setFluid() çağrılmadan veya geçersiz değerle tick geldiyse atla.
    if (!this._fluid
        || !isFinite(this._fluid.rho) || this._fluid.rho <= 0
        || !isFinite(this._fluid.mu)  || this._fluid.mu  <= 0) {
      console.warn('[Engine] Geçersiz fluid — tick atlandı:', this._fluid);
      return;
    }

    const pumpComp   = components[0];
    const pumpParams = { ...pumpComp.getSafeParams(), fluid: this._fluid };

    // ── pumpParams kritik alan guard ──────────────────────────────────────
    // hq_coeffs geçersizse (NaN, pozitif a2, eksik) engine çarpacak.
    // getSafeParams() zaten düzeltir ama a2 >= 0 hâlâ sızabilir (dejenere durum).
    const c = pumpParams.hq_coeffs;
    if (!c || !isFinite(c.a0) || !isFinite(c.a1) || !isFinite(c.a2) || c.a2 >= 0) {
      console.warn('[Engine] Pompa H-Q katsayıları geçersiz — tick atlandı:', c);
      return;
    }

    const rampF = rampFactor(this._t, RAMP_DURATION);

    // Pompa state güncelle
    if (this._pumpState === PumpState.RAMPING && rampF >= 1.0) {
      this._pumpState = PumpState.RUNNING;
      this._notifyStateChange();
    }

    // ── Validation uyarılarını önceden topla ─────────────────────────────
    // evaluateSystem() içinde getSafeParams() ikinci kez çağrılır —
    // performans için burada toplananlar sadece alarm üretiminde kullanılır.
    const validationWarnings = [];
    components.forEach(comp => {
      const p = comp.getSafeParams();
      if (p.__invalid) validationWarnings.push(...p.__warnings);
    });

    // ── Çalışma noktası bul ──────────────────────────────────────────────
    const { Q_op, converged, iterations } = findOperatingPoint(
      components, pumpParams, rampF, this._fluid, this._Q_operating
    );

    let Q_effective;
    let convergenceFailed = false;

    if (converged) {
      Q_effective       = Q_op;
      this._Q_operating = Q_op;
    } else {
      Q_effective       = this._Q_operating;
      convergenceFailed = true;
    }

    // ── Nihai zincir hesabı ──────────────────────────────────────────────
    const { nodes, isBlocked } = evaluateSystem(
      components, pumpParams, Q_effective, rampF, this._fluid
    );

    // ── Hacim güncelle ───────────────────────────────────────────────────
    this._totalVolume_m3 += Q_effective * PHYS_DT;

    // ── Alarmlar ─────────────────────────────────────────────────────────
    const alarms = this._checkAlarms(
      nodes, isBlocked, Q_effective, convergenceFailed, validationWarnings
    );

    // ── Snapshot ─────────────────────────────────────────────────────────
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

    if (this._onTick) this._onTick(snapshot);
  }


  // ── ALARM SİSTEMİ ─────────────────────────────────────────────────────

  _checkAlarms(nodes, isBlocked, Q_effective, convergenceFailed, validationWarnings = []) {
    const alarms = [];

    // 0. Validation uyarıları
    validationWarnings.forEach(w => {
      alarms.push({
        code:    'VALIDATION_WARNING',
        level:   'warning',
        message: w,
        t:       this._t,
      });
    });

    // 1. Yakınsama başarısız
    if (convergenceFailed) {
      alarms.push({
        code:    'CONVERGENCE_FAILURE',
        level:   'warning',
        message: 'Çalışma noktası hesaplanamadı — pipeline konfigürasyonunu kontrol et',
        t:       this._t,
      });
    }

    // 2. Deadhead
    if (this._pumpState !== PumpState.STOPPED && Q_effective <= 1e-6) {
      this._deadheadT += PHYS_DT;
      alarms.push({
        code:    'DEADHEAD',
        level:   this._deadheadT > DEADHEAD_WARN ? 'critical' : 'warning',
        message: `Pompa deadhead durumunda (${this._deadheadT.toFixed(1)}s)`,
        t:       this._t,
      });
      if (this._deadheadT > DEADHEAD_WARN) {
        this._pumpState = PumpState.OVERLOAD;
        this._setSysState(SysState.ALARM);
      }
    } else {
      this._deadheadT = 0;
    }

    // 3. Negatif basınç
    nodes.forEach(n => {
      if (n.P_out < 0) {
        alarms.push({
          code:    'NEGATIVE_PRESSURE',
          level:   'warning',
          message: `${n.name || n.type} çıkışında negatif basınç — kavitasyon riski`,
          nodeId:  n.id,
          t:       this._t,
        });
      }
    });

    // 4. Yüksek hız
    nodes.forEach(n => {
      if (n.type === 'pipe' && n.v > 3.0) {
        alarms.push({
          code:    'HIGH_VELOCITY',
          level:   'info',
          message: `${n.name || n.type} hızı yüksek: ${n.v.toFixed(2)} m/s`,
          nodeId:  n.id,
          t:       this._t,
        });
      }
    });

    // 5. PRV aktif — basınç sınırı aşıldı
    nodes.forEach(n => {
      if (n.subtype === 'prv' && n.prvState === 'active') {
        alarms.push({
          code:    'PRV_ACTIVE',
          level:   'info',
          message: `${n.name || 'PRV'} devrede — giriş basıncı set değerini aşıyor`,
          nodeId:  n.id,
          t:       this._t,
        });
      }
    });


    this._alarms = alarms;
    if (alarms.length && this._onAlarm) this._onAlarm(alarms);
    return alarms;
  }


  // ── Yardımcılar ───────────────────────────────────────────────────────

  _setSysState(state) {
    if (this._sysState === state) return;
    this._sysState = state;
    this._notifyStateChange();
  }

  _notifyStateChange() {
    if (this._onStateChange) {
      this._onStateChange(this._sysState, this._pumpState);
    }
  }
}