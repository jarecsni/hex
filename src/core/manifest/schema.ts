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

const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+].*)?$/;

// Manifest schema with prompts already desugared (each entry { name, def }).
export const manifestSchema = z.object({
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
  hooks: hooksSchema.optional(),
  include: z.array(includeRuleSchema).optional(),
});
