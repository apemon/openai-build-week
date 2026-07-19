import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import OpenAI from "openai";
import { teamBillingPrompts } from "../src/demo/team-billing-snapshots";

const outputNames = [
  "00-initial-request.mp3",
  "01-permissions.mp3",
  "02-pricing-basis.mp3",
  "03-seat-changes.mp3",
  "04-failed-payment.mp3",
  "05-provider.mp3",
  "06-success.mp3",
  "07-tax.mp3",
] as const;

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY must be configured in .env.local to generate prepared audio.");
  }
  if (teamBillingPrompts.length !== outputNames.length) {
    throw new Error("Prepared prompt and output filename counts differ.");
  }

  const client = new OpenAI();
  const outputDirectory = path.resolve("public/demo-audio");
  const generatedAudio: Buffer[] = [];

  for (const prompt of teamBillingPrompts) {
    const response = await client.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "marin",
      input: prompt.spokenQuestion,
      instructions: "Speak as a calm, concise AI requirements interviewer. Do not add any words.",
      response_format: "mp3",
    });
    generatedAudio.push(Buffer.from(await response.arrayBuffer()));
  }

  await mkdir(outputDirectory, { recursive: true });
  await Promise.all(
    generatedAudio.map((audio, index) => writeFile(path.join(outputDirectory, outputNames[index]), audio)),
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Prepared audio generation failed.";
  console.error(message);
  process.exitCode = 1;
});
