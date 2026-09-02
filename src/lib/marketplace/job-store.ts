import type { Agent, Job, JobMode, JobSimulation, JobStatus, RegistryCategory, SessionPermission } from "./types";

const JOB_STORAGE_KEY = "plow.jobs.v1";

function canUseStorage() {
  return typeof window !== "undefined";
}

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `local-${Date.now()}`;
}

export function readJobs(): Job[] {
  if (!canUseStorage()) return [];

  try {
    const raw = window.localStorage.getItem(JOB_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Job[]) : [];
  } catch {
    return [];
  }
}

export function writeJobs(jobs: readonly Job[]) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(JOB_STORAGE_KEY, JSON.stringify(jobs));
  } catch {
    // Local persistence is optional until a real backend is connected.
  }
}

export function getLocalJob(jobId: string) {
  return readJobs().find((job) => job.id === jobId);
}

export interface CreateLocalJobInput {
  agent: Agent;
  mode?: JobMode;
  taskSummary: string;
  category?: RegistryCategory;
  price: string;
  currency: string;
  clientAddress?: string;
  status?: JobStatus;
  permission?: SessionPermission;
  expiresAt: string;
  termsHash?: string;
  onchainJobId?: string;
  onchainNetwork?: "BSC Mainnet" | "BSC Testnet";
  onchainChainId?: 56 | 97;
  jobContractAddress?: string;
  payment?: Job["payment"];
  escrow?: Job["escrow"];
  simulation?: JobSimulation;
}

export function createLocalJob(input: CreateLocalJobInput): Job {
  const now = new Date().toISOString();
  const category = input.category ?? input.agent.category;
  const job: Job = {
    id: makeId(),
    mode: input.mode ?? "live",
    agentId: input.agent.id,
    agentIdentityId: input.agent.identity.agentId,
    agentName: input.agent.name,
    category,
    clientAddress: input.clientAddress ?? "Local draft",
    taskSummary: input.taskSummary,
    status: input.status ?? "draft",
    price: input.price,
    currency: input.currency,
    createdAt: now,
    updatedAt: now,
    terms: {
      protocol: "ERC-8183",
      termsHash: input.termsHash,
      taskSummary: input.taskSummary,
      category,
      expiresAt: input.expiresAt,
    },
    statusHistory: [
      {
        status: input.status ?? "draft",
        changedAt: now,
        note: input.status && input.status !== "draft" ? "Created with an on chain transaction in progress." : "Created locally. No transaction was submitted.",
      },
    ],
    permission: input.permission,
    payment: input.payment ?? {
      protocol: "x402",
      status: "preview",
      amount: input.price,
      currency: input.currency,
    },
    onchainJobId: input.onchainJobId,
    onchainNetwork: input.onchainNetwork,
    onchainChainId: input.onchainChainId,
    jobContractAddress: input.jobContractAddress,
    termsHash: input.termsHash,
    escrow: input.escrow,
    simulation: input.simulation,
  };

  writeJobs([job, ...readJobs()]);
  return job;
}

export function updateLocalJob(jobId: string, patch: Partial<Omit<Job, "id">>) {
  const jobs = readJobs();
  const updatedJobs = jobs.map((job) => job.id === jobId
    ? { ...job, ...patch, updatedAt: new Date().toISOString() }
    : job);
  writeJobs(updatedJobs);
  return updatedJobs.find((job) => job.id === jobId);
}

export function appendLocalStatus(jobId: string, status: JobStatus, note?: string) {
  const now = new Date().toISOString();
  const jobs = readJobs();
  const updatedJobs = jobs.map((job) => {
    if (job.id !== jobId) return job;
    return {
      ...job,
      status,
      updatedAt: now,
      statusHistory: [...job.statusHistory, { status, changedAt: now, note }],
    };
  });
  writeJobs(updatedJobs);
  return updatedJobs.find((job) => job.id === jobId);
}
