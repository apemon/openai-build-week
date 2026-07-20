import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { createInitialContextDigest, createInitialState, initialInterviewPrompt } from "@/domain/initial-state";
import type { SessionState } from "@/domain/types";
import { CHECKPOINT_KEY, clearCheckpoint, createCheckpoint, restoreCheckpoint } from "@/lib/session-checkpoint";

const timestamp = "2026-07-20T00:00:00.000Z";

describe("V2 reload and privacy cleanup", () => {
  it("keeps confirmed digest provenance/metadata but strips original extraction and all pending wording", () => {
    const digest = {
      ...createInitialContextDigest(new Date(timestamp)),
      sources: [
        ...createInitialContextDigest(new Date(timestamp)).sources,
        { id: "SOURCE-FILE", kind: "uploaded_file" as const, filename: "private-brief.md", mimeType: "text/markdown", sizeBytes: 123, characterCount: 42, pageCount: null },
      ],
      coverage: { coveredLocations: ["Private heading"], omissions: ["Appendix was unreadable."], warnings: ["Partial extraction"], requiresAcknowledgement: true },
    };
    const state: SessionState = {
      ...createInitialState("live", new Date(timestamp)),
      phase: "reviewing_answer",
      revision: 1,
      confirmedContextDigest: digest,
      contextPreparation: {
        requestId: "REQUEST-CONTEXT",
        status: "ready",
        draftDigest: { ...digest, confirmedAt: null },
        temporaryExtraction: {
          sourceId: "SOURCE-FILE",
          complete: false,
          warnings: ["Partial extraction"],
          excerpts: [{
            id: "EXCERPT-SECRET",
            sourceId: "SOURCE-FILE",
            text: "FULL-EXTRACTION-MUST-NOT-SURVIVE",
            reference: { sourceId: "SOURCE-FILE", location: "Private heading", page: null, heading: "Private heading", paragraph: 1 },
          }],
        },
        warningAcknowledged: true,
      },
      temporaryExtractionAvailable: true,
      answerDraft: { text: "UNCONFIRMED-ANSWER-MUST-NOT-SURVIVE", source: "typed", promptId: "PROMPT-INITIAL", transcriptionItemId: null },
      activeLookahead: {
        approval: {
          roadmapItemId: "ROADMAP-001",
          prompt: { ...initialInterviewPrompt, id: "PROMPT-LOOKAHEAD" },
          approvedAtRevision: 0,
          dependencyVersion: "DEPENDENCY-0",
          independentOfOperation: "answer",
        },
        status: "summary_draft",
        clarificationTurns: [{ id: "CLARIFICATION-001", role: "product_manager", text: "RAW-CLARIFICATION-MUST-NOT-SURVIVE", createdAt: timestamp }],
        decisionSummary: {
          id: "SUMMARY-001",
          roadmapItemId: "ROADMAP-001",
          text: "UNCONFIRMED-SUMMARY-MUST-NOT-SURVIVE",
          uncertainties: [],
          status: "draft",
          approvedAtRevision: 0,
          dependencyVersion: "DEPENDENCY-0",
          confirmedAt: null,
          staleReason: null,
        },
      },
    };

    const serialized = JSON.stringify(createCheckpoint(state, new Date(timestamp)));
    expect(serialized).toContain("private-brief.md");
    expect(serialized).toContain("Appendix was unreadable.");
    expect(serialized).not.toContain("FULL-EXTRACTION-MUST-NOT-SURVIVE");
    expect(serialized).not.toContain("UNCONFIRMED-ANSWER-MUST-NOT-SURVIVE");
    expect(serialized).not.toContain("RAW-CLARIFICATION-MUST-NOT-SURVIVE");
    expect(serialized).not.toContain("UNCONFIRMED-SUMMARY-MUST-NOT-SURVIVE");
  });

  it("clears the per-tab checkpoint on explicit cleanup", () => {
    const storage = { removeItem: vi.fn() };
    clearCheckpoint(storage);
    expect(storage.removeItem).toHaveBeenCalledOnce();
    expect(storage.removeItem).toHaveBeenCalledWith(CHECKPOINT_KEY);
  });

  it("restores a confirmed digest after reload without restoring its temporary extraction", () => {
    const digest = createInitialContextDigest(new Date(timestamp));
    const preparingInitialRevision: SessionState = {
      ...createInitialState("live", new Date(timestamp)),
      phase: "analyzing",
      confirmedContextDigest: digest,
      temporaryExtractionAvailable: true,
      pendingRequest: { requestId: "REQUEST-INITIALIZE", baseRevision: 0, operation: "initialize", actionId: "ACTION-INITIALIZE" },
      processingStage: "validating_confirmed_input",
    };
    const checkpoint = createCheckpoint(preparingInitialRevision, new Date(timestamp));
    const storage = {
      getItem: vi.fn(() => JSON.stringify(checkpoint)),
      removeItem: vi.fn(),
    };
    const restored = restoreCheckpoint(storage, new Date("2026-07-20T00:01:00.000Z"));
    expect(restored).toMatchObject({
      phase: "connecting",
      confirmedContextDigest: digest,
      temporaryExtractionAvailable: false,
      pendingRequest: null,
      processingStage: "idle",
    });
  });
});

describe("V2 leaked-secret protections", () => {
  it("keeps committed environment defaults disabled and credential-free", () => {
    const example = readFileSync(".env.example", "utf8");
    const ignore = readFileSync(".gitignore", "utf8");
    expect(example).toContain("OPENAI_API_KEY=\n");
    expect(example).toContain("LIVE_AI_ENABLED=false");
    expect(example).not.toMatch(/NEXT_PUBLIC_.*(?:KEY|SECRET|TOKEN)/);
    expect(example).not.toMatch(/\bsk-[A-Za-z0-9_-]{16,}\b/);
    expect(ignore).toMatch(/^\.env\*$/m);
    expect(ignore).toContain("!.env.example");
  });

  it("does not reference the standard OpenAI key from browser-owned source modules", () => {
    const browserSources = [
      "src/app/SpecGrillApp.tsx",
      "src/app/brain-client.ts",
      "src/realtime/OpenAIWebRTCTransport.ts",
      "src/realtime/realtime-client.ts",
      "src/lib/session-checkpoint.ts",
    ].map((file) => readFileSync(file, "utf8")).join("\n");
    expect(browserSources).not.toContain("process.env.OPENAI_API_KEY");
    expect(browserSources).not.toContain("NEXT_PUBLIC_OPENAI");
  });
});
