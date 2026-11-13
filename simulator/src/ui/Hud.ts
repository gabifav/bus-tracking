/** DOM speedometer overlay. */
export class Hud {
  private speedEl = document.getElementById('speed')!;
  private gearEl = document.getElementById('gear')!;
  private lastShown = '';

  private rpmEl = document.getElementById('rpm') as HTMLElement;

  update(speedKmh: number, reverse: boolean, gear: number, rpm: number): void {
    const text = Math.round(Math.abs(speedKmh)).toString();
    const g = reverse ? 'R' : Math.abs(speedKmh) < 0.5 ? 'N' : `D${gear}`;
    this.rpmEl.style.width = `${Math.min(100, (rpm / 2400) * 100)}%`;
    const key = text + g;
    const gearText = g;
    if (key === this.lastShown) return;
    this.lastShown = key;
    this.speedEl.textContent = text;
    this.gearEl.textContent = gearText;
  }
}
