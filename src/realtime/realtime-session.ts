import { COMMUNICATOR_SESSION_INSTRUCTIONS } from "@/agents/communicator/speech-instructions";

export const REALTIME_MODEL = "gpt-realtime-2.1";
export const TRANSCRIPTION_MODEL = "gpt-4o-transcribe";
export const REALTIME_VOICE = "marin";
export const REALTIME_CLIENT_SECRET_TTL_SECONDS = 600;

export interface LockedRealtimeSession {
  type: "realtime";
  model: string;
  output_modalities: ["audio"];
  instructions: string;
  tools: [];
  tool_choice: "none";
  audio: {
    input: {
      turn_detection: {
        type: "semantic_vad";
        eagerness: "medium";
        create_response: false;
        interrupt_response: false;
      };
      transcription: {
        model: string;
        language: "en";
      };
    };
    output: {
      voice: string;
    };
  };
}

export function createLockedRealtimeSession(
  realtimeModel = REALTIME_MODEL,
  transcriptionModel = TRANSCRIPTION_MODEL,
  voice = REALTIME_VOICE,
): LockedRealtimeSession {
  return {
    type: "realtime",
    model: realtimeModel,
    output_modalities: ["audio"],
    instructions: COMMUNICATOR_SESSION_INSTRUCTIONS,
    tools: [],
    tool_choice: "none",
    audio: {
      input: {
        turn_detection: {
          type: "semantic_vad",
          eagerness: "medium",
          create_response: false,
          interrupt_response: false,
        },
        transcription: {
          model: transcriptionModel,
          language: "en",
        },
      },
      output: { voice },
    },
  };
}

export function isLockedRealtimeSession(
  session: unknown,
  expected: LockedRealtimeSession,
): boolean {
  if (!session || typeof session !== "object") return false;
  const candidate = session as Record<string, unknown>;
  const audio = candidate.audio as Record<string, unknown> | undefined;
  const input = audio?.input as Record<string, unknown> | undefined;
  const output = audio?.output as Record<string, unknown> | undefined;
  const turnDetection = input?.turn_detection as Record<string, unknown> | undefined;
  const transcription = input?.transcription as Record<string, unknown> | undefined;

  return (
    candidate.type === expected.type &&
    candidate.model === expected.model &&
    Array.isArray(candidate.output_modalities) &&
    candidate.output_modalities.length === 1 &&
    candidate.output_modalities[0] === "audio" &&
    candidate.instructions === expected.instructions &&
    Array.isArray(candidate.tools) &&
    candidate.tools.length === 0 &&
    candidate.tool_choice === "none" &&
    turnDetection?.type === "semantic_vad" &&
    turnDetection.eagerness === "medium" &&
    turnDetection.create_response === false &&
    turnDetection.interrupt_response === false &&
    transcription?.model === expected.audio.input.transcription.model &&
    transcription.language === "en" &&
    output?.voice === expected.audio.output.voice
  );
}
