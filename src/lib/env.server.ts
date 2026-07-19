import "server-only";
import { z } from "zod";

const serverEnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_BRAIN_MODEL: z.string().min(1).default("gpt-5.6"),
  OPENAI_REALTIME_MODEL: z.string().min(1).default("gpt-realtime-2.1"),
  OPENAI_TRANSCRIPTION_MODEL: z.string().min(1).default("gpt-4o-transcribe"),
  LIVE_AI_ENABLED: z.enum(["true", "false"]).default("false"),
  ALLOWED_ORIGIN: z.string().url().default("http://localhost:3000"),
});

export function getServerEnv() {
  const parsed = serverEnvSchema.parse(process.env);
  return {
    ...parsed,
    liveConfigured: parsed.LIVE_AI_ENABLED === "true" && Boolean(parsed.OPENAI_API_KEY),
  } as const;
}

export function getPublicRuntimeConfig() {
  const env = getServerEnv();
  return { liveEnabled: env.liveConfigured } as const;
}
