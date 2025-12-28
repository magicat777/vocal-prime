<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import interact from 'interactjs';
  import { gridLayout, scaledPanelLayouts, GRID_CONFIG, type PanelId } from '../../stores/gridLayout';

  // Props
  export let panelId: PanelId;
  export let title: string = '';

  // Local state
  let panelElement: HTMLDivElement;
  let interactable: ReturnType<typeof interact> | null = null;
  let isDragging = false;
  let isResizing = false;

  // Reactive panel data from store
  $: panel = $scaledPanelLayouts[panelId];
  $: rawPanel = $gridLayout.panels[panelId]; // For lock state
  $: isActive = $gridLayout.activePanel === panelId;
  $: snapEnabled = $gridLayout.snapEnabled;

  // Calculate pixel position and size from scaled grid coordinates
  $: pixelPos = panel ? gridLayout.gridToPixels(panel.x, panel.y) : { x: 0, y: 0 };
  $: pixelSize = panel ? gridLayout.sizeToPixels(panel.width, panel.height) : { width: 200, height: 150 };

  // Style string for positioning
  $: panelStyle = panel && rawPanel ? `
    left: ${pixelPos.x}px;
    top: ${pixelPos.y}px;
    width: ${pixelSize.width}px;
    height: ${pixelSize.height}px;
    z-index: ${rawPanel.zIndex + (isActive ? 100 : 0)};
  ` : '';

  onMount(() => {
    if (!panelElement || !panel) return;

    interactable = interact(panelElement)
      .draggable({
        inertia: false,
        modifiers: [],
        autoScroll: false,
        allowFrom: '.panel-header',  // Use the panel's own header as drag handle
        listeners: {
          start: () => {
            isDragging = true;
            gridLayout.setActivePanel(panelId);
            gridLayout.bringToFront(panelId);
            panelElement.style.willChange = 'transform';
          },
          move: (event) => {
            if (rawPanel?.locked) return;

            const target = event.target as HTMLElement;
            const x = (parseFloat(target.getAttribute('data-x') || '0')) + event.dx;
            const y = (parseFloat(target.getAttribute('data-y') || '0')) + event.dy;

            target.style.transform = `translate(${x}px, ${y}px)`;
            target.setAttribute('data-x', String(x));
            target.setAttribute('data-y', String(y));
          },
          end: (event) => {
            isDragging = false;
            gridLayout.setActivePanel(null);
            panelElement.style.willChange = '';

            const target = event.target as HTMLElement;
            const dragX = parseFloat(target.getAttribute('data-x') || '0');
            const dragY = parseFloat(target.getAttribute('data-y') || '0');

            // Use RAW panel position (not scaled/clamped) to calculate new position
            const rawPixelPos = rawPanel ? gridLayout.gridToPixels(rawPanel.x, rawPanel.y) : pixelPos;
            const finalPixelX = rawPixelPos.x + dragX;
            const finalPixelY = rawPixelPos.y + dragY;

            const cellSize = GRID_CONFIG.cellSize;

            let gridX = (finalPixelX - GRID_CONFIG.padding) / cellSize;
            let gridY = (finalPixelY - GRID_CONFIG.padding) / cellSize;

            if (snapEnabled) {
              gridX = Math.round(gridX);
              gridY = Math.round(gridY);
            }

            target.style.transform = '';
            target.removeAttribute('data-x');
            target.removeAttribute('data-y');

            gridLayout.updatePosition(panelId, Math.max(0, Math.round(gridX)), Math.max(0, Math.round(gridY)));
          },
        },
      })
      .resizable({
        edges: { left: false, right: true, bottom: true, top: false },
        modifiers: [
          interact.modifiers.restrictSize({
            min: {
              width: GRID_CONFIG.minPanelWidth,
              height: GRID_CONFIG.minPanelHeight,
            },
          }),
        ],
        listeners: {
          start: () => {
            isResizing = true;
            gridLayout.setActivePanel(panelId);
            gridLayout.bringToFront(panelId);
            panelElement.style.willChange = 'width, height';
          },
          move: (event) => {
            if (rawPanel?.locked) return;

            const target = event.target as HTMLElement;
            target.style.width = `${event.rect.width}px`;
            target.style.height = `${event.rect.height}px`;
          },
          end: (event) => {
            isResizing = false;
            gridLayout.setActivePanel(null);
            panelElement.style.willChange = '';

            const cellSize = GRID_CONFIG.cellSize;

            // Calculate size in grid cells from pixel dimensions
            let newWidthCells = event.rect.width / cellSize;
            let newHeightCells = event.rect.height / cellSize;

            if (snapEnabled) {
              // Snap to nearest grid cell
              newWidthCells = Math.round(newWidthCells);
              newHeightCells = Math.round(newHeightCells);
            }

            // Store directly - no scale conversion needed
            // The stored value IS the grid cell count the user resized to
            gridLayout.updateSize(panelId, Math.max(1, Math.round(newWidthCells)), Math.max(1, Math.round(newHeightCells)));
          },
        },
      });
  });

  onDestroy(() => {
    if (interactable) {
      interactable.unset();
    }
  });

  function handleDoubleClick() {
    gridLayout.toggleLock(panelId);
  }

  function handlePanelClick() {
    gridLayout.bringToFront(panelId);
  }
</script>

{#if panel}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    bind:this={panelElement}
    class="draggable-panel"
    class:is-dragging={isDragging}
    class:is-resizing={isResizing}
    class:is-active={isActive}
    class:is-locked={rawPanel?.locked}
    style={panelStyle}
    role="region"
    aria-label={title || panelId}
    on:mousedown={handlePanelClick}
  >
    <!-- Panel content (includes its own header) -->
    <div class="panel-content" on:dblclick={handleDoubleClick}>
      <slot />
    </div>

    <!-- Lock indicator overlay -->
    {#if rawPanel?.locked}
      <div class="lock-indicator" title="Locked - double-click to unlock">🔒</div>
    {/if}

    <!-- Resize handle (bottom-right corner) -->
    {#if !rawPanel?.locked}
      <div class="resize-handle" aria-hidden="true">
        <svg viewBox="0 0 10 10" class="resize-icon">
          <path d="M8,0 L10,0 L10,10 L0,10 L0,8 L8,8 Z" fill="currentColor" opacity="0.3" />
          <line x1="3" y1="10" x2="10" y2="3" stroke="currentColor" stroke-width="1" opacity="0.5" />
          <line x1="6" y1="10" x2="10" y2="6" stroke="currentColor" stroke-width="1" opacity="0.5" />
        </svg>
      </div>
    {/if}
  </div>
{/if}

<style>
  .draggable-panel {
    position: absolute;
    display: flex;
    flex-direction: column;
    background: var(--bg-panel);
    border-radius: var(--border-radius);
    border: 1px solid var(--border-color);
    overflow: hidden;
    user-select: none;
    touch-action: none;
    transition: box-shadow 0.15s ease;
  }

  .draggable-panel.is-active {
    box-shadow: 0 0 0 2px var(--accent-primary), 0 8px 24px rgba(0, 0, 0, 0.4);
  }

  .draggable-panel.is-dragging {
    cursor: grabbing;
    opacity: 0.9;
  }

  .draggable-panel.is-resizing {
    cursor: se-resize;
  }

  .draggable-panel.is-locked {
    border-color: rgba(255, 200, 50, 0.3);
  }

  .lock-indicator {
    position: absolute;
    top: 4px;
    right: 4px;
    font-size: 0.6rem;
    opacity: 0.6;
    z-index: 10;
    pointer-events: none;
  }

  /* Style the panel's header as a drag handle */
  .panel-content :global(.panel-header) {
    cursor: grab;
  }

  .panel-content :global(.panel-header):active {
    cursor: grabbing;
  }

  .is-locked .panel-content :global(.panel-header) {
    cursor: default;
  }

  .panel-content {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .resize-handle {
    position: absolute;
    bottom: 0;
    right: 0;
    width: 16px;
    height: 16px;
    cursor: se-resize;
    color: var(--text-muted);
  }

  .resize-icon {
    width: 100%;
    height: 100%;
  }

  .is-locked .resize-handle {
    display: none;
  }

  /* During drag/resize, prevent child interactions */
  .is-dragging .panel-content,
  .is-resizing .panel-content {
    pointer-events: none;
  }
</style>
