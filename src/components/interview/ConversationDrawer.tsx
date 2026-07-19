"use client";

import type { ConversationTurn } from "@/domain/types";

export function ConversationDrawer({ turns }: { turns: ConversationTurn[] }) {
  return <details className="rounded-2xl border border-stone-700 bg-stone-900"><summary className="min-h-11 cursor-pointer px-4 py-3 font-semibold">Conversation history <span className="text-stone-400">({turns.length})</span></summary><ol className="space-y-4 border-t border-stone-700 p-4">{turns.length ? turns.map((turn) => <li key={turn.id}><div className="flex flex-wrap gap-2 text-xs uppercase tracking-wide text-stone-400"><span>{turn.type.replaceAll("_", " ")}</span><span>{new Date(turn.createdAt).toLocaleTimeString()}</span></div><p className="mt-1 whitespace-pre-wrap text-stone-200">{turn.text}</p></li>) : <li className="text-stone-400">No confirmed turns yet.</li>}</ol></details>;
}
