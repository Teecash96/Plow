import Image from "next/image";
import type { Agent } from "@/lib/marketplace/types";

interface AgentAvatarProps {
  agent: Pick<Agent, "name" | "avatar">;
  size?: "small" | "large";
}

function initialsFor(name: string) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return initials || "AG";
}

export function AgentAvatar({ agent, size = "small" }: AgentAvatarProps) {
  const initials = agent.avatar?.initials ?? initialsFor(agent.name);
  const sizeClass = size === "large" ? "size-24 rounded-3xl text-2xl" : "size-14 rounded-2xl text-sm";
  return (
    <div className={`relative shrink-0 overflow-hidden border border-surface-border bg-black ${sizeClass}`}>
      {agent.avatar?.src ? (
        <Image src={agent.avatar.src} alt={agent.avatar.alt} fill sizes={size === "large" ? "6rem" : "3.5rem"} className="object-cover" />
      ) : (
        <span className="flex size-full items-center justify-center bg-surface-raised font-mono font-semibold text-brand" aria-label={`${agent.name} avatar`}>{initials}</span>
      )}
    </div>
  );
}
