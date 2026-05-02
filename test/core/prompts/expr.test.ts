import { describe, expect, it } from 'vitest';
import { evalWhen } from '../../../src/core/prompts/expr.js';

describe('evalWhen', () => {
  it('treats truthy variables as true', () => {
    expect(evalWhen('containerize', { containerize: true })).toBe(true);
    expect(evalWhen('containerize', { containerize: false })).toBe(false);
  });

  it('handles negation with `not`', () => {
    expect(evalWhen('not debug', { debug: false })).toBe(true);
    expect(evalWhen('not debug', { debug: true })).toBe(false);
  });

  it('handles equality comparisons', () => {
    expect(evalWhen('framework == "react"', { framework: 'react' })).toBe(true);
    expect(evalWhen('framework == "react"', { framework: 'vue' })).toBe(false);
  });

  it('handles membership', () => {
    expect(evalWhen('framework in ["react", "vue"]', { framework: 'react' })).toBe(true);
    expect(evalWhen('framework in ["react", "vue"]', { framework: 'svelte' })).toBe(false);
  });

  it('returns false for undefined references when used as plain truthy check', () => {
    expect(evalWhen('missing', {})).toBe(false);
  });

  it('throws on syntactically invalid expressions', () => {
    expect(() => evalWhen('framework ===== "react"', { framework: 'react' })).toThrow();
  });
});
