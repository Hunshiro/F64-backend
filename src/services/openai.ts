import { env } from "../config/env";

type AiQuestion = {
  text: string;
  options: string[];
  correctOptions: number[];
  type: "single" | "multi";
  marks: number;
  negativeMarks: number;
  explanation?: string;
  visualRequired?: boolean;
  sourcePage?: number;
  visualNote?: string;
};

type AiResponse = {
  questions: AiQuestion[];
};

export async function generateQuestionsWithOpenAI(input: {
  instructions: string;
  sourceText: string;
  questionsLimit: number;
}): Promise<AiQuestion[]> {
  if (!env.openaiApiKey) return [];

  const prompt = [
    "You are a quiz generator for banking/government exams.",
    "Create concise MCQs based on the provided instructions and source text.",
    "Return JSON only, matching the schema.",
    `Limit questions to ${input.questionsLimit}.`,
    "",
    "Instructions:",
    input.instructions || "(none)",
    "",
    "Source Text:",
    input.sourceText || "(none)"
  ].join("\n");

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.openaiApiKey}`
    },
    body: JSON.stringify({
      model: env.openaiModel,
      input: prompt,
      text: {
        format: {
          type: "json_schema",
          name: "quiz_generation",
          strict: true,
          schema: {
            type: "object",
            properties: {
              questions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    text: { type: "string" },
                    options: { type: "array", items: { type: "string" } },
                    correctOptions: { type: "array", items: { type: "integer" } },
                    type: { type: "string", enum: ["single", "multi"] },
                    marks: { type: "number" },
                    negativeMarks: { type: "number" },
                    explanation: { type: "string" }
                  },
                  required: ["text", "options", "correctOptions", "type", "marks", "negativeMarks", "explanation"],
                  additionalProperties: false
                }
              }
            },
            required: ["questions"],
            additionalProperties: false
          }
        }
      }
    })
  });

  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    const errorText = data?.error?.message || data?.error || "OpenAI request failed";
    console.error("OpenAI error:", errorText);
    return [];
  }
  const jsonText = data?.output_text || data?.output?.[0]?.content?.[0]?.text || "";
  try {
    const parsed = JSON.parse(jsonText) as AiResponse;
    return parsed.questions || [];
  } catch {
    console.error("OpenAI parse error: could not parse JSON response");
    return [];
  }
}

export async function generateQuestionsWithOpenAIPdf(input: {
  instructions: string;
  pdfBuffer: Buffer;
  filename: string;
  questionsLimit: number;
}): Promise<AiQuestion[]> {
  if (!env.openaiApiKey) return [];

  const prompt = [
    "You are a quiz generator for SSC CGL exams.",
    "Use the attached PDF directly. It may contain diagrams, charts, geometry figures, reasoning puzzles, or other visuals.",
    `Create up to ${input.questionsLimit} MCQs matching the schema.`,
    "For any question that depends on a visual from the PDF, set visualRequired=true, include sourcePage with the 1-based PDF page number, and include a short visualNote.",
    "Do not invent page numbers. If a question is not visual, omit sourcePage or set visualRequired=false.",
    "",
    "Instructions:",
    input.instructions || "(none)"
  ].join("\n");

  const pdfData = `data:application/pdf;base64,${input.pdfBuffer.toString("base64")}`;
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.openaiApiKey}`
    },
    body: JSON.stringify({
      model: env.openaiModel,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            {
              type: "input_file",
              filename: input.filename,
              file_data: pdfData
            }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "visual_quiz_generation",
          strict: true,
          schema: {
            type: "object",
            properties: {
              questions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    text: { type: "string" },
                    options: { type: "array", items: { type: "string" } },
                    correctOptions: { type: "array", items: { type: "integer" } },
                    type: { type: "string", enum: ["single", "multi"] },
                    marks: { type: "number" },
                    negativeMarks: { type: "number" },
                    explanation: { type: "string" },
                    visualRequired: { type: "boolean" },
                    sourcePage: { type: ["integer", "null"] },
                    visualNote: { type: "string" }
                  },
                  required: [
                    "text",
                    "options",
                    "correctOptions",
                    "type",
                    "marks",
                    "negativeMarks",
                    "explanation",
                    "visualRequired",
                    "sourcePage",
                    "visualNote"
                  ],
                  additionalProperties: false
                }
              }
            },
            required: ["questions"],
            additionalProperties: false
          }
        }
      }
    })
  });

  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    const errorText = data?.error?.message || data?.error || "OpenAI visual PDF request failed";
    console.error("OpenAI visual PDF error:", errorText);
    return [];
  }
  const jsonText = data?.output_text || data?.output?.[0]?.content?.[0]?.text || "";
  try {
    const parsed = JSON.parse(jsonText) as AiResponse;
    return parsed.questions || [];
  } catch {
    console.error("OpenAI visual PDF parse error: could not parse JSON response");
    return [];
  }
}

export async function generateInstructionsWithOpenAI(input: {
  blueprint: string;
  sourceText: string;
}): Promise<string> {
  if (!env.openaiApiKey) return "";

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

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.openaiApiKey}`
    },
    body: JSON.stringify({
      model: env.openaiModel,
      input: prompt
    })
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) return "";
  return String(data?.output?.[0]?.content?.[0]?.text || "").trim();
}
