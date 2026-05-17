import { env } from "../config/env";

type GradeInput = {
  essayTopic: string;
  letterTopic: string;
  essayText: string;
  letterText: string;
  essayWordCount: number;
  letterWordCount: number;
  essayTargetWords: number;
  letterTargetWords: number;
  maxEssayMarks: number;
  maxLetterMarks: number;
};

type GradeResult = {
  essayScore: number;
  letterScore: number;
  totalScore: number;
  feedback: {
    essay: string;
    letter: string;
    overall: string;
  };
  strengths: string[];
  improvements: string[];
};

export async function gradeWritingWithAi(input: GradeInput): Promise<GradeResult | null> {
  const prompt = [
    "You are a professional Banking/Insurance descriptive writing evaluator (OICL AO Mains standard).",
    "Evaluate essay and letter using formal exam rubrics.",
    "Check word count adherence, grammar, structure, coherence, tone, and required format.",
    "Essay rubric: clarity of thesis, logical flow, paragraphing, examples/data, conclusion.",
    "Letter rubric: proper format, salutation, subject, tone, purpose, closing, and brevity.",
    "Penalize for weak structure, off-topic content, poor grammar, and missing format elements.",
    "Do not be overly generous; be strict but fair.",
    "Return concise, actionable feedback.",
    "",
    `Essay topic: ${input.essayTopic}`,
    `Letter topic: ${input.letterTopic}`,
    `Essay target words: ${input.essayTargetWords}`,
    `Letter target words: ${input.letterTargetWords}`,
    `Essay max marks: ${input.maxEssayMarks}`,
    `Letter max marks: ${input.maxLetterMarks}`,
    `Essay word count: ${input.essayWordCount}`,
    `Letter word count: ${input.letterWordCount}`,
    "",
    "Essay response:",
    input.essayText,
    "",
    "Letter response:",
    input.letterText
  ].join("\n");

  if (env.geminiApiKey) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.geminiApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 800,
            responseMimeType: "application/json",
            responseSchema: {
              type: "object",
              properties: {
                essayScore: { type: "number" },
                letterScore: { type: "number" },
                totalScore: { type: "number" },
                feedback: {
                  type: "object",
                  properties: {
                    essay: { type: "string" },
                    letter: { type: "string" },
                    overall: { type: "string" }
                  },
                  required: ["essay", "letter", "overall"]
                },
                strengths: { type: "array", items: { type: "string" } },
                improvements: { type: "array", items: { type: "string" } }
              },
              required: ["essayScore", "letterScore", "totalScore", "feedback"]
            }
          }
        })
      }
    );
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) return null;
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    try {
      return JSON.parse(text) as GradeResult;
    } catch {
      return null;
    }
  }

  if (env.openaiApiKey) {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.openaiApiKey}`
      },
      body: JSON.stringify({
        model: env.openaiModel,
        input: prompt,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "writing_grade",
            schema: {
              type: "object",
              properties: {
                essayScore: { type: "number" },
                letterScore: { type: "number" },
                totalScore: { type: "number" },
                feedback: {
                  type: "object",
                  properties: {
                    essay: { type: "string" },
                    letter: { type: "string" },
                    overall: { type: "string" }
                  },
                  required: ["essay", "letter", "overall"]
                },
                strengths: { type: "array", items: { type: "string" } },
                improvements: { type: "array", items: { type: "string" } }
              },
              required: ["essayScore", "letterScore", "totalScore", "feedback"]
            }
          }
        }
      })
    });
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) return null;
    const jsonText = data?.output?.[0]?.content?.[0]?.text || "";
    try {
      return JSON.parse(jsonText) as GradeResult;
    } catch {
      return null;
    }
  }

  return null;
}

export function gradeWritingFallback(input: GradeInput): GradeResult {
  const essayRatio = Math.min(1, input.essayWordCount / input.essayTargetWords);
  const letterRatio = Math.min(1, input.letterWordCount / input.letterTargetWords);
  const essayScore = Math.max(0, Math.round(input.maxEssayMarks * (0.5 + essayRatio / 2)));
  const letterScore = Math.max(0, Math.round(input.maxLetterMarks * (0.5 + letterRatio / 2)));
  const totalScore = essayScore + letterScore;
  return {
    essayScore,
    letterScore,
    totalScore,
    feedback: {
      essay: "Focus on structure, clarity, and covering all points in the essay.",
      letter: "Use a proper format and concise, formal language in the letter.",
      overall: "Good effort. Improve organization and add more specific examples."
    },
    strengths: ["Clear attempt", "Good effort"],
    improvements: ["Add structure", "Increase relevance to the topic"]
  };
}
