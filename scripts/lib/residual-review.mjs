/** Local human review only; classifications do not automatically mutate subtitles. */
/* global document, localStorage, Blob, navigator, setTimeout */
export function reviewPayload(manifest, reviewer, values) {
  const allowed = [
    "",
    "environment",
    "vocalization",
    "correct",
    "wrong-text",
    "duplicate",
    "song",
    "uncertain",
  ];
  const items = manifest.items.map((item) => {
    const value = values[item.id] ?? {};
    const decision = allowed.includes(value.decision) ? value.decision : "";
    const text = typeof value.text === "string" ? value.text.trim() : "";
    const heard = value.heard === true;
    const issues = [];
    if (!decision) issues.push("尚未选择判断");
    if (decision && decision !== "uncertain" && !heard)
      issues.push("请先听完该项所有上下文片段");
    if (decision && !reviewer.trim()) issues.push("请填写复核者");
    if (decision === "wrong-text" && !text)
      issues.push("请填听到的文字，无法判断请选择仍不确定");
    return {
      id: item.id,
      originalCue: item.originalCue,
      currentCue: item.currentCue,
      targetHash: item.targetHash,
      decision,
      text,
      heard,
      notes: typeof value.notes === "string" ? value.notes : "",
      issues,
      status: issues.length
        ? "draft"
        : decision === "uncertain"
          ? "unresolved"
          : "reviewed",
    };
  });
  return {
    version: "residual-listening-labels-v1",
    packageId: manifest.packageId,
    baselineHash: manifest.baselineHash,
    reviewer: reviewer.trim(),
    status: items.some((i) => i.status === "draft")
      ? "draft"
      : "submitted-for-validation",
    subtitleMutations: 0,
    items,
  };
}

export function reviewRuntime(manifest, payloadBuilder) {
  const values = {},
    key = `residual-review:${manifest.packageId}`;
  const reviewer = document.getElementById("reviewer"),
    status = document.getElementById("status");
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null");
    if (
      saved?.packageId === manifest.packageId &&
      saved.baselineHash === manifest.baselineHash
    ) {
      reviewer.value = saved.reviewer || "";
      for (const item of saved.items || [])
        if (
          manifest.items.some(
            (m) => m.id === item.id && m.targetHash === item.targetHash,
          )
        )
          values[item.id] = item;
    }
  } catch {
    status.textContent = "浏览器无法恢复草稿；填写后请导出 JSON 备份。";
  }
  function collect() {
    for (const item of manifest.items) {
      const card = document.getElementById(item.id);
      values[item.id] = {
        heard: card.querySelector('[name="heard"]').checked,
        decision: card.querySelector("select").value,
        text: card.querySelector('[name="text"]').value,
        notes: card.querySelector('[name="notes"]').value,
      };
    }
    return payloadBuilder(manifest, reviewer.value, values);
  }
  function save() {
    const payload = collect();
    try {
      localStorage.setItem(key, JSON.stringify(payload));
      status.textContent = "草稿已保存在本浏览器。";
    } catch {
      status.textContent =
        "本浏览器不支持本地保存，请导出 JSON 或复制下方文本。";
    }
    document.getElementById("progress").textContent =
      `${payload.items.filter((i) => i.status === "reviewed").length} / ${manifest.items.length} 项已复核（不含仍不确定）`;
    return payload;
  }
  for (const item of manifest.items) {
    const card = document.getElementById(item.id),
      value = values[item.id] || {};
    card.querySelector('[name="heard"]').checked = value.heard === true;
    card.querySelector("select").value = value.decision || "";
    card.querySelector('[name="text"]').value = value.text || "";
    card.querySelector('[name="notes"]').value = value.notes || "";
    card.addEventListener("input", save);
    for (const audio of card.querySelectorAll("audio")) {
      audio.addEventListener("timeupdate", () => {
        audio.nextElementSibling.textContent = `源时间 ${(Number(audio.dataset.start) + audio.currentTime).toFixed(2)} 秒 / 播放器 ${audio.currentTime.toFixed(2)} 秒`;
      });
      audio.addEventListener("play", () => {
        for (const other of document.querySelectorAll("audio"))
          if (other !== audio) other.pause();
      });
    }
  }
  reviewer.addEventListener("input", save);
  function exportText() {
    const payload = save(),
      box = document.getElementById("json");
    box.value = JSON.stringify(payload, null, 2);
    box.hidden = false;
    status.textContent =
      payload.status === "draft"
        ? "已导出草稿（允许未完成）。缺项说明保存在 JSON 中，不会自动修改字幕。"
        : "JSON 已准备好；仍不确定的项目会保留为待复核。";
    return box.value;
  }
  document.getElementById("export").onclick = () => {
    const text = exportText(),
      url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "residual-listening-labels.json";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  document.getElementById("copy").onclick = async () => {
    const text = exportText();
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = "JSON 已复制。";
    } catch {
      document.getElementById("json").select();
      status.textContent =
        "请按 ⌘C 复制已选中的 JSON；也可以直接把文本发给我。";
    }
  };
}

export function renderResidualReview(manifest) {
  const escape = (s) =>
    String(s).replace(
      /[&<>"']/gu,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const time = (n) =>
    `${Math.floor(n / 60)}:${(n % 60).toFixed(2).padStart(5, "0")}`;
  const options = [
    ["", "请选择"],
    ["environment", "仅环境音／音乐，无人声，不需要此字幕"],
    ["vocalization", "有人声，但只是气声／笑声／无词语气声"],
    ["correct", "能听到，当前文字正确"],
    ["wrong-text", "有对白，但当前文字错误"],
    ["duplicate", "与附近字幕是同一句，重复显示"],
    ["song", "这是歌曲歌词"],
    ["uncertain", "仍不确定"],
  ];
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>11 个剩余字幕疑点听审</title><style>body{max-width:920px;margin:24px auto;padding:0 20px;font:17px/1.7 system-ui;background:#f7f6f3;color:#202322}article{padding:24px;margin:22px 0;background:white;border:1px solid #ccc;border-radius:12px}audio,select,textarea{width:100%;box-sizing:border-box}input,select,textarea,button{font:inherit;padding:9px}button{cursor:pointer;margin:8px 8px 8px 0}textarea{min-height:80px}label{display:block;margin:12px 0}input[type=checkbox]{width:20px;height:20px}small{color:#555}header{background:#f7f6f3;position:sticky;top:0;padding:12px 0;z-index:1}details{margin:12px 0}#json{height:300px}</style></head><body><header><b>剩余疑点听审 · 11 项</b><div id="progress">尚未提交判断</div></header><p>先听音频，再展开人工稿参考。目标时间只是当前待核对字幕的范围，不是已确认发声边界。人工稿没有对应句，不代表没有声音。语气声、笑声可单独选择，不要求填写“发话关系”。</p><label>复核者 <input id="reviewer" autocomplete="name" placeholder="请输入名字或代号"></label>${manifest.items.map((r, i) => `<article id="${r.id}"><h2>${i + 1}. ${escape(r.text)}</h2><p>源视频：<b>${time(r.start)}–${time(r.end)}</b>（${r.start.toFixed(2)}–${r.end.toFixed(2)} 秒）<br>当前修正版第 ${r.currentCue} 条 · 178 条旧稿第 ${r.originalCue} 条</p>${r.clips.map((c, j) => `<p>上下文 ${j + 1}/${r.clips.length}：源 ${time(c.start)}–${time(c.end)}；播放器 0 秒 = 源 ${c.start.toFixed(2)} 秒</p><audio controls preload="metadata" src="${c.file}" data-start="${c.start}"></audio><small>源时间 ${c.start.toFixed(2)} 秒 / 播放器 0.00 秒</small>`).join("")}<details><summary>人工稿附近内容和时间（仅参考）</summary>${r.references.map((v) => `<p>${time(v.start)}–${time(v.end)}：${escape(v.text)}<small>（ASS 第 ${v.referenceLine} 行）</small></p>`).join("") || "此处无参考对白"}</details><label><input name="heard" type="checkbox"> 我已听完本项全部上下文片段</label><label>听到的情况<select>${options.map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}</select></label><label>实际听到的日语（选“文字错误”时填写；不确定不要猜）<textarea name="text"></textarea></label><label>备注／是否需要字幕／源时间定位（可空）<textarea name="notes"></textarea></label></article>`).join("")}<button id="export">导出 JSON（允许未完成）</button><button id="copy">显示并复制 JSON</button><p id="status" role="status">未修改字幕。填写后请导出并发给我。</p><textarea id="json" aria-label="JSON 备用导出文本" hidden readonly></textarea><script>(${reviewRuntime.toString()})(${JSON.stringify(manifest).replace(/</gu, "\\u003c")},${reviewPayload.toString()});</script></body></html>`;
}
