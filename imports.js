// imports.js
'use strict';

// Sistem ve store
import { SystemConfig } from './state/system-config.js';
import { pipelineStore } from './state/pipeline-store.js';

// Renderer
import { SVGRenderer } from './renderer/svg-renderer.js';
import { ChartRenderer } from './renderer/chart-renderer.js';
import { FlowAnimator } from './renderer/flow-animator.js';
import { TooltipManager } from './renderer/tooltip-manager.js';

// Simülasyon
import { SimulationEngine, SysState } from './Simulation/SimulationEngine.js';

// Veri ve component yönetimi
import { Units } from './data/unit-system.js';
import { fluidRegistry } from './data/fluid-model.js';
import { createComponent } from './components/base.js';
import { createCatalogManager } from './catalog-manager.js';

// Yan etkili component importları (kayıt için sıra önemli)
import './components/pipe.js';
import './components/transition.js';
import './components/elbow.js';
import './components/valve.js';
import './components/pump.js';
import './components/prv.js';

// Exportlar (main.js kullanacak)
export {
	SystemConfig,
	pipelineStore,
	SVGRenderer,
	ChartRenderer,
	FlowAnimator,
	TooltipManager,
	SimulationEngine,
	SysState,
	Units,
	fluidRegistry,
	createComponent,
	createCatalogManager
};