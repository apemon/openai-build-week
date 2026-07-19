import { preparedTurnAt, teamBillingDecisions } from "./team-billing-scenario";
import { teamBillingPrompts, teamBillingSnapshots, validatePreparedSnapshots } from "./team-billing-snapshots";
import type { ConversationTurn, InterviewPrompt, Specification } from "@/domain/types";

export interface DemoStep {
  index: number;
  decision: (typeof teamBillingDecisions)[number];
  prompt: InterviewPrompt;
  turn: ConversationTurn;
  specification: Specification;
  nextPrompt: InterviewPrompt | null;
}

export class PreparedDemoRunner {
  readonly total = teamBillingDecisions.length;
  #index = 0;

  constructor() { validatePreparedSnapshots(); }
  get index() { return this.#index; }
  get complete() { return this.#index >= this.total; }
  get currentPrompt() { return this.complete ? null : teamBillingPrompts[this.#index]; }
  get currentDecision() { return this.complete ? null : teamBillingDecisions[this.#index]; }

  advance(createdAt?: string): DemoStep {
    if (this.complete) throw new Error("Prepared Demo is already complete");
    const index = this.#index++;
    return {
      index,
      decision: teamBillingDecisions[index],
      prompt: teamBillingPrompts[index],
      turn: preparedTurnAt(index, createdAt),
      specification: teamBillingSnapshots[index],
      nextPrompt: teamBillingPrompts[index + 1] ?? null,
    };
  }

  reset() { this.#index = 0; }
}

export function playPreparedAudio(src: string, audioFactory: (src: string) => Pick<HTMLAudioElement, "play"> = (value) => new Audio(value)): Promise<boolean> {
  try {
    return Promise.resolve(audioFactory(src).play()).then(() => true).catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}
