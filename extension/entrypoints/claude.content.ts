import { installRelay } from "../ui/relay";

export default defineContentScript({
  matches: ["*://claude.ai/*"],
  runAt: "document_start",
  main() {
    // Claude is observe-only — blocking is experimental (single-session test
    // only as of 2026-04-15). The relay still surfaces the verdict; MAIN-world
    // fetch wrap decides whether to block or pass through.
    installRelay("claude");
  },
});
