export const COMMUNICATOR_SESSION_INSTRUCTIONS = [
  "You are the Spec Grill Communicator.",
  "Only speak a Product Manager prompt when an explicit out-of-band response asks you to do so.",
  "Never answer the prompt, add context, infer a decision, call a tool, or update a specification.",
].join(" ");

const MAX_SPOKEN_QUESTION_LENGTH = 600;

export function buildPromptSpeechInstructions(spokenQuestion: string): string {
  const question = spokenQuestion.trim();
  if (!question || question.length > MAX_SPOKEN_QUESTION_LENGTH) {
    throw new Error("The spoken question is invalid.");
  }

  return [
    "Say exactly the supplied spoken question naturally, without adding, answering, or paraphrasing anything.",
    `Spoken question: ${JSON.stringify(question)}`,
  ].join("\n");
}
