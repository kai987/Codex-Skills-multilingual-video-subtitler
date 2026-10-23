import assert from "node:assert/strict";
import test from "node:test";

import {
  optionalModelTests,
  requiredOfflineTests,
  verifyOfflineTestReport,
} from "../scripts/ci/verify-offline-test-report.mjs";

function report() {
  return {
    success: true,
    numFailedTests: 0,
    numFailedTestSuites: 0,
    numTodoTests: 0,
    numPendingTests: 2,
    numPassedTests: 3,
    numTotalTests: 5,
    testResults: [
      ...requiredOfflineTests.map(([name, title]) => ({
        name: `/ci/workspace/${name}`,
        assertionResults: [{ title, status: "passed" }],
      })),
      ...optionalModelTests.map(([name, title]) => ({
        name: `/ci/workspace/${name}`,
        assertionResults: [{ title, status: "pending" }],
      })),
    ],
  };
}

test("accepts passed synthetic E2E tests with only the two model tests skipped", () => {
  assert.doesNotThrow(() => verifyOfflineTestReport(report()));
});

for (const [label, change] of [
  [
    "required E2E skipped",
    (r) => (r.testResults[0].assertionResults[0].status = "pending"),
  ],
  ["required E2E missing", (r) => r.testResults.shift()],
  [
    "unexpected skip",
    (r) =>
      r.testResults.push({
        name: "tests/other.test.ts",
        assertionResults: [{ title: "unrelated", status: "pending" }],
      }),
  ],
  [
    "real model test enabled",
    (r) => (r.testResults[3].assertionResults[0].status = "passed"),
  ],
  ["unsuccessful run", (r) => (r.success = false)],
  ["duplicate required E2E", (r) => r.testResults.push(r.testResults[0])],
  ["inconsistent totals", (r) => (r.numTotalTests = 99)],
]) {
  test(`rejects ${label}`, () => {
    const value = report();
    change(value);
    assert.throws(() => verifyOfflineTestReport(value));
  });
}
