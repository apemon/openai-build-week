import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { arch, cpus, hostname, platform, release } from "node:os";
import { join } from "node:path";

import type { BrainHarness } from "@/domain/brain-harness";
import type { BrainHarnessMode, V3BrainResponse } from "@/domain/v3-schemas";

import { buildEvaluationRequest, evaluationDatasetHash, syntheticEvaluationSessions } from "./dataset";
import { nearestRankP95 } from "./gates";
import { EVALUATION_RUBRICS } from "./rubrics";
import { scoreTechnicalOutput } from "./technical-scorer";

export interface FrozenRunnerMetadata {
  seed: string;
  runnerCommit: string;
  promptHash: string;
  schemaHash: string;
  evidenceHash: string;
  sdkVersion: string;
  codexCliVersion: string | null;
  requestedModels: Partial<Record<BrainHarnessMode, string>>;
  flags: { publicSearchEnabled: false; repetitions: number };
  startedAt: string;
  host: { hostname: string; platform: string; release: string; arch: string; cpu: string };
  datasetHash: string;
  rubricHash: string;
}

export interface EvaluationRunSummary {
  metadata: FrozenRunnerMetadata;
  candidates: Array<{
    candidate: BrainHarnessMode;
    completedSamples: number;
    failedSamples: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    coldP95LatencyMs: number;
    warmP95LatencyMs: number;
    timeToFirstLifecycleP95Ms: number;
    firstPassValidityRate: number;
    repairRate: number;
    readinessAccuracy: number;
    contradictionAccuracy: number;
    acceptanceCriterionTestability: number;
    evidenceAuthorityViolationCount: number;
  }>;
  /** Keep private until human scoring is complete. */
  privateLabelMap: Record<string, Record<BrainHarnessMode, string>>;
}

export interface EvaluationRunnerOptions {
  seed: string;
  runnerCommit: string;
  repetitions: number;
  artifactDirectory?: string;
  harnesses: Partial<Record<BrainHarnessMode, BrainHarness>>;
  promptHash: string;
  schemaHash: string;
  evidenceHash: string;
  sdkVersion: string;
  codexCliVersion?: string;
  requestedModels?: Partial<Record<BrainHarnessMode, string>>;
  now?: () => Date;
}

const FORBIDDEN_ARTIFACT_SENTINELS = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/,
  /\bBearer\s+[A-Za-z0-9._-]+/i,
  /OPENAI_API_KEY/i,
  /CODEX_API_KEY/i,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
];

function hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function blindLabel(seed: string, sessionId: string, candidate: BrainHarnessMode): string {
  return `Candidate ${createHash("sha256").update(`${seed}:${sessionId}:${candidate}`).digest("hex").slice(0, 8).toUpperCase()}`;
}

function percentile50(samples: readonly number[]): number {
  if (samples.length === 0) return Number.POSITIVE_INFINITY;
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length / 2) - 1];
}

function assertSyntheticArtifactSafe(serialized: string): void {
  for (const sentinel of FORBIDDEN_ARTIFACT_SENTINELS) {
    if (sentinel.test(serialized)) throw new Error("Evaluation artifact failed the secret/content sentinel scan");
  }
}

export function labelExperimentalEvaluationResponse(
  response: V3BrainResponse,
  candidate: BrainHarnessMode,
): V3BrainResponse {
  return {
    ...response,
    provenance: {
      source: "experimental_evaluation",
      agent: "brain",
      harnessMode: candidate,
      publicSearchEnabled: false,
      localOnly: true,
      requestedModel: response.provenance.requestedModel,
      actualModel: response.provenance.actualModel,
      validatedAt: response.provenance.validatedAt,
      repairAttempted: response.provenance.repairAttempted,
    },
  };
}

async function runOne(
  harness: BrainHarness,
  request: ReturnType<typeof buildEvaluationRequest>,
): Promise<{ response: V3BrainResponse; latencyMs: number; firstLifecycleMs: number }> {
  const controller = new AbortController();
  const startedAt = performance.now();
  let firstLifecycleMs = Number.POSITIVE_INFINITY;
  let response: V3BrainResponse | null = null;
  for await (const event of harness.run(request, controller.signal)) {
    if (event.type === "lifecycle" && !Number.isFinite(firstLifecycleMs)) {
      firstLifecycleMs = performance.now() - startedAt;
    }
    if (event.type === "result") response = event.response;
  }
  if (!response) throw new Error("Candidate ended without a result");
  return { response, latencyMs: performance.now() - startedAt, firstLifecycleMs };
}

/** Opt-in only. It accepts synthetic fixtures exclusively and never discovers
 * or captures runtime Interview Sessions. */
export async function runFrozenEvaluation(options: EvaluationRunnerOptions): Promise<EvaluationRunSummary> {
  if (!Number.isInteger(options.repetitions) || options.repetitions < 3) {
    throw new Error("Frozen evaluation requires at least three repetitions per fixture and candidate");
  }
  const now = options.now ?? (() => new Date());
  const metadata: FrozenRunnerMetadata = {
    seed: options.seed,
    runnerCommit: options.runnerCommit,
    promptHash: options.promptHash,
    schemaHash: options.schemaHash,
    evidenceHash: options.evidenceHash,
    sdkVersion: options.sdkVersion,
    codexCliVersion: options.codexCliVersion ?? null,
    requestedModels: options.requestedModels ?? {},
    flags: { publicSearchEnabled: false, repetitions: options.repetitions },
    startedAt: now().toISOString(),
    host: {
      hostname: hostname(),
      platform: platform(),
      release: release(),
      arch: arch(),
      cpu: cpus()[0]?.model ?? "unknown",
    },
    datasetHash: evaluationDatasetHash(),
    rubricHash: hash(EVALUATION_RUBRICS),
  };
  const privateLabelMap = Object.fromEntries(syntheticEvaluationSessions.map((session) => [
    session.id,
    Object.fromEntries((["one_shot", "responses_native", "codex_ephemeral"] as const)
      .map((candidate) => [candidate, blindLabel(options.seed, session.id, candidate)])),
  ])) as EvaluationRunSummary["privateLabelMap"];
  const candidateSummaries: EvaluationRunSummary["candidates"] = [];

  for (const candidate of ["one_shot", "responses_native", "codex_ephemeral"] as const) {
    const harness = options.harnesses[candidate];
    if (!harness) continue;
    const latencies: number[] = [];
    const coldLatencies: number[] = [];
    const warmLatencies: number[] = [];
    const firstLifecycle: number[] = [];
    let failedSamples = 0;
    const technicalScores: ReturnType<typeof scoreTechnicalOutput>[] = [];
    for (const session of syntheticEvaluationSessions) {
      const request = buildEvaluationRequest(session);
      for (let repetition = 0; repetition < options.repetitions; repetition += 1) {
        try {
          const run = await runOne(harness, request);
          latencies.push(run.latencyMs);
          (repetition === 0 ? coldLatencies : warmLatencies).push(run.latencyMs);
          firstLifecycle.push(run.firstLifecycleMs);
          technicalScores.push(scoreTechnicalOutput(session, run.response));
          if (options.artifactDirectory) {
            const candidateDirectory = join(options.artifactDirectory, "blinded-candidate-outputs", session.id);
            await mkdir(candidateDirectory, { recursive: true });
            const serialized = JSON.stringify(labelExperimentalEvaluationResponse(run.response, candidate));
            assertSyntheticArtifactSafe(serialized);
            await writeFile(
              join(candidateDirectory, `${privateLabelMap[session.id][candidate]}-${repetition + 1}.json`),
              serialized,
              { mode: 0o600 },
            );
          }
        } catch {
          failedSamples += 1;
        }
      }
    }
    candidateSummaries.push({
      candidate,
      completedSamples: latencies.length,
      failedSamples,
      p50LatencyMs: percentile50(latencies),
      p95LatencyMs: nearestRankP95(latencies),
      coldP95LatencyMs: nearestRankP95(coldLatencies),
      warmP95LatencyMs: nearestRankP95(warmLatencies),
      timeToFirstLifecycleP95Ms: nearestRankP95(firstLifecycle),
      firstPassValidityRate: technicalScores.filter((score) => score.firstPassValid).length / Math.max(1, technicalScores.length),
      repairRate: technicalScores.filter((score) => score.repairUsed).length / Math.max(1, technicalScores.length),
      readinessAccuracy: technicalScores.filter((score) => score.readinessCorrect).length / Math.max(1, technicalScores.length),
      contradictionAccuracy: technicalScores.filter((score) => score.contradictionClassificationCorrect).length / Math.max(1, technicalScores.length),
      acceptanceCriterionTestability: technicalScores.reduce((sum, score) => sum + score.acceptanceCriterionTestability, 0) / Math.max(1, technicalScores.length),
      evidenceAuthorityViolationCount: technicalScores.filter((score) => !score.evidenceAuthoritySafe).length,
    });
  }
  const summary = { metadata, candidates: candidateSummaries, privateLabelMap };
  if (options.artifactDirectory) {
    await mkdir(options.artifactDirectory, { recursive: true });
    const serialized = JSON.stringify({ metadata, candidates: candidateSummaries }, null, 2);
    assertSyntheticArtifactSafe(serialized);
    await writeFile(join(options.artifactDirectory, "aggregate-content-free.json"), serialized, { mode: 0o600 });
    await writeFile(
      join(options.artifactDirectory, "private-label-map.json"),
      JSON.stringify(privateLabelMap, null, 2),
      { mode: 0o600 },
    );
  }
  return summary;
}
