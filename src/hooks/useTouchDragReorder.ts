import { useRef, useCallback } from 'react';

export function useTouchDragReorder(
  rankings: string[],
  setRankings: React.Dispatch<React.SetStateAction<string[]>>,
  containerRef: React.RefObject<HTMLDivElement | null>
) {
  const touchStartY = useRef(0);
  const touchDragIndex = useRef<number | null>(null);
  const touchCurrentIndex = useRef<number | null>(null);

  const getItemIndexAtY = useCallback((y: number): number | null => {
    if (!containerRef.current) return null;
    const children = Array.from(containerRef.current.children) as HTMLElement[];
    for (let i = 0; i < children.length; i++) {
      const rect = children[i].getBoundingClientRect();
      if (y >= rect.top && y <= rect.bottom) return i;
    }
    return null;
  }, [containerRef]);

  const handleTouchStart = useCallback((index: number, e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    touchDragIndex.current = index;
    touchCurrentIndex.current = index;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (touchDragIndex.current === null) return;
    const y = e.touches[0].clientY;
    const overIndex = getItemIndexAtY(y);
    if (overIndex !== null && overIndex !== touchCurrentIndex.current) {
      touchCurrentIndex.current = overIndex;
      setRankings(prev => {
        const newArr = [...prev];
        const fromIdx = newArr.indexOf(prev[touchDragIndex.current!]);
        if (fromIdx === -1) return prev;
        const [removed] = newArr.splice(fromIdx, 1);
        newArr.splice(overIndex, 0, removed);
        touchDragIndex.current = overIndex;
        return newArr;
      });
    }
  }, [getItemIndexAtY, setRankings]);

  const handleTouchEnd = useCallback(() => {
    touchDragIndex.current = null;
    touchCurrentIndex.current = null;
  }, []);

  return { handleTouchStart, handleTouchMove, handleTouchEnd };
}
