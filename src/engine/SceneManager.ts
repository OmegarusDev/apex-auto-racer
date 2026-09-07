export interface Scene {
  enter?(): void;
  exit?(): void;
  update(dt: number): void;
  render(ctx: CanvasRenderingContext2D, w: number, h: number): void;
  onResize?(w: number, h: number): void;
  handleBack?(): boolean;
  /** When true, launchRace replaces this scene instead of pushing (avoids stacking Results). */
  raceLaunchReplace?: boolean;
}

interface PendingNav {
  action: 'push' | 'replace' | 'back' | 'replaceRoot';
  scene?: Scene;
}

/**
 * Instant scene hops. A full-screen fade to black on every tap read as the
 * game refreshing; menus just swap.
 */
export class SceneManager {
  private stack: Scene[] = [];
  private pending: PendingNav | null = null;
  private navLock = false;

  get current(): Scene | null {
    if (this.stack.length === 0) return null;
    return this.stack[this.stack.length - 1] ?? null;
  }

  get depth(): number {
    return this.stack.length;
  }

  push(scene: Scene): void {
    this.enqueue({ action: 'push', scene });
  }

  replace(scene: Scene): void {
    this.enqueue({ action: 'replace', scene });
  }

  /** Drop the entire stack and land on one scene (New Career, Results → Title). */
  replaceRoot(scene: Scene): void {
    this.enqueue({ action: 'replaceRoot', scene });
  }

  back(): void {
    if (this.stack.length <= 1 && this.pending === null) return;
    this.enqueue({ action: 'back' });
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
    this.current?.update(dt);
  }

  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    this.current?.render(ctx, w, h);
  }

  private enqueue(nav: PendingNav): void {
    if (this.navLock) {
      this.pending = nav;
      return;
    }
    this.commitNow(nav);
  }

  private commitNow(nav: PendingNav): void {
    this.navLock = true;
    this.apply(nav);
    this.navLock = false;
    while (this.pending !== null) {
      const next = this.pending;
      this.pending = null;
      this.navLock = true;
      this.apply(next);
      this.navLock = false;
    }
  }

  private apply(nav: PendingNav): void {
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

    if (nav.action === 'replaceRoot' && nav.scene !== undefined) {
      while (this.stack.length > 0) {
        const outgoing = this.stack.pop();
        outgoing?.exit?.();
      }
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

  /** enter() must not recurse into another nav without the lock. */
  private safeEnter(scene: Scene): void {
    try {
      scene.enter?.();
    } catch (err) {
      console.error('[apex] scene.enter failed', err);
    }
  }
}
