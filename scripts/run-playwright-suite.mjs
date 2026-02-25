#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

const projectRoot = process.cwd();
const testsDir = path.resolve(projectRoot, 'tests/e2e');

dotenv.config({ path: path.resolve(projectRoot, '.env.test'), override: true });

const args = process.argv.slice(2);
const requestedSpecs = args.filter((arg) => !arg.startsWith('--'));

const listFlag = args.includes('--list');

const allSpecs = readdirSync(testsDir)
  .map((entry) => ({ entry, fullPath: path.join(testsDir, entry) }))
  .filter(({ entry, fullPath }) => entry.endsWith('.spec.ts') && statSync(fullPath).isFile())
  .map(({ entry }) => path.join('tests/e2e', entry))
  .sort();

if (listFlag) {
  for (const spec of allSpecs) {
    process.stdout.write(`${spec}\n`);
  }
  process.exit(0);
}

const specsToRun = requestedSpecs.length > 0 ? requestedSpecs : allSpecs;

if (specsToRun.length === 0) {
  process.stderr.write('No specs to run.\n');
  process.exit(1);
}

const env = {
  ...process.env,
  PLAYWRIGHT_BROWSERS_PATH: path.resolve(projectRoot, '.playwright-browsers'),
  LD_LIBRARY_PATH: [
    '/usr/lib/x86_64-linux-gnu',
    '/lib/x86_64-linux-gnu',
    path.resolve(projectRoot, '.playwright-browsers', 'chromium_headless_shell-1208', 'chrome-headless-shell-linux64'),
    process.env.LD_LIBRARY_PATH ?? '',
  ]
    .filter(Boolean)
    .join(':'),
};

const runSpec = (spec) =>
  new Promise((resolve, reject) => {
    process.stdout.write(`\n=== Running ${spec} ===\n`);
    const child = spawn('pnpm', ['exec', 'playwright', 'test', spec, '--reporter=line', '--workers=1'], {
      stdio: 'inherit',
      env,
    });

    const keepalive = setInterval(() => {
      process.stdout.write(`[keepalive] ${new Date().toISOString()} ${spec}\n`);
    }, 5000);

    child.on('exit', (code, signal) => {
      clearInterval(keepalive);
      if (signal) {
        reject(new Error(`Spec ${spec} exited via signal ${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`Spec ${spec} failed with exit code ${code}`));
        return;
      }
      resolve();
    });
  });

const run = async () => {
  for (const spec of specsToRun) {
    await runSpec(spec);
  }
  process.stdout.write('\nAll requested Playwright specs passed.\n');
};

run().catch((error) => {
  process.stderr.write(`\n${error.message}\n`);
  process.exit(1);
});
