/** Fresh-generation-only orchestration. Never imported by status/resume/audit. */
import path from "node:path";
import fs from "node:fs/promises";
import { prepareSeams, executeSeams } from "../subtitle-tool-refine-seams.mjs";
import { assembleTextOnly } from "../subtitle-tool-seam-text-only.mjs";
import { assembleContextDelivery } from "./seam-context-delivery.mjs";
import { deliverShortResponseObservation } from "./short-response-observation.mjs";
import { deliverAudioCoverage } from "./audio-coverage-delivery.mjs";
import { inspectContentSafety } from "./content-safety-gate.mjs";

export async function refineDefaultDelivery(
  base,
  options = {},
  dependencies = {},
) {
  options.signal?.throwIfAborted();
  const prepare = dependencies.prepare ?? prepareSeams;
  const execute = dependencies.execute ?? executeSeams;
  const assemble = dependencies.assemble ?? assembleTextOnly;
  const context = dependencies.context ?? assembleContextDelivery;
  const observe = dependencies.observe ?? deliverShortResponseObservation;
  const observeCoverage = dependencies.observeCoverage ?? deliverAudioCoverage;
  const originalOutputs = base.outputs.map((p) => path.resolve(base.task, p));
  const recovery = base.contentRecovery;
  const initialOutputs =
    recovery?.status === "recovered-machine-draft"
      ? recovery.outputs
      : originalOutputs;
  const safety = dependencies.safety ?? inspectContentSafety;
  const inspect = async (outputs) => {
    try {
      return await safety(outputs, { language: options.language ?? null });
    } catch (error) {
      return {
        status: "HOLD",
        reason: String(error),
        acousticCorrectness: "NOT_VERIFIED",
        machineOnlyReleaseAuthorized: false,
      };
    }
  };
  const delivery = {
    version: "default-seam-delivery-v1",
    baselineTask: base.task,
    originalOutputs,
    preferredOutputs: initialOutputs,
    contentRecovery: recovery ?? null,
    qualityStatus: "needs-review",
    finalizationMethod: "none",
    humanValidated: false,
    acousticTimingVerified: false,
    changedTargets: 0,
    inferenceRequests: recovery?.startedRequests ?? 0,
    status: "skipped",
    contentSafety: await inspect(initialOutputs),
    contextCandidate: {
      mode: "shadow",
      status: "skipped",
      reason:
        options.contextSeams === false
          ? "disabled"
          : "seam-stage-not-completed",
      newInference: 0,
      automaticPromotionAllowed: false,
    },
  };
  if (recovery?.reservedRequests > 0) {
    delivery.reason =
      "content-recovery-used-shared-enhancement-budget; no seam inference";
    delivery.status =
      recovery.status === "recovered-machine-draft"
        ? "refined"
        : "needs-review";
  } else if (
    recovery &&
    !["no-detected-risk", "recovered-machine-draft"].includes(recovery.status)
  )
    delivery.reason = "content-recovery-hold; no seam inference";
  else if (options.enabled === false) delivery.reason = "disabled";
  else if (base.executionStatus !== "completed")
    delivery.reason = "baseline-incomplete";
  else if (base.coverageScope !== "full-audio")
    delivery.reason = "partial-range";
  else if (base.unresolvedCount !== 0 || base.aliasCount !== 0)
    delivery.reason = "unresolved-baseline";
  else if (options.language !== "ja") delivery.reason = "unvalidated-language";
  else if (delivery.contentSafety.status === "HOLD")
    delivery.reason =
      "content-safety-hold; resolve global decoding risks before seam refinement";
  else {
    options.signal?.throwIfAborted();
    // Claim once per baseline, outside its hash-bound artifact contract. A failed
    // or interrupted enhancement cannot get a new budget by invoking this twice.
    await fs.writeFile(
      path.join(base.task, "default-seam-reservation.json"),
      JSON.stringify({ version: delivery.version, retry: 0 }) + "\n",
      { flag: "wx" },
    );
    try {
      const planned = await prepare(base.task, path.dirname(base.task));
      delivery.evidenceRoot = planned.root;
      delivery.reservedRequests = planned.requests;
      delivery.reservedAudioSeconds = planned.seconds;
      if (planned.requests === 0) delivery.reason = "no-eligible-seams";
      else {
        options.signal?.throwIfAborted();
        options.progress?.(
          `默认接缝复核：${planned.requests} 次本地请求，${planned.seconds} 秒音频；零重试。`,
        );
        // On failure the exact started count lives in request exit evidence; do
        // not misreport verifySeams().newInference=0 as this execution's count.
        delivery.inferenceRequests = null;
        await execute(planned.root, {
          authorize: true,
          signal: options.signal,
        });
        delivery.inferenceRequests = planned.requests;
        options.signal?.throwIfAborted();
        const text = await assemble(planned.root, path.dirname(base.task));
        delivery.candidateRoot = text.root;
        delivery.changedTargets = text.changedTargets;
        delivery.status = text.changedTargets ? "refined" : "unchanged";
        if (text.changedTargets) {
          delivery.preferredOutputs = ["ass", "srt", "vtt"].map((ext) =>
            path.join(text.root, `seam-text-only.machine-candidate.${ext}`),
          );
          delivery.timingPolicy =
            "original-outer-envelope-no-acoustic-alignment";
        }
        // This candidate is inspectable by default, never promoted on one known success.
        // Failure here cannot discard a valid old-policy refinement or buy a retry.
        if (options.contextSeams !== false) {
          try {
            options.signal?.throwIfAborted();
            const candidate = await context(
              planned.root,
              path.dirname(base.task),
            );
            options.signal?.throwIfAborted();
            delivery.contextCandidate = {
              ...candidate,
              mode: "shadow",
              status: candidate.additionalChangedTargets
                ? "candidate"
                : "unchanged",
              newInference: 0,
              automaticPromotionAllowed: false,
            };
          } catch (error) {
            delivery.contextCandidate.status = options.signal?.aborted
              ? "cancelled"
              : "failed";
            delivery.contextCandidate.reason = String(error);
            if (options.signal?.aborted) throw error;
          }
        }
      }
    } catch (error) {
      delivery.status = options.signal?.aborted ? "cancelled" : "failed";
      delivery.reason = String(error);
      // Preserve and identify the usable baseline; never advertise a failed
      // enhancement as completed or silently rerun its requests.
    }
  }
  // A read-only sidecar is independent of seam inference. Disabling refinement
  // does not disable observation; cancelled runs do not start additional work.
  delivery.shortResponseObservation = {
    status: "skipped",
    reason: "unvalidated-language",
    newInference: 0,
    mode: "observe-only",
    automaticReplacementAllowed: false,
  };
  if (options.signal?.aborted) {
    delivery.status = "cancelled";
    delivery.shortResponseObservation.reason = "cancelled";
  } else if (options.language === "ja") {
    try {
      delivery.shortResponseObservation = await observe({
        recordsPath: base.recordsPath,
        subtitlePath: delivery.preferredOutputs.find((p) => p.endsWith(".srt")),
        outputRoot: base.task,
        signal: options.signal,
      });
      options.signal?.throwIfAborted();
    } catch (error) {
      delivery.shortResponseObservation.status = options.signal?.aborted
        ? "cancelled"
        : "unavailable";
      delivery.shortResponseObservation.reason = String(error);
      if (options.signal?.aborted) {
        delivery.status = "cancelled";
        delivery.reason = String(error);
      }
      // A missing audit must not hide a successfully delivered machine draft,
      // but it must never be presented as zero risks or a passed quality gate.
    }
  }
  delivery.audioCoverageObservation = {
    status: "skipped",
    reason: "unvalidated-language",
    newInference: 0,
    mode: "observe-only",
    subtitleMutationAuthorized: false,
  };
  if (options.signal?.aborted)
    delivery.audioCoverageObservation.reason = "cancelled";
  else if (options.language === "ja") {
    try {
      delivery.audioCoverageObservation = await observeCoverage({
        task: base.task,
        subtitlePath: delivery.preferredOutputs.find((p) => p.endsWith(".srt")),
        outputRoot: base.task,
        signal: options.signal,
      });
      options.signal?.throwIfAborted();
    } catch (error) {
      delivery.audioCoverageObservation.status = options.signal?.aborted
        ? "cancelled"
        : "unavailable";
      delivery.audioCoverageObservation.reason = String(error);
      if (options.signal?.aborted) {
        delivery.status = "cancelled";
        delivery.reason = String(error);
      }
    }
  }
  // Re-check the exact delivered text, not merely the pre-refinement baseline.
  // Missing/unreadable audits fail closed. Kept outputs remain inspectable.
  delivery.contentSafety = await inspect(delivery.preferredOutputs);
  delivery.inspectableOutputs = [...delivery.preferredOutputs];
  for (const output of recovery?.outputs ?? [])
    if (!delivery.inspectableOutputs.includes(output))
      delivery.inspectableOutputs.push(output);
  // Raw request-level checks survive serialization and cannot be cleared by
  // a superficially clean exported subset or an unavailable recovery check.
  if (
    recovery &&
    !["no-detected-risk", "recovered-machine-draft"].includes(recovery.status)
  ) {
    delivery.contentSafety.status = "HOLD";
    delivery.contentSafety.recoveryReason = recovery.status;
  }
  if (delivery.contentSafety.status !== "NO_DETECTED_HIGH_RISK") {
    delivery.contentSafety.status = "HOLD";
    delivery.preferredOutputs = [];
  }
  const manifest = path.join(base.task, "DEFAULT_DELIVERY.json");
  const index = path.join(base.task, "DEFAULT_DELIVERY.md");
  const originalIndex = path.basename(base.outputIndex ?? "OUTPUT_INDEX.md");
  await fs.writeFile(manifest, JSON.stringify(delivery, null, 2) + "\n", {
    flag: "wx",
  });
  await fs.writeFile(
    index,
    [
      "# Default machine delivery",
      "",
      `Status: ${delivery.status}; quality: needs-review.`,
      "",
      delivery.contentSafety.status === "HOLD"
        ? "CONTENT SAFETY HOLD: no preferred subtitle. The draft contains unresolved risks or the safety check is unavailable. No text was deleted."
        : "Preferred subtitles (machine draft, not acoustically verified timing):",
      "",
      ...delivery.preferredOutputs.map(
        (p) => `- [${path.basename(p)}](<${path.relative(base.task, p)}>)`,
      ),
      "",
      "Inspectable draft (not quality-approved):",
      ...delivery.inspectableOutputs.map(
        (p) => `- [${path.basename(p)}](<${path.relative(base.task, p)}>)`,
      ),
      "",
      `Original output is preserved in [${originalIndex}](${originalIndex}).`,
      ...(recovery
        ? [
            "",
            `Content recovery: ${recovery.status}; reserved ${recovery.reservedRequests} requests / ${recovery.reservedAudioSeconds.toFixed(3)} seconds, one round, no recursive retry. [Evidence and recheck](default-content-recovery/recovery.json). Content was re-recognized in a separate copy, not bulk-deduplicated. Original evidence is unchanged.`,
          ]
        : []),
      "",
      `Context-text candidate: ${delivery.contextCandidate.status} (shadow only; not preferred; no additional inference).`,
      ...(delivery.contextCandidate.outputs ?? []).map(
        (p) =>
          `- [Context candidate ${path.basename(p)}](<${path.relative(base.task, p)}>)`,
      ),
      "A context candidate is not proof of generalization or verified acoustic timing. Preferred subtitles above remain the existing-policy delivery.",
      "",
      delivery.audioCoverageObservation.status === "observed"
        ? `Audio coverage observation: ${delivery.audioCoverageObservation.previewCount} source-stratified listening samples, ${delivery.audioCoverageObservation.requestedListeningSeconds.toFixed(2)} seconds. [Listening samples (ranking unvalidated)](AUDIO_COVERAGE_OBSERVATION.md). Energy activity is not confirmed speech or missing dialogue.`
        : `Audio coverage observation: ${delivery.audioCoverageObservation.status}; see manifest. This is not proof of complete dialogue.`,
      delivery.shortResponseObservation.status === "observed"
        ? `Short-response observation: ${delivery.shortResponseObservation.observedCount} review candidates, not confirmed errors. [Review list](SHORT_RESPONSE_OBSERVATION.md). No extra inference or subtitle mutations.`
        : `Short-response observation: ${delivery.shortResponseObservation.status}; see manifest for reason. This is not a zero-risk result.`,
      "Detailed execution, failure/skip reason and evidence paths: [DEFAULT_DELIVERY.json](DEFAULT_DELIVERY.json).",
      "",
    ].join("\n"),
    { flag: "wx" },
  );
  return {
    ...base,
    defaultDelivery: delivery,
    defaultDeliveryManifest: manifest,
    preferredOutputs: delivery.preferredOutputs,
    outputIndex: index,
  };
}
