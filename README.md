# PipeFlow Simulator

A browser-based, real-time pipeline flow simulator.  
Build your pipeline with drag-and-drop, physics-based calculations run instantly.

---

## 👷 For Engineers

### Physical Model

**Flow calculation** is based on the continuity equation. Flow rate (Q) is kept constant along the pipeline; velocity updates automatically at diameter changes.

**Major losses** are calculated using the Darcy-Weisbach equation:

```
ΔP = f · (L/D) · ½ρv²
```

The friction factor (f) is determined by the Colebrook-White method — `f = 64/Re` in laminar flow, converged via Newton-Raphson iteration in turbulent flow (max 50 iterations, tolerance 1×10⁻⁸).

**Minor losses** are calculated using the K-coefficient method:

```
ΔP = K · ½ρv²
```

K varies by angle for elbows, and by type and opening percentage for valves (lookup table + linear interpolation). Gate, globe, butterfly, and ball valve types are supported.

**Transitions (reducer/expander):**
- Expander → Borda-Carnot: `ΔP_loss = ½ρ(v₁-v₂)²`
- Reducer → contraction coefficient: `Kc ≈ 0.5·(1 - (D₂/D₁)²)`
- Bernoulli pressure change is included in both cases

**Flow regime** is determined by Reynolds number:
- Re < 2300 → Laminar
- 2300–4000 → Transitional
- Re > 4000 → Turbulent

**Fluid model** is empirical coefficient-based. Density (ρ) is computed as a polynomial function of temperature; dynamic viscosity (μ) uses the Vogel equation. Water and 50% ethylene glycol are pre-defined; the model is extensible.

**Pump model** operates at fixed flow rate (Q) and head (H). A smooth-step ramp function is applied at startup (2 seconds). Deadhead protection: an overload alarm triggers after 5 seconds of zero flow with the pump running.

### Alarm System

| Code | Trigger | Level |
|------|---------|-------|
| `DEADHEAD` | Pump running, flow = 0 | warning → critical |
| `NEGATIVE_PRESSURE` | P < 0 at any outlet | warning (cavitation) |
| `HIGH_VELOCITY` | Pipe velocity > 3 m/s | info |

### Supported Components

| Component | Calculation method |
|-----------|-------------------|
| Pump | H·ρ·g → pressure, smooth ramp |
| Pipe | Darcy-Weisbach + Colebrook-White |
| Elbow | K-coefficient (angle-dependent) |
| Reducer | Contraction loss + Bernoulli |
| Expander | Borda-Carnot + Bernoulli |
| Valve | K-table interpolation, partial opening |

---

## 💻 For Developers

### Architecture

```
main.js
├── state/
│   ├── pipeline-store.js     — component list, event emission
│   └── system-config.js      — global defaults, override system
├── components/
│   ├── base.js               — ComponentBase, factory, registry
│   ├── pump.js
│   ├── pipe.js
│   ├── elbow.js
│   ├── transition.js
│   └── valve.js
├── simulation/
│   └── simulation-engine.js  — state machine, tick loop, calculation chain
├── renderer/
│   ├── svg-renderer.js       — layout calculation, SVG drawing
│   ├── svg-utils.js          — SVG helpers
│   ├── chart-renderer.js     — Canvas 2D chart
│   └── flow-animator.js      — requestAnimationFrame particle animation
└── data/
    ├── catalogs.js            — component catalog
    └── fluids.js              — fluid models
```

### Data Flow

```
PipelineStore (components[])
      ↓ getParams()
SimulationEngine._tick()        — setInterval 100ms
      ↓ snapshot { nodes, t, Q, alarms }
handleTick()
      ├── ChartRenderer.draw()  — pressure/velocity/loss chart
      ├── FlowAnimator.update() — animation sync
      └── updateHUD()           — timer, volume
```

### SimulationEngine State Machine

```
          start()
IDLE ──────────────→ RUNNING
  ↑                     │ valve closed
  │      stop()         ↓
  └──────────────── ALARM
                    (deadhead > 5s → OVERLOAD)
```

### Adding a New Component

```javascript
// 1. components/myelem.js
import { ComponentBase, registerComponentType } from './base.js';

class MyElem extends ComponentBase {
  constructor() { super('myelem', 'default'); }

  getParams() {
    return {
      type: 'myelem',
      diameter_mm: this.resolve('diameter_mm'),
      // ...
    };
  }

  shapeSpec(layout) { /* SVG definition */ }
  renderPropsHTML() { /* Panel HTML */ }
}

registerComponentType('myelem', 'default', () => new MyElem());

// 2. Add to switch in simulation-engine.js _tick():
case 'myelem':
  result = calcMyElem(params, P_current, Q_effective, fluid);
  break;

// 3. Add to CATALOG_DEF in data/catalogs.js
```

### Override System

Every component falls back to `SystemConfig` defaults; per-element overrides are supported:

```javascript
comp.resolve('diameter_mm')      // returns override if set, otherwise SystemConfig default
comp.override('diameter_mm', 80) // set element-specific value
comp.hasOverride('diameter_mm')  // check
```

### Tick & Time

```
TICK_MS   = 100ms   → setInterval interval (UI update rate)
PHYS_DT   = 0.1s    → physical time represented per tick
RAMP_DUR  = 2.0s    → pump startup ramp duration
```

Physical time maps 1:1 to real time — 1 real second = 1 simulation second.

### Stack

- **Vanilla JS (ES Modules)** — no framework, no bundler
- **SVG** — pipeline drawing and component geometry
- **Canvas 2D** — chart rendering
- **requestAnimationFrame** — flow particle animation
- **setInterval** — simulation tick loop
- **EventEmitter** (custom) — store/engine communication

---

## 🙋 For Users

### Building a Pipeline

1. Select a component from the left panel
2. Drag and drop it onto the canvas
3. Components connect automatically — diameter mismatches are flagged
4. The pump is always at the start of the pipeline and cannot be removed

### Component Settings

Click any component to open its parameters in the right panel. Fields left unchanged use the system default. Only enter values where you need something different.

### Running the Simulation

Press **START**. The pump ramps up to full speed over 2 seconds and fluid begins flowing through the pipeline.

While running you can:
- Adjust valve opening — the chart updates instantly
- Click a component — its section is highlighted on the chart

Pressing **STOP** resets the timer and volume counter.

### Reading the Chart

| Color | Meaning |
|-------|---------|
| Blue line | Pressure (bar) — left axis |
| Green dashed | Velocity (m/s) — right axis |
| Red bar | Major loss (friction) |
| Yellow bar | Minor loss (fittings, valves, etc.) |

The bar strip below the chart shows total pressure drop per component. The tallest bar is consuming the most energy.

### Alarms

| Condition | What happens |
|-----------|-------------|
| Valve closed + pump running | **OVERLOAD** alarm after 5 seconds |
| Pressure drops below zero | **Cavitation** warning |
| Pipe velocity above 3 m/s | **High velocity** notice |

When an alarm triggers, the START button turns red. Open the valve to return the system to normal.

---

## License

MIT
