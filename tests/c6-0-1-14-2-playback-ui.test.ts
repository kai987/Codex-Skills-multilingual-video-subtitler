import { runInNewContext } from "node:vm";
import { describe, it, expect } from "vitest";
import { c601142WorkspaceJavascript } from "../packages/video-subtitler/src/review/c601142-review-workspace-ui.js";
import { c60114WorkspaceJavascript } from "../packages/video-subtitler/src/review/c60114-review-workspace-ui.js";
import { required141 } from "../packages/video-subtitler/src/review/c601141-policy.js";
interface Element142 {
  id: string;
  value: string;
  textContent: string;
  className: string;
  label: string;
  focused: boolean;
  dataset: Record<string, string>;
  children: Element142[];
  action?: () => void;
  append: (...children: Element142[]) => void;
  focus: () => void;
}
function element(label = ""): Element142 {
  const node: Element142 = {
    id: "",
    value: "",
    textContent: "",
    className: "",
    label,
    focused: false,
    dataset: {},
    children: [],
    append: (...children) => {
      node.children.push(...children);
    },
    focus: () => {
      node.focused = true;
    },
  };
  return node;
}
function harness(editable = true, editingArea = true) {
  const workspace = element(),
    area = element(),
    identity = element(),
    heading = element(),
    aside = element();
  const status: string[] = [],
    buttons: Element142[] = [],
    fields = {
      "v14-budget": element(),
      "priority-filter": element(),
      "type-filter": element(),
    };
  const v14 = { budget: "FULL_QUEUE" };
  let renders = 0,
    refreshes = 0;
  const item = {
    reviewItemId: "synthetic-safety",
    suggestedActions: editable ? ["ADD_NEW_CUE"] : ["UNRESOLVED"],
  };
  const data = {
    items: {
      items: [
        {
          ...item,
          reviewLayer: "MISSING_SAFETY_RESERVE",
          evidenceStrata: ["PYANNOTE_EXCLUSIVE"],
          inventoryTargetIds: ["target"],
        },
      ],
    },
    safety: {
      targets: [
        {
          targetId: "target",
          clusterId: "cluster",
          selectionStage: "EXCLUSIVE_RESERVE",
          evidenceStrata: ["PYANNOTE_EXCLUSIVE"],
          memberCandidateIds: ["one", "two"],
          uncoveredSpeechSeconds: 1.5,
          independentFamilyCount: 1,
          targetCoreUnion: [
            { startSample: 48000, endSample: 96000 },
            { startSample: 120000, endSample: 144000 },
          ],
          densityOverrideReason: null,
        },
      ],
      summary: { targetUnionSeconds: 1.5 },
    },
    lexical: {
      targets: [
        {
          targetId: "target",
          evidenceClass: "CROSS_MODEL_DISAGREEMENT",
          localizedTextCandidates: [
            {
              provider: "synthetic-provider",
              source: "CURRENT_C601142",
              text: "合成の候補",
              localizationStatus: "EXACT_SOURCE_WINDOW",
              sourceInterval: { start: 1, end: 3 },
            },
          ],
        },
      ],
    },
    playback: { fullQueueEpisodeRatio: 0.5, burdenGate: "PASSED" },
  };
  const state = {
    data: { detectorCeilingReviewV2: data },
    filtered: [{ reviewItemId: "baseline", suggestedActions: [] }, item],
    index: 1,
  };
  const context = {
    v14,
    state,
    render: () => {
      renders++;
    },
    refreshFiltered: () => {
      refreshes++;
    },
    document: {
      title: "",
      querySelector: (selector: string) =>
        selector === "aside" ? aside : heading,
      createElement: () => element(),
    },
    byId: (id: string) =>
      id === "c601142-jump-safety"
        ? buttons.find((b) => b.id === id)
        : (
            {
              workspace,
              "manual-text": editingArea ? area : undefined,
              identity,
              ...fields,
            } as Record<string, Element142 | undefined>
          )[id],
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
    `${c601142WorkspaceJavascript()}\n({render})`,
    context,
  ) as { render: () => void };
  return {
    runtime,
    v14,
    state,
    workspace,
    area,
    identity,
    heading,
    aside,
    buttons,
    status,
    fields,
    renders: () => renders,
    refreshes: () => refreshes,
  };
}
describe("C601142 additive review UI and unchanged transaction boundary", () => {
  it("defaults to the official complete queue and retains the transaction subsystem identity", () => {
    const h = harness();
    expect(h.v14.budget).toBe("C601142_FINAL_FULL_QUEUE");
    h.runtime.render();
    expect(h.renders()).toBe(1);
    expect(h.identity.textContent).toContain("C6.0.1.12 transactions");
  });
  it("shows atomic union holes, independent families and the non-truth warning", () => {
    const h = harness();
    h.runtime.render();
    const labels: string[] = [];
    const visit = (e: Element142) => {
      labels.push(e.label);
      e.children.forEach(visit);
    };
    visit(h.workspace);
    expect(labels.join(" ")).toContain("48000 → 96000 | 120000 → 144000");
    expect(labels.join(" ")).toContain("Energy alone is never speech");
    expect(labels.join(" ")).toContain("independent families 1");
    expect(labels.join(" ")).toContain("Review envelope is context only");
  });
  it("copy only edits a focused manual-text base and saves no decision", () => {
    const h = harness();
    h.runtime.render();
    const before = JSON.stringify(h.state);
    required141(
      required141(
        h.buttons.find((b) => b.label === "Copy candidate to editing base"),
      ).action,
    )();
    expect(h.area.value).toBe("合成の候補");
    expect(h.area.focused).toBe(true);
    expect(h.status[0]).toContain("No decision saved");
    expect(JSON.stringify(h.state)).toBe(before);
  });
  it("requires an editing area and never invents an action for non-editable items", () => {
    const absent = harness(true, false);
    absent.runtime.render();
    required141(
      required141(
        absent.buttons.find(
          (b) => b.label === "Copy candidate to editing base",
        ),
      ).action,
    )();
    expect(absent.status[0]).toContain("Select a human editing action");
    const readonly = harness(false);
    readonly.runtime.render();
    expect(
      readonly.buttons.filter((b) => b.label.startsWith("Copy")),
    ).toHaveLength(0);
  });
  it("jump resets only display filters and does not duplicate itself after rendering", () => {
    const h = harness();
    h.runtime.render();
    h.state.index = 0;
    required141(
      required141(h.buttons.find((b) => b.id === "c601142-jump-safety")).action,
    )();
    expect(h.state.index).toBe(1);
    expect(h.refreshes()).toBe(1);
    expect(h.fields["priority-filter"].value).toBe("ALL");
    expect(h.fields["type-filter"].value).toBe("ALL");
    expect(
      h.buttons.filter((b) => b.id === "c601142-jump-safety"),
    ).toHaveLength(1);
  });
  it.each(["C601142_FINAL_FULL_QUEUE", "FULL_QUEUE", "ALL_MANDATORY"])(
    "keeps unresolved evidence correctly in %s",
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
});
