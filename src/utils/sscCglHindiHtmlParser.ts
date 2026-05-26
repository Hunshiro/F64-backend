import { Buffer } from "buffer";

// Deprecated: keep this file as a thin compatibility wrapper.
// Extraction logic is unified in `sscCglHtmlParser.ts`.

import { detectHtmlAndExtractQuestions } from "./sscCglHtmlParser";

export function detectSscCglHindiHtmlAndExtractQuestions(
  buffer: Buffer,
  options?: { language?: "hindi" | "english" | "mixed"; strictLanguageFilter?: boolean }
) {
  // For Hindi HTML uploads, automatically detect and filter to Hindi only
  return detectHtmlAndExtractQuestions(buffer, {
    language: "hindi",
    strictLanguageFilter: true,
    ...options
  });
}
