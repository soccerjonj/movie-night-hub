import { useEffect, useRef, useState } from 'react';

interface Props {
  value: number;
  className?: string;
  durationMs?: number;
}

/** Count-up for club header stats (runs once per mount). */
const ClubStatNumber = ({ value, className, durationMs = 700 }: Props) => {
  const [display, setDisplay] = useState(0);
  const startRef = useRef<number | null>(null);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    startRef.current = null;
    const from = 0;
    const to = value;
    if (to === from) {
      setDisplay(to);
      return;
    }
    const tick = (now: number) => {
      if (startRef.current == null) startRef.current = now;
      const t = Math.min(1, (now - startRef.current) / durationMs);
      const eased = 1 - (1 - t) ** 2;
      setDisplay(Math.round(from + (to - from) * eased));
      if (t < 1) frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [value, durationMs]);

  return <span className={className}>{display}</span>;
};

export default ClubStatNumber;
