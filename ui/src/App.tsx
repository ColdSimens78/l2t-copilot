/**
 * L2T Cockpit — каркас главного окна (спека ui-screens-v0.md §1):
 * TopBar / (Channel Rack | центр S4/S5 | AI Panel S2/S6) / AI Dock
 * + Bus Inspector drawer (S7, заходит №5). Экраны = фокусы зон одного окна.
 */
import { ApiContext, currentAdapter } from "@/ipc/api";
import { CockpitProvider } from "@/store/cockpit";
import { TopBar } from "@/components/cockpit/top-bar";
import { AiDock } from "@/components/cockpit/ai-dock";
import { ToastHost } from "@/components/cockpit/toast-host";
import { DropZone } from "@/screens/s1-drop-zone";

function App() {
  return (
    <ApiContext.Provider value={currentAdapter}>
      <CockpitProvider>
        <div className="bg-background text-foreground flex h-svh flex-col gap-2 p-3">
          <TopBar />
          <div className="grid min-h-0 flex-1 grid-cols-[280px_1fr_320px] gap-2">
            <aside className="bg-card flex flex-col rounded-2xl border p-3">
              <h2 className="text-card-foreground text-sm font-semibold">Channel Rack</h2>
              <p className="text-muted-foreground mt-2 text-xs">
                3 генератора = 3 канала (S3 — заход №4). Источник лупа появится
                здесь после X-Ray.
              </p>
            </aside>
            <main className="bg-card flex min-h-0 flex-col rounded-2xl border">
              <DropZone />
              <p className="text-muted-foreground px-4 pb-3 text-center text-[10px]">
                центр: тумблер [Призраки]/[Playlist] — S4/S5 (заход №5)
              </p>
            </main>
            <aside className="bg-card flex flex-col rounded-2xl border p-3">
              <h2 className="text-card-foreground text-sm font-semibold">AI Panel</h2>
              <p className="text-muted-foreground mt-2 text-xs">
                Loop X-Ray (S2) и Self-Check (S6) — заходы №3 и №5.
              </p>
            </aside>
          </div>
          <AiDock />
          <ToastHost />
        </div>
      </CockpitProvider>
    </ApiContext.Provider>
  );
}

export default App;
