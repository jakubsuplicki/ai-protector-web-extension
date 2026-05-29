import {
  ISOLATED_SOURCE,
  MAIN_SOURCE,
  VERDICT_WAIT_TIMEOUT_MS,
  type ScanReply,
} from "../config";
import { log, warn } from "../util";

export default defineContentScript({
  matches: ["*://chatgpt.com/*"],
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
        // URL match MUST happen before touching the body — reading a Request
        // body via clone().text() is a round-trip that would delay every page
        // fetch if done unconditionally. Keep the URL gate at the top.
        if (/\/backend[^/]*\/.*conversation$/.test(url)) {
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
              if (shouldBlock(reply)) {
                const verdict = reply.verdict;
                return new Response(
                  JSON.stringify({
                    error: {
                      type: "aiprot_block",
                      message:
                        verdict.blocked_reason ??
                        "Blocked by AI Protector — sensitive data detected.",
                    },
                  }),
                  {
                    status: 403,
                    statusText: "Blocked by AI Protector",
                    headers: { "content-type": "application/json" },
                  },
                );
              }
              // Only ALLOW reaches here. ISOLATED resolves the action: in
              // strict mode BLOCK and MODIFY both resolve to action "block"
              // (the extension can't apply server-side masking, so MODIFY is
              // stopped, not passed through); in ask/observe the user/mode
              // decides. shouldBlock() keys on that resolved action.
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
    log("MAIN-world fetch wrapped");
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
    const data = JSON.parse(body) as { messages?: unknown };
    if (!Array.isArray(data.messages)) return null;
    const parts: string[] = [];
    for (const m of data.messages as Array<{ content?: { parts?: unknown } }>) {
      const p = m?.content?.parts;
      if (!Array.isArray(p)) continue;
      for (const piece of p) {
        if (typeof piece === "string") {
          parts.push(piece);
        } else if (
          piece &&
          typeof piece === "object" &&
          typeof (piece as { text?: unknown }).text === "string"
        ) {
          parts.push((piece as { text: string }).text);
        }
      }
    }
    const joined = parts.join("\n").trim();
    return joined.length > 0 ? joined : null;
  } catch {
    return null;
  }
}
