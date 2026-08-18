"use client";

import { useEffect, useMemo, useRef, useState } from "react";

interface TaglineRevealProps {
  children: string;
}

export function TaglineReveal({ children }: TaglineRevealProps) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [visibleWords, setVisibleWords] = useState(0);
  const words = useMemo(() => children.split(" "), [children]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        words.forEach((_, index) => {
          window.setTimeout(() => setVisibleWords((current) => Math.max(current, index + 1)), index * 70);
        });
        observer.disconnect();
      },
      { threshold: 0.45 },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [words]);

  return (
    <p ref={ref} className="max-w-4xl text-4xl font-medium leading-tight tracking-tight sm:text-5xl lg:text-6xl">
      {words.map((word, index) => (
        <span key={`${word}-${index}`} className="word-reveal mr-3 inline-block" data-visible={index < visibleWords}>
          {word}
        </span>
      ))}
    </p>
  );
}
