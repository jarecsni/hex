import { z } from 'zod';

const promptCommon = {
  description: z.string().optional(),
  required: z.boolean().optional(),
  when: z.string().optional(),
};

const stringPromptSchema = z.object({
  type: z.literal('string'),
  default: z.string().optional(),
  pattern: z.string().optional(),
  ...promptCommon,
});

const integerPromptSchema = z.object({
  type: z.union([z.literal('integer'), z.literal('number')]),
  default: z.number().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  ...promptCommon,
});

const booleanPromptSchema = z.object({
  type: z.literal('boolean'),
  default: z.boolean().optional(),
  ...promptCommon,
});

const enumPromptSchema = z.object({
  type: z.literal('enum'),
  choices: z.array(z.string()).min(1),
  default: z.string().optional(),
  ...promptCommon,
});

const multiPromptSchema = z.object({
  type: z.literal('multi'),
  choices: z.array(z.string()).min(1),
  default: z.array(z.string()).optional(),
  ...promptCommon,
});

const passwordPromptSchema = z.object({
  type: z.literal('password'),
  ...promptCommon,
});

const pathPromptSchema = z.object({
  type: z.literal('path'),
  default: z.string().optional(),
  must_exist: z.boolean().optional(),
  ...promptCommon,
});

export const promptDefSchema = z.discriminatedUnion('type', [
  stringPromptSchema,
  integerPromptSchema,
  booleanPromptSchema,
  enumPromptSchema,
  multiPromptSchema,
  passwordPromptSchema,
  pathPromptSchema,
]);

export const renameHookSchema = z.object({
  rename: z.object({
    from: z.string().min(1),
    to: z.string().min(1),
    when: z.string().optional(),
  }),
});

export const deleteHookSchema = z.object({
  delete: z
    .union([
      z.object({ path: z.string().min(1), when: z.string().optional() }),
      z.object({ glob: z.string().min(1), when: z.string().optional() }),
    ])
    .refine((v) => ('path' in v ? !('glob' in v) : 'glob' in v), {
      message: 'delete hook must specify exactly one of path or glob',
    }),
});

const postRenderHookSchema = z.union([renameHookSchema, deleteHookSchema]);

export const hooksSchema = z.object({
  post_render: z.array(postRenderHookSchema).optional(),
});

export const includeRuleSchema = z
  .union([
    z.object({ path: z.string().min(1), when: z.string().min(1) }),
    z.object({ glob: z.string().min(1), when: z.string().min(1) }),
  ])
  .refine((v) => ('path' in v ? !('glob' in v) : 'glob' in v), {
    message: 'include rule must specify exactly one of path or glob',
  });

export const sectionSchema = z.object({
  title: z.string().min(1),
  prompts: z.array(z.string().min(1)).min(1),
});

const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+].*)?$/;

export const TASK_ID_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export const setupTaskSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(TASK_ID_RE, 'task id must be kebab-case ([a-z0-9-], no leading/trailing dash)'),
  title: z.string().min(1),
  detail: z.string().optional(),
});

export const setupSchema = z.object({
  message: z.string().min(1).optional(),
  tasks: z.array(setupTaskSchema).optional(),
});

// Manifest schema with prompts already desugared (each entry { name, def }).
// `sections:` opts the manifest into total coverage — every prompt must
// appear in exactly one section, and section entries must reference real
// prompts. The check fires here (not at engine time) so authoring mistakes
// surface as parse errors with file paths.
export const manifestSchema = z
  .object({
    type: z.union([z.literal('component'), z.literal('recipe')]),
    name: z.string().min(1),
    version: z.string().regex(SEMVER_RE, 'version must be semver (MAJOR.MINOR.PATCH)'),
    kind: z.string().optional(),
    prompts: z
      .array(
        z.object({
          name: z.string().min(1),
          def: promptDefSchema,
        }),
      )
      .optional(),
    sections: z.array(sectionSchema).optional(),
    hooks: hooksSchema.optional(),
    include: z.array(includeRuleSchema).optional(),
    setup: setupSchema.optional(),
  })
  .superRefine((manifest, ctx) => {
    if (manifest.setup?.tasks) {
      const seenIds = new Map<string, number>();
      manifest.setup.tasks.forEach((task, idx) => {
        const previous = seenIds.get(task.id);
        if (previous !== undefined) {
          ctx.addIssue({
            code: 'custom',
            path: ['setup', 'tasks', idx, 'id'],
            message: `setup task id "${task.id}" appears more than once (also at index ${previous})`,
          });
          return;
        }
        seenIds.set(task.id, idx);
      });
    }

    if (!manifest.sections) return;

    const promptNames = new Set((manifest.prompts ?? []).map((p) => p.name));
    const seen = new Map<string, number>(); // name → section index

    manifest.sections.forEach((section, sIdx) => {
      section.prompts.forEach((promptName, pIdx) => {
        if (!promptNames.has(promptName)) {
          ctx.addIssue({
            code: 'custom',
            path: ['sections', sIdx, 'prompts', pIdx],
            message: `section "${section.title}" references unknown prompt "${promptName}"`,
          });
          return;
        }
        const previous = seen.get(promptName);
        if (previous !== undefined) {
          ctx.addIssue({
            code: 'custom',
            path: ['sections', sIdx, 'prompts', pIdx],
            message: `prompt "${promptName}" appears in multiple sections (also in section ${previous})`,
          });
          return;
        }
        seen.set(promptName, sIdx);
      });
    });

    for (const name of promptNames) {
      if (!seen.has(name)) {
        ctx.addIssue({
          code: 'custom',
          path: ['sections'],
          message: `prompt "${name}" is not assigned to any section`,
        });
      }
    }
  });
