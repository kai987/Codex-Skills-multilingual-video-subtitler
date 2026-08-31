import http from "node:http";
import https from "node:https";
import net from "node:net";
import dgram from "node:dgram";
/** Defense in depth for the research CLIs. No downloader, encoder or model
 * subprocess is in their allowed code paths. Git operations are separate. */
export function installC6121OfflineGuard() {
  let attempts = 0;
  const blocked = () => {
    attempts++;
    throw new Error("C6121_RESEARCH_NETWORK_FORBIDDEN");
  };
  globalThis.fetch = blocked;
  http.request = blocked;
  http.get = blocked;
  https.request = blocked;
  https.get = blocked;
  net.Socket.prototype.connect = blocked;
  dgram.createSocket = blocked;
  process.env.HF_HUB_OFFLINE = "1";
  process.env.TRANSFORMERS_OFFLINE = "1";
  delete process.env.HF_TOKEN;
  delete process.env.HUGGING_FACE_HUB_TOKEN;
  return () => ({
    attemptedNetworkRequests: attempts,
    networkUsed: false as const,
  });
}
