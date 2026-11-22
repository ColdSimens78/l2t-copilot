/**
 * Иконка-заглушка audio-ui-компонентов: их registry ссылается на этот модуль,
 * но не поставляет его (у их сайта — мультибиблиотечный lazy-рендер).
 * Наша версия — фиксация на lucide (shortlist oss-recon-ui.md, ISC):
 * компоненты передают имена для пяти библиотек, мы берём lucide-имя
 * ("ChevronRightIcon" → иконка ChevronRight) и рендерим из lucide-react.
 */
import { icons } from "lucide-react";
import type { ComponentProps } from "react";

type IconPlaceholderProps = ComponentProps<"svg"> & {
  lucide?: string;
  // Имена других библиотек принимаются, но игнорируются (lucide — наш выбор).
  hugeicons?: string;
  phosphor?: string;
  remixicon?: string;
  tabler?: string;
};

export function IconPlaceholder({ lucide, ...props }: IconPlaceholderProps) {
  if (!lucide) return null;
  // "ChevronRightIcon" | "ChevronRight" → "ChevronRight"
  const name = lucide.replace(/Icon$/, "") as keyof typeof icons;
  const Icon = icons[name];
  if (!Icon) return null;
  return <Icon aria-hidden {...props} />;
}
