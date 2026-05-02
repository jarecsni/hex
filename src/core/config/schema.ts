import { z } from 'zod';

export const sourceRootSchema = z.object({
  path: z.string().min(1),
});

export const hexConfigSchema = z.object({
  sources: z.array(sourceRootSchema).default([]),
});
