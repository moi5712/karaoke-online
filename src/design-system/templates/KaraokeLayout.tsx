import { type ReactNode } from "react";
import { cn } from "../utils/cn";

export interface KaraokeLayoutProps {
  header?: ReactNode;
  footer?: ReactNode;
  playerSection: ReactNode;
  sidebar: ReactNode;
  className?: string;
}

export function KaraokeLayout({
  header,
  footer,
  playerSection,
  sidebar,
  className,
}: KaraokeLayoutProps) {
  return (
    <div
      id="app-root-container"
      className={cn(
        "min-h-dvh lg:h-dvh lg:overflow-hidden bg-surface-base text-neutral-100 flex flex-col font-sans",
        className
      )}
    >
      {header}

      <main
        id="main-content"
        className="flex-1 min-h-0 w-full max-w-7xl mx-auto px-3 py-2 grid grid-cols-1 lg:grid-cols-12 gap-3 lg:overflow-hidden"
      >
        <section
          id="player-and-controls-section"
          className="lg:col-span-8 lg:min-h-0 lg:overflow-hidden flex flex-col gap-3"
        >
          {playerSection}
        </section>

        <section
          id="playlist-and-search-sidebar"
          className="lg:col-span-4 lg:min-h-0 lg:overflow-hidden flex flex-col gap-3"
        >
          {sidebar}
        </section>
      </main>

      {footer}
    </div>
  );
}
