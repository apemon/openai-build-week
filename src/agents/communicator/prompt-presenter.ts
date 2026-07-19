import { z } from "zod";

import { buildPromptSpeechInstructions } from "./speech-instructions";

const promptIdSchema = z.string().trim().min(1).max(200);

export interface SpeakBrainPromptEvent {
  type: "response.create";
  response: {
    conversation: "none";
    metadata: {
      purpose: "speak_brain_prompt";
      promptId: string;
    };
    input: [];
    output_modalities: ["audio"];
    instructions: string;
    max_output_tokens: number;
    tools: [];
  };
}

export function createSpeakBrainPromptEvent(
  promptId: string,
  spokenQuestion: string,
): SpeakBrainPromptEvent {
  const validatedPromptId = promptIdSchema.parse(promptId);

  return {
    type: "response.create",
    response: {
      conversation: "none",
      metadata: {
        purpose: "speak_brain_prompt",
        promptId: validatedPromptId,
      },
      input: [],
      output_modalities: ["audio"],
      instructions: buildPromptSpeechInstructions(spokenQuestion),
      max_output_tokens: 200,
      tools: [],
    },
  };
}
