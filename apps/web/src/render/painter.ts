import type Phaser from 'phaser';

/** Integer-pixel drawing on top of a Phaser Graphics object. */
export class Painter {
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
  line(x0: number, y0: number, x1: number, y1: number, color: number, size = 1): void {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const stepX = x0 < x1 ? 1 : -1;
    const stepY = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    this.g.fillStyle(color, 1);
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
