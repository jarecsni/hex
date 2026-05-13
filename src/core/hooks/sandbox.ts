import {
  type QuickJSContext,
  type QuickJSRuntime,
  type QuickJSWASMModule,
  getQuickJS,
  shouldInterruptAfterDeadline,
} from 'quickjs-emscripten';

export class SandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxError';
  }
}

export type SandboxLimits = {
  /** Hard memory ceiling for the runtime, in bytes. Default 32 MiB. */
  memoryBytes?: number;
  /** Wall-clock budget for a single `runScript` call, in ms. Default 5000. */
  cpuMs?: number;
};

const DEFAULT_MEMORY_BYTES = 32 * 1024 * 1024;
const DEFAULT_CPU_MS = 5_000;

let cachedModule: QuickJSWASMModule | undefined;

async function loadModule(): Promise<QuickJSWASMModule> {
  if (!cachedModule) {
    cachedModule = await getQuickJS();
  }
  return cachedModule;
}

/**
 * A QuickJS-WASM execution environment for a single `hex` invocation.
 *
 * Hooks run inside an embedded WebAssembly VM — they share no Node primitives
 * with the host (no `fs`, `process`, `child_process`, `require`). The only
 * surface they can touch is what later milestones (M7.2+) explicitly bridge
 * in via host-injected functions.
 *
 * Lifecycle:
 * - `createSandbox()` returns a ready-to-use instance.
 * - `runScript()` may be called many times; the CPU deadline is reset per
 *   call so a long-lived sandbox doesn't trip on cumulative wall-clock time.
 * - `dispose()` tears down the QuickJS runtime + context. A disposed sandbox
 *   rejects further `runScript` calls; create a new one to re-init.
 */
export class Sandbox {
  private disposed = false;

  constructor(
    private readonly runtime: QuickJSRuntime,
    private readonly context: QuickJSContext,
    private readonly cpuMs: number,
  ) {}

  /**
   * Evaluate JS source inside the sandbox and return the dumped result.
   *
   * The CPU interrupt handler is (re)installed on every call so each script
   * gets its own wall-clock budget — see `cpuMs` in `SandboxLimits`.
   *
   * Throws `SandboxError` if the script throws, exceeds the CPU budget, or
   * exhausts the memory limit. The sandbox itself remains usable after a
   * thrown error.
   */
  runScript(source: string, filename = 'hook.js'): unknown {
    if (this.disposed) {
      throw new SandboxError('Sandbox has been disposed');
    }
    this.runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + this.cpuMs));
    const result = this.context.evalCode(source, filename);
    if (result.error) {
      const dumped = this.context.dump(result.error);
      result.error.dispose();
      throw new SandboxError(formatError(dumped));
    }
    const value = this.context.dump(result.value);
    result.value.dispose();
    return value;
  }

  dispose(): void {
    if (this.disposed) return;
    this.context.dispose();
    this.runtime.dispose();
    this.disposed = true;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }
}

/**
 * Initialise a sandbox. The underlying QuickJS-WASM module is loaded lazily
 * and shared across sandboxes within a single Node process, but each call
 * here creates a fresh runtime + context so failures in one sandbox cannot
 * contaminate another.
 */
export async function createSandbox(limits: SandboxLimits = {}): Promise<Sandbox> {
  const module = await loadModule();
  const runtime = module.newRuntime();
  runtime.setMemoryLimit(limits.memoryBytes ?? DEFAULT_MEMORY_BYTES);
  const context = runtime.newContext();
  return new Sandbox(runtime, context, limits.cpuMs ?? DEFAULT_CPU_MS);
}

function formatError(value: unknown): string {
  if (value && typeof value === 'object') {
    const e = value as { name?: unknown; message?: unknown };
    const name = typeof e.name === 'string' ? e.name : 'Error';
    const message = typeof e.message === 'string' ? e.message : '';
    return message ? `${name}: ${message}` : name;
  }
  return String(value);
}
