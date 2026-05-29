import {
  ISOLATED_SOURCE,
  MAIN_SOURCE,
  VERDICT_WAIT_TIMEOUT_MS,
  type ScanReply,
} from "../config";
import { log, warn } from "../util";

export default defineContentScript({
  matches: ["*://claude.ai/*"],
  runAt: "document_start",
  world: "MAIN",
  main() {
    const pageOrigin = window.location.origin;
    const origFetch = window.fetch;

    const wrappedFetch = async function wrapped(
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      try {
        const url = urlOf(input);
        // Claude's completion endpoint: /api/organizations/*/chat_conversations/*/completion
        if (/\/api\/organizations\/.*\/completion$/.test(url)) {
          const method =
            init?.method ?? (input instanceof Request ? input.method : "GET");
          if (method.toUpperCase() === "POST") {
            log("intercepted POST →", url);
            const body =
              init?.body ??
              (input instanceof Request ? await input.clone().text() : undefined);
            const prompt = extractPrompt(body);
            if (prompt) {
              const reply = await requestScanReply(prompt, pageOrigin);
              const verdict = reply?.verdict;
              log("verdict for Claude:", verdict?.decision);
              if (shouldBlock(reply)) {
                log("BLOCKING request to Claude");
                const verdict = reply.verdict;
                return new Response(
                  JSON.stringify({ error: { type: "aiprot_block", message: verdict.blocked_reason ?? "Blocked by AI Protector" } }),
                  { status: 403, statusText: "Blocked by AI Protector", headers: { "content-type": "application/json" } },
                );
              }
            }
          }
        }
      } catch (err) {
        warn("fetch wrap error — failing open", err);
      }
      return origFetch.call(window, input as RequestInfo, init);
    };

    Object.assign(wrappedFetch, origFetch);
    window.fetch = wrappedFetch as typeof window.fetch;
    log("MAIN-world fetch wrapped (claude.ai)");
  },
});

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

type IsolatedReply = {
  source: typeof ISOLATED_SOURCE;
  id: string;
} & Partial<ScanReply>;

function requestScanReply(
  prompt: string,
  origin: string,
): Promise<ScanReply | null> {
  const id = crypto.randomUUID();
  return new Promise((resolve) => {
    const handler = (ev: MessageEvent) => {
      if (ev.source !== window || ev.origin !== origin) return;
      const d = ev.data as Partial<IsolatedReply> | null;
      if (!d || d.source !== ISOLATED_SOURCE || d.id !== id) return;
      cleanup();
      resolve(
        d.verdict
          ? {
              verdict: d.verdict,
              action:
                d.action ?? (d.verdict.decision === "BLOCK" ? "block" : "allow"),
            }
          : null,
      );
    };
    const timer = setTimeout(() => {
      cleanup();
      warn(`scan wait timeout after ${VERDICT_WAIT_TIMEOUT_MS}ms — failing open`);
      resolve(null);
    }, VERDICT_WAIT_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener("message", handler);
    };
    window.addEventListener("message", handler);
    window.postMessage({ source: MAIN_SOURCE, id, prompt }, origin);
  });
}

function shouldBlock(reply: ScanReply | null): reply is ScanReply {
  if (!reply) return false;
  return reply.action === "block";
}

function extractPrompt(body: BodyInit | null | undefined): string | null {
  if (typeof body !== "string") return null;
  try {
    const data = JSON.parse(body) as { prompt?: string };
    // Claude sends { prompt: "user text", ... } in its completion request
    if (typeof data.prompt === "string" && data.prompt.length > 0) {
      return data.prompt;
    }
    return null;
  } catch {
    return null;
  }
}
