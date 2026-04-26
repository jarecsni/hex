import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { brand } from './brand/colors.js';
import { VERSION } from './brand/splash.js';

const PKG_NAME = '@hexology/hex';
const REGISTRY = 'https://registry.npmjs.org';
const FETCH_TIMEOUT_MS = 2000;

export async function maybeUpdate(): Promise<void> {
  if (!shouldCheck()) return;

  const latest = await fetchLatestVersion();
  if (!latest || compareVersions(latest, VERSION) <= 0) return;

  console.log(
    `${brand.honey('▲')} hex ${brand.bold(latest)} is available — you have ${brand.dim(VERSION)}.`,
  );
  const yes = await confirm('Update now?');
  if (!yes) return;

  const ok = await runInstall();
  if (!ok) {
    console.error(brand.error('Update failed. Continuing with current version.'));
    return;
  }

  await relaunch();
}

function shouldCheck(): boolean {
  if (process.env.HEX_NO_UPDATE_CHECK === '1') return false;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  return true;
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(`${REGISTRY}/${PKG_NAME}/latest`, {
      signal: ctrl.signal,
      headers: { 'User-Agent': `hex/${VERSION}`, accept: 'application/json' },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} (y/N) `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

function runInstall(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('npm', ['i', '-g', `${PKG_NAME}@latest`], {
      stdio: 'inherit',
      shell: false,
    });
    child.on('exit', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

function relaunch(): Promise<never> {
  const args = process.argv.slice(2);
  return new Promise<never>((_, reject) => {
    const child = spawn('hex', args, { stdio: 'inherit', shell: false });
    child.on('exit', (code) => process.exit(code ?? 0));
    child.on('error', reject);
  });
}
