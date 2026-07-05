import mapMd from "../../../docs/system-map.md?raw";
import { MarkdownDoc } from "./MarkdownDoc";

/** The full docs/system-map.md rendered read-only. Mermaid fences show as code. */
export function SystemMapReference() {
  return <MarkdownDoc source={mapMd} />;
}
