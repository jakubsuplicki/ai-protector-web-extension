import { installRelay } from "../ui/relay";

export default defineContentScript({
  matches: ["*://chatgpt.com/*"],
  runAt: "document_start",
  main() {
    installRelay("chatgpt");
  },
});
