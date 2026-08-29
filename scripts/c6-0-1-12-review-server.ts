import { parseArgs } from "node:util";

interface ReviewWorkspaceServerModule {
  startC60112ReviewWorkspaceServer(input: {
    workspaceDirectory: string;
    host: "127.0.0.1";
    port: number;
  }): Promise<{
    host: "127.0.0.1";
    port: number;
    url: string;
    close: () => Promise<void>;
  }>;
}

const { values } = parseArgs({
  options: {
    workspace: { type: "string" },
    host: { type: "string", default: "127.0.0.1" },
    port: { type: "string", default: "0" },
  },
});

if (values.workspace === undefined || values.workspace.trim().length === 0) {
  throw new Error(
    "Usage: tsx scripts/c6-0-1-12-review-server.ts --workspace <review-workspace> [--port 0]",
  );
}
if (values.host !== "127.0.0.1") {
  throw new Error(
    "The C6.0.1.12 review server only supports --host 127.0.0.1.",
  );
}
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65_535) {
  throw new Error("--port must be an integer between 0 and 65535.");
}

const moduleUrl = new URL(
  "../packages/video-subtitler/src/review/c60112-review-workspace.ts",
  import.meta.url,
).href;
const workspaceModule = (await import(
  moduleUrl
)) as ReviewWorkspaceServerModule;
const running = await workspaceModule.startC60112ReviewWorkspaceServer({
  workspaceDirectory: values.workspace,
  host: "127.0.0.1",
  port,
});

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      host: running.host,
      port: running.port,
      url: running.url,
      workspace: values.workspace,
      network: false,
    },
    null,
    2,
  )}\n`,
);

let closing = false;
const close = async (): Promise<void> => {
  if (closing) return;
  closing = true;
  await running.close();
};

process.once("SIGINT", () => {
  void close().then(() => {
    process.exitCode = 0;
  });
});
process.once("SIGTERM", () => {
  void close().then(() => {
    process.exitCode = 0;
  });
});
