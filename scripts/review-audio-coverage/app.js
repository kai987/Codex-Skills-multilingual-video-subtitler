/* global document, Blob, setTimeout */
const data = JSON.parse(document.getElementById("data").textContent);
const labels = data.submission.labels;
const sounds = [
  ["pending", "待听审"],
  ["speech", "语音"],
  ["mixed-speech", "语音与音乐/音效混合"],
  ["music", "只有音乐/歌唱，无对白"],
  ["effect", "只有音效"],
  ["noise", "只有环境噪声"],
  ["uncertain", "不确定"],
];
const relations = [
  ["pending", "待判断"],
  ["independent", "独立发话/回应"],
  ["continuation", "同一句的延续/内部片段"],
  ["uncertain", "不确定"],
  ["not-applicable", "无对白，不适用"],
];
for (const item of data.items) {
  const row = labels.find((r) => r.id === item.id),
    card = document.createElement("article");
  const title = document.createElement("h2");
  title.textContent = item.id;
  card.append(title);
  const target = document.createElement("p");
  target.className = "target";
  target.textContent = `片段内目标：${item.targetStart.toFixed(2)}–${item.targetEnd.toFixed(2)} 秒 / 全段 ${item.duration.toFixed(2)} 秒`;
  card.append(target);
  const audio = document.createElement("audio");
  audio.controls = true;
  audio.preload = "none";
  audio.src = item.audio;
  card.append(audio);
  const listened = document.createElement("label"),
    check = document.createElement("input");
  check.type = "checkbox";
  listened.append(check, " 我已听过目标及上下文");
  check.addEventListener("change", () => (row.listened = check.checked));
  card.append(listened);
  const choices = {};
  for (const [key, caption, options] of [
    ["sound", "目标声音", sounds],
    ["relation", "发话关系", relations],
  ]) {
    const label = document.createElement("label"),
      select = document.createElement("select");
    label.append(caption + " ", select);
    for (const [value, text] of options) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      select.append(option);
    }
    select.addEventListener("change", () => {
      row[key] = select.value;
      if (key === "sound") {
        row.relation =
          row.sound === "pending"
            ? "pending"
            : ["music", "effect", "noise"].includes(row.sound)
              ? "not-applicable"
              : "uncertain";
        choices.relation.value = row.relation;
      }
    });
    choices[key] = select;
    card.append(label);
  }
  document.getElementById("clips").append(card);
}
document.getElementById("export").addEventListener("click", () => {
  data.submission.reviewer = document.getElementById("reviewer").value.trim();
  const bad =
    labels.find(
      (r) =>
        r.sound !== "pending" &&
        (!r.listened ||
          !data.submission.reviewer ||
          (["speech", "mixed-speech"].includes(r.sound) &&
            !["independent", "continuation", "uncertain"].includes(
              r.relation,
            )) ||
          (["music", "effect", "noise"].includes(r.sound) &&
            r.relation !== "not-applicable") ||
          (r.sound === "uncertain" && r.relation !== "uncertain")),
    ) ?? labels.find((r) => r.sound === "pending" && r.relation !== "pending");
  if (bad) {
    document.getElementById("status").textContent =
      `请检查 ${bad.id}：填写复核者、确认听过，并选择一致的发话关系。`;
    return;
  }
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data.submission, null, 2) + "\n"], {
      type: "application/json",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "audio-listening-labels.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  document.getElementById("status").textContent =
    `已导出，${labels.filter((r) => r.sound !== "pending").length}/${labels.length} 已标注。请将 JSON 交回 Codex；导出不等于字幕质量通过。`;
});
