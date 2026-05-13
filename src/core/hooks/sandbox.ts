import {
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSRuntime,
  type QuickJSWASMModule,
  getQuickJS,
  shouldInterruptAfterDeadline,
} from 'quickjs-emscripten';
import { type ProjectFs, ProjectFsError } from './project-fs.js';

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

  /**
   * Install a JS value as a top-level global inside the sandbox.
   *
   * Used by the hook runner to surface `answers`, `recipe`, and other
   * read-only context objects to hook code. The value is marshalled
   * via {@link marshal} — strings, numbers, booleans, null/undefined,
   * arrays, and plain objects (recursive) are supported.
   */
  installGlobal(name: string, value: unknown): void {
    if (this.disposed) {
      throw new SandboxError('Sandbox has been disposed');
    }
    const handle = marshal(this.context, value);
    this.context.setProp(this.context.global, name, handle);
    handle.dispose();
  }

  /**
   * Install a `<name>.<method>` host-function namespace. Each method is
   * bridged so its arguments are dumped to JS values and the return
   * value is marshalled back. Errors thrown by the host functions
   * surface inside the hook as catchable JS errors.
   */
  installHostObject(name: string, methods: Record<string, (...args: unknown[]) => unknown>): void {
    if (this.disposed) {
      throw new SandboxError('Sandbox has been disposed');
    }
    const ctx = this.context;
    const obj = ctx.newObject();
    for (const [methodName, impl] of Object.entries(methods)) {
      const handle = ctx.newFunction(methodName, (...argHandles) => {
        const args = argHandles.map((h) => ctx.dump(h));
        try {
          const result = impl(...args);
          return marshal(ctx, result);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const errName = err instanceof Error && err.name ? err.name : 'Error';
          return { error: ctx.newError({ name: errName, message }) };
        }
      });
      ctx.setProp(obj, methodName, handle);
      handle.dispose();
    }
    ctx.setProp(ctx.global, name, obj);
    obj.dispose();
  }

  /**
   * Install a sandboxed `project.*` API into the sandbox's globalThis.
   *
   * Exposes `read`, `write`, `delete`, `exists`, and `list` as host functions
   * that call through to {@link ProjectFs}. Path-traversal and symlink-escape
   * rejections surface inside the hook as thrown JS errors with usable
   * messages, not as silent failures.
   *
   * Safe to call once per sandbox. Calling twice replaces the previous
   * `project` global.
   */
  installProjectFs(fs: ProjectFs): void {
    if (this.disposed) {
      throw new SandboxError('Sandbox has been disposed');
    }

    const ctx = this.context;
    const projectObj = ctx.newObject();

    const bind = (
      name: 'read' | 'write' | 'delete' | 'exists' | 'list',
      impl: (args: unknown[]) => unknown,
    ): void => {
      const handle = ctx.newFunction(name, (...argHandles) => {
        const args = argHandles.map((h) => ctx.dump(h));
        try {
          const result = impl(args);
          return marshal(ctx, result);
        } catch (err) {
          const message =
            err instanceof ProjectFsError || err instanceof Error ? err.message : String(err);
          const name_ = err instanceof Error && typeof err.name === 'string' ? err.name : 'Error';
          return { error: ctx.newError({ name: name_, message }) };
        }
      });
      ctx.setProp(projectObj, name, handle);
      handle.dispose();
    };

    bind('read', (args) => fs.read(args[0] as string));
    bind('write', (args) => {
      fs.write(args[0] as string, args[1] as string);
      return undefined;
    });
    bind('delete', (args) => {
      fs.delete(args[0] as string);
      return undefined;
    });
    bind('exists', (args) => fs.exists(args[0] as string));
    bind('list', (args) => fs.list(args[0] as string));

    ctx.setProp(ctx.global, 'project', projectObj);
    projectObj.dispose();
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

function marshal(ctx: QuickJSContext, value: unknown): QuickJSHandle {
  if (value === undefined) {
    return ctx.undefined;
  }
  if (value === null) {
    return ctx.null;
  }
  if (typeof value === 'string') {
    return ctx.newString(value);
  }
  if (typeof value === 'number') {
    return ctx.newNumber(value);
  }
  if (typeof value === 'boolean') {
    return value ? ctx.true : ctx.false;
  }
  if (Array.isArray(value)) {
    const arr = ctx.newArray();
    for (let i = 0; i < value.length; i += 1) {
      const elem = marshal(ctx, value[i]);
      ctx.setProp(arr, i, elem);
      elem.dispose();
    }
    return arr;
  }
  if (typeof value === 'object') {
    const obj = ctx.newObject();
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const prop = marshal(ctx, v);
      ctx.setProp(obj, key, prop);
      prop.dispose();
    }
    return obj;
  }
  throw new SandboxError(`cannot marshal value of type ${typeof value} into sandbox`);
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
