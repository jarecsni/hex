import { z } from 'zod';

const pathSourceSchema = z.object({
  path: z.string().min(1),
});

const gitSourceSchema = z.object({
  git: z.string().min(1),
  ref: z.string().min(1).optional(),
});

export const sourceRootSchema = z.union([pathSourceSchema, gitSourceSchema]);

export const hexConfigSchema = z.object({
  sources: z.array(sourceRootSchema).default([]),
});
