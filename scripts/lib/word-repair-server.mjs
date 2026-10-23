import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import { identity } from "./content-review-plan.mjs";
import { readJson } from "./local-asr-run.mjs";
import { applyActions } from "./word-repair.mjs";
import {
  loadReview,
  saveActions,
  exportReview,
  validateActionFile,
} from "./word-repair-run.mjs";

export async function serveReview(root, port = 0) {
  const workspace = await loadReview(root),
    token = randomBytes(24).toString("hex");
  const audioFiles = new Set(workspace.units.map((u) => u.audio));
  const downloads = new Map();
  let origin,
    queue = Promise.resolve();
  const state = async () => {
    const saved = await readJson(path.join(root, "actions.json"));
    validateActionFile(workspace, saved);
    return {
      workspace,
      saved,
      revision: identity(saved),
      result: applyActions(workspace, saved.actions),
    };
  };
  const server = http.createServer((req, res) => {
    const task = async () => {
      try {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");
        const url = new URL(req.url, origin);
        if (
          req.headers.host !== new URL(origin).host ||
          url.searchParams.get("token") !== token ||
          (req.headers.origin && req.headers.origin !== origin)
        ) {
          res.writeHead(403);
          res.end("Forbidden");
          return;
        }
        const send = (value) => {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify(value));
        };
        if (req.method === "GET" && url.pathname === "/") {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.setHeader(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-ancestors 'none'",
          );
          res.end(
            (
              await fs.readFile(
                new URL("../review-word-repair/index.html", import.meta.url),
                "utf8",
              )
            ).replace('src="/app.js"', 'src="/app.js?token=' + token + '"'),
          );
          return;
        }
        if (req.method === "GET" && url.pathname === "/app.js") {
          res.setHeader("Content-Type", "text/javascript; charset=utf-8");
          res.end(
            await fs.readFile(
              new URL("../review-word-repair/app.js", import.meta.url),
            ),
          );
          return;
        }
        if (req.method === "GET" && url.pathname === "/state") {
          send(await state());
          return;
        }
        if (req.method === "GET" && audioFiles.has(url.pathname.slice(1))) {
          res.setHeader("Content-Type", "audio/wav");
          res.end(await fs.readFile(path.join(root, url.pathname.slice(1))));
          return;
        }
        if (req.method === "GET" && downloads.has(url.pathname)) {
          res.setHeader("Content-Type", "application/octet-stream");
          res.setHeader(
            "Content-Disposition",
            'attachment; filename="' +
              path.basename(downloads.get(url.pathname)) +
              '"',
          );
          res.end(await fs.readFile(downloads.get(url.pathname)));
          return;
        }
        if (
          req.method !== "POST" ||
          !["/save", "/export"].includes(url.pathname)
        ) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        if (req.headers["content-type"] !== "application/json")
          throw Error("JSON_REQUIRED");
        let body = "";
        for await (const chunk of req) {
          body += chunk.toString();
          if (Buffer.byteLength(body) > 1048576) throw Error("BODY_TOO_LARGE");
        }
        const value = JSON.parse(body),
          current = await state();
        if (value.revision !== current.revision) {
          res.writeHead(409);
          send({ error: "STALE_REVISION_RELOAD" });
          return;
        }
        if (url.pathname === "/save") {
          if (
            Object.keys(value).some((k) => !["revision", "saved"].includes(k))
          )
            throw Error("UNKNOWN_SAVE_FIELD");
          await saveActions(root, value.saved);
          send(await state());
          return;
        }
        const out = await exportReview(root),
          id = path.basename(out.directory);
        const links = [];
        for (const f of [
          "subtitle.review-candidate.ass",
          "subtitle.review-candidate.srt",
          "subtitle.review-candidate.vtt",
          "changes.json",
          "evaluation.json",
          "export-manifest.json",
        ]) {
          const route = "/download/" + id + "/" + f;
          downloads.set(route, path.join(out.directory, f));
          links.push({ name: f, url: route + "?token=" + token });
        }
        send({ status: out.status, changes: out.changes, links });
      } catch (e) {
        if (!res.headersSent)
          res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    };
    // Serialize writes and reads so optimistic revision checks cannot race.
    queue = queue.then(task, task);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  origin = "http://127.0.0.1:" + server.address().port;
  return { server, url: origin + "/?token=" + token };
}
