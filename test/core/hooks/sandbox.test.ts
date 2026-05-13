import { describe, expect, it } from 'vitest';
import { SandboxError, createSandbox } from '../../../src/core/hooks/sandbox.js';

describe('createSandbox', () => {
  it('evaluates a no-op script and returns undefined', async () => {
    const sandbox = await createSandbox();
    try {
      expect(sandbox.runScript('undefined')).toBeUndefined();
    } finally {
      sandbox.dispose();
    }
  });

  it('returns primitive values from evaluated scripts', async () => {
    const sandbox = await createSandbox();
    try {
      expect(sandbox.runScript('1 + 1')).toBe(2);
      expect(sandbox.runScript('"hello"')).toBe('hello');
      expect(sandbox.runScript('true')).toBe(true);
    } finally {
      sandbox.dispose();
    }
  });

  it('returns plain object literals via dump', async () => {
    const sandbox = await createSandbox();
    try {
      expect(sandbox.runScript('({ a: 1, b: [2, 3] })')).toEqual({ a: 1, b: [2, 3] });
    } finally {
      sandbox.dispose();
    }
  });

  it('exposes no Node primitives inside the sandbox', async () => {
    const sandbox = await createSandbox();
    try {
      expect(sandbox.runScript('typeof require')).toBe('undefined');
      expect(sandbox.runScript('typeof process')).toBe('undefined');
      expect(sandbox.runScript('typeof globalThis.fs')).toBe('undefined');
    } finally {
      sandbox.dispose();
    }
  });

  it('throws SandboxError when the script throws', async () => {
    const sandbox = await createSandbox();
    try {
      expect(() => sandbox.runScript('throw new Error("boom")')).toThrow(SandboxError);
      expect(() => sandbox.runScript('throw new Error("boom")')).toThrow(/boom/);
    } finally {
      sandbox.dispose();
    }
  });

  it('remains usable after a script throws', async () => {
    const sandbox = await createSandbox();
    try {
      expect(() => sandbox.runScript('throw new Error("first")')).toThrow(SandboxError);
      expect(sandbox.runScript('1 + 1')).toBe(2);
    } finally {
      sandbox.dispose();
    }
  });

  it('runs many scripts within a single sandbox lifecycle', async () => {
    const sandbox = await createSandbox();
    try {
      for (let i = 0; i < 10; i += 1) {
        expect(sandbox.runScript(`${i} * 2`)).toBe(i * 2);
      }
    } finally {
      sandbox.dispose();
    }
  });

  it('trips the CPU budget on a tight loop', async () => {
    const sandbox = await createSandbox({ cpuMs: 50 });
    try {
      expect(() => sandbox.runScript('while (true) {}')).toThrow(SandboxError);
    } finally {
      sandbox.dispose();
    }
  });

  it('trips the memory limit on an unbounded allocation', async () => {
    const sandbox = await createSandbox({ memoryBytes: 1 * 1024 * 1024 });
    try {
      expect(() =>
        sandbox.runScript('const a = []; while (true) { a.push(new Array(10000).fill(0)); }'),
      ).toThrow(SandboxError);
    } finally {
      sandbox.dispose();
    }
  });

  it('rejects further runScript calls after dispose', async () => {
    const sandbox = await createSandbox();
    sandbox.dispose();
    expect(() => sandbox.runScript('1')).toThrow(/disposed/);
  });

  it('is safe to dispose twice', async () => {
    const sandbox = await createSandbox();
    sandbox.dispose();
    expect(() => sandbox.dispose()).not.toThrow();
  });

  it('supports dispose-then-re-init for fresh isolated runtimes', async () => {
    const first = await createSandbox();
    first.runScript('globalThis.leaked = 42');
    first.dispose();

    const second = await createSandbox();
    try {
      expect(second.runScript('typeof globalThis.leaked')).toBe('undefined');
    } finally {
      second.dispose();
    }
  });

  it('resets the CPU deadline between calls so long-lived sandboxes do not trip on cumulative time', async () => {
    const sandbox = await createSandbox({ cpuMs: 1_000 });
    try {
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(sandbox.runScript('1 + 1')).toBe(2);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(sandbox.runScript('2 + 2')).toBe(4);
    } finally {
      sandbox.dispose();
    }
  });
});
