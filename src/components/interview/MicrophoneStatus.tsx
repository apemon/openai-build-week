export type MicrophoneDisplayState = "off" | "listening" | "speech_detected" | "transcribing" | "reviewing_answer";
const labels: Record<MicrophoneDisplayState, string> = { off: "Microphone off", listening: "Listening", speech_detected: "Speech detected", transcribing: "Transcribing", reviewing_answer: "Microphone paused while you review" };

export function MicrophoneStatus({ state, voiceMuted, onToggleVoice, onResume, canResume = false }: { state: MicrophoneDisplayState; voiceMuted: boolean; onToggleVoice: () => void; onResume?: () => void; canResume?: boolean }) {
  return <div className="flex flex-wrap items-center gap-2 text-sm"><span role="status" className="min-h-11 rounded-full border border-stone-600 px-4 py-3">● {labels[state]}</span><button type="button" aria-pressed={voiceMuted} onClick={onToggleVoice} className="min-h-11 rounded-full border border-stone-600 px-4">{voiceMuted ? "Unmute voice" : "Mute voice"}</button>{canResume && onResume && <button type="button" onClick={onResume} className="min-h-11 rounded-full border border-sky-700 px-4 text-sky-200">Resume microphone</button>}</div>;
}
