/* Browser controller. All mutations are validated and persisted by the local server. */
/* global location, document, fetch, crypto, Blob, setTimeout, confirm, addEventListener */
const token = new URL(location.href).searchParams.get("token");
const endpoint = (p) => p + "?token=" + encodeURIComponent(token);
let state;
const drafts = new Map();
function draft(id, key, value) {
  const d = drafts.get(id) || {};
  d[key] = value;
  drafts.set(id, d);
  message("有未保存的修改；请分别保存文本／时间后导出。");
}
addEventListener("beforeunload", (e) => {
  if (drafts.size) {
    e.preventDefault();
    e.returnValue = "";
  }
});
const el = (tag, text) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  return n;
};
const message = (text) => {
  document.querySelector("#message").textContent = text;
};
async function api(p, body) {
  const r = await fetch(
    endpoint(p),
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {},
  );
  const data = await r.json();
  if (!r.ok) throw Error(data.error || r.status);
  return data;
}
function action(item, kind) {
  return {
    resolutionId: crypto.randomUUID(),
    reviewId: item.reviewId,
    action: kind,
    selectedCandidateId: null,
    selectedCandidateEvidenceHash: null,
    correctedText: null,
    start: null,
    end: null,
    splitParts: [],
    mergeCueIds: [],
    reviewerNotes: "",
    errorTypes: [],
    confirmedReading: null,
    terminologyHints: [],
    dialectHints: [],
  };
}
async function persist(saved, applied) {
  state = await api("/save", { revision: state.revision, saved });
  if (applied) {
    const d = drafts.get(applied.reviewId) || {};
    if (applied.action === "EDIT_TEXT") delete d.text;
    if (applied.action === "EDIT_TIMING") {
      delete d.sourceStart;
      delete d.sourceEnd;
    }
    if (Object.keys(d).length) drafts.set(applied.reviewId, d);
    else drafts.delete(applied.reviewId);
  } else drafts.clear();
  render();
  message("已保存 " + state.saved.actions.length + " 项操作。未认证整集质量。");
}
async function append(a) {
  if (
    a.action === "ACCEPT_SUGGESTION" &&
    drafts.get(a.reviewId)?.text !== undefined
  )
    throw Error("请先保存手动文本，或重新读取以放弃未保存文本");
  await persist({ ...state.saved, actions: [...state.saved.actions, a] }, a);
}
const guarded = (fn) => async () => {
  try {
    await fn();
  } catch (e) {
    message("未完成：" + e.message);
  }
};
function button(text, fn) {
  const b = el("button", text);
  b.addEventListener("click", guarded(fn));
  return b;
}
function render() {
  const w = state.workspace,
    main = document.querySelector("#units");
  main.replaceChildren();
  document.querySelector("#vocabulary").textContent = w.priorVocabulary
    .map(
      (v) =>
        v.surface +
        (v.reading ? "（" + v.reading + "）" : "") +
        " [" +
        v.trust +
        "]",
    )
    .join(" / ");
  for (const u of w.units) {
    const section = el("section");
    section.dataset.unitId = u.id;
    section.append(
      el(
        "h2",
        u.start.toFixed(2) + "–" + u.end.toFixed(2) + " 秒 · " + u.category,
      ),
    );
    const audio = el("audio");
    audio.controls = true;
    audio.preload = "none";
    audio.src = endpoint("/" + u.audio);
    section.append(
      audio,
      el(
        "small",
        "音频片段从源时间 " +
          u.audioStart.toFixed(2) +
          " 秒开始。分组完整性来自时间关联，尚未逐句重新听音认证。",
      ),
    );
    const ref = el("details"),
      sum = el("summary", "展开历史人工稿（仅作参考，不自动导入）");
    ref.append(sum, el("pre", u.referenceText));
    section.append(ref);
    if (u.timing) {
      const t = el("details");
      t.append(
        el("summary", "起点／终点证据（目标：" + u.timing.targetText + "）"),
        el("pre", JSON.stringify(u.timing, null, 2)),
      );
      section.append(t);
    }
    for (const item of w.items.filter((i) => i.unitId === u.id)) {
      const original = w.baseline.find(
        (r) => r.recordId === item.targetCueIds[0],
      );
      const last = state.result.changes
        .filter((c) => c.reviewId === item.reviewId)
        .at(-1)?.after;
      const current = {
        ...(last ||
          original || { text: "", sourceStart: null, sourceEnd: null }),
        ...drafts.get(item.reviewId),
      };
      const article = el("article");
      article.dataset.reviewId = item.reviewId;
      article.append(
        el(
          "p",
          original
            ? "原始字幕（只读）"
            : "缺句待复核：必须分别保存文本与时间，才能导出",
        ),
      );
      const old = el("div", original?.text || "（无字幕）");
      old.className = "original";
      article.append(old);
      const text = el("textarea");
      text.value = current.text;
      text.addEventListener("input", () =>
        draft(item.reviewId, "text", text.value),
      );
      text.setAttribute("aria-label", "修订文本");
      article.append(text);
      article.append(
        button("保存文本", () =>
          append({ ...action(item, "EDIT_TEXT"), correctedText: text.value }),
        ),
      );
      if (item.candidateSuggestions.length) {
        const select = el("select");
        select.setAttribute("aria-label", "词级候选");
        for (const c of item.candidateSuggestions) {
          const opt = el(
            "option",
            c.span.before +
              " → " +
              c.span.after +
              " · " +
              (c.authority === "prior-word-proposal"
                ? "术语先验（非声学证明）"
                : "ASR 提议（未确认）"),
          );
          opt.title = c.sources.join(", ");
          opt.value = c.candidateId;
          select.append(opt);
        }
        article.append(
          select,
          button("采用选中词级候选", () => {
            const c = item.candidateActionBindings.find(
              (b) => b.candidateId === select.value,
            );
            return append({
              ...action(item, "ACCEPT_SUGGESTION"),
              selectedCandidateId: c.candidateId,
              selectedCandidateEvidenceHash: c.candidateEvidenceHash,
            });
          }),
        );
        article.append(
          el(
            "small",
            "候选可能仍然错误。采用会核对原文及证据绑定；改过文本后请手动合并，不覆盖已有修改。",
          ),
        );
      }
      const controls = el("div");
      controls.className = "controls";
      const start = el("input"),
        end = el("input");
      for (const [input, label, v] of [
        [start, "起点（源秒）", current.sourceStart],
        [end, "终点（源秒）", current.sourceEnd],
      ]) {
        input.type = "number";
        input.step = "0.01";
        input.value = v ?? "";
        input.addEventListener("input", () =>
          draft(
            item.reviewId,
            input === start ? "sourceStart" : "sourceEnd",
            input.value,
          ),
        );
        input.setAttribute("aria-label", label);
        const l = el("label", label);
        l.append(input);
        controls.append(l);
      }
      controls.append(
        button("保存时间", () => {
          if (!start.value || !end.value) throw Error("起点和终点不能为空");
          return append({
            ...action(item, "EDIT_TIMING"),
            start: Number(start.value),
            end: Number(end.value),
          });
        }),
      );
      article.append(controls);
      article.append(
        button("保留当前／记录已查看", () => append(action(item, "KEEP"))),
        button("仍未解决", () => append(action(item, "MARK_UNRESOLVED"))),
      );
      const lastAction = state.saved.actions
        .filter((a) => a.reviewId === item.reviewId)
        .at(-1);
      article.append(
        el("small", "最近保存：" + (lastAction?.action || "未操作")),
      );
      section.append(article);
    }
    main.append(section);
  }
}
document.querySelector("#reload").addEventListener(
  "click",
  guarded(async () => {
    if (drafts.size && !confirm("放弃未保存的修改，读取磁盘状态？")) return;
    state = await api("/state");
    drafts.clear();
    render();
    message("已读取保存状态。");
  }),
);
document.querySelector("#export").addEventListener(
  "click",
  guarded(async () => {
    if (drafts.size) throw Error("存在未保存的文本或时间，请先保存再导出");
    const out = await api("/export", { revision: state.revision });
    const d = document.querySelector("#downloads");
    d.replaceChildren();
    for (const f of out.links) {
      const a = el("a", f.name);
      a.href = f.url;
      a.download = f.name;
      d.append(a);
    }
    message("导出成功 · " + out.changes + " 项变更 · " + out.status);
  }),
);
document.querySelector("#backup").addEventListener("click", () => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(state.saved, null, 2)], {
      type: "application/json",
    }),
  );
  const a = el("a");
  a.href = url;
  a.download = "word-repair-actions.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
document.querySelector("#restore").addEventListener(
  "change",
  guarded(async () => {
    const f = document.querySelector("#restore").files[0];
    if (!f) return;
    const saved = JSON.parse(await f.text());
    if (
      !confirm(
        "用此操作文件恢复复核状态？已有保存记录仍保留在 action-history。",
      )
    )
      return;
    await persist(saved);
  }),
);
guarded(async () => {
  state = await api("/state");
  render();
  message(
    state.workspace.units.length +
      " 个冻结分组 · 0 次新增推理 · " +
      state.saved.actions.length +
      " 项已保存操作",
  );
})();
