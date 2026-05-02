import { describe, expect, it } from 'vitest';
import type { Prompt, Section } from '../../../src/core/manifest/types.js';
import { SectionPlanError, planSections } from '../../../src/core/prompts/sections.js';

const prompts: Prompt[] = [
  { name: 'a', def: { type: 'string' } },
  { name: 'b', def: { type: 'string' } },
  { name: 'c', def: { type: 'string' } },
];

describe('planSections', () => {
  it('returns one null-titled plan when no sections are given', () => {
    const plans = planSections(prompts);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.title).toBeNull();
    expect(plans[0]?.prompts).toEqual(prompts);
  });

  it('returns one null-titled plan when sections is empty', () => {
    const plans = planSections(prompts, []);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.title).toBeNull();
  });

  it('groups prompts by section in declared order', () => {
    const sections: Section[] = [
      { title: 'First', prompts: ['a', 'c'] },
      { title: 'Second', prompts: ['b'] },
    ];
    const plans = planSections(prompts, sections);
    expect(plans).toHaveLength(2);
    expect(plans[0]?.title).toBe('First');
    expect(plans[0]?.prompts.map((p) => p.name)).toEqual(['a', 'c']);
    expect(plans[1]?.title).toBe('Second');
    expect(plans[1]?.prompts.map((p) => p.name)).toEqual(['b']);
  });

  it('throws when a section references an unknown prompt', () => {
    expect(() => planSections(prompts, [{ title: 'X', prompts: ['a', 'ghost'] }])).toThrow(
      SectionPlanError,
    );
  });

  it('throws when a prompt is mentioned in two sections', () => {
    expect(() =>
      planSections(prompts, [
        { title: 'X', prompts: ['a', 'b'] },
        { title: 'Y', prompts: ['b', 'c'] },
      ]),
    ).toThrow(SectionPlanError);
  });

  it('throws when a prompt is not assigned to any section', () => {
    expect(() => planSections(prompts, [{ title: 'X', prompts: ['a', 'b'] }])).toThrow(
      /prompt "c" is not assigned/,
    );
  });
});
