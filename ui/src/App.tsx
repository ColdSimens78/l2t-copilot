/**
 * L2T Cockpit — каркас фазы B. Экраны S0–S7 по docs/ui-screens-v0.md.
 * ЗАГОЛУШКА между заходами (квота-экономия): IPC-слой подключён,
 * экраны приходят в следующих заходах.
 */
import { ApiContext, currentAdapter } from "@/ipc/api";

function App() {
  return (
    <ApiContext.Provider value={currentAdapter}>
      <div className="bg-background text-foreground flex min-h-svh flex-col p-3">
        <p className="text-muted-foreground font-mono text-xs">
          IPC-слой фазы B подключён (адаптер: mock). Экраны S0–S7 — в следующих
          заходах.
        </p>
      </div>
    </ApiContext.Provider>
  );
}

export default App;
