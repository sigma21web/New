/**
 * `pnpm validate:contrast` — the deterministic contrast regression entry point.
 *
 * Runs from a clean checkout, needs no credentials and makes no network call: every judge response comes
 * from a generated deterministic recording through ReplayProvider, which refuses any unrecorded prompt.
 * Exits 0 only when the whole regression passes. `--json` emits the machine-readable document for CI.
 */
import { formatReport } from './report.js';
import { runContrastRegression } from './runner.js';
import { CorpusError } from './corpus.js';

async function main(): Promise<void> {
  const json = process.argv.includes('--json');
  try {
    const report = await runContrastRegression();
    if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else process.stdout.write(`${formatReport(report)}\n`);
    process.exitCode = report.status === 'passed' ? 0 : 1;
  } catch (err) {
    // A corpus that cannot be loaded or validated is a failure, never an empty pass.
    const message = err instanceof CorpusError ? `${err.code}: ${err.detail}` : String(err);
    process.stderr.write(`contrast regression: FAILED\n  ${message}\n`);
    process.exitCode = 1;
  }
}

await main();
