/** Keyboard state, exposed as normalised driver controls. */
export interface DriveControls {
  throttle: number; // 0..1
  brake: number;    // 0..1 (also reverse when stopped)
  steer: number;    // -1 (left) .. 1 (right)
  handbrake: boolean;
}

export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    target.addEventListener('blur', () => this.keys.clear());
  }

  isDown(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  /** True once per key press; cleared by endFrame(). */
  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  endFrame(): void {
    this.pressed.clear();
  }

  getDriveControls(): DriveControls {
    return {
      throttle: this.isDown('KeyW', 'ArrowUp') ? 1 : 0,
      brake: this.isDown('KeyS', 'ArrowDown') ? 1 : 0,
      steer: (this.isDown('KeyD', 'ArrowRight') ? 1 : 0) - (this.isDown('KeyA', 'ArrowLeft') ? 1 : 0),
      handbrake: this.isDown('Space'),
    };
  }
}
