// Speed helpers for the main screen (1.16.2): keep hidden parts from re-drawing, and measure tab switches.
import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';

/**
 * A main tab's page. Built on the first visit, then kept (hidden) in the background.
 * While it stays hidden it is not re-drawn at all – even when the main screen changes (e.g. the timer ticking).
 * It always re-draws when it is shown, so its buttons get the latest state.
 */
export const Pane = React.memo(
  function Pane({ active, name, children }: { active: boolean; name: string; children: React.ReactNode }) {
    const first = useRef(true);
    useEffect(() => {
      if (!active) return;
      const wasFirst = first.current;
      first.current = false;
      requestAnimationFrame(() => recordTabShown(name, wasFirst));
    }, [active]);
    return <View style={active ? { flex: 1 } : { display: 'none' }}>{children}</View>;
  },
  (a, b) => !a.active && !b.active
);

/** Something that is closed (a popup / full screen) is not re-drawn while it stays closed. */
export const WhenOpen = React.memo(
  function WhenOpen({ children }: { open: boolean; children: React.ReactNode }) {
    return <>{children}</>;
  },
  (a, b) => !a.open && !b.open
);

// ---------------------------------------------------------------- speed meter

export interface TabTiming {
  tab: string;
  ms: number;
  first: boolean;
  at: number;
}
let pressAt: { tab: string; t: number } | null = null;
const timings: TabTiming[] = [];

export function markTabPress(tab: string) {
  pressAt = { tab, t: Date.now() };
}

function recordTabShown(tab: string, first: boolean) {
  if (!pressAt || pressAt.tab !== tab) return; // opened by the app itself (start, search…), not a tap
  timings.unshift({ tab, ms: Date.now() - pressAt.t, first, at: Date.now() });
  timings.length = Math.min(timings.length, 15);
  pressAt = null;
}

export function tabTimings(): TabTiming[] {
  return timings;
}
