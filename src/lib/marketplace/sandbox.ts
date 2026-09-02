import type { Agent, Job, JobSimulation, JobSimulationStep, RegistryCategory, SessionPermission } from "./types";
import { readJobs, writeJobs } from "./job-store";

export const SANDBOX_SCENARIO = "one-click-hire" as const;

export interface CreateSandboxJobInput {
  agent: Agent;
  taskSummary: string;
  category?: RegistryCategory;
  price: string;
  currency: string;
  expiresAt: string;
  permission?: SessionPermission;
  termsHash?: string;
  now?: string | Date;
  id?: string;
}

function simulationId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `simulation-${crypto.randomUUID()}`;
  }
  return `simulation-${Date.now()}`;
}

function startMilliseconds(value: string | Date | undefined) {
  if (value === undefined) return Date.now();
  const milliseconds = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error("The sandbox start time is invalid.");
  return milliseconds;
}

function at(start: number, offset: number) {
  return new Date(start + offset).toISOString();
}

function step(id: string, label: string, completedAt: string, detail: string): JobSimulationStep {
  return { id, label, completedAt, detail: `Simulation only. ${detail}` };
}

export function createSandboxJob(input: CreateSandboxJobInput): Job {
  const taskSummary = input.taskSummary.trim();
  const category = input.category ?? input.agent.category;
  if (!taskSummary) throw new Error("Add a task description before starting the sandbox.");
  if (!input.price.trim()) throw new Error("Add a budget before starting the sandbox.");
  if (!input.currency.trim()) throw new Error("Add a currency before starting the sandbox.");

  const start = startMilliseconds(input.now);
  const timestamps = Array.from({ length: 7 }, (_, index) => at(start, index * 250));
  const steps = [
    step("checks", "Agent checks", timestamps[0], "The identity, service endpoint, price, and heartbeat passed local checks."),
    step("job-created", "ERC 8183 job prepared", timestamps[1], "No createJob transaction was sent."),
    step("job-registered", "Evaluator registration", timestamps[2], "No evaluator registration transaction was sent."),
    step("payment", "x402 payment", timestamps[3], "No payment token was transferred and no payment receipt was created."),
    step("funding", "Escrow funding", timestamps[4], "No token approval or escrow funding transaction was sent."),
    step("execution", "Agent execution", timestamps[5], "A local provider result was generated without calling the provider."),
    step("submission", "Result submitted", timestamps[6], "No provider submission transaction was sent."),
  ] satisfies readonly JobSimulationStep[];
  const simulation: JobSimulation = {
    scenario: SANDBOX_SCENARIO,
    network: input.agent.deployment.network,
    chainId: input.agent.deployment.chainId,
    completedAt: timestamps[6],
    steps,
  };

  return {
    id: input.id ?? simulationId(),
    mode: "simulation",
    agentId: input.agent.id,
    agentIdentityId: input.agent.identity.agentId,
    agentName: input.agent.name,
    category,
    clientAddress: "Simulation only",
    taskSummary,
    status: "completed",
    price: input.price.trim(),
    currency: input.currency.trim(),
    createdAt: timestamps[0],
    updatedAt: timestamps[6],
    terms: {
      protocol: "ERC-8183",
      termsHash: input.termsHash,
      taskSummary,
      category,
      expiresAt: input.expiresAt,
    },
    statusHistory: [
      { status: "draft", changedAt: timestamps[0], note: "Simulation only. No wallet request was made." },
      { status: "pending", changedAt: timestamps[1], note: "Simulation only. No ERC 8183 job was created." },
      { status: "active", changedAt: timestamps[4], note: "Simulation only. No payment token approval or escrow funding was sent." },
      { status: "submitted", changedAt: timestamps[6], note: "Simulation only. No provider submission transaction was sent." },
      { status: "completed", changedAt: timestamps[6], note: "Simulation complete. No on chain state changed." },
    ],
    permission: input.permission,
    payment: {
      protocol: "x402",
      status: "preview",
      amount: input.price.trim(),
      currency: input.currency.trim(),
    },
    execution: {
      status: "completed",
      attempt: 1,
      startedAt: timestamps[5],
      completedAt: timestamps[6],
    },
    resultSummary: "Simulation complete. The hire, payment, escrow, execution, and submission steps were shown locally. No real result was produced.",
    escrow: {
      status: "completed",
      reason: "Simulation only. No ERC 8183 escrow was created.",
    },
    simulation,
  };
}

export function saveSandboxJob(job: Job) {
  if (job.mode !== "simulation" || !job.simulation) {
    throw new Error("Only explicit simulation jobs can be saved by the sandbox.");
  }
  const existing = readJobs().filter((savedJob) => savedJob.id !== job.id);
  writeJobs([job, ...existing]);
  return job;
}
