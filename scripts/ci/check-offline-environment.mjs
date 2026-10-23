import assert from "node:assert/strict";
import net from "node:net";

for (const key of [
  "MVL_OFFLINE_CI",
  "HF_HUB_OFFLINE",
  "HF_DATASETS_OFFLINE",
  "TRANSFORMERS_OFFLINE",
  "PIP_NO_INDEX",
]) {
  assert.equal(process.env[key], "1", `${key} must be enabled`);
}
for (const key of [
  "MVL_MFA_INTEGRATION_TEST",
  "MVL_SPEAKER_INTEGRATION_TEST",
]) {
  assert.equal(process.env[key], "0", `${key} must be disabled`);
}
for (const key of [
  "OPENAI_API_KEY",
  "HF_TOKEN",
  "HUGGING_FACE_HUB_TOKEN",
  "HUGGINGFACE_HUB_TOKEN",
  "MVL_C6_C519_TASK",
  "MVL_C6_SOURCE_VIDEO",
  "MVL_C5171_FRESH_TASK",
]) {
  assert(!process.env[key], `${key} must not be provided to offline CI`);
}

async function loopbackCheck(host) {
  const server = net.createServer((socket) => socket.end());
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, host, resolve);
    });
    const address = server.address();
    assert(address && typeof address !== "string");
    await new Promise((resolve, reject) => {
      const socket = net.connect({ host, port: address.port });
      socket.once("error", reject);
      socket.setTimeout(2000, () => {
        socket.destroy();
        reject(Error(`Loopback unavailable: ${host}`));
      });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

await loopbackCheck("127.0.0.1");
await loopbackCheck("::1");

// RFC 5737 TEST-NET-3: no production service or model endpoint is contacted.
await new Promise((resolve, reject) => {
  const socket = net.connect({ host: "203.0.113.1", port: 443 });
  socket.setTimeout(2000, () => {
    socket.destroy();
    reject(Error("External network was not denied by the OS sandbox"));
  });
  socket.once("connect", () => {
    socket.destroy();
    reject(Error("External network unexpectedly available"));
  });
  socket.once("error", (error) => {
    socket.destroy();
    if (["EPERM", "EACCES"].includes(error.code)) resolve();
    else reject(error);
  });
});

console.log(
  "OFFLINE_CI_GUARD_PASSED: integration disabled, no credentials, loopback allowed, external network denied",
);
