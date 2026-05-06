import { describe, expect, it } from 'vitest';
import { ManifestError, parseManifestObject } from '../../../src/core/manifest/parse.js';

const baseManifest = {
  type: 'component' as const,
  name: 'demo',
  version: '0.1.0',
};

describe('parseManifestObject — base shape', () => {
  it('accepts the minimal manifest', () => {
    const m = parseManifestObject(baseManifest);
    expect(m.type).toBe('component');
    expect(m.name).toBe('demo');
    expect(m.version).toBe('0.1.0');
    expect(m.prompts).toBeUndefined();
  });

  it('rejects non-semver versions', () => {
    expect(() => parseManifestObject({ ...baseManifest, version: '1.0' })).toThrow(ManifestError);
  });

  it('rejects unknown top-level types', () => {
    expect(() => parseManifestObject({ ...baseManifest, type: 'plugin' })).toThrow(ManifestError);
  });

  it('rejects a non-object root', () => {
    expect(() => parseManifestObject('not a manifest')).toThrow(ManifestError);
  });
});

describe('parseManifestObject — prompts (long form)', () => {
  it('accepts a string prompt', () => {
    const m = parseManifestObject({
      ...baseManifest,
      prompts: [{ project_name: { type: 'string', required: true } }],
    });
    expect(m.prompts).toEqual([{ name: 'project_name', def: { type: 'string', required: true } }]);
  });

  it('accepts an integer prompt with min/max', () => {
    const m = parseManifestObject({
      ...baseManifest,
      prompts: [{ port: { type: 'integer', default: 3000, min: 1, max: 65535 } }],
    });
    expect(m.prompts?.[0]?.def).toMatchObject({
      type: 'integer',
      default: 3000,
      min: 1,
      max: 65535,
    });
  });

  it('accepts a boolean prompt', () => {
    const m = parseManifestObject({
      ...baseManifest,
      prompts: [{ containerize: { type: 'boolean', default: true } }],
    });
    expect(m.prompts?.[0]?.def).toEqual({ type: 'boolean', default: true });
  });

  it('accepts an enum prompt with choices and default', () => {
    const m = parseManifestObject({
      ...baseManifest,
      prompts: [
        {
          license: {
            type: 'enum',
            choices: ['MIT', 'Apache-2.0', 'BSD-3-Clause'],
            default: 'MIT',
          },
        },
      ],
    });
    expect(m.prompts?.[0]?.def).toMatchObject({
      type: 'enum',
      choices: ['MIT', 'Apache-2.0', 'BSD-3-Clause'],
      default: 'MIT',
    });
  });

  it('rejects an enum prompt with empty choices', () => {
    expect(() =>
      parseManifestObject({
        ...baseManifest,
        prompts: [{ license: { type: 'enum', choices: [] } }],
      }),
    ).toThrow(ManifestError);
  });

  it('accepts a multi prompt', () => {
    const m = parseManifestObject({
      ...baseManifest,
      prompts: [{ features: { type: 'multi', choices: ['a', 'b', 'c'], default: ['a'] } }],
    });
    expect(m.prompts?.[0]?.def).toMatchObject({ type: 'multi' });
  });

  it('accepts a password prompt', () => {
    const m = parseManifestObject({
      ...baseManifest,
      prompts: [{ token: { type: 'password' } }],
    });
    expect(m.prompts?.[0]?.def).toEqual({ type: 'password' });
  });

  it('rejects an unknown prompt type', () => {
    expect(() =>
      parseManifestObject({
        ...baseManifest,
        prompts: [{ project_name: { type: 'date' } }],
      }),
    ).toThrow(ManifestError);
  });
});

describe('parseManifestObject — prompts (shorthand)', () => {
  it('desugars an array → enum, first item is default', () => {
    const m = parseManifestObject({
      ...baseManifest,
      prompts: [{ framework: ['react', 'vue', 'svelte'] }],
    });
    expect(m.prompts?.[0]).toEqual({
      name: 'framework',
      def: { type: 'enum', choices: ['react', 'vue', 'svelte'], default: 'react' },
    });
  });

  it('desugars a bare boolean → boolean prompt', () => {
    const m = parseManifestObject({ ...baseManifest, prompts: [{ debug: false }] });
    expect(m.prompts?.[0]).toEqual({
      name: 'debug',
      def: { type: 'boolean', default: false },
    });
  });

  it('desugars a bare number → integer prompt', () => {
    const m = parseManifestObject({ ...baseManifest, prompts: [{ replicas: 3 }] });
    expect(m.prompts?.[0]).toEqual({
      name: 'replicas',
      def: { type: 'integer', default: 3 },
    });
  });

  it('desugars a bare string → string prompt', () => {
    const m = parseManifestObject({ ...baseManifest, prompts: [{ name: 'demo' }] });
    expect(m.prompts?.[0]).toEqual({
      name: 'name',
      def: { type: 'string', default: 'demo' },
    });
  });

  it('rejects empty enum shorthand', () => {
    expect(() => parseManifestObject({ ...baseManifest, prompts: [{ framework: [] }] })).toThrow(
      ManifestError,
    );
  });

  it('rejects a multi-key prompt entry', () => {
    expect(() =>
      parseManifestObject({
        ...baseManifest,
        prompts: [{ a: 'x', b: 'y' }],
      }),
    ).toThrow(ManifestError);
  });
});

describe('parseManifestObject — hooks', () => {
  it('accepts a rename hook', () => {
    const m = parseManifestObject({
      ...baseManifest,
      hooks: { post_render: [{ rename: { from: 'gitignore', to: '.gitignore' } }] },
    });
    expect(m.hooks?.post_render?.[0]).toEqual({
      rename: { from: 'gitignore', to: '.gitignore' },
    });
  });

  it('accepts a delete hook with path', () => {
    const m = parseManifestObject({
      ...baseManifest,
      hooks: { post_render: [{ delete: { path: 'src/legacy.ts' } }] },
    });
    expect(m.hooks?.post_render?.[0]).toEqual({ delete: { path: 'src/legacy.ts' } });
  });

  it('accepts a delete hook with glob and when:', () => {
    const m = parseManifestObject({
      ...baseManifest,
      hooks: {
        post_render: [{ delete: { glob: 'src/examples/**', when: '!include_examples' } }],
      },
    });
    expect(m.hooks?.post_render?.[0]).toEqual({
      delete: { glob: 'src/examples/**', when: '!include_examples' },
    });
  });
});

describe('parseManifestObject — include rules', () => {
  it('accepts a path-based include rule', () => {
    const m = parseManifestObject({
      ...baseManifest,
      include: [{ path: 'Dockerfile', when: 'containerize' }],
    });
    expect(m.include?.[0]).toEqual({ path: 'Dockerfile', when: 'containerize' });
  });

  it('accepts a glob-based include rule', () => {
    const m = parseManifestObject({
      ...baseManifest,
      include: [{ glob: 'src/**/*.vue', when: 'framework == "vue"' }],
    });
    expect(m.include?.[0]).toEqual({ glob: 'src/**/*.vue', when: 'framework == "vue"' });
  });
});

describe('parseManifestObject — sections', () => {
  const promptsFixture = [
    { name: { type: 'string' } },
    { description: { type: 'string', default: '' } },
    { license: { type: 'enum', choices: ['MIT', 'Apache-2.0'], default: 'MIT' } },
  ];

  it('accepts a manifest with sections covering every prompt', () => {
    const m = parseManifestObject({
      ...baseManifest,
      prompts: promptsFixture,
      sections: [
        { title: 'Basics', prompts: ['name', 'description'] },
        { title: 'Licence', prompts: ['license'] },
      ],
    });
    expect(m.sections).toHaveLength(2);
    expect(m.sections?.[0]?.title).toBe('Basics');
  });

  it('accepts a manifest without sections (flat list still works)', () => {
    const m = parseManifestObject({ ...baseManifest, prompts: promptsFixture });
    expect(m.sections).toBeUndefined();
  });

  it('rejects a section that references an unknown prompt', () => {
    expect(() =>
      parseManifestObject({
        ...baseManifest,
        prompts: promptsFixture,
        sections: [
          { title: 'Basics', prompts: ['name', 'ghost'] },
          { title: 'Licence', prompts: ['description', 'license'] },
        ],
      }),
    ).toThrow(ManifestError);
  });

  it('rejects an orphan prompt when sections are declared', () => {
    expect(() =>
      parseManifestObject({
        ...baseManifest,
        prompts: promptsFixture,
        sections: [{ title: 'Basics', prompts: ['name', 'description'] }],
      }),
    ).toThrow(/license.*not assigned/);
  });

  it('rejects a prompt mentioned in two sections', () => {
    expect(() =>
      parseManifestObject({
        ...baseManifest,
        prompts: promptsFixture,
        sections: [
          { title: 'A', prompts: ['name', 'description'] },
          { title: 'B', prompts: ['description', 'license'] },
        ],
      }),
    ).toThrow(/multiple sections/);
  });

  it('rejects a section with no prompts (zod min(1))', () => {
    expect(() =>
      parseManifestObject({
        ...baseManifest,
        prompts: promptsFixture,
        sections: [
          { title: 'Empty', prompts: [] },
          { title: 'Rest', prompts: ['name', 'description', 'license'] },
        ],
      }),
    ).toThrow(ManifestError);
  });
});

describe('parseManifestObject — setup', () => {
  it('accepts a manifest with setup.message and setup.tasks', () => {
    const m = parseManifestObject({
      ...baseManifest,
      setup: {
        message: 'A few things to wire up:',
        tasks: [
          { id: 'install-deps', title: 'Install dependencies', detail: 'npm install' },
          { id: 'push-to-github', title: 'Push to GitHub for first deploy' },
        ],
      },
    });
    expect(m.setup?.message).toBe('A few things to wire up:');
    expect(m.setup?.tasks).toHaveLength(2);
    expect(m.setup?.tasks?.[0]).toEqual({
      id: 'install-deps',
      title: 'Install dependencies',
      detail: 'npm install',
    });
    expect(m.setup?.tasks?.[1]?.detail).toBeUndefined();
  });

  it('accepts a setup block with only a message', () => {
    const m = parseManifestObject({
      ...baseManifest,
      setup: { message: 'all yours' },
    });
    expect(m.setup?.message).toBe('all yours');
    expect(m.setup?.tasks).toBeUndefined();
  });

  it('treats an absent setup block as undefined', () => {
    const m = parseManifestObject(baseManifest);
    expect(m.setup).toBeUndefined();
  });

  it('rejects a task id that is not kebab-case', () => {
    expect(() =>
      parseManifestObject({
        ...baseManifest,
        setup: { tasks: [{ id: 'Install_Deps', title: 'Install' }] },
      }),
    ).toThrow(/kebab-case/);
  });

  it('rejects a task id with leading/trailing dashes', () => {
    expect(() =>
      parseManifestObject({
        ...baseManifest,
        setup: { tasks: [{ id: '-bad', title: 'x' }] },
      }),
    ).toThrow(/kebab-case/);
  });

  it('rejects duplicate task ids', () => {
    expect(() =>
      parseManifestObject({
        ...baseManifest,
        setup: {
          tasks: [
            { id: 'one', title: 'A' },
            { id: 'one', title: 'B' },
          ],
        },
      }),
    ).toThrow(/appears more than once/);
  });

  it('rejects a task with an empty title', () => {
    expect(() =>
      parseManifestObject({
        ...baseManifest,
        setup: { tasks: [{ id: 'ok', title: '' }] },
      }),
    ).toThrow(ManifestError);
  });
});
