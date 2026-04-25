import pc from 'picocolors';

export const brand = {
  honey: (s: string) => pc.yellow(s),
  honeyBold: (s: string) => pc.bold(pc.yellow(s)),
  done: (s: string) => pc.green(s),
  pending: (s: string) => pc.dim(s),
  error: (s: string) => pc.red(s),
  warn: (s: string) => pc.yellow(s),
  dim: (s: string) => pc.dim(s),
  bold: (s: string) => pc.bold(s),
};
