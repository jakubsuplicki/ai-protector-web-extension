// Test setup: install a jsdom DOM into globalThis so bun test can run
// code that touches document/window (warning.ts renders a shadow-DOM host
// into document.body).
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://chatgpt.com/",
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;
g.window = dom.window;
g.document = dom.window.document;
g.HTMLElement = dom.window.HTMLElement;
g.Element = dom.window.Element;
g.Node = dom.window.Node;
g.navigator = dom.window.navigator;
g.getComputedStyle = dom.window.getComputedStyle;
