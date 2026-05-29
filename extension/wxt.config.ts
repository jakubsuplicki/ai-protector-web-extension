import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: ".",
  outDir: "dist",
  dev: {
    server: { port: 3100 },
  },
  manifest: {
    name: "AI Protector",
    description: "DLP coaching for AI tools — scans prompts before they leave your browser.",
    version: "0.1.0",
    // "alarms" drives the periodic engine health ping that keeps the toolbar
    // status icon fresh while idle (see entrypoints/background.ts).
    permissions: ["storage", "alarms"],
    icons: {
      16: "icons/icon-16.png",
      32: "icons/icon-32.png",
      48: "icons/icon-48.png",
      128: "icons/icon-128.png",
    },
    action: {
      default_title: "AI Protector",
      // Online (full-color) icon is the default; the service worker swaps to
      // the grayed offline set via chrome.action.setIcon when unreachable.
      default_icon: {
        16: "icons/icon-16.png",
        32: "icons/icon-32.png",
        48: "icons/icon-48.png",
        128: "icons/icon-128.png",
      },
    },
    host_permissions: [
      "http://localhost:8000/*",
      "http://localhost/*",
      "http://127.0.0.1/*",
      "https://localhost/*",
      "*://chatgpt.com/*",
      "*://claude.ai/*",
    ],
  },
});
