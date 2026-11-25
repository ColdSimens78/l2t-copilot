/**
 * Связь вкладки с её панелей по id: PanelTabs ставит вкладке id
 * `<префикс>-tab-<id>` и aria-controls на панель, панель получает обратный
 * aria-labelledby. Схема имён живёт только здесь — вкладки и панели не
 * договариваются о ней руками.
 */

/** Атрибуты корня панели — разложить по элементу панели. */
export function tabPanelProps<ID extends string>(idPrefix: string, id: ID) {
  return {
    id: `${idPrefix}-${id}`,
    role: "tabpanel" as const,
    "aria-labelledby": `${idPrefix}-tab-${id}`,
  };
}
