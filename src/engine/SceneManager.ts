export interface Scene {
  enter?(): void;
  exit?(): void;
  update(dt: number): void;
  render(ctx: CanvasRenderingContext2D, w: number, h: number): void;
  onResize?(w: number, h: number): void;
  handleBack?(): boolean;
}

const FADE_MS = 150;

type TransitionKind = 'none' | 'fadeOut' | 'fadeIn';

interface PendingNav {
  action: 'push' | 'replace' | 'back';
  scene?: Scene;
}

export class SceneManager {
  private stack: Scene[] = [];
  private transition: TransitionKind = 'none';
  private transitionT = 0;
  private pending: PendingNav | null = null;

  get current(): Scene | null {
    if (this.stack.length === 0) return null;
    return this.stack[this.stack.length - 1] ?? null;
  }

  get depth(): number {
    return this.stack.length;
  }

  push(scene: Scene): void {
    if (this.transition !== 'none') {
      this.pending = { action: 'push', scene };
      return;
    }
    this.beginFadeOut({ action: 'push', scene });
  }

  replace(scene: Scene): void {
    if (this.transition !== 'none') {
      this.pending = { action: 'replace', scene };
      return;
    }
    this.beginFadeOut({ action: 'replace', scene });
  }

  back(): void {
    if (this.stack.length <= 1) return;
    if (this.transition !== 'none') {
      this.pending = { action: 'back' };
      return;
    }
    this.beginFadeOut({ action: 'back' });
  }

  handleBack(): boolean {
    const scene = this.current;
    if (scene?.handleBack !== undefined && scene.handleBack()) {
      return true;
    }
    if (this.stack.length > 1) {
      this.back();
      return true;
    }
    return false;
  }

  onResize(w: number, h: number): void {
    for (const scene of this.stack) {
      scene.onResize?.(w, h);
    }
  }

  update(dt: number): void {
    if (this.transition === 'fadeOut') {
      this.transitionT += dt;
      if (this.transitionT >= FADE_MS / 1000) {
        this.commitPending();
        this.transition = 'fadeIn';
        this.transitionT = 0;
      }
      return;
    }

    if (this.transition === 'fadeIn') {
      this.transitionT += dt;
      if (this.transitionT >= FADE_MS / 1000) {
        this.transition = 'none';
        this.transitionT = 0;
        // Flush nav requested during the fade (e.g. enter failure → back).
        if (this.pending !== null) {
          this.beginFadeOut(this.pending);
          return;
        }
      }
    }

    this.current?.update(dt);
  }

  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    this.current?.render(ctx, w, h);

    if (this.transition === 'none') return;

    const alpha =
      this.transition === 'fadeOut'
        ? Math.min(1, this.transitionT / (FADE_MS / 1000))
        : Math.max(0, 1 - this.transitionT / (FADE_MS / 1000));

    if (alpha <= 0) return;

    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  private beginFadeOut(nav: PendingNav): void {
    this.pending = nav;
    this.transition = 'fadeOut';
    this.transitionT = 0;
  }

  private commitPending(): void {
    const nav = this.pending;
    this.pending = null;
    if (nav === null) return;

    if (nav.action === 'push' && nav.scene !== undefined) {
      this.current?.exit?.();
      this.stack.push(nav.scene);
      this.safeEnter(nav.scene);
      return;
    }

    if (nav.action === 'replace' && nav.scene !== undefined) {
      const outgoing = this.stack.pop();
      outgoing?.exit?.();
      this.stack.push(nav.scene);
      this.safeEnter(nav.scene);
      return;
    }

    if (nav.action === 'back' && this.stack.length > 1) {
      const outgoing = this.stack.pop();
      outgoing?.exit?.();
      const current = this.current;
      if (current !== null) this.safeEnter(current);
    }
  }

  /** enter() must not leave the manager stuck in fadeOut forever. */
  private safeEnter(scene: Scene): void {
    try {
      scene.enter?.();
    } catch (err) {
      console.error('[apex] scene.enter failed', err);
    }
  }
}
