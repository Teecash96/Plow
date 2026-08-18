"use client";

import { CATEGORY_DEFINITIONS } from "@/lib/marketplace/categories";
import type { RegistryCategory } from "@/lib/marketplace/types";

interface CategoryTabsProps {
  value: RegistryCategory | "all";
  onChange: (value: RegistryCategory | "all") => void;
  counts?: Partial<Record<RegistryCategory | "all", number>>;
}

export function CategoryTabs({ value, onChange, counts }: CategoryTabsProps) {
  const count = (key: RegistryCategory | "all") => counts?.[key] === undefined ? null : <span className="font-mono text-xs">{counts[key]}</span>;

  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-6" role="tablist" aria-label="Agent categories">
      <button
        type="button"
        role="tab"
        aria-selected={value === "all"}
        onClick={() => onChange("all")}
        className={`flex min-h-11 min-w-0 items-center justify-between gap-2 rounded-2xl border px-3 py-3 text-left text-sm font-semibold transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] focus:outline-none focus:ring-2 focus:ring-brand sm:px-4 ${value === "all" ? "border-brand bg-brand text-black" : "border-surface-border bg-surface text-muted hover:border-[#6a6a6a] hover:text-foreground"}`}
      >
        <span>All agents</span>
        {count("all")}
      </button>
      {CATEGORY_DEFINITIONS.map((category) => (
        <button
          key={category.id}
          type="button"
          role="tab"
          aria-selected={value === category.id}
          onClick={() => onChange(category.id)}
          className={`flex min-h-11 min-w-0 items-center justify-between gap-2 rounded-2xl border px-3 py-3 text-left text-sm font-semibold transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] focus:outline-none focus:ring-2 focus:ring-brand sm:px-4 ${value === category.id ? "border-brand bg-brand text-black" : "border-surface-border bg-surface text-muted hover:border-[#6a6a6a] hover:text-foreground"}`}
        >
          <span>{category.label}</span>
          {count(category.id)}
        </button>
      ))}
      <button
        type="button"
        role="tab"
        aria-selected={value === "uncategorised"}
        onClick={() => onChange("uncategorised")}
        className={`flex min-h-11 min-w-0 items-center justify-between gap-2 rounded-2xl border px-3 py-3 text-left text-sm font-semibold transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] focus:outline-none focus:ring-2 focus:ring-brand sm:px-4 ${value === "uncategorised" ? "border-brand bg-brand text-black" : "border-surface-border bg-surface text-muted hover:border-[#6a6a6a] hover:text-foreground"}`}
      >
        <span>Uncategorised</span>
        {count("uncategorised")}
      </button>
    </div>
  );
}
