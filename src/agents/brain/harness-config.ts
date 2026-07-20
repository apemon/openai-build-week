import { brainHarnessModeSchema, type BrainHarnessMode } from "@/domain/v3-schemas";

import { BrainRunError } from "./retry-policy";

export interface BrainHarnessConfiguration {
  mode: BrainHarnessMode;
  publicSearchEnabled: boolean;
}

export function readBrainHarnessConfiguration(
  surface: "live_route" | "local_evaluation",
  environment: NodeJS.ProcessEnv = process.env,
): BrainHarnessConfiguration {
  const parsedMode = brainHarnessModeSchema.safeParse(environment.OPENAI_BRAIN_HARNESS ?? "one_shot");
  if (!parsedMode.success) {
    throw new BrainRunError("INVALID_REQUEST", "The configured Brain harness is invalid.", false);
  }
  const publicSearchEnabled = environment.BRAIN_PUBLIC_SEARCH_ENABLED === "true";
  if (surface === "live_route" && parsedMode.data !== "one_shot") {
    throw new BrainRunError("INVALID_REQUEST", "Experimental harnesses are unavailable on the ordinary Live route.", false);
  }
  if (publicSearchEnabled && (surface !== "local_evaluation" || parsedMode.data !== "codex_ephemeral")) {
    throw new BrainRunError("INVALID_REQUEST", "Public search is available only to acknowledged local codex_ephemeral evaluation.", false);
  }
  if (parsedMode.data !== "one_shot" && environment.BRAIN_EXPERIMENTAL_HARNESSES_ENABLED !== "true") {
    throw new BrainRunError("INVALID_REQUEST", "Experimental Brain harnesses are disabled.", false);
  }
  return { mode: parsedMode.data, publicSearchEnabled };
}
