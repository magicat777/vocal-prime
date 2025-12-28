/**
 * Grid Layout Store - Manages panel positions and sizes for drag/resize
 *
 * Uses a virtual grid system where panels snap to grid cells.
 * Positions are stored as grid coordinates, converted to pixels at render time.
 * Supports proportional scaling when window size changes.
 */
import { writable, derived, get } from 'svelte/store';

// Grid configuration
export const GRID_CONFIG = {
  cellSize: 20,           // Base grid cell size in pixels
  snapThreshold: 15,      // Pixels before snap kicks in
  minPanelWidth: 160,     // Minimum panel width (8 cells)
  minPanelHeight: 100,    // Minimum panel height (5 cells)
  gap: 8,                 // Gap between panels in pixels
  padding: 8,             // Container padding in pixels
} as const;

// Reference dimensions for proportional scaling
export const REFERENCE_DIMENSIONS = {
  width: 1600,   // Reference container width
  height: 900,   // Reference container height
} as const;

// Scale state for proportional panel scaling
export interface ScaleState {
  containerWidth: number;
  containerHeight: number;
  scaleX: number;
  scaleY: number;
}

// Panel position and size (in grid cells, not pixels)
export interface PanelLayout {
  id: string;
  x: number;           // Grid column position
  y: number;           // Grid row position
  width: number;       // Width in grid cells
  height: number;      // Height in grid cells
  zIndex: number;      // Stacking order
  locked: boolean;     // Prevent drag/resize
}

// Default layouts for each panel (position in grid cells)
// Grid is roughly 80 columns x 45 rows at 1600x900 with 20px cells
const defaultLayouts: Record<string, Omit<PanelLayout, 'id'>> = {
  // Top row - Waveform and Spectrum
  waveform: { x: 0, y: 0, width: 20, height: 14, zIndex: 1, locked: false },
  spectrum: { x: 20, y: 0, width: 58, height: 14, zIndex: 1, locked: false },

  // Middle row - Pitch, Formants, Quality
  pitch: { x: 0, y: 14, width: 20, height: 14, zIndex: 1, locked: false },
  formants: { x: 20, y: 14, width: 20, height: 14, zIndex: 1, locked: false },
  quality: { x: 40, y: 14, width: 38, height: 14, zIndex: 1, locked: false },

  // Bottom row - Meters, Goniometer, Stereo, FreqBands
  meters: { x: 0, y: 28, width: 20, height: 14, zIndex: 1, locked: false },
  goniometer: { x: 20, y: 28, width: 20, height: 14, zIndex: 1, locked: false },
  stereo: { x: 40, y: 28, width: 20, height: 14, zIndex: 1, locked: false },
  freqBands: { x: 60, y: 28, width: 18, height: 14, zIndex: 1, locked: false },
};

export type PanelId = keyof typeof defaultLayouts;

export interface GridLayoutState {
  panels: Record<string, PanelLayout>;
  activePanel: string | null;      // Currently being dragged/resized
  gridVisible: boolean;            // Show grid overlay for alignment
  snapEnabled: boolean;            // Enable snap-to-grid
  scale: ScaleState;               // Scaling state for proportional layouts
}

const defaultState: GridLayoutState = {
  panels: Object.fromEntries(
    Object.entries(defaultLayouts).map(([id, layout]) => [id, { id, ...layout }])
  ),
  activePanel: null,
  gridVisible: false,
  snapEnabled: true,
  scale: {
    containerWidth: REFERENCE_DIMENSIONS.width,
    containerHeight: REFERENCE_DIMENSIONS.height,
    scaleX: 1,
    scaleY: 1,
  },
};

// Parse stored data and merge with defaults
function parseStoredData(parsed: unknown): GridLayoutState {
  if (!parsed || typeof parsed !== 'object') {
    return defaultState;
  }
  const data = parsed as Record<string, unknown>;

  // Merge with defaults to handle new panels
  const mergedPanels: Record<string, PanelLayout> = {};
  for (const [id, defaultPanel] of Object.entries(defaultState.panels)) {
    const storedPanels = data['panels'] as Record<string, PanelLayout> | undefined;
    const storedPanel = storedPanels?.[id];

    const hasValidPosition = storedPanel &&
      typeof storedPanel.x === 'number' && storedPanel.x !== null &&
      typeof storedPanel.y === 'number' && storedPanel.y !== null;
    const hasValidSize = storedPanel &&
      typeof storedPanel.width === 'number' && storedPanel.width !== null &&
      typeof storedPanel.height === 'number' && storedPanel.height !== null;

    if (hasValidPosition && hasValidSize) {
      mergedPanels[id] = { ...defaultPanel, ...storedPanel, id };
    } else {
      mergedPanels[id] = defaultPanel;
    }
  }

  return {
    ...defaultState,
    ...data,
    panels: mergedPanels,
    scale: defaultState.scale,
  };
}

// Load from localStorage
function loadFromLocalStorage(): GridLayoutState {
  if (typeof window !== 'undefined' && window.localStorage) {
    const stored = localStorage.getItem('vocal-prime-grid-layout');
    if (stored) {
      try {
        return parseStoredData(JSON.parse(stored));
      } catch {
        return defaultState;
      }
    }
  }
  return defaultState;
}

// Save to localStorage
function saveToLocalStorage(state: GridLayoutState) {
  if (typeof window !== 'undefined' && window.localStorage) {
    const dataToSave = {
      panels: state.panels,
      gridVisible: state.gridVisible,
      snapEnabled: state.snapEnabled,
    };
    localStorage.setItem('vocal-prime-grid-layout', JSON.stringify(dataToSave));
  }
}

// Create the store
function createGridLayoutStore() {
  const { subscribe, set, update } = writable<GridLayoutState>(loadFromLocalStorage());

  return {
    subscribe,

    // Convert grid coordinates to pixel position
    gridToPixels: (gridX: number, gridY: number): { x: number; y: number } => ({
      x: gridX * GRID_CONFIG.cellSize + GRID_CONFIG.padding,
      y: gridY * GRID_CONFIG.cellSize + GRID_CONFIG.padding,
    }),

    // Convert pixel position to grid coordinates (with snap)
    pixelsToGrid: (pixelX: number, pixelY: number, snap = true): { x: number; y: number } => {
      const rawX = (pixelX - GRID_CONFIG.padding) / GRID_CONFIG.cellSize;
      const rawY = (pixelY - GRID_CONFIG.padding) / GRID_CONFIG.cellSize;

      if (snap) {
        return {
          x: Math.round(rawX),
          y: Math.round(rawY),
        };
      }
      return { x: rawX, y: rawY };
    },

    // Convert grid dimensions to pixel dimensions
    sizeToPixels: (gridWidth: number, gridHeight: number): { width: number; height: number } => ({
      width: gridWidth * GRID_CONFIG.cellSize,
      height: gridHeight * GRID_CONFIG.cellSize,
    }),

    // Update panel position (during drag)
    updatePosition: (panelId: string, x: number, y: number) => {
      update(state => {
        const panel = state.panels[panelId];
        if (!panel || panel.locked) return state;

        const newState = {
          ...state,
          panels: {
            ...state.panels,
            [panelId]: { ...panel, x: Math.round(x), y: Math.round(y) },
          },
        };
        saveToLocalStorage(newState);
        return newState;
      });
    },

    // Update panel size (during resize)
    updateSize: (panelId: string, width: number, height: number) => {
      update(state => {
        const panel = state.panels[panelId];
        if (!panel || panel.locked) return state;

        const minWidthCells = Math.ceil(GRID_CONFIG.minPanelWidth / GRID_CONFIG.cellSize);
        const minHeightCells = Math.ceil(GRID_CONFIG.minPanelHeight / GRID_CONFIG.cellSize);

        const newState = {
          ...state,
          panels: {
            ...state.panels,
            [panelId]: {
              ...panel,
              width: Math.round(Math.max(minWidthCells, width)),
              height: Math.round(Math.max(minHeightCells, height)),
            },
          },
        };
        saveToLocalStorage(newState);
        return newState;
      });
    },

    // Set active panel (being dragged/resized)
    setActivePanel: (panelId: string | null) => {
      update(state => ({ ...state, activePanel: panelId }));
    },

    // Bring panel to front
    bringToFront: (panelId: string) => {
      update(state => {
        const maxZ = Math.max(...Object.values(state.panels).map(p => p.zIndex));
        const newState = {
          ...state,
          panels: {
            ...state.panels,
            [panelId]: { ...state.panels[panelId], zIndex: maxZ + 1 },
          },
        };
        saveToLocalStorage(newState);
        return newState;
      });
    },

    // Toggle panel lock (simply toggles the locked flag - no size conversion)
    toggleLock: (panelId: string) => {
      update(state => {
        const panel = state.panels[panelId];
        if (!panel) return state;

        const newState = {
          ...state,
          panels: {
            ...state.panels,
            [panelId]: { ...panel, locked: !panel.locked },
          },
        };
        saveToLocalStorage(newState);
        return newState;
      });
    },

    // Lock all panels
    lockAll: () => {
      update(state => {
        const newPanels = { ...state.panels };
        for (const id of Object.keys(newPanels)) {
          newPanels[id] = { ...newPanels[id], locked: true };
        }
        const newState = { ...state, panels: newPanels };
        saveToLocalStorage(newState);
        return newState;
      });
    },

    // Unlock all panels
    unlockAll: () => {
      update(state => {
        const newPanels = { ...state.panels };
        for (const id of Object.keys(newPanels)) {
          newPanels[id] = { ...newPanels[id], locked: false };
        }
        const newState = { ...state, panels: newPanels };
        saveToLocalStorage(newState);
        return newState;
      });
    },

    // Check if all panels are locked
    areAllLocked: (): boolean => {
      const state = get({ subscribe });
      return Object.values(state.panels).every(p => p.locked);
    },

    // Toggle grid visibility
    toggleGrid: () => {
      update(state => {
        const newState = { ...state, gridVisible: !state.gridVisible };
        saveToLocalStorage(newState);
        return newState;
      });
    },

    // Toggle snap-to-grid
    toggleSnap: () => {
      update(state => {
        const newState = { ...state, snapEnabled: !state.snapEnabled };
        saveToLocalStorage(newState);
        return newState;
      });
    },

    // Reset to default layout
    reset: () => {
      set(defaultState);
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.removeItem('vocal-prime-grid-layout');
      }
    },

    // Get panel by ID
    getPanel: (panelId: string): PanelLayout | undefined => {
      return get({ subscribe }).panels[panelId];
    },

    // Update container size and recalculate scale factors
    setContainerSize: (containerWidth: number, containerHeight: number) => {
      update(state => {
        const scaleX = containerWidth / REFERENCE_DIMENSIONS.width;
        const scaleY = containerHeight / REFERENCE_DIMENSIONS.height;

        return {
          ...state,
          scale: {
            ...state.scale,
            containerWidth,
            containerHeight,
            scaleX,
            scaleY,
          },
        };
      });
    },

    // Get current scale factors
    getScale: (): ScaleState => {
      return get({ subscribe }).scale;
    },
  };
}

export const gridLayout = createGridLayoutStore();

// Derived store for just the panels (for reactive updates)
export const panelLayouts = derived(gridLayout, $grid => $grid.panels);

// Derived store for scale state
export const scaleState = derived(gridLayout, $grid => $grid.scale);

// Derived store for panel layouts ready for rendering
// NO automatic scaling - panels keep their exact stored dimensions
// Only clamps positions to keep panels visible within container bounds
export const scaledPanelLayouts = derived(gridLayout, $grid => {
  const { containerWidth, containerHeight } = $grid.scale;
  const minWidthCells = Math.ceil(GRID_CONFIG.minPanelWidth / GRID_CONFIG.cellSize);
  const minHeightCells = Math.ceil(GRID_CONFIG.minPanelHeight / GRID_CONFIG.cellSize);

  // Calculate available grid cells based on current container size
  const maxGridX = Math.floor((containerWidth - GRID_CONFIG.padding * 2) / GRID_CONFIG.cellSize);
  const maxGridY = Math.floor((containerHeight - GRID_CONFIG.padding * 2) / GRID_CONFIG.cellSize);

  const outputPanels: Record<string, PanelLayout> = {};

  for (const [id, panel] of Object.entries($grid.panels)) {
    // Use stored dimensions directly - no scaling
    const panelWidth = Math.max(minWidthCells, panel.width);
    const panelHeight = Math.max(minHeightCells, panel.height);

    // Use stored positions directly
    let x = panel.x;
    let y = panel.y;

    // Only clamp positions to keep panels visible (don't extend beyond container)
    if (x + panelWidth > maxGridX && maxGridX > panelWidth) {
      x = Math.max(0, maxGridX - panelWidth);
    }
    if (y + panelHeight > maxGridY && maxGridY > panelHeight) {
      y = Math.max(0, maxGridY - panelHeight);
    }

    outputPanels[id] = {
      ...panel,
      x,
      y,
      width: panelWidth,
      height: panelHeight,
    };
  }

  return outputPanels;
});
