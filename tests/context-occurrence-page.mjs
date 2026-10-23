import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { renderOccurrencePage } from "../scripts/replay-context-occurrences.mjs";

const result = () => ({
  prefixes: [
    { text: "あ", conditionalMfaInterval: { start: 724.1, end: 724.38 } },
  ],
  anchoredResponse: {
    text: "ああ",
    emissionAnchor: { start: 727.78, end: 727.805 },
  },
  followingCandidates: [
    {
      text: "あ",
      originalAsrInterval: { start: 727.22, end: 727.98 },
      conditionalMfaInterval: { start: 727.05, end: 727.08 },
    },
  ],
});
const playback = { start: 718.46, end: 731.98 };

test("page maps playback controls back to source seconds without inventing a cue", async () => {
  const html = renderOccurrencePage(result(), playback);
  const events = {},
    buttons = [...html.matchAll(/data-seek="([^"]+)"/gu)].map((m) => ({
      dataset: { seek: m[1] },
      addEventListener(name, fn) {
        this[name] = fn;
      },
    }));
  let plays = 0;
  const audio = {
    currentTime: 0,
    addEventListener(name, fn) {
      events[name] = fn;
    },
    play() {
      plays++;
      return Promise.resolve();
    },
  };
  const counter = { textContent: "" };
  const document = {
    querySelector: (s) => (s === "#audio" ? audio : counter),
    querySelectorAll: () => buttons,
  };
  vm.runInNewContext(html.match(/<script>([\s\S]+)<\/script>/u)[1], {
    document,
  });
  assert.equal(buttons.length, 3);
  buttons[1].click();
  assert(Math.abs(audio.currentTime - 5.04) < 1e-6);
  events.timeupdate();
  assert.equal(counter.textContent, "源时间：723.500 秒");
  buttons[2].click();
  assert(Math.abs(audio.currentTime - 8.72) < 1e-6);
  events.timeupdate();
  assert.equal(counter.textContent, "源时间：727.180 秒");
  buttons[0].click();
  assert.equal(audio.currentTime, 0);
  assert.equal(plays, 3);
  assert.match(html, /src="context\.wav"/u);
  assert.match(html, /不是已修好的字幕/u);
  assert(!html.includes(".srt"));
});

test("untrusted candidate text is escaped, not executable markup", () => {
  const r = result();
  r.followingCandidates[0].text = '</td><script>throw Error("x")</script>';
  const html = renderOccurrencePage(r, playback);
  assert.equal([...html.matchAll(/<script>/gu)].length, 1);
  assert.match(
    html,
    /&lt;script&gt;throw Error\(&quot;x&quot;\)&lt;\/script&gt;/u,
  );
});

test("autoplay refusal reports a recoverable manual playback instruction", async () => {
  const html = renderOccurrencePage(result(), playback),
    counter = { textContent: "" };
  let click;
  const audio = {
    currentTime: 0,
    addEventListener() {
      /* Time updates are not exercised in this refusal test. */
    },
    play() {
      return Promise.reject(Error("blocked"));
    },
  };
  vm.runInNewContext(html.match(/<script>([\s\S]+)<\/script>/u)[1], {
    document: {
      querySelector: (s) => (s === "#audio" ? audio : counter),
      querySelectorAll: () => [
        {
          dataset: { seek: "0" },
          addEventListener: (_, fn) => {
            click = fn;
          },
        },
      ],
    },
  });
  click();
  await Promise.resolve();
  assert.equal(counter.textContent, "请点击音频播放按钮");
});
