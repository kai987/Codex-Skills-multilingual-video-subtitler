import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const requiredOfflineTests = [
  [
    "tests/e2e/c5-17-2-review-delivery-flow.test.ts",
    "repairs a C5.17.1-like seven-item task and fails closed on delivery corruption",
  ],
  [
    "tests/e2e/c6-0-protected-finalization-flow.test.ts",
    "observes legacy output, then materializes only verified-human preservation",
  ],
  [
    "tests/e2e/c6-0-protected-finalization-flow.test.ts",
    "keeps the authority-negative control fail closed without a final package",
  ],
];

export const optionalModelTests = [
  [
    "tests/e2e/c5-17-forced-alignment-flow.test.ts",
    "runs one bounded real align_one attempt and parses word/phone tiers",
  ],
  [
    "tests/c5-18-speaker-runtime.test.ts",
    "runs real Community-1 inference only when explicitly enabled",
  ],
];

export function verifyOfflineTestReport(report) {
  assert.equal(report.success, true, "Vitest must finish successfully");
  assert.equal(report.numFailedTests, 0);
  assert.equal(report.numFailedTestSuites, 0);
  assert.equal(report.numTodoTests, 0);
  assert(Array.isArray(report.testResults), "Missing Vitest test results");
  const required = new Set();
  const optional = new Set();
  let passed = 0;
  for (const file of report.testResults) {
    const name = file.name.replaceAll("\\", "/");
    for (const result of file.assertionResults) {
      const matches = ([target, title]) =>
        (name === target || name.endsWith(`/${target}`)) &&
        result.title === title;
      const requiredIndex = requiredOfflineTests.findIndex(matches);
      const optionalIndex = optionalModelTests.findIndex(matches);
      const label = `${name}: ${result.title}`;
      if (optionalIndex !== -1) {
        assert(
          ["pending", "skipped"].includes(result.status),
          `Real-model test must remain disabled: ${label}`,
        );
        assert(!optional.has(optionalIndex), `Duplicate model test: ${label}`);
        optional.add(optionalIndex);
        continue;
      }
      assert.equal(
        result.status,
        "passed",
        `Offline test did not pass: ${label}`,
      );
      passed += 1;
      if (requiredIndex !== -1) {
        assert(
          !required.has(requiredIndex),
          `Duplicate required test: ${label}`,
        );
        required.add(requiredIndex);
      }
    }
  }
  assert.equal(
    required.size,
    3,
    "All three synthetic end-to-end tests must run",
  );
  assert.equal(
    optional.size,
    2,
    "Both optional real-model tests must be present",
  );
  assert.equal(
    report.numPendingTests,
    2,
    "Only the two real-model tests may skip",
  );
  assert.equal(report.numPassedTests, passed, "Passed-test count mismatch");
  assert.equal(report.numTotalTests, passed + optional.size);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  assert(
    process.argv[2],
    "Usage: verify-offline-test-report.mjs <report.json>",
  );
  verifyOfflineTestReport(JSON.parse(await readFile(process.argv[2], "utf8")));
  console.log(
    "OFFLINE_TEST_REPORT_PASSED: three synthetic E2E tests passed; only two real-model tests skipped",
  );
}
