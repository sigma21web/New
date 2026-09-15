/**
 * Human-readable rendering of a contrast regression report. The machine-readable document is the report
 * object itself; this is the concise summary the CLI prints for a reviewer.
 */
import { type ContrastReport } from './runner.js';

export function formatReport(report: ContrastReport): string {
  const t = report.totals;
  const lines: string[] = [];
  lines.push(`contrast regression: ${report.status.toUpperCase()}`);
  lines.push(
    `  corpus        ${t.sets} sets × ${t.variants_per_set} variants × ${t.dimensions_evaluated} dimensions = ${t.evaluations_expected} evaluations`,
  );
  lines.push(
    `  executed      ${t.evaluations_executed} (skipped ${t.evaluations_skipped}); assertions ${t.assertions}, observed-only ${t.not_asserted}`,
  );
  lines.push(
    `  agreement     ${t.agreements}/${t.assertions}; false positives ${t.false_positives}; false negatives ${t.false_negatives}`,
  );
  lines.push(`  corpus hash   ${report.pins.corpus_hash}`);
  lines.push(`  result hash   ${report.result_hash}`);
  lines.push('  by variant class (expected-dimension assertions):');
  for (const [cls, v] of Object.entries(report.by_variant)) {
    lines.push(
      `    ${cls.padEnd(17)} agree ${String(v.agreements).padStart(3)}  FP ${v.false_positives}  FN ${v.false_negatives}  observed-only ${v.not_asserted}`,
    );
  }
  if (report.missing_recordings.length)
    lines.push(`  MISSING RECORDINGS: ${report.missing_recordings.length}`);
  if (report.malformed_verdicts.length)
    lines.push(`  MALFORMED VERDICTS: ${report.malformed_verdicts.length}`);
  for (const d of report.disagreements.slice(0, 10))
    lines.push(`    ! ${d.set_id} ${d.variant}/${d.dimension}: ${d.disagreement ?? ''}`);
  for (const f of report.failures.slice(0, 10)) lines.push(`    ✗ ${f.code}: ${f.detail}`);
  lines.push(
    `  calibration   ${report.calibration_status} — deterministic replay agreement only, not live judge calibration (ADR-0029)`,
  );
  return lines.join('\n');
}
