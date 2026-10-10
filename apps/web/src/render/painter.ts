import type Phaser from 'phaser';

/** The drawing calls the sprite code uses, so it can draw on Phaser or on a plain canvas. */
export interface PixelPainter {
  rect(x: number, y: number, w: number, h: number, color: number, alpha?: number): void;
  px(x: number, y: number, color: number, alpha?: number): void;
  line(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    color: number,
    size?: number,
    alpha?: number,
  ): void;
}

/** Integer-pixel drawing on top of a Phaser Graphics object. */
export class Painter implements PixelPainter {
  constructor(readonly g: Phaser.GameObjects.Graphics) {}

  clear(): void {
    this.g.clear();
  }

  rect(x: number, y: number, w: number, h: number, color: number, alpha = 1): void {
    this.g.fillStyle(color, alpha);
    this.g.fillRect(Math.round(x), Math.round(y), w, h);
  }

  px(x: number, y: number, color: number, alpha = 1): void {
    this.rect(x, y, 1, 1, color, alpha);
  }

  /** Bresenham line, `size` px thick. */
  line(x0: number, y0: number, x1: number, y1: number, color: number, size = 1, alpha = 1): void {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const stepX = x0 < x1 ? 1 : -1;
    const stepY = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    this.g.fillStyle(color, alpha);
    for (;;) {
      this.g.fillRect(x0, y0, size, size);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += stepX;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += stepY;
      }
    }
  }
}

/** The same drawing on a 2D canvas (menu previews). */
export class CanvasPainter implements PixelPainter {
  constructor(readonly ctx: CanvasRenderingContext2D) {}

  clear(): void {
    this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
  }

  rect(x: number, y: number, w: number, h: number, color: number, alpha = 1): void {
    this.ctx.globalAlpha = alpha;
    this.ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    this.ctx.fillRect(Math.round(x), Math.round(y), w, h);
    this.ctx.globalAlpha = 1;
  }

  px(x: number, y: number, color: number, alpha = 1): void {
    this.rect(x, y, 1, 1, color, alpha);
  }

  line(x0: number, y0: number, x1: number, y1: number, color: number, size = 1, alpha = 1): void {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++)
      this.rect(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, size, size, color, alpha);
  }
}
