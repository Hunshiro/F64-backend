import { env } from "../config/env";

type AiQuestion = {
  text: string;
  options: string[];
  correctOptions: number[];
  type: "single" | "multi";
  marks: number;
  negativeMarks: number;
  explanation?: string;
};

type AiResponse = {
  questions: AiQuestion[];
};

type GeminiModelListResult = {
  models: string[];
  fromApi: boolean;
};

const GEMINI_MODELS_TTL_MS = 10 * 60 * 1000;
let cachedGeminiModels: { models: string[]; expiresAt: number } | null = null;

export async function generateQuestionsWithGemini(input: {
  instructions: string;
  sourceText: string;
  questionsLimit: number;
}): Promise<AiQuestion[]> {
  if (!env.geminiApiKey) return [];

  const model = await getValidGeminiModel();
  if (!model) return [];

  const prompt = [
    "You are a quiz generator for banking/government exams.",
    "Create concise MCQs based on the provided instructions and source text.",
    "Return ONLY valid JSON with a 'questions' array. Each question must follow the schema: { text, options, correctOptions: number[], type: 'single' | 'multi', marks, negativeMarks, explanation }.",
    `Limit questions to ${input.questionsLimit}.`,
    "",
    "Instructions:",
    input.instructions || "(none)",
    "",
    "Source Text:",
    input.sourceText || "(none)"
  ].join("\n");

  const url = `https://openrouter.ai/api/v1/chat/completions`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.geminiApiKey}`,
        "HTTP-Referer": "https://testbook.com", // Required by OpenRouter
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.4,
        max_tokens: 1200,
        response_format: { type: "json_object" }
      })
    });

    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      const errorText = data?.error?.message || data?.error || "OpenRouter request failed";
      console.error("AI service error:", errorText);
      return [];
    }
    const text = data?.choices?.[0]?.message?.content || "";
    try {
      return parseQuestions(text);
    } catch {
      console.error("AI parse error: could not parse JSON response");
      if (text) {
        console.error("AI raw response (truncated):", text.slice(0, 500));
      }
      return [];
    }
  } catch (err: any) {
    console.error("AI request failed:", err?.message || err);
    return [];
  }
}

export async function listGeminiModels(): Promise<string[]> {
  if (!env.geminiApiKey) return [];
  const { models } = await fetchGenerateContentModels();
  return models;
}

export async function generateInstructionsWithGemini(input: {
  blueprint: string;
  sourceText: string;
}): Promise<string> {
  if (!env.geminiApiKey) return "";

  const model = await getValidGeminiModel();
  if (!model) return "";

  const prompt = [
    "You write concise exam instruction pages.",
    "Create a polished instruction page for the mock exam described below.",
    "Use the blueprint exactly, then use the PDF text only to refine clarity.",
    "Return plain text only.",
    "",
    "Blueprint:",
    input.blueprint,
    "",
    "Instruction PDF Text:",
    input.sourceText || "(none)"
  ].join("\n");

  try {
    const res = await fetch(`https://openrouter.ai/api/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.geminiApiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 900
      })
    });
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) return "";
    return String(data?.choices?.[0]?.message?.content || "").trim();
  } catch {
    return "";
  }
}

async function getValidGeminiModel(): Promise<string> {
  const requested = env.geminiModel;
  const { models, fromApi } = await fetchGenerateContentModels();
  if (requested) {
    if (models.includes(requested)) return requested;
  }

  if (!fromApi) {
    return requested || "";
  }

  const fallbackOrder = ["openrouter/owl-alpha", "google/gemini-flash-1.5"];
  const fallback = fallbackOrder.find((name) => models.includes(name)) || models[0] || "";

  if (fallback && fallback !== requested) {
    console.warn("Model fallback:", {
      requested: requested || "(none)",
      selected: fallback
    });
  }
  return fallback;
}

async function fetchGenerateContentModels(): Promise<GeminiModelListResult> {
  const now = Date.now();
  if (cachedGeminiModels && cachedGeminiModels.expiresAt > now) {
    return { models: cachedGeminiModels.models, fromApi: true };
  }

  const url = `https://openrouter.ai/api/v1/models`;
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as any;
    const errorText = data?.error?.message || "AI listModels failed";
    console.error("AI listModels error:", errorText);
    return { models: [], fromApi: false };
  }

  const data = (await res.json()) as any;
  const models = (data?.data || [])
    .map((m: any) => m.id)
    .filter(Boolean);

  cachedGeminiModels = {
    models,
    expiresAt: now + GEMINI_MODELS_TTL_MS
  };

  return { models, fromApi: true };
}

function ensureModelPath(model: string) {
  return model;
}

function parseQuestions(raw: string): AiQuestion[] {
  const jsonText = extractJson(raw);
  try {
    const parsed = JSON.parse(jsonText) as AiResponse | AiQuestion[];
    if (Array.isArray(parsed)) return parsed;
    return parsed.questions || [];
  } catch {
    const recovered = recoverQuestions(raw);
    return recovered;
  }
}

function extractJson(raw: string) {
  if (!raw) return "{}";
  let text = raw.trim();
  text = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  if (text.startsWith("[")) {
    return `{"questions": ${text}}`;
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return text;
  return text.slice(start, end + 1).trim();
}

function recoverQuestions(raw: string): AiQuestion[] {
  const marker = '"questions"';
  const idx = raw.indexOf(marker);
  if (idx === -1) return [];
  const arrayStart = raw.indexOf("[", idx);
  if (arrayStart === -1) return [];

  const items: AiQuestion[] = [];
  let depth = 0;
  let current = "";
  for (let i = arrayStart + 1; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === "{") {
      if (depth === 0) current = "";
      depth += 1;
    }
    if (depth > 0) current += ch;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          const obj = JSON.parse(current) as AiQuestion;
          if (obj && obj.text && Array.isArray(obj.options)) {
            items.push(obj);
          }
        } catch {
          // skip invalid object
        }
      }
    }
  }
  return items;
}
