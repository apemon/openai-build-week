"use client";

import { useState } from "react";
import type { AnswerDraft, SessionState, SpecificationItem } from "@/domain/types";
import { AnswerDraftCard } from "./AnswerDraftCard";
import { ConversationDrawer } from "./ConversationDrawer";
import { MicrophoneStatus, type MicrophoneDisplayState } from "./MicrophoneStatus";
import { PromptCard } from "./PromptCard";
import { TextComposer } from "./TextComposer";
import { SpecificationPanel } from "../specification/SpecificationPanel";

export interface InterviewRoomProps {
  state: SessionState;
  remainingLabel: string;
  microphoneState: MicrophoneDisplayState;
  voiceMuted: boolean;
  changedItemIds?: string[];
  preparedAudioUnavailable?: boolean;
  onToggleVoice: () => void;
  onResumeMicrophone: () => void;
  canResumeMicrophone?: boolean;
  onCreateDraft: (draft: AnswerDraft) => void;
  onEditDraft: (text: string) => void;
  onConfirmDraft: () => void;
  onRecordAgain: () => void;
  onDefer?: (note: string) => void;
  onAnswerNow?: () => void;
  onComposerFocus?: () => void;
  onRetryError?: () => void;
  onRestartPreparedDemo?: () => void;
  onReviewSpecification: () => void;
  onCorrectItem: (item: SpecificationItem) => void;
  onUsePreparedAnswer?: () => void;
}

export function InterviewRoom(props: InterviewRoomProps) {
  const { state } = props;
  const [mobileTab, setMobileTab] = useState<"specification" | "history">("specification");
  const provenance = state.mode === "demo" ? "Prepared demo • no AI call" : "Live AI";
  return (
    <main className="mx-auto min-h-screen max-w-[1500px] px-3 py-3 sm:px-5">
      <header className="sticky top-2 z-10 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-stone-700 bg-stone-950/95 p-3 shadow-lg">
        <div className="flex flex-wrap items-center gap-2 text-sm"><strong>Spec Grill</strong><span className={`rounded-full border px-3 py-1 ${state.mode === "demo" ? "border-amber-600 text-amber-100" : "border-sky-600 text-sky-100"}`}>{provenance}</span><span>Readiness: {state.specification.readiness.status.replaceAll("_", " ")}</span><span aria-label={`${props.remainingLabel} remaining`}>⏱ {props.remainingLabel}</span></div>
        <div className="flex flex-wrap gap-2"><MicrophoneStatus state={props.microphoneState} voiceMuted={props.voiceMuted} onToggleVoice={props.onToggleVoice} onResume={props.onResumeMicrophone} canResume={Boolean(props.canResumeMicrophone) && state.mode === "live" && props.microphoneState === "off"} /><button type="button" onClick={props.onReviewSpecification} className="min-h-11 rounded-full bg-stone-100 px-4 font-semibold text-stone-950">Review specification</button></div>
      </header>
      <div aria-live="polite" className="sr-only">{state.phase === "reviewing_answer" ? "Answer Draft ready for review." : state.phase === "analyzing" ? "The Brain is analyzing the confirmed answer." : state.error?.message ?? ""}</div>
      <div role="tablist" aria-label="Session details" className="mb-4 grid grid-cols-2 rounded-xl border border-stone-700 p-1 lg:hidden"><button type="button" role="tab" aria-selected={mobileTab === "specification"} onClick={() => setMobileTab("specification")} className={`min-h-11 rounded-lg px-3 ${mobileTab === "specification" ? "bg-stone-700 font-semibold" : "text-stone-300"}`}>Specification</button><button type="button" role="tab" aria-selected={mobileTab === "history"} onClick={() => setMobileTab("history")} className={`min-h-11 rounded-lg px-3 ${mobileTab === "history" ? "bg-stone-700 font-semibold" : "text-stone-300"}`}>History</button></div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section aria-label="Interview interaction" className="space-y-4">
          <div className="rounded-2xl border border-stone-700 bg-stone-900 p-4"><p className="font-semibold">Communicator <span className="font-normal text-stone-400">· {state.mode === "demo" ? "prepared local prompt audio" : "AI voice"}</span></p><p className="mt-1 text-sm text-stone-300">{state.mode === "demo" ? "Presents prevalidated prepared content without AI or microphone access." : "Presents the Brain-approved prompt. It cannot change your Specification."}</p></div>
          {state.currentPrompt && <PromptCard prompt={state.currentPrompt} onDefer={props.onDefer} onAnswerNow={props.onAnswerNow} preparedAudioUnavailable={props.preparedAudioUnavailable} />}
          {state.phase === "reviewing_answer" && state.answerDraft ? <AnswerDraftCard draft={state.answerDraft} onChange={props.onEditDraft} onConfirm={props.onConfirmDraft} onRecordAgain={props.onRecordAgain} /> : state.mode === "demo" && props.onUsePreparedAnswer ? <button type="button" onClick={props.onUsePreparedAnswer} className="min-h-11 w-full rounded-xl bg-amber-300 px-5 py-3 font-semibold text-stone-950">Use prepared answer</button> : <TextComposer disabled={state.phase === "analyzing"} onTyping={props.onComposerFocus} onReview={(text) => props.onCreateDraft({ text, source: "typed", promptId: state.currentPrompt?.id ?? null, transcriptionItemId: null })} />}
          {state.phase === "analyzing" && <p role="status" className="rounded-xl border border-sky-800 bg-sky-950/30 p-4">Analyzing the confirmed answer… The last validated Specification remains visible.</p>}
          {state.error && <section role="alert" aria-labelledby="recoverable-error-title" className="rounded-xl border border-red-800 bg-red-950/30 p-4"><h2 id="recoverable-error-title" className="font-semibold">{state.mode === "live" ? "Live interview needs attention" : "Prepared Demo needs attention"}</h2><p className="mt-1">{state.error.message}</p>{state.mode === "live" && (props.onRetryError || props.onRestartPreparedDemo) && <div className="mt-3 flex flex-wrap gap-2">{props.onRetryError && <button type="button" onClick={props.onRetryError} className="min-h-11 rounded-lg bg-stone-100 px-4 font-semibold text-stone-950">Retry</button>}{props.onRestartPreparedDemo && <button type="button" onClick={props.onRestartPreparedDemo} className="min-h-11 rounded-lg border border-amber-700 px-4 font-semibold text-amber-100">Restart in prepared demo</button>}</div>}{state.mode === "live" && props.onRestartPreparedDemo && <p className="mt-2 text-sm text-stone-300">Starting Prepared Demo creates a separate prepared session; it does not reuse Live AI data.</p>}</section>}
          <div className="hidden lg:block"><ConversationDrawer turns={state.turns} /></div>
        </section>
        <div className={`${mobileTab === "specification" ? "block" : "hidden"} min-w-0 lg:block`}><SpecificationPanel specification={state.specification} revision={state.revision} changedItemIds={props.changedItemIds} onCorrect={props.onCorrectItem} /></div>
        <div className={`${mobileTab === "history" ? "block" : "hidden"} lg:hidden`}><ConversationDrawer turns={state.turns} /></div>
      </div>
    </main>
  );
}
