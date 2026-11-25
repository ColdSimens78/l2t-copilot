/**
 * L2T Cockpit — каркас главного окна (спека ui-screens-v0.md §1):
 * TopBar / (Channel Rack | центр S4/S5 | AI Panel S2/S6) / AI Dock
 * + Bus Inspector drawer (S7). Экраны = фокусы зон одного окна.
 */
import { ApiContext, currentAdapter } from "@/ipc/api";
import { CockpitProvider, useCockpit } from "@/store/cockpit";
import { TopBar } from "@/components/cockpit/top-bar";
import { ChannelRack } from "@/components/cockpit/channel-rack";
import { AiPanel } from "@/components/cockpit/ai-panel";
import { AiDock } from "@/components/cockpit/ai-dock";
import { ToastHost } from "@/components/cockpit/toast-host";
import { DropZone } from "@/screens/s1-drop-zone";
import { CenterStage } from "@/screens/center-stage";

/** Центр: до Loop X-Ray — drop-зона лупа (S1), после — тумблер Слои / Playlist (S4/S5). */
function Center() {
  const { xray } = useCockpit();
  return (
    <main className="bg-card flex min-h-0 flex-col rounded-2xl border">
      {xray ? <CenterStage /> : <DropZone />}
    </main>
  );
}

function App() {
  return (
    <ApiContext.Provider value={currentAdapter}>
      <CockpitProvider>
        <div className="bg-background text-foreground flex h-svh flex-col gap-2 p-3">
          <TopBar />
          <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)_320px] gap-2">
            <ChannelRack />
            <Center />
            <AiPanel />
          </div>
          <AiDock />
          <ToastHost />
        </div>
      </CockpitProvider>
    </ApiContext.Provider>
  );
}

export default App;
