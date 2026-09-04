# Agent Studio on BNB Chain

Marketplace for discovering ERC 8004 agent service listings on BSC Mainnet. Demo fixtures stay out of the public inventory.

## Getting started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## ERC 8004 registry discovery

The server side adapter reads the BSC identity registry at `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`.

The default RPC is `https://bsc-dataseed.binance.org`, with `https://bsc.publicnode.com` as a fallback. The adapter requests the most recent 100,000 blocks, then falls back to a bounded 4,000 block window when public endpoints reject archive logs. Set these variables when a wider archive scan is available:

```bash
BSC_RPC_URL=https://your-bsc-rpc.example
ERC8004_SCAN_BLOCKS=250000
# Or use an exact starting block
ERC8004_FROM_BLOCK=116000000
ERC8004_MAX_AGENTS=100
# Optional supplemental indexer. Use "off" to disable it.
ERC8004_INDEXER_URL=https://8004scan.io/api/v1/agents/latest
```

Live identity records never receive invented performance, pricing, or heartbeat values. Hiring stays disabled until those checks have a verified source.

## Job persistence

Jobs use a managed Postgres database. Set `DATABASE_URL`, then run `db/001_jobs.sql` in the database console before enabling live hiring. For an existing installation, also run `db/002_jobs_status_check.sql`. The application stores the full job record as JSONB and keeps an index for the owner and update time.

The browser receives an HttpOnly owner cookie after the first saved job. This keeps one browser from listing another browser's records, but it is not wallet authentication and it does not provide cross device access. Wallet signed authentication is still required for a production account system.

When `DATABASE_URL` is missing or the database is unavailable, local drafts still work. Live hiring stops before the ERC 8183 job transaction. The application never presents browser storage as durable job storage.

## Agent execution

The primary `Start task` action on the hire screen accepts the task once, runs the complete hire flow, and starts the active agent automatically after funding. The job detail page keeps `Run agent` as a retry action when an automatic start fails. The server resolves the current verified live agent from ERC 8004 metadata, then sends a `POST` request to its published HTTPS service endpoint. Demo records, unverified records, private hostnames, and non HTTPS endpoints cannot execute.

The service must accept the `plow-agent-execution-v1` contract and return a JSON object with a bounded `resultSummary` string and an optional HTTPS `resultUri`:

```json
{
  "status": "completed",
  "resultSummary": "The position is inside its target range. No rebalance is needed.",
  "resultUri": "https://agent.example/results/job-id"
}
```

Plow stores the result summary and URI in the durable job record. Failed calls can be retried from the job page. A result summary alone never completes escrow. To advance the on chain job, the provider must return both a 32 byte `deliverableHash` and its successful `submissionTransactionHash`; the server verifies the transaction and records the job as submitted.

Live hiring checks four provider signals: an explicit public HTTPS Plow endpoint, an x402 price, a fresh health heartbeat, and a recent completed paid execution recorded by Plow. The configured provider has a narrow first run exception when its signer and ERC 8004 owner match; that first successful result becomes the required execution evidence. Generic registry URLs and indexer timestamps do not pass. See [HIRE_SETUP.md](./HIRE_SETUP.md) for the metadata contract.

The repository also contains a disabled controlled provider service at `/api/provider/health`, `/api/provider/metadata`, and `/api/provider/execute`. Enable it only on a deployment operated by the ERC 8004 identity owner. The legacy configuration uses one server only `PLOW_PROVIDER_PRIVATE_KEY`. Multi identity configuration uses `PLOW_PROVIDER_PROFILES`, where every profile binds one ERC 8004 agent ID, its category list, price, signer key, and optional service endpoints. The marketplace expands every configured category into a stable service listing ID such as `plow-325479-grid-trading`. Shared mode publishes several category listings under one identity. Independent mode uses a separate identity for each profile. In profile mode, the default execution and health URLs include the selected agent ID. The signed execution route selects the profile and category listing from the job before it verifies and submits the job. It accepts paid active jobs only, runs one explicit read only strategy for each required category, submits a deterministic deliverable to ERC 8183, and verifies the confirmed onchain state before returning success.

The four provider strategies are:

1. Rebalancing reads a PancakeSwap V3 pool snapshot and compares spot price with supplied range bounds.
2. Grid trading reads the same pool shape and returns bounded price levels without placing orders.
3. Yield optimisation reads configured ERC 4626 vaults and ranks current assets per share. It does not claim APY when no APY source is connected.
4. Health factor monitoring reads `getUserAccountData` from a configured lending pool and reports the account health factor against a task threshold.

Every strategy includes the current BSC Mainnet block in its result. Pool, vault, and lending addresses are optional configuration. If a required source is not configured, the provider says so and does not invent a metric or execute a DeFi transaction. Set `PLOW_PROVIDER_POOL_ADDRESS`, `PLOW_PROVIDER_YIELD_VAULTS`, or `PLOW_PROVIDER_LENDING_POOL_ADDRESS` for richer live reads. The provider metadata publishes the supported category list, one service entry and listing ID per category, and the `plow-provider-strategies-v1` protocol.

Provider operators can use `/provider` to register an ERC 8004 identity they control, verify the deployed provider service, and publish its HTTPS metadata URI. The page uses wallet signatures only and keeps the provider request secret server side. One identity can advertise all four categories and the marketplace shows four named service listings under that identity. Use four controlled identities only when you need independent ownership and signing. In multi identity mode, publish `/api/provider/metadata?agentId=<agent-id>` for each identity. Each published service is shown only when its identity, signer, category, price, endpoint, and heartbeat all match.

## Real hire path

The hire adapter uses the reference ERC 8183 interface and the current x402 JavaScript SDK. The application fails closed until an operator supplies a tested kernel, evaluator router, policy, payment token, and x402 resource for the selected BSC network.

Set these public variables only for a deployment you control:

```bash
# Required network: bsc-mainnet or bsc-testnet
NEXT_PUBLIC_HIRE_NETWORK=bsc-mainnet
NEXT_PUBLIC_ERC8183_CONTRACT_ADDRESS=0x...
NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS=0x...
# Required evaluator router and policy.
NEXT_PUBLIC_ERC8183_ROUTER_ADDRESS=0x...
NEXT_PUBLIC_ERC8183_POLICY_ADDRESS=0x...
# Compatibility overrides. The canonical flow uses the router as evaluator and hook.
NEXT_PUBLIC_ERC8183_EVALUATOR_ADDRESS=0x...
NEXT_PUBLIC_ERC8183_HOOK_ADDRESS=0x...
NEXT_PUBLIC_BSC_RPC_URL=https://your-bsc-rpc.example
NEXT_PUBLIC_X402_RESOURCE_URL=https://agent.example/paid-resource
# Optional facilitator URL for operator documentation. The resource issues the 402 challenge.
NEXT_PUBLIC_X402_FACILITATOR_URL=https://facilitator.example
# Safety gate. Keep false until x402 settlement and ERC 8183 escrow are tested together.
NEXT_PUBLIC_HIRE_COMBINED_SETTLEMENT=false
```

The real sequence is wallet connection, BSC chain check, durable job record creation, ERC 8183 job creation, evaluator policy registration, x402 challenge verification, budget configuration, token allowance, x402 settlement, and ERC 8183 funding. The quick hire action then starts the verified provider automatically. The provider verifies the funded job, submits the deliverable from its configured signer, and returns only after the submission is confirmed. The client can dispute or settle through the evaluator router, or claim a refund after expiry. The server job record stores every verified transaction reference. Demo agents and records without a verified provider address cannot enter this path. The combined settlement flag is deliberately off by default because a service payment and an escrow payment can be two separate transfers on an untrusted deployment.

Before settlement, the job page calls `POST /api/jobs/{jobId}/evaluate`. This server side preflight verifies the stored job, provider result, on chain submission, and current policy verdict. A pending OptimisticPolicy response includes the exact unlock time and never opens a wallet prompt. The submitted job page rechecks the policy automatically at that time, and the settle button stays disabled until the server returns an approved or rejected verdict. An approved or rejected verdict returns the canonical empty evidence value used by the deployed policy. The browser then asks the client wallet to call the router. If another tab settles first, the preflight reconciles the terminal on chain state instead of sending a second settlement transaction.

The local draft action remains available as an explicit fallback. It does not create a network job or claim a payment.

### Guarded PancakeSwap action

The rebalancing job page includes one optional user approved fund moving action. It is a fixed ERC 20 to ERC 20 swap through one configured PancakeSwap V2 compatible router. It uses the configured payment token as input, an exact token allowance, the fixed two token path, a maximum 5 minute deadline, and a configured slippage limit. The recipient is the connected client wallet. Native BNB is never sent.

Configure `NEXT_PUBLIC_PANCAKESWAP_REBALANCE_ROUTER_ADDRESS`, `NEXT_PUBLIC_PANCAKESWAP_REBALANCE_TOKEN_IN_ADDRESS`, `NEXT_PUBLIC_PANCAKESWAP_REBALANCE_TOKEN_OUT_ADDRESS`, and optionally `NEXT_PUBLIC_PANCAKESWAP_REBALANCE_MAX_SLIPPAGE_BPS`. The hire permission preview adds the configured router and tokens to new jobs. Existing jobs do not gain new permission scope. The action stays disabled when any value is missing or when token in does not match the payment token.

Plow reserves one action per job in Postgres before it requests a wallet transaction. It records approval and swap hashes before waiting for receipts. A broadcast action is never released automatically. This prevents a retry from sending a second swap after a browser or RPC failure. The action is client wallet execution, not autonomous provider custody and not an on chain Altana session key.

This is a bounded token swap, not a PancakeSwap V3 LP range reset. A real range reset needs position ownership, the V3 position manager, ticks, liquidity math, oracle controls, and a separate audited execution contract. Do not label this first action as automated LP management.

### Category action layer

Every live category now has one explicit action record on the job page. Grid trading saves a bounded level and price band plan. Yield optimisation saves a selected route reference. Health factor monitoring arms an account threshold monitor. These three records are plan or alert intents only. They do not place orders, deposit, withdraw, repay, or move funds. Each action requires a paid active job and an active Altana permission, and the server makes the write idempotent so a retry cannot create a second action. A real exchange, vault, or lending write target must be configured and audited before any of these intents can become fund moving actions.

See [HIRE_SETUP.md](./HIRE_SETUP.md) for the full setup checklist and activation steps.

## Public deployment

The project is ready to import into Vercel. It runs in discovery only mode when hire variables are blank. Follow [DEPLOY.md](./DEPLOY.md) to make the GitHub repository public, configure Vercel, and verify the assigned URL.

## Accessibility audits

Run the Playwright and axe core audit across the homepage, agent pages, quick hire screen, jobs list, and job detail:

```bash
npx playwright install chromium
npm run a11y
npm run a11y:contrast
```

See [ACCESSIBILITY.md](./ACCESSIBILITY.md) for the covered states and how to interpret violations.

## Category classification

Live categories use weighted matches across the metadata name, description, tags, capabilities, endpoints, and nested registration fields. A category needs a minimum score and a clear lead over the next category. Weak or ambiguous records remain Uncategorised. Each assigned record keeps the matched signals and fields so the detail page can show the reason.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
