import { z } from "zod";

const eventId = z.string().trim().min(1).max(512);
const providerId = z.string().trim().min(1).max(512);
const transcript = z.string().max(4_000);

const sessionEventSchema = z.object({
  event_id: eventId,
  type: z.enum(["session.created", "session.updated"]),
  session: z.record(z.string(), z.unknown()),
});

const providerErrorEventSchema = z.object({
  event_id: eventId,
  type: z.literal("error"),
  error: z.object({
    type: z.string().trim().min(1).max(200).optional(),
    code: z.string().trim().min(1).max(200).optional(),
    message: z.string().max(2_000).optional(),
  }),
});

const speechStartedSchema = z.object({
  event_id: eventId,
  type: z.literal("input_audio_buffer.speech_started"),
  item_id: providerId,
  audio_start_ms: z.number().int().nonnegative(),
});

const speechStoppedSchema = z.object({
  event_id: eventId,
  type: z.literal("input_audio_buffer.speech_stopped"),
  item_id: providerId,
  audio_end_ms: z.number().int().nonnegative(),
});

const transcriptDeltaSchema = z.object({
  event_id: eventId,
  type: z.literal("conversation.item.input_audio_transcription.delta"),
  item_id: providerId,
  content_index: z.number().int().nonnegative(),
  delta: transcript,
});

const transcriptCompletedSchema = z.object({
  event_id: eventId,
  type: z.literal("conversation.item.input_audio_transcription.completed"),
  item_id: providerId,
  content_index: z.number().int().nonnegative(),
  transcript,
});

const responseCreatedSchema = z.object({
  event_id: eventId,
  type: z.literal("response.created"),
  response: z.object({
    id: providerId,
    metadata: z.record(z.string(), z.string()).nullable().optional(),
  }),
});

const outputTranscriptDeltaSchema = z.object({
  event_id: eventId,
  type: z.literal("response.output_audio_transcript.delta"),
  response_id: providerId,
  item_id: providerId,
  output_index: z.number().int().nonnegative(),
  content_index: z.number().int().nonnegative(),
  delta: transcript,
});

const outputTranscriptDoneSchema = z.object({
  event_id: eventId,
  type: z.literal("response.output_audio_transcript.done"),
  response_id: providerId,
  item_id: providerId,
  output_index: z.number().int().nonnegative(),
  content_index: z.number().int().nonnegative(),
  transcript,
});

const outputTextDoneSchema = z.object({
  event_id: eventId,
  type: z.literal("response.output_text.done"),
  response_id: providerId,
  item_id: providerId,
  output_index: z.number().int().nonnegative(),
  content_index: z.number().int().nonnegative(),
  text: transcript,
});

const responseDoneSchema = z.object({
  event_id: eventId,
  type: z.literal("response.done"),
  response: z.object({
    id: providerId,
    status: z.enum(["completed", "cancelled", "failed", "incomplete"]),
    metadata: z.record(z.string(), z.string()).nullable().optional(),
  }),
});

const outputAudioBufferSchema = z.object({
  event_id: eventId,
  type: z.enum(["output_audio_buffer.started", "output_audio_buffer.stopped"]),
  response_id: providerId,
});

export const realtimeServerEventSchema = z.discriminatedUnion("type", [
  sessionEventSchema,
  providerErrorEventSchema,
  speechStartedSchema,
  speechStoppedSchema,
  transcriptDeltaSchema,
  transcriptCompletedSchema,
  responseCreatedSchema,
  outputTranscriptDeltaSchema,
  outputTranscriptDoneSchema,
  outputTextDoneSchema,
  responseDoneSchema,
  outputAudioBufferSchema,
]);

export type RealtimeServerEvent = z.infer<typeof realtimeServerEventSchema>;

const supportedEventTypes = new Set<string>(realtimeServerEventSchema.options.map((schema) => {
  const type = schema.shape.type;
  if (type instanceof z.ZodEnum) return type.options;
  return [type.value];
}).flat());

export type RealtimeEventParseResult =
  | { success: true; event: RealtimeServerEvent }
  | { success: false; reason: "invalid" | "unsupported" };

export function parseRealtimeServerEvent(input: unknown): RealtimeEventParseResult {
  let value: unknown = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch {
      return { success: false, reason: "invalid" };
    }
  }

  const eventType = z.object({ type: z.string() }).safeParse(value);
  if (!eventType.success) return { success: false, reason: "invalid" };
  if (!supportedEventTypes.has(eventType.data.type)) {
    return { success: false, reason: "unsupported" };
  }

  const parsed = realtimeServerEventSchema.safeParse(value);
  return parsed.success
    ? { success: true, event: parsed.data }
    : { success: false, reason: "invalid" };
}
