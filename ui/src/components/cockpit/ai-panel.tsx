/**
 * AI Panel — правая зона окна (спека §1): вкладки Loop X-Ray (S2) и Self-Check
 * (S6). Семейство доверия: X-Ray — про луп, Self-Check — про микс. Метка у
 * вкладки Self-Check — общий свет последнего отчёта, чтобы итог был виден,
 * даже когда открыта другая вкладка.
 */
import { useState } from "react";
import { useCockpit } from "@/store/cockpit";
import { LIGHT_LABEL } from "@/lib/lights";
import { tabPanelProps } from "@/lib/tab-panel";
import { overallLight, selfCheckRows } from "@/lib/xray";
import { LightDot } from "@/components/cockpit/light";
import { PanelTabs } from "@/components/cockpit/panel-tabs";
import { SelfCheckPanel } from "@/components/cockpit/self-check-panel";
import { XRayPanel } from "@/components/cockpit/xray-panel";

type AiTab = "xray" | "check";

export function AiPanel() {
  const [tab, setTab] = useState<AiTab>("xray");
  const { selfCheck, xray, analyzing } = useCockpit();
  // громкость строки не зависит от замера экспорта — для метки хватает отчёта
  const light = selfCheck ? overallLight(selfCheckRows(selfCheck, xray, null)) : null;

  return (
    <aside aria-label="AI Panel" className="bg-card flex min-h-0 flex-col gap-2 rounded-2xl border p-3">
      <PanelTabs
        idPrefix="ai"
        label="AI Panel"
        onChange={setTab}
        tabs={[
          {
            id: "xray",
            label: "Loop X-Ray",
            badge: analyzing ? (
              <span
                aria-label="Слушаю луп"
                className="bg-warning inline-block size-1.5 shrink-0 animate-pulse rounded-full motion-reduce:animate-none"
                role="img"
              />
            ) : null,
          },
          {
            id: "check",
            label: "Self-Check",
            badge: light ? <LightDot label={LIGHT_LABEL[light]} light={light} /> : null,
          },
        ]}
        value={tab}
      />
      <div {...tabPanelProps("ai", tab)} className="flex min-h-0 flex-1 flex-col">
        {tab === "xray" ? <XRayPanel /> : <SelfCheckPanel />}
      </div>
    </aside>
  );
}
