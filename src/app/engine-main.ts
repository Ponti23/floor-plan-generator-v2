/** Entry point for the exact engine page (`/engine.html`). */
import { mountEnginePage } from "./engine-page.ts";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) {
  throw new Error("engine page needs a #app root element");
}
mountEnginePage(root);
