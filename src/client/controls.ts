import type { HeroCommand } from "../shared/movement.js";

const LEFT = ["a", "arrowleft"], RIGHT = ["d", "arrowright"];
const UP = ["w", "arrowup"], DOWN = ["s", "arrowdown"];
const GAME_KEYS = new Set([...LEFT, ...RIGHT, ...UP, ...DOWN, " "]);

/**
 * Keyboard state, sampled once per fixed step. Movement is held state (read
 * live); a Space tap is buffered until a step consumes it, so a press that
 * lands on a 0-step frame isn't lost and one spanning a multi-step frame
 * doesn't swing twice.
 */
export class Controls {
  private held = new Set<string>();
  private attackTapped = false;
  private listeners: Array<() => void> = [];

  constructor(onFirstInput: () => void) {
    const down = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (!GAME_KEYS.has(key)) { return; }
      e.preventDefault();
      onFirstInput();
      if (key === " " && !e.repeat) { this.attackTapped = true; }
      this.held.add(key);
    };
    const up = (e: KeyboardEvent) => this.held.delete(e.key.toLowerCase());
    // A key released while the tab is unfocused never fires keyup.
    const blur = () => this.held.clear();

    addEventListener("keydown", down);
    addEventListener("keyup", up);
    addEventListener("blur", blur);
    this.listeners.push(
      () => removeEventListener("keydown", down),
      () => removeEventListener("keyup", up),
      () => removeEventListener("blur", blur),
    );
  }

  /** The command for the next fixed step. Holding Space keeps swinging. */
  sample(out: HeroCommand): HeroCommand {
    out.moveX = this.axis(LEFT, RIGHT);
    out.moveY = this.axis(UP, DOWN);
    out.attack = this.attackTapped || this.held.has(" ");
    this.attackTapped = false;
    return out;
  }

  dispose() {
    this.listeners.forEach((off) => off());
  }

  /** Opposite keys cancel out, so the axis is always exactly -1, 0 or 1. */
  private axis(negative: string[], positive: string[]): -1 | 0 | 1 {
    const back = negative.some((k) => this.held.has(k));
    const forward = positive.some((k) => this.held.has(k));
    if (back === forward) { return 0; }
    return back ? -1 : 1;
  }
}
