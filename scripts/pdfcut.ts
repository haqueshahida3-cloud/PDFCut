#!/usr/bin/env node
// Development entry for the command line: `npm run cli -- split input.pdf --pages 1-5 -o out.pdf`.
// The packaged app bundles src/cli/run.ts into dist-electron/cli.cjs instead.
import { runCli } from '../src/cli/run';

runCli(process.argv.slice(2), { version: 'dev' }).then((code) => {
  process.exitCode = code;
});
