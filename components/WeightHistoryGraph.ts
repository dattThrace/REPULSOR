/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { css, html, LitElement, unsafeCSS } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import type { PlaybackState, Prompt } from '../types';

const MAX_WEIGHT_VALUE = 2.0; // Max value for Y-axis (prompt weight)
const GRID_COLOR = 'rgba(255, 255, 255, 0.1)';
const AXIS_LABEL_COLOR = 'rgba(255, 255, 255, 0.5)';
const OVERLAY_TEXT_COLOR = 'rgba(255, 255, 255, 0.7)';
const FONT_SIZE = 10; // For axis labels

@customElement('weight-history-graph')
export class WeightHistoryGraph extends LitElement {
  static override styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      position: relative; /* For overlay positioning */
    }
    canvas {
      width: 100%;
      height: 100%;
      border-radius: inherit; /* Inherit border-radius from host if any */
    }
    .overlay {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      color: ${unsafeCSS(OVERLAY_TEXT_COLOR)};
      font-size: 1.5em;
      font-weight: bold;
      pointer-events: none; /* Allow clicks to pass through if needed */
      border-radius: inherit;
    }
  `;

  @property({ type: Object }) prompts: Map<string, Prompt> = new Map();
  @property({ type: Object }) history: Map<string, Array<{ time: number, weight: number }>> = new Map();
  @property({ type: Number }) historyDurationMs = 15000;
  @property({ type: Boolean, reflect: true }) active = false;
  @property({ type: String }) playbackStateForOverlay: PlaybackState = 'stopped';


  @query('canvas') private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private rafId: number | null = null;
  private lastDrawTime = 0; // To maintain consistent view when paused

  override firstUpdated() {
    const context = this.canvas.getContext('2d');
    if (!context) {
      console.error('Failed to get canvas 2D context');
      return;
    }
    this.ctx = context;
    this.resizeCanvas(); 
    if (this.active) {
      this.startDrawingLoop();
    } else {
      this.drawGraph(); // Draw once in inactive state with overlay
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.stopDrawingLoop();
  }

  override updated(changedProperties: Map<string, unknown>) {
    super.updated(changedProperties);
    if (changedProperties.has('active')) {
      if (this.active) {
        this.startDrawingLoop();
      } else {
        this.stopDrawingLoop();
        this.drawGraph(); // Redraw with overlay when becoming inactive
      }
    } else if (this.active && (changedProperties.has('history') || changedProperties.has('prompts'))) {
      // If active and data changes, the loop will handle it.
      // If inactive and data changes, might need a redraw if desired. For now, it freezes.
    }
     if (changedProperties.has('playbackStateForOverlay') && !this.active) {
        this.drawGraph(); // Redraw with updated overlay text if inactive
    }
  }

  public setActive(isActive: boolean, playbackState: PlaybackState) {
    this.active = isActive;
    this.playbackStateForOverlay = playbackState;
  }

  private resizeCanvas() {
    if (!this.canvas || !this.ctx) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.canvas.offsetWidth * dpr;
    this.canvas.height = this.canvas.offsetHeight * dpr;
    this.ctx.scale(dpr, dpr); 
  }
  
  private startDrawingLoop() {
    if (!this.ctx) return;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.lastDrawTime = Date.now(); // Reset time anchor when starting

    const draw = () => {
      if (!this.active) return; // Stop loop if deactivated
      this.drawGraph();
      this.rafId = requestAnimationFrame(draw);
    };
    this.rafId = requestAnimationFrame(draw);
  }

  private stopDrawingLoop() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private drawGraph() {
    if (!this.ctx || !this.canvas) return;

    if (this.canvas.offsetWidth === 0 || this.canvas.offsetHeight === 0) {
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.rafId = requestAnimationFrame(() => {
            if (!this.isConnected) return; // Check if component is still connected
            this.resizeCanvas();
            if (this.active) this.startDrawingLoop(); else this.drawGraph();
        });
        return;
    }
    if (this.canvas.width !== this.canvas.offsetWidth * window.devicePixelRatio ||
        this.canvas.height !== this.canvas.offsetHeight * window.devicePixelRatio) {
        this.resizeCanvas();
    }


    const { width, height } = this.canvas.getBoundingClientRect(); 
    this.ctx.clearRect(0, 0, width, height);

    const now = this.active ? Date.now() : this.lastDrawTime;
    if (this.active) this.lastDrawTime = now; // Update lastDrawTime only when active
    const startTime = now - this.historyDurationMs;

    // --- Draw Grid ---
    this.ctx.strokeStyle = GRID_COLOR;
    this.ctx.lineWidth = 0.5;
    this.ctx.fillStyle = AXIS_LABEL_COLOR;
    this.ctx.font = `${FONT_SIZE}px sans-serif`;

    const weightIntervals = [0, 0.5, 1.0, 1.5, MAX_WEIGHT_VALUE];
    weightIntervals.forEach(val => {
      const y = height - (val / MAX_WEIGHT_VALUE) * height;
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(width, y);
      this.ctx.stroke();
      this.ctx.fillText(val.toFixed(1), 2, y - 2 > FONT_SIZE ? y - 2 : y + FONT_SIZE);
    });

    const numTimeIntervals = 5; 
    for (let i = 0; i <= numTimeIntervals; i++) {
      const x = (i / numTimeIntervals) * width;
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, height);
      this.ctx.stroke();
      const timeLabelVal = ((numTimeIntervals - i) * (this.historyDurationMs / 1000 / numTimeIntervals));
      const timeLabel = timeLabelVal > 0 ? `-${timeLabelVal.toFixed(0)}s` : 'Now';
      const textMetrics = this.ctx.measureText(timeLabel);
      const textWidth = textMetrics.width;
      let textX = x - textWidth / 2;
      if (i === 0) textX = x + 2; // Left align first label
      if (i === numTimeIntervals) textX = x - textWidth - 2; // Right align last label

      this.ctx.fillText(timeLabel, Math.max(0, Math.min(width - textWidth, textX)), height - 2);
    }
    
    // --- Draw Prompt Lines ---
    this.ctx.lineWidth = 2;
    this.history.forEach((points, promptId) => {
      const promptInfo = this.prompts.get(promptId);
      if (!promptInfo || points.length === 0) return; // Allow drawing single point if needed or <2

      this.ctx.strokeStyle = promptInfo.color;
      this.ctx.beginPath();

      let firstVisiblePoint = true;
      for (let i = 0; i < points.length; i++) {
        const point = points[i];
        if (point.time < startTime && i < points.length -1 && points[i+1].time < startTime) continue; 

        const x = ((point.time - startTime) / this.historyDurationMs) * width;
        const y = height - (point.weight / MAX_WEIGHT_VALUE) * height;
        
        if (firstVisiblePoint) {
          this.ctx.moveTo(x, y);
          firstVisiblePoint = false;
        } else {
          this.ctx.lineTo(x, y);
        }
      }
      if (!firstVisiblePoint) { // Only stroke if there was something to draw
           this.ctx.stroke();
      }
    });

    // --- Draw Overlay if not active ---
    if (!this.active) {
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        this.ctx.fillRect(0, 0, width, height);
        this.ctx.font = `bold ${Math.min(24, width/10)}px sans-serif`;
        this.ctx.fillStyle = OVERLAY_TEXT_COLOR;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        const overlayText = this.playbackStateForOverlay.toUpperCase();
        this.ctx.fillText(overlayText, width / 2, height / 2);
        this.ctx.textAlign = 'left'; // Reset
        this.ctx.textBaseline = 'alphabetic'; // Reset
    }
  }

  override render() {
    return html`<canvas></canvas>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'weight-history-graph': WeightHistoryGraph;
  }
}
