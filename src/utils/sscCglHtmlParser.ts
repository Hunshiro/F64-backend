import { Buffer } from "buffer";

export type ParsedSscCglQuestion = {

  subject: string;
  text: string;
  text_hi?: string;
  options: string[];
  options_hi?: string[];
  correctOptions: number[]; // option indices
  type: "single" | "multi";
  marks: number;
  negativeMarks: number;
  explanation?: string;
  explanation_hi?: string;
  imageUrl?: string;
};

function normalizeWhitespace(s: string) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function letterToIndex(letter: string) {
  const L = String(letter || "").trim().toUpperCase();
  const map: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };
  return map[L];
}

// Detect if text contains Hindi (Devanagari) script
function containsHindi(text: string): boolean {
  const devanagariRange = /[\u0900-\u097F]/g;
  return devanagariRange.test(text);
}

// Detect if text contains English characters
function containsEnglish(text: string): boolean {
  return /[a-zA-Z]/.test(text);
}

// Detect predominant language in the document
export function detectDocumentLanguage(html: string): "hindi" | "english" | "mixed" {
  // Extract all text from question-type and question-text divs
  const textBlocks = html.match(/<div[^>]*class=["'](?:question-type|question-text)["'][^>]*>([\s\S]*?)<\/div>/gi) || [];
  
  let hindiCount = 0;
  let englishCount = 0;

  textBlocks.forEach((block) => {
    const textContent = block.replace(/<[^>]*>/g, " ");
    if (containsHindi(textContent)) hindiCount++;
    if (containsEnglish(textContent)) englishCount++;
  });

  // If mostly Hindi, classify as Hindi
  if (hindiCount > englishCount) return "hindi";
  // If mostly English, classify as English
  if (englishCount > hindiCount) return "english";
  // If mixed or ambiguous
  return "mixed";
}

// Check if a question text is primarily Hindi or English
function getQuestionLanguage(text: string): "hindi" | "english" | "mixed" {
  const hindiChars = (text.match(/[\u0900-\u097F]/g) || []).length;
  const englishChars = (text.match(/[a-zA-Z]/g) || []).length;

  if (hindiChars > englishChars * 2) return "hindi";
  if (englishChars > hindiChars * 2) return "english";
  return "mixed";
}

// Minimal HTML parsing for the specific template using regex.
// NOTE: This is intentionally dependency-free. It targets your provided structure.
export function parseSscCglHtmlQuestions(
  html: string,
  options?: { language?: "hindi" | "english" | "mixed"; strictLanguageFilter?: boolean }
): Array<Omit<ParsedSscCglQuestion, "marks" | "negativeMarks" | "type">> {
  const raw = String(html || "");
  const language = options?.language || detectDocumentLanguage(raw);
  const strictLanguageFilter = options?.strictLanguageFilter ?? false;

  // Match the entire block starting from <div class="mock-question" up until the next one or end.
  // This lookahead prevents the match from terminating early due to nested </div> tags.
  const questionBlocks = raw.match(/<div[^>]*class=["']mock-question["'][\s\S]*?(?=<div[^>]*class=["']mock-question["']|$)/gi) || [];

  return questionBlocks
    .map((block) => {
      const subjectMatch = block.match(/<div[^>]*class=["']question-type["'][^>]*>([\s\S]*?)<\/div>/i);
      const subject = normalizeWhitespace(subjectMatch ? subjectMatch[1].replace(/<[^>]*>/g, " ") : "");

      const textMatch = block.match(/<div[^>]*class=["']question-text["'][^>]*>([\s\S]*?)<\/div>/i);
      let text = normalizeWhitespace(textMatch ? textMatch[1].replace(/<[^>]*>/g, " ") : "");
      // Ensure text is never empty, as Mongoose schema requires it.
      if (!text) text = "Question text could not be extracted.";

      // options
      // Match option blocks. Hindi templates sometimes place option-text inside additional wrappers.
      const optionBlocks = block.match(/<div[^>]*class=["']option["'][\s\S]*?(?=<div[^>]*class=["']option["']|<div[^>]*class=["']solution-text["']|$)/gi) || [];

      // Ensure A-D order.
      const letterToText: Record<string, string> = {};
      optionBlocks.forEach((ob) => {
        const letterAttr = ob.match(/data-option=["']([A-D])["']/i);
        const letter = letterAttr ? letterAttr[1].toUpperCase() : "";
        const optTextMatch = ob.match(/<div[^>]*class=["']option-text["'][^>]*>([\s\S]*?)<\/div>/i);
        const optText = normalizeWhitespace(optTextMatch ? optTextMatch[1].replace(/<[^>]*>/g, " ") : "");
        if (letter) letterToText[letter] = optText;
      });

      // Ensure 4 options are always present and non-empty.
      // Some Hindi templates may not put the visible text inside `.option-text`.
      // Fallback: if `.option-text` is empty, use the full option block text.
      const getFallbackOptionText = (ob: string) => {
        const rawText = ob
          .replace(/<[^>]*>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        return rawText;
      };

      const options: string[] = ["A", "B", "C", "D"].map((L) => {
        const optionText = letterToText[L] || "";
        if (optionText) return optionText;

        const optionBlockForLetter = optionBlocks.find((ob) => {
          const letterAttr = ob.match(/data-option=["']([A-D])["']/i);
          const letter = letterAttr ? letterAttr[1].toUpperCase() : "";
          return letter === L;
        });

        const fallback = optionBlockForLetter ? getFallbackOptionText(optionBlockForLetter) : "";
        return fallback || `Option ${L}`;
      });

      const dataAnswerMatch = block.match(/data-answer=["']([A-D])["']/i);
      const correctAnswerTextMatch = block.match(/<div[^>]*class=["']correct-answer["'][^>]*>([\s\S]*?)<\/div>/i);
      const correctLetter = (dataAnswerMatch?.[1] || (correctAnswerTextMatch ? correctAnswerTextMatch[1].replace(/<[^>]*>/g, "").trim() : "")).toUpperCase();
      const correctOptions = correctLetter ? [letterToIndex(correctLetter)].filter(idx => idx !== undefined && idx >= 0 && idx < 4) : [];

      const explanationMatch = block.match(/<div[^>]*class=["']solution-text["'][^>]*>([\s\S]*?)<\/div>/i);
      const explanation = normalizeWhitespace(explanationMatch ? explanationMatch[1].replace(/<[^>]*>/g, " ") : "");

      const imageUrlMatch = block.match(/<img[^>]*src=["']([^"']+)["'][^>]*>/i);
      const imageUrl = imageUrlMatch ? imageUrlMatch[1] : undefined;

      return {
        subject,
        text,
        options,
        correctOptions,
        explanation: explanation || "",
        imageUrl,
        // Internal: track detected language for this question
        _detectedLanguage: getQuestionLanguage(text)
      };
    })
    .filter((q: any) => {
      // Apply strict language filtering if requested
      if (!strictLanguageFilter) return true;

      // If document is pure Hindi, filter out English-heavy questions
      if (language === "hindi" && q._detectedLanguage === "english") {
        console.warn(`[LANGUAGE FILTER] Skipping English question in Hindi document: "${q.text.substring(0, 50)}..."`);
        return false;
      }

      // If document is pure English, filter out Hindi-heavy questions
      if (language === "english" && q._detectedLanguage === "hindi") {
        console.warn(`[LANGUAGE FILTER] Skipping Hindi question in English document: "${q.text.substring(0, 50)}..."`);
        return false;
      }

      return true;
    })
    .map((q: any) => {
      // Remove internal tracking field
      const { _detectedLanguage, ...cleanQuestion } = q;
      return cleanQuestion;
    });
}

export function detectHtmlAndExtractQuestions(
  buffer: Buffer,
  options?: { language?: "hindi" | "english" | "mixed"; strictLanguageFilter?: boolean }
) {
  const prefix = buffer.slice(0, 200).toString("utf-8").trim().toLowerCase();
  const looksLikeHtml = prefix.startsWith("<html") || prefix.startsWith("<!doctype") || prefix.includes("mock-question");
  if (!looksLikeHtml) return null;
  const html = buffer.toString("utf-8");
  const parsed = parseSscCglHtmlQuestions(html, options);
  return parsed;
}
