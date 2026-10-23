/** Human boundary brackets only: never a subtitle mutation or automatic endpoint. */
export function validateTailAnnotation(manifest, value) {
  const keys = [
    "version",
    "evidenceHash",
    "audioSha256",
    "reviewer",
    "heardContext",
    "status",
    "stillAudibleAt",
    "endedBy",
    "notes",
  ];
  if (!value || Object.keys(value).sort().join() !== keys.sort().join())
    throw Error("ANNOTATION_FIELDS");
  if (
    value.version !== "human-tail-bracket-v1" ||
    value.evidenceHash !== manifest.evidenceHash ||
    value.audioSha256 !== manifest.audioSha256
  )
    throw Error("STALE_OR_FOREIGN_EVIDENCE");
  if (
    typeof value.reviewer !== "string" ||
    !value.reviewer.trim() ||
    value.reviewer.length > 100 ||
    value.heardContext !== true
  )
    throw Error("REVIEWER_AND_CONTEXT_REQUIRED");
  if (typeof value.notes !== "string" || value.notes.length > 2000)
    throw Error("INVALID_NOTES");
  const valid = (t) =>
    typeof t === "number" &&
    Number.isFinite(t) &&
    t >= manifest.minimum &&
    t <= manifest.end &&
    Math.abs(t * 100 - Math.round(t * 100)) < 1e-7;
  if (value.status === "uncertain") {
    if (value.stillAudibleAt !== null || value.endedBy !== null)
      throw Error("UNCERTAIN_HAS_NO_BOUNDARY");
  } else if (value.status === "bracketed") {
    if (
      !valid(value.stillAudibleAt) ||
      !valid(value.endedBy) ||
      value.endedBy <= value.stillAudibleAt
    )
      throw Error("INVALID_SOURCE_TIME_BRACKET");
  } else throw Error("UNKNOWN_STATUS");
  return {
    annotation: value,
    provenance: "explicit-human-listening",
    endpointRange:
      value.status === "bracketed"
        ? { after: value.stillAudibleAt, noLaterThan: value.endedBy }
        : null,
    exactEnd: null,
    subtitleMutationAuthorized: false,
    machineIndependent: false,
    qualityStatus: "needs-review",
    finalizationMethod: "none",
  };
}

/* global document, localStorage, Blob, setTimeout */
export function boundaryReviewApp(manifest, validate) {
  const $ = (id) => document.getElementById(id),
    audio = $("audio");
  const key = "tail-boundary:" + manifest.evidenceHash;
  const message = (s) => {
    $("message").textContent = s;
  };
  $("range").textContent =
    `源时间 ${manifest.start.toFixed(2)}–${manifest.end.toFixed(2)} 秒。所有标记使用源时间，不是播放器的片段时间。`;
  for (const id of ["lower", "upper", "seek"]) {
    $(id).min = manifest.minimum;
    $(id).max = manifest.end;
  }
  $("seek").value = manifest.minimum.toFixed(2);
  function state() {
    const uncertain = $("uncertain").checked;
    return {
      version: "human-tail-bracket-v1",
      evidenceHash: manifest.evidenceHash,
      audioSha256: manifest.audioSha256,
      reviewer: $("reviewer").value,
      heardContext: $("heard").checked,
      status: uncertain ? "uncertain" : "bracketed",
      stillAudibleAt:
        uncertain || !$("lower").value.trim() ? null : Number($("lower").value),
      endedBy:
        uncertain || !$("upper").value.trim() ? null : Number($("upper").value),
      notes: $("notes").value,
    };
  }
  function save() {
    $("json").value = ""; // Never leave a stale export after an edit.
    try {
      localStorage.setItem(key, JSON.stringify(state()));
    } catch {
      message("浏览器不能保存草稿；请导出或复制 JSON。当前输入仍保留在页面。");
    }
  }
  function mark(id) {
    const source = Math.round((manifest.start + audio.currentTime) * 100) / 100;
    if (
      !Number.isFinite(source) ||
      source < manifest.minimum ||
      source > manifest.end
    ) {
      message("请先定位到争议尾段再标记。");
      return;
    }
    $(id).value = source.toFixed(2);
    $("uncertain").checked = false;
    save();
  }
  audio.ontimeupdate = () => {
    $("clock").textContent =
      `源时间 ${(manifest.start + audio.currentTime).toFixed(2)} 秒`;
  };
  $("mark-lower").onclick = () => mark("lower");
  $("mark-upper").onclick = () => mark("upper");
  $("jump").onclick = () => {
    const t = Number($("seek").value);
    if (
      !$("seek").value.trim() ||
      !Number.isFinite(t) ||
      t < manifest.minimum ||
      t > manifest.end
    ) {
      message("定位时间超出音频范围。");
      return;
    }
    audio.pause();
    audio.currentTime = t - manifest.start;
  };
  $("replay").onclick = () => {
    audio.currentTime = 0;
    audio.play().catch(() => message("请使用播放器的播放按钮。"));
  };
  for (const id of [
    "reviewer",
    "heard",
    "lower",
    "upper",
    "uncertain",
    "notes",
  ])
    $(id).oninput = save;
  function makeJson() {
    try {
      const v = state();
      validate(manifest, v);
      $("json").value = JSON.stringify(v, null, 2);
      message(
        "JSON 已生成。可下载；若下载失败，复制下方全部内容保存为 tail-boundary-review.json。",
      );
      return $("json").value;
    } catch (e) {
      $("json").value = "";
      message(
        "未导出：" +
          e.message +
          "。请填写复核者、勾选听过上下文，并填写有序区间；无法判断可选‘仍不确定’。",
      );
      return null;
    }
  }
  $("export").onclick = makeJson;
  $("download").onclick = () => {
    const text = makeJson();
    if (!text) return;
    try {
      const url = URL.createObjectURL(
        new Blob([text], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "tail-boundary-review.json";
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      message("下载不可用，请复制下方 JSON；输入未丢失。");
    }
  };
  $("select-json").onclick = () => {
    if (!$("json").value) makeJson();
    $("json").focus();
    $("json").select();
  };
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null");
    if (
      saved &&
      saved.evidenceHash === manifest.evidenceHash &&
      saved.audioSha256 === manifest.audioSha256
    ) {
      $("reviewer").value =
        typeof saved.reviewer === "string" ? saved.reviewer : "";
      $("notes").value = typeof saved.notes === "string" ? saved.notes : "";
      $("heard").checked = saved.heardContext === true;
      $("uncertain").checked = saved.status === "uncertain";
      $("lower").value =
        typeof saved.stillAudibleAt === "number" ? saved.stillAudibleAt : "";
      $("upper").value = typeof saved.endedBy === "number" ? saved.endedBy : "";
      message("已恢复同一音频的草稿；导出前会重新校验。");
    }
  } catch {
    message("无法恢复草稿；可正常填写并复制导出。");
  }
}

export function renderBoundaryReview(manifest) {
  const data = JSON.stringify(manifest).replace(/</gu, "\\u003c");
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>尾音结束区间复核</title>
<style>body{font:18px/1.6 system-ui;max-width:850px;margin:32px auto;padding:0 20px;background:#f7f7f4;color:#202824}section{background:white;padding:20px;margin:20px 0;border:1px solid #bbb;border-radius:8px}label{display:block;margin:14px 0}button,input,textarea{font:inherit;padding:8px;max-width:100%;box-sizing:border-box}button{cursor:pointer;margin:6px 4px 6px 0}audio,textarea{width:100%}input[type=number]{width:155px}#message{white-space:pre-wrap}small{display:block}</style>
<h1>标记尾音结束的范围</h1><p id="range"></p><p>已确认尾段仍有拖长的「ああ」，但精确终点未知。请标记一个区间，不必猜到百分之一秒。这里的波形变化、MFA 和 VAD 都不是答案。</p>
<section><audio id="audio" src="context.wav" controls preload="metadata"></audio><p id="clock">尚未播放</p><button id="replay">重听完整上下文</button><label>定位到源时间（秒） <input id="seek" type="number" step="0.01"></label><button id="jump">定位并暂停</button><small>听到接近尾部时暂停，再使用下面两个标记按钮；可以手动修正数字。播放器反应有延迟，标记的是人工估计范围。</small></section>
<section><label>复核者 <input id="reviewer" maxlength="100" autocomplete="off"></label><label><input id="heard" type="checkbox"> 我已听过完整上下文和尾段</label><label>这里仍能听到目标元音（源秒） <input id="lower" type="number" step="0.01"></label><button id="mark-lower">用当前播放位置标记“仍听得到”</button><label>到这里目标元音已经结束（源秒） <input id="upper" type="number" step="0.01"></label><button id="mark-upper">用当前播放位置标记“已结束”</button><label><input id="uncertain" type="checkbox"> 仍不确定，不提交结束区间</label><label>备注 <textarea id="notes" rows="2" maxlength="2000"></textarea></label></section>
<button id="export">生成 JSON</button><button id="download">下载 JSON</button><button id="select-json">全选 JSON，手动复制</button><p id="message" role="status"></p><textarea id="json" readonly rows="12" aria-label="可复制的复核 JSON"></textarea><p>此页只收集人工证据，不修改字幕、不运行模型，不代表机器独立生成能力提高。</p>
<script>(${boundaryReviewApp.toString()})(${data}, ${validateTailAnnotation.toString()});</script></html>`;
}
