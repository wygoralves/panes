import { useEffect, useRef, useState } from "react";

const BAR_COUNT = 60;
const FLOOR = 4;
const QUIET = 6;
const MAX_HEIGHT = 32;
const GAIN = 160;

function seedBars(): number[] {
  return Array.from({ length: BAR_COUNT }, () => FLOOR);
}

export function Waveform({
  level,
  active,
}: {
  level: number;
  active: boolean;
}) {
  const [bars, setBars] = useState<number[]>(seedBars);
  const levelRef = useRef(level);
  levelRef.current = level;

  useEffect(() => {
    if (!active) {
      setBars(seedBars());
      return;
    }
    const handle = window.setInterval(() => {
      setBars((prev) => {
        const next = prev.slice(1);
        const current = Math.max(0, levelRef.current);
        const scaled = Math.min(MAX_HEIGHT, FLOOR + current * GAIN);
        const jitter = (Math.random() - 0.5) * 3;
        next.push(Math.max(FLOOR, Math.min(MAX_HEIGHT, scaled + jitter)));
        return next;
      });
    }, 110);
    return () => window.clearInterval(handle);
  }, [active]);

  return (
    <div className="mr-waveform" aria-hidden="true">
      {bars.map((h, i) => (
        <div
          key={i}
          className={`mr-bar${h < QUIET ? " mr-bar-quiet" : ""}`}
          style={{ height: h }}
        />
      ))}
    </div>
  );
}
