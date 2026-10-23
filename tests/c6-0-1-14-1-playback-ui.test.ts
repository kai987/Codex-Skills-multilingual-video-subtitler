import { runInNewContext } from "node:vm";
import { describe, it, expect } from "vitest";
import { c601141WorkspaceJavascript } from "../packages/video-subtitler/src/review/c601141-review-workspace-ui.js";
import { required141 } from "../packages/video-subtitler/src/review/c601141-policy.js";
import { c60114WorkspaceJavascript } from "../packages/video-subtitler/src/review/c60114-review-workspace-ui.js";

interface Element141 {
  value: string;
  textContent: string;
  className: string;
  dataset: Record<string, string>;
  children: Element141[];
  label: string;
  action?: () => void;
  focused: boolean;
  append: (...children: Element141[]) => void;
  focus: () => void;
}
function element(label = ""): Element141 {
  const node: Element141 = {
    value: "",
    textContent: "",
    className: "",
    dataset: {},
    children: [],
    label,
    focused: false,
    append: (...children) => {
      node.children.push(...children);
    },
    focus: () => {
      node.focused = true;
    },
  };
  return node;
}
function harness(editable = true) {
  const workspace = element(),
    area = element(),
    identity = element(),
    heading = element(),
    status: string[] = [],
    buttons: Element141[] = [];
  const v14 = { budget: "FULL_QUEUE" };
  let baseRenderCount = 0;
  const item = {
    reviewItemId: "synthetic-item",
    suggestedActions: editable ? ["ADD_NEW_CUE"] : ["UNRESOLVED"],
  };
  const data = {
    items: {
      items: [
        {
          ...item,
          reviewLayer: "MISSING_SAFETY_RESERVE",
          itemTypes: ["MISSING_SAFETY_RESERVE", "NEW_LOCAL_ASR_CANDIDATE"],
        },
      ],
    },
    targets: {
      targets: [
        {
          parentReviewItemId: item.reviewItemId,
          reviewTargetId: "synthetic-target",
          targetSource: "MISSING_SAFETY_RESERVE",
          nativeInterval: { startSample: 48000, endSample: 96000 },
          inventoryIntervalIds: ["inventory"],
          detectorRunIds: ["detector"],
          fingerprintEntryIds: [],
        },
      ],
    },
    lexical: {
      targets: [
        {
          targetId: "synthetic-target",
          evidenceClass: "WHISPER_ONLY_LOCALIZED",
          localizedTextCandidates: [
            { requestId: "request", text: "合成の候補" },
          ],
        },
      ],
    },
  };
  const context = {
    v14,
    state: {
      data: { speechInventoryReviewV1: data },
      filtered: [item],
      index: 0,
    },
    render: () => {
      baseRenderCount++;
    },
    document: {
      title: "",
      querySelector: () => heading,
      createElement: () => element(),
    },
    byId: (id: string) => ({ workspace, "manual-text": area, identity })[id],
    text: (_tag: string, content: string) => element(content),
    button: (label: string, action: () => void) => {
      const node = element(label);
      node.action = action;
      buttons.push(node);
      return node;
    },
    showStatus: (message: string) => status.push(message),
  };
  const runtime = runInNewContext(
    `${c601141WorkspaceJavascript()}\n({render})`,
    context,
  ) as { render: () => void };
  return {
    runtime,
    v14,
    workspace,
    area,
    identity,
    status,
    buttons,
    baseRenderCount: () => baseRenderCount,
  };
}
describe("C601141 additive UI keeps editing separate from decisions", () => {
  it.each([
    "FULL_QUEUE",
    "FULL_QUEUE_WITH_SAFETY_RESERVE",
    "FULL_QUEUE_CONSERVATIVE_SPEECH",
    "ALL_MANDATORY",
  ])(
    "preserves unresolved items without fabricated audio in the %s view",
    (budget) => {
      const item = {
        reviewItemId: "unresolved",
        priorityTier: "LOW",
        sourceInterval: { start: 1, end: 2 },
      };
      const state = {
        filtered: [] as (typeof item)[],
        index: 0,
        data: {
          items: [item],
          sourceTargetReviewV3: {
            unresolvedItemIds: [item.reviewItemId],
            regions: { regions: [] },
            playback: { plans: [{ planId: budget, reviewItemIds: [] }] },
          },
        },
      };
      const api = runInNewContext(
        `${c60114WorkspaceJavascript()}\nrender=()=>{};({v14,refreshFiltered});`,
        {
          state,
          render: () => undefined,
          refreshFiltered: () => undefined,
          audioView: () => undefined,
          byId: () => ({ value: "ALL" }),
          typeMatches: () => true,
        },
      ) as { v14: { budget: string }; refreshFiltered: () => void };
      api.v14.budget = budget;
      api.refreshFiltered();
      expect(state.filtered).toHaveLength(budget === "ALL_MANDATORY" ? 0 : 1);
    },
  );
  it("defaults to the complete frozen safety-reserve plan", () => {
    const h = harness();
    expect(h.v14.budget).toBe("FULL_QUEUE_WITH_SAFETY_RESERVE");
    h.runtime.render();
    expect(h.baseRenderCount()).toBe(1);
    expect(h.identity.textContent).toContain("C6.0.1.12 transactions");
  });
  it("renders source-native evidence and review-only badges", () => {
    const h = harness();
    h.runtime.render();
    const labels: string[] = [];
    const walk = (v: Element141) => {
      labels.push(v.label);
      v.children.forEach(walk);
    };
    walk(h.workspace);
    expect(labels.join(" ")).toContain("Native samples 48000 → 96000");
    expect(labels.join(" ")).toContain("NEW_LOCAL_ASR_CANDIDATE");
    expect(labels.join(" ")).toContain("not transcript truth");
  });
  it("copy changes only the human editing base, without a decision or timing change", () => {
    const h = harness();
    h.runtime.render();
    expect(h.buttons).toHaveLength(1);
    required141(required141(h.buttons[0]).action)();
    expect(h.area.value).toBe("合成の候補");
    expect(h.area.focused).toBe(true);
    expect(h.status[0]).toContain("No decision saved");
  });
  it("does not expose copy/edit on non-editable items", () => {
    const h = harness(false);
    h.runtime.render();
    expect(h.buttons).toHaveLength(0);
    expect(h.area.value).toBe("");
  });
});
