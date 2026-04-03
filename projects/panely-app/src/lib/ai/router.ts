import OpenAI from "openai";
import { getProviderModelById, resolveOpenClawModel, type AIProvider } from "@/lib/ai/providers";

export interface GenerateTextInput {
  prompt: string;
  modelId?: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface GenerateTextOutput {
  text: string;
  provider: AIProvider;
  modelId: string;
  model: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function generateWithOpenRouter(
  prompt: string,
  model: string,
  systemPrompt?: string,
  maxTokens = 2048,
  temperature = 0.7
): Promise<string> {
  const client = new OpenAI({
    apiKey: requireEnv("OPENROUTER_API_KEY"),
    baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
  });
  const completion = await client.chat.completions.create({
    model,
    temperature,
    max_tokens: maxTokens,
    messages: [
      ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
      { role: "user" as const, content: prompt },
    ],
  });

  return completion.choices[0]?.message?.content?.trim() || "";
}

export async function generateText(input: GenerateTextInput): Promise<GenerateTextOutput> {
  const modelConfig = getProviderModelById(input.modelId);
  const prompt = input.prompt.trim();

  if (!prompt) {
    throw new Error("Prompt is required");
  }

  const maxTokens = input.maxTokens ?? 2048;
  const temperature = input.temperature ?? 0.7;
  const routedModel = resolveOpenClawModel(modelConfig.id);
  const text = await generateWithOpenRouter(
    prompt,
    routedModel,
    input.systemPrompt,
    maxTokens,
    temperature
  );

  return {
    text,
    provider: modelConfig.provider,
    modelId: modelConfig.id,
    model: routedModel,
  };
}
