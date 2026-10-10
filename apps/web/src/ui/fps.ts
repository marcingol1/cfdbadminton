/** Small frames-per-second readout (top-left corner), averaged over half a second. */
export class FpsMeter {
  private readonly el: HTMLElement;
  private frames = 0;
  private elapsed = 0;
  private worst = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'fps';
    this.el.setAttribute('aria-hidden', 'true');
    parent.appendChild(this.el);
  }

  setVisible(visible: boolean): void {
    this.el.hidden = !visible;
  }

  /** Call once per rendered frame with the real time since the previous frame. */
  frame(deltaMs: number): void {
    this.frames++;
    this.elapsed += deltaMs;
    this.worst = Math.max(this.worst, deltaMs);
    if (this.elapsed < 500) return;
    const fps = Math.round((this.frames * 1000) / this.elapsed);
    const avgMs = this.elapsed / this.frames;
    this.el.textContent = `${fps} FPS · ${avgMs.toFixed(1)}ms (max ${Math.round(this.worst)})`;
    this.el.className = `fps ${fps >= 55 ? 'good' : fps >= 30 ? 'ok' : 'bad'}`;
    this.frames = 0;
    this.elapsed = 0;
    this.worst = 0;
  }
}
