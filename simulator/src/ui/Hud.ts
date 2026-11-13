/** DOM speedometer overlay. */
export class Hud {
  private speedEl = document.getElementById('speed')!;
  private gearEl = document.getElementById('gear')!;
  private lastShown = '';

  update(speedKmh: number): void {
    const text = Math.round(Math.abs(speedKmh)).toString();
    const gear = speedKmh < -0.5 ? 'R' : Math.abs(speedKmh) < 0.5 ? 'N' : 'D';
    const key = text + gear;
    if (key === this.lastShown) return;
    this.lastShown = key;
    this.speedEl.textContent = text;
    this.gearEl.textContent = gear;
  }
}
