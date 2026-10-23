import test from "node:test";
import assert from "node:assert/strict";
import { diagnosticFiles } from "../scripts/complete-soft-speech-offline.mjs";
import {
  formats,
  serializeRecords,
} from "../packages/video-subtitler/dist/standalone/bounded.js";
const row = {
  recordId: "test",
  sourceStart: 0.784,
  sourceEnd: 2.784,
  text: "テスト",
  issues: [],
};
test("diagnostic export tolerates binary float roundtrip without altering raw records", () => {
  const before = JSON.parse(JSON.stringify(row));
  assert.throws(
    () => serializeRecords([row], "ja"),
    /SERIALIZATION_TEXT_OR_TIMING_LOSS/u,
  );
  for (const [ext, content] of Object.entries(diagnosticFiles([row]))) {
    const r = formats[ext].parse(content)[0];
    assert.equal(Math.round(r.end * 100), 278);
    assert.equal(r.text, row.text);
  }
  assert.deepEqual(row, before);
});
test("diagnostic export rejects actual duration collapse and invalid timing", () => {
  assert.throws(
    () => diagnosticFiles([{ ...row, sourceStart: 1.001, sourceEnd: 1.002 }]),
    /COLLAPSE/u,
  );
  assert.throws(() => diagnosticFiles([{ ...row, sourceStart: NaN }]));
  assert.throws(() => diagnosticFiles([row, row]), /OVERLAP/u);
});
test("diagnostic export handles minute carry and multiline text", () => {
  const records = [
    { ...row, sourceStart: 59.999, sourceEnd: 61.784, text: "一行\n二行" },
  ];
  for (const [ext, content] of Object.entries(diagnosticFiles(records))) {
    const r = formats[ext].parse(content)[0];
    assert.equal(r.start, 60);
    assert.equal(Math.round(r.end * 100), 6178);
    assert.equal(r.text, records[0].text);
  }
});
