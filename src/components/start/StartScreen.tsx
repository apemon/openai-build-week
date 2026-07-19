"use client";

export interface StartScreenProps {
  liveEnabled: boolean;
  liveUnavailableReason?: string;
  onEnableMicrophone: () => void | Promise<void>;
  onStartLiveText: () => void;
  onStartPreparedDemo: () => void;
}

export function StartScreen({ liveEnabled, liveUnavailableReason, onEnableMicrophone, onStartLiveText, onStartPreparedDemo }: StartScreenProps) {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl items-center px-5 py-12 sm:px-8">
      <div className="w-full">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.22em] text-amber-300">Requirements interview room</p>
        <h1 className="max-w-4xl text-5xl font-semibold tracking-tight text-stone-50 sm:text-7xl">Spec Grill</h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-stone-300">Turn a vague product request into a traceable, implementation-ready Specification—one consequential question at a time.</p>

        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <section aria-labelledby="live-title" className="rounded-3xl border border-stone-700 bg-stone-900/80 p-6 sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="live-title" className="text-2xl font-semibold">Live interview</h2>
              <span className="rounded-full border border-sky-600 px-3 py-1 text-sm text-sky-200">Live AI</span>
            </div>
            <p className="mt-4 text-stone-300">Speak or type your real product intent. You review every Answer Draft before it reaches the Brain.</p>
            <div className="mt-5 rounded-2xl bg-stone-950 p-4 text-sm leading-6 text-stone-300">
              <p>Spec Grill does not persist raw audio or session text on its servers. Live audio and text are processed by OpenAI under the deployed project&apos;s data controls.</p>
              <p className="mt-2 font-medium text-amber-200">Do not enter confidential or regulated information in this hackathon demo.</p>
            </div>
            {!liveEnabled && <p role="status" className="mt-4 rounded-xl border border-amber-700 bg-amber-950/40 p-3 text-sm text-amber-100">Live Mode is unavailable. {liveUnavailableReason ?? "Server configuration is disabled."}</p>}
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button type="button" disabled={!liveEnabled} onClick={onEnableMicrophone} className="min-h-11 rounded-xl bg-sky-300 px-5 py-3 font-semibold text-stone-950 disabled:cursor-not-allowed disabled:bg-stone-700 disabled:text-stone-400">Enable microphone</button>
              <button type="button" disabled={!liveEnabled} onClick={onStartLiveText} className="min-h-11 rounded-xl border border-stone-600 px-5 py-3 font-semibold text-stone-100 disabled:cursor-not-allowed disabled:text-stone-500">Continue with text only</button>
            </div>
          </section>

          <section aria-labelledby="demo-title" className="rounded-3xl border border-amber-700/70 bg-amber-950/20 p-6 sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="demo-title" className="text-2xl font-semibold">Prepared Demo</h2>
              <span className="rounded-full border border-amber-500 bg-amber-900/40 px-3 py-1 text-sm font-medium text-amber-100">Prepared demo • no AI call</span>
            </div>
            <p className="mt-4 text-stone-300">Walk through a deterministic seven-decision team-billing scenario with prevalidated snapshots. It needs no microphone, network, or OpenAI key.</p>
            <button type="button" onClick={onStartPreparedDemo} className="mt-6 min-h-11 w-full rounded-xl bg-amber-300 px-5 py-3 font-semibold text-stone-950 sm:w-auto">Run prepared demo</button>
          </section>
        </div>
      </div>
    </main>
  );
}
