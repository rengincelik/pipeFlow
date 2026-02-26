'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// SIMULATION ENGINE
// Boru hattı dinamik simülasyon motoru.
// PipelineStore'dan bağımsız çalışır — component'lara dokunmaz.
// Her tick'te zinciri baştan sona koşturur, snapshot üretir.
// ═══════════════════════════════════════════════════════════════════════════

// ── Sabitler ───────────────────────────────────────────────────────────────
const GRAVITY        = 9.81;          // m/s²
const TICK_MS        = 100;           // ms — UI güncelleme aralığı
const PHYS_DT        = 0.1;           // s  — her tick'in fiziksel karşılığı
const RAMP_DURATION  = 2.0;           // s  — pompanın nominal değere ulaşma süresi
const MAX_ITER_CW    = 50;            // Colebrook-White max iterasyon
const CW_TOL         = 1e-8;          // Colebrook-White yakınsama toleransı
const DEADHEAD_WARN  = 5.0;           // s  — deadhead alarm süresi

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


// YARDIMCI FONKSİYONLAR


/**
 * Colebrook-White denklemi ile Darcy friction faktörü (f).
 * Laminer akış için f = 64/Re kullanılır.
 * @param {number} Re   Reynolds sayısı
 * @param {number} eps  Boru pürüzlülüğü (mm)
 * @param {number} D    Boru iç çapı (mm)
 * @returns {number} Darcy friction faktörü
 */


function frictionFactor(Re, eps, D) {
  if (Re < 1e-9) return 0;
  if (Re < 2300) return 64 / Re;   // Laminer

  // Türbülanslı — Colebrook-White iteratif
  const r = (eps / D) / 3.7;
  let f = 0.02;   // başlangıç tahmini

  for (let i = 0; i < MAX_ITER_CW; i++) {
    const f_new = 1 / Math.pow(-2 * Math.log10(r + 2.51 / (Re * Math.sqrt(f))), 2);
    if (Math.abs(f_new - f) < CW_TOL) return f_new;
    f = f_new;
  }
  return f;
}

/**
 * Akış alanı (m²)
 */
function area(D_mm) {
  const D = D_mm / 1000;
  return (Math.PI * D * D) / 4;
}

/**
 * Hız (m/s)
 */
function velocity(Q_m3s, D_mm) {
  const A = area(D_mm);
  return A > 0 ? Q_m3s / A : 0;
}

/**
 * Reynolds sayısı
 * @param {number} v     Hız (m/s)
 * @param {number} D_mm  Çap (mm)
 * @param {number} rho   Yoğunluk (kg/m³)
 * @param {number} mu    Dinamik viskozite (Pa·s)
 */
function reynolds(v, D_mm, rho, mu) {
  return mu > 0 ? (rho * v * (D_mm / 1000)) / mu : 0;
}

/**
 * Valve için K değerini opening'e göre lookup + lineer interpolasyon.
 * K_table: [{ opening: 1.0, K: 0.2 }, { opening: 0.5, K: 3.0 }, ...]
 * opening: 0 (tam kapalı) – 1 (tam açık)
 *
 * Eğer K_table yoksa fallback değer kullanılır.
 */
function valveK(subtype, opening, K_table) {
  // Tam kapalı — çok yüksek direnç (deadhead tetikler)
  if (opening <= 0) return 1e9;

  // K_table varsa interpolasyon yap
  if (K_table && K_table.length >= 2) {
    const sorted = [...K_table].sort((a, b) => a.opening - b.opening);
    if (opening <= sorted[0].opening)               return sorted[0].K;
    if (opening >= sorted[sorted.length - 1].opening) return sorted[sorted.length - 1].K;

    for (let i = 0; i < sorted.length - 1; i++) {
      const lo = sorted[i], hi = sorted[i + 1];
      if (opening >= lo.opening && opening <= hi.opening) {
        const t = (opening - lo.opening) / (hi.opening - lo.opening);
        return lo.K + t * (hi.K - lo.K);
      }
    }
  }

  // K_table yoksa tip bazlı fallback (tam açık değerler)
  const fallback = { gate: 0.1, globe: 10, butterfly: 0.3, ball: 0.05 };
  const baseK = fallback[subtype] ?? 1.0;

  // Açıklığa göre basit üstel artış (K_table olmayan durumlar için)
  // opening=1 → baseK, opening=0.5 → baseK*10, opening=0.1 → baseK*1000
  return baseK * Math.pow(10, 2 * (1 - opening));
}

/**
 * Minor kayıp basınç düşümü
 * dP = K * 0.5 * rho * v²
 */
function minorLoss(K, v, rho) {
  return K * 0.5 * rho * v * v;
}

/**
 * Pompa ramp faktörü (0→1 arası)
 * t: geçen süre (s), rampDuration: nominal değere ulaşma süresi (s)
 */
function rampFactor(t, rampDuration) {
  if (t >= rampDuration) return 1.0;
  // Smooth step — ani değil, organik
  const x = t / rampDuration;
  return x * x * (3 - 2 * x);
}


// ═══════════════════════════════════════════════════════════════════════════
// ELEMAN HESAP FONKSİYONLARI
// Her fonksiyon { P_out, D_out_mm, dP_major, dP_minor, v, Re, nodeState } döner
// ═══════════════════════════════════════════════════════════════════════════

function calcPump(params, Q_m3s, rampF) {
  const H_actual = params.H_m * rampF;
  const P_out    = params.fluid.rho * GRAVITY * H_actual;
  return {
    P_out,
    D_out_mm:  params.diameter_mm,
    dP_major:  0,
    dP_minor:  0,
    v:         velocity(Q_m3s, params.diameter_mm),
    Re:        0,
    nodeState: NodeState.FLOWING,
  };
}

function calcPipe(params, P_in, Q_m3s, fluid) {
  const D    = params.diameter_mm;
  const v    = velocity(Q_m3s, D);
  const Re   = reynolds(v, D, fluid.rho, fluid.mu);
  const f    = frictionFactor(Re, params.eps_mm, D);
  const L    = params.length_m;

  // Darcy-Weisbach: dP = f * (L/D) * 0.5 * rho * v²
  const dP_major = f * (L / (D / 1000)) * 0.5 * fluid.rho * v * v;
  const P_out    = Math.max(0, P_in - dP_major);

  return {
    P_out,
    D_out_mm:  D,
    dP_major,
    dP_minor:  0,
    v,
    Re,
    f,
    nodeState: NodeState.FLOWING,
  };
}

function calcElbow(params, P_in, Q_m3s, fluid) {
  const D   = params.diameter_mm;
  const v   = velocity(Q_m3s, D);
  const Re  = reynolds(v, D, fluid.rho, fluid.mu);
  const dP  = minorLoss(params.K, v, fluid.rho);
  return {
    P_out:     Math.max(0, P_in - dP),
    D_out_mm:  D,
    dP_major:  0,
    dP_minor:  dP,
    v,
    Re,
    nodeState: NodeState.FLOWING,
  };
}

function calcTransition(params, P_in, Q_m3s, fluid) {
  const D_in  = params.D_in_mm;
  const D_out = params.D_out_mm;
  const v_in  = velocity(Q_m3s, D_in);
  const v_out = velocity(Q_m3s, D_out);

  // Borda-Carnot (expander kayıp) veya contraction loss (reducer)
  let dP_minor;
  if (params.subtype === 'expander') {
    // Borda-Carnot: dP = 0.5 * rho * (v_in - v_out)²
    dP_minor = 0.5 * fluid.rho * Math.pow(v_in - v_out, 2);
  } else {
    // Reducer: dP = K_c * 0.5 * rho * v_out²
    // K_c ≈ 0.5 * (1 - (D_out/D_in)²) — basit yaklaşım
    const ratio = (D_out / D_in) ** 2;
    const K_c   = 0.5 * (1 - ratio);
    dP_minor    = minorLoss(K_c, v_out, fluid.rho);
  }

  // Bernoulli: basınç değişimi (hız farkından)
  const dP_bernoulli = 0.5 * fluid.rho * (v_in * v_in - v_out * v_out);
  const P_out = Math.max(0, P_in + dP_bernoulli - dP_minor);

  const Re = reynolds(v_in, D_in, fluid.rho, fluid.mu);

  return {
    P_out,
    D_out_mm:  D_out,
    dP_major:  0,
    dP_minor,
    v:         v_out,
    v_in,
    Re,
    nodeState: NodeState.FLOWING,
  };
}

function calcValve(params, P_in, Q_m3s, fluid) {
  const D      = params.diameter_mm;
  const v      = velocity(Q_m3s, D);
  const Re     = reynolds(v, D, fluid.rho, fluid.mu);
  const K      = valveK(params.subtype, params.opening, params.K_table);
  const dP     = minorLoss(K, v, fluid.rho);
  const P_out  = Math.max(0, P_in - dP);
  const blocked = params.opening <= 0;

  return {
    P_out:     blocked ? P_in : P_out,   // kapalıysa basınç geçmez
    D_out_mm:  D,
    dP_major:  0,
    dP_minor:  dP,
    v:         blocked ? 0 : v,
    Re,
    K,
    opening:   params.opening,
    nodeState: blocked ? NodeState.BLOCKED : NodeState.FLOWING,
  };
}


// ═══════════════════════════════════════════════════════════════════════════
// SIMULATION ENGINE
// ═══════════════════════════════════════════════════════════════════════════

export class SimulationEngine {
  /**
   * @param {object} pipelineStore  — PipelineStore instance
   * @param {object} fluid          — { rho, mu } — yoğunluk ve dinamik viskozite
   */
  constructor(pipelineStore, fluid) {
    this._store      = pipelineStore;
    this._fluid      = fluid;           // { rho: kg/m³, mu: Pa·s }

    // ── State ──────────────────────────────────────────────
    this._sysState   = SysState.IDLE;
    this._pumpState  = PumpState.STOPPED;

    // ── Zaman ─────────────────────────────────────────────
    this._t          = 0;               // fiziksel süre (s)
    this._intervalId = null;

    // ── Deadhead takibi ───────────────────────────────────
    this._deadheadT  = 0;               // deadhead'de geçen süre (s)

    // ── Hacim sayacı ──────────────────────────────────────
    this._totalVolume_m3 = 0;

    // ── Snapshots (grafik için) ────────────────────────────
    this._snapshots  = [];              // tüm geçmiş

    // ── Alarm listesi ─────────────────────────────────────
    this._alarms     = [];

    // ── Dışarıya event callback'leri ──────────────────────
    this._onTick     = null;            // fn(snapshot)
    this._onAlarm    = null;            // fn(alarms)
    this._onStateChange = null;         // fn(sysState, pumpState)
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /** Simülasyonu başlat */
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

  /** Simülasyonu durdur */
  stop() {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
    this._pumpState = PumpState.STOPPED;
    this._setSysState(SysState.IDLE);
  }

  /** Simülasyonu resetle */
  reset() {
    this.stop();
    this._t              = 0;
    this._deadheadT      = 0;
    this._totalVolume_m3 = 0;
    this._snapshots      = [];
    this._alarms         = [];
  }

  /**
   * Valve opening'i runtime'da güncelle.
   * @param {number} componentId
   * @param {number} opening  0–1
   */
  setValveOpening(componentId, opening) {
    const comp = this._store.components.find(c => c.id === componentId);
    if (comp && comp.type === 'valve') {
      comp.opening = Math.max(0, Math.min(1, opening));
    }
  }

  /**
   * Fluid'i güncelle (sıcaklık değişimi vb.)
   * @param {{ rho, mu }} fluid
   */
  setFluid(fluid) {
    this._fluid = fluid;
  }

  // ── Event bağlama ───────────────────────────────────────────────────────

  onTick(fn)        { this._onTick        = fn; return this; }
  onAlarm(fn)       { this._onAlarm       = fn; return this; }
  onStateChange(fn) { this._onStateChange = fn; return this; }

  // ── Getter'lar ──────────────────────────────────────────────────────────

  get sysState()        { return this._sysState; }
  get pumpState()       { return this._pumpState; }
  get elapsedTime()     { return this._t; }
  get totalVolume_m3()  { return this._totalVolume_m3; }
  get snapshots()       { return this._snapshots; }
  get lastSnapshot()    { return this._snapshots[this._snapshots.length - 1] ?? null; }


  // ═══════════════════════════════════════════════════════════════════════
  // TICK — Ana hesap döngüsü
  // ═══════════════════════════════════════════════════════════════════════

  _tick() {
    this._t += PHYS_DT;

    const components = this._store.components;
    if (!components.length) return;

    // Pompa parametreleri (her zaman [0]. indeks)
    const pumpParams = components[0].getParams();
    const rampF      = rampFactor(this._t, RAMP_DURATION);

    // Pompa state güncelle
    if (this._pumpState === PumpState.RAMPING && rampF >= 1.0) {
      this._pumpState = PumpState.RUNNING;
      this._notifyStateChange();
    }

    const Q_m3s  = pumpParams.Q_m3s * rampF;
    const fluid  = this._fluid;

    // ── Zincir hesabı ─────────────────────────────────────
    const nodes = [];
    let P_current   = 0;       // pompadan önce giriş basıncı (atmosfer = 0 gauge)
    let D_current   = pumpParams.diameter_mm;
    let isBlocked   = false;
    let Q_effective = Q_m3s;

    for (let i = 0; i < components.length; i++) {
      const comp   = components[i];
      const params = { ...comp.getParams(), fluid };
      let result;

      if (isBlocked) {
        // Blok sonrası elemanlar dry
        result = {
          P_out:     P_current,
          D_out_mm:  D_current,
          dP_major:  0,
          dP_minor:  0,
          v:         0,
          Re:        0,
          nodeState: NodeState.DRY,
        };
      } else {
        switch (comp.type) {
          case 'pump':
            result = calcPump(params, Q_effective, rampF);
            break;
          case 'pipe':
            result = calcPipe(params, P_current, Q_effective, fluid);
            break;
          case 'elbow':
            result = calcElbow(params, P_current, Q_effective, fluid);
            break;
          case 'transition':
            result = calcTransition(params, P_current, Q_effective, fluid);
            break;
          case 'valve':
            result = calcValve(params, P_current, Q_effective, fluid);
            if (result.nodeState === NodeState.BLOCKED) {
              isBlocked   = true;
              Q_effective = 0;
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
        dP_major:  result.dP_major,
        dP_minor:  result.dP_minor,
        dP_total:  (result.dP_major ?? 0) + (result.dP_minor ?? 0),
        v:         result.v,
        Re:        result.Re,
        f:         result.f,
        K:         result.K,
        opening:   result.opening,
        nodeState: result.nodeState,
      });

      P_current  = result.P_out;
      D_current  = result.D_out_mm;
    }

    // ── Hacim güncelle ────────────────────────────────────
    this._totalVolume_m3 += Q_effective * PHYS_DT;

    // ── Deadhead kontrolü ─────────────────────────────────
    const alarms = this._checkAlarms(nodes, isBlocked, Q_effective);

    // ── Snapshot üret ─────────────────────────────────────
    const snapshot = {
      t:             this._t,
      pumpState:     this._pumpState,
      sysState:      this._sysState,
      Q_m3s:         Q_effective,
      rampFactor:    rampF,
      nodes,
      totalVolume_m3: this._totalVolume_m3,
      alarms,
    };

    this._snapshots.push(snapshot);

    // Grafik için son N snapshot yeter — bellek yönetimi
    if (this._snapshots.length > 600) this._snapshots.shift();

    // ── Callback'leri çağır ───────────────────────────────
    if (this._onTick)  this._onTick(snapshot);
  }


  // ═══════════════════════════════════════════════════════════════════════
  // ALARM SİSTEMİ
  // ═══════════════════════════════════════════════════════════════════════

  _checkAlarms(nodes, isBlocked, Q_effective) {
    const alarms = [];

    // 1. Deadhead — pompa çalışıyor, debi sıfır
    if (this._pumpState !== PumpState.STOPPED && Q_effective <= 0) {
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

    // 2. Negatif basınç (kavitasyon riski)
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

    // 3. Yüksek hız uyarısı (endüstri standardı: > 3 m/s)
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

    this._alarms = alarms;
    if (alarms.length && this._onAlarm) this._onAlarm(alarms);

    return alarms;
  }


  // ── Yardımcılar ─────────────────────────────────────────────────────────

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
