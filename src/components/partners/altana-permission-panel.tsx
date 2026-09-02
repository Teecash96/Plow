"use client";

import { ArrowCounterClockwise, LockKey, ShieldCheck } from "@phosphor-icons/react";
import { useState } from "react";
import { updateRemoteJob } from "@/lib/marketplace/job-api";
import { updateLocalJob } from "@/lib/marketplace/job-store";
import type { AltanaPermissionTemplate, SessionPermission } from "@/lib/marketplace/types";

type PermissionLike = SessionPermission | AltanaPermissionTemplate;

interface AltanaPermissionPanelProps {
  permission?: PermissionLike;
  jobId?: string;
  mode?: "preview" | "job";
}

function statusLabel(permission?: PermissionLike) {
  if (!permission) return "Not configured";
  if (permission.status === "revoked" || ("revokedAt" in permission && permission.revokedAt)) return "Revoked";
  if (permission.status === "active") return "Active policy";
  if (permission.status === "draft") return "Draft boundary";
  return "Not configured";
}

function statusClass(permission?: PermissionLike) {
  const status = statusLabel(permission);
  if (status === "Active policy") return "border-[#5a9876] bg-[#10261c] text-positive";
  if (status === "Revoked") return "border-[#ad6565] bg-[#281313] text-negative";
  return "border-[#9a843c] bg-[#211d0d] text-[#e8d995]";
}

function permissionForJob(permission: PermissionLike, revokedAt: string): SessionPermission {
  return {
    provider: "Altana",
    spendCap: permission.spendCap,
    currency: permission.currency,
    allowlistedContracts: permission.allowlistedContracts,
    allowlistedTokens: permission.allowlistedTokens,
    expiresAt: permission.expiresAt,
    expiresAtTimestamp: permission.expiresAtTimestamp,
    status: "revoked",
    templateId: permission.templateId,
    revokeSupported: permission.revokeSupported,
    lastUpdatedAt: revokedAt,
    source: "job",
    revokedAt,
  };
}

export function AltanaPermissionPanel({ permission, jobId, mode = "preview" }: AltanaPermissionPanelProps) {
  const [localPermission, setLocalPermission] = useState<PermissionLike | undefined>(permission);
  const [revokeMessage, setRevokeMessage] = useState<string>();
  const [saving, setSaving] = useState(false);
  const contracts = localPermission?.allowlistedContracts ?? [];
  const tokens = localPermission?.allowlistedTokens ?? [];
  const revoked = statusLabel(localPermission) === "Revoked";

  async function requestRevoke() {
    if (!localPermission || !jobId || revoked) return;
    const revokedAt = new Date().toISOString();
    const next = permissionForJob(localPermission, revokedAt);
    setSaving(true);
    try {
      await updateRemoteJob(jobId, { permission: next });
      updateLocalJob(jobId, { permission: next });
      setLocalPermission(next);
      setRevokeMessage("Permission revoked on the server. New wallet transactions and agent executions will be rejected.");
    } catch {
      setRevokeMessage("The server record was not updated. The permission remains active.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-3xl border border-surface-border bg-surface p-6" aria-labelledby="altana-permissions-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-2xl bg-black text-brand"><LockKey size={21} /></span>
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-brand">Altana permissions</p>
            <h2 id="altana-permissions-heading" className="mt-2 text-2xl font-semibold">Bounded execution scope</h2>
          </div>
        </div>
        <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${statusClass(localPermission)}`}>{statusLabel(localPermission)}</span>
      </div>

      {!localPermission ? (
        <p className="mt-6 text-sm leading-6 text-muted">No Altana permission template is attached. A future session key must define a spend cap, contract allowlist, token allowlist, and expiration before execution.</p>
      ) : (
        <>
          <dl className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-surface-border bg-black p-4"><dt className="text-xs text-muted">Spend cap</dt><dd className="mt-2 font-semibold">{localPermission.spendCap} {localPermission.currency}</dd></div>
            <div className="rounded-2xl border border-surface-border bg-black p-4"><dt className="text-xs text-muted">Expiration</dt><dd className="mt-2 font-semibold">{localPermission.expiresAt}</dd></div>
            <div className="rounded-2xl border border-surface-border bg-black p-4"><dt className="text-xs text-muted">Contracts</dt><dd className="mt-2 font-semibold">{contracts.length || "None"}</dd></div>
            <div className="rounded-2xl border border-surface-border bg-black p-4"><dt className="text-xs text-muted">Tokens</dt><dd className="mt-2 font-semibold">{tokens.length || "None"}</dd></div>
          </dl>

          <div className="mt-5 grid gap-4 border-t border-surface-border pt-5 sm:grid-cols-2">
            <div>
              <p className="text-xs text-muted">Allowlisted contracts</p>
              <p className="mt-2 break-words font-mono text-xs leading-5">{contracts.length ? contracts.join(", ") : "No contracts added"}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Allowlisted tokens</p>
              <p className="mt-2 break-words font-mono text-xs leading-5">{tokens.length ? tokens.join(", ") : "No tokens added"}</p>
            </div>
          </div>

          <div className="mt-5 flex items-start gap-2 rounded-2xl border border-surface-border bg-black px-4 py-3 text-xs leading-5 text-muted">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-brand" />
            <span>{mode === "job" ? "Plow enforces this policy before wallet transactions and agent execution. It is not an Altana session key." : "Draft only. Live submission activates Plow policy checks before any wallet transaction."}</span>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <p className="break-words text-xs text-muted">Template {localPermission.templateId ?? "Not assigned"} · Updated {localPermission.lastUpdatedAt ?? "Not yet"}</p>
            <button type="button" onClick={requestRevoke} disabled={!jobId || revoked || saving} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-surface-border px-3 py-2 text-xs font-semibold text-muted transition-colors hover:border-[#6a6a6a] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand" title={!jobId ? "Available after a job has a permission record" : revoked ? "Permission is already marked revoked" : "Record a revoke intent"}>
              <ArrowCounterClockwise size={15} />
              {saving ? "Saving" : revoked ? "Revoked" : "Revoke permission"}
            </button>
          </div>
          {revokeMessage ? <p className="mt-3 text-xs text-warning">{revokeMessage}</p> : null}
        </>
      )}
    </section>
  );
}
