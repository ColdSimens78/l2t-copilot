/**
 * L2T Cockpit v0 — AI-кокпит над MCP-шиной (мок-данные, без Tauri-ядра).
 * Стейджинг: три канала-генератора midi-gen с призрачным слоем предложений
 * (proposal §3.1, §4.2, §5). Кнопка = будущий MCP-вызов через Rust-ядро;
 * здесь — мок IPC: данные в формате core/midi_io, как их отдаст ядро.
 */
import { useState } from "react";
import { Pause, Play, Square } from "lucide-react";

import { ChannelCard } from "@/components/cockpit/channel-card";
import type { AcceptanceEvent } from "@/contract/suggestion";
import { bass_real, chords_real, drums_real, SUGGESTIONS } from "@/mock/parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const CHANNELS = [
  { part: "bass" as const, title: "🎸 bass — generate_bassline", notes: bass_real, minPitch: 36, maxPitch: 60 },
  { part: "chords" as const, title: "🎹 chords — generate_chord_progression", notes: chords_real, minPitch: 44, maxPitch: 72 },
  { part: "drums" as const, title: "🥁 drums — generate_drum_pattern", notes: drums_real, minPitch: 34, maxPitch: 44 },
];

function App() {
  // Мок manifest: события accept/reject (Acceptance Rate, PRD §4).
  const [manifest, setManifest] = useState<AcceptanceEvent[]>([]);

  return (
    <div className="bg-background text-foreground flex min-h-svh flex-col gap-3 p-3">
      <header className="bg-card flex flex-wrap items-center gap-2 rounded-2xl border p-3">
        <h1 className="text-base font-semibold">L2T Cockpit</h1>
        <Badge variant="outline">v0 · mock IPC</Badge>
        <span className="text-muted-foreground font-mono text-xs">
          сессия: poc-v0.scraftz · 90 BPM · A minor
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button aria-label="Play" size="icon-sm" variant="ghost"><Play /></Button>
          <Button aria-label="Pause" size="icon-sm" variant="ghost"><Pause /></Button>
          <Button aria-label="Stop" size="icon-sm" variant="ghost"><Square /></Button>
          <Badge className="ml-2" variant="secondary">режим: Ручной</Badge>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-col gap-3">
        <p className="text-muted-foreground px-1 text-xs">
          Стейджинг: канал = генератор midi-gen. Пунктирные ноты — призрачное
          предложение (контракт suggestion: rationale · confidence ·
          source_tool); до accept партия живёт только в UI.
        </p>
        {CHANNELS.map((channel) => (
          <ChannelCard
            key={channel.part}
            bars={4}
            maxPitch={channel.maxPitch}
            minPitch={channel.minPitch}
            notes={channel.notes}
            onDecision={(event) =>
              setManifest((log) => [...log, event])
            }
            part={channel.part}
            suggestion={SUGGESTIONS[channel.part]}
            title={channel.title}
          />
        ))}
      </main>

      {/* AI Dock (USER FLOW v1): одна строка внизу, никогда не модальные спиннеры. */}
      <footer className="bg-card text-muted-foreground mt-auto flex items-center gap-2 rounded-2xl border p-2 font-mono text-xs">
        <span aria-hidden>●</span>
        <span>
          {manifest.length === 0
            ? "ИИ: ожидание — ручной режим, шина не подключена (мок)"
            : `ИИ: последнее — ${manifest[manifest.length - 1].decision} «${manifest[manifest.length - 1].part}» ← ${manifest[manifest.length - 1].source_tool} · manifest: ${manifest.length} соб.`}
        </span>
      </footer>
    </div>
  );
}

export default App;
