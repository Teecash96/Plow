# Live hire setup

The live hire path is disabled until the deployment configuration is complete. This is deliberate. The application must not create a job or accept a payment when it cannot prove the target contract, token, network, and x402 resource.

## Known deployments

The bnbagent-sdk v1 stack ships deployed ERC 8183 contracts. These were verified onchain: `paymentToken()` matches the $U token and `getJob`/`jobCounter` respond.

| Network | AgenticCommerce | EvaluatorRouter | OptimisticPolicy | Payment token |
| --- | --- | --- | --- | --- |
| BSC Mainnet (56) | `0xea4daa3100a767e86fded867729ae7446476eba6` | `0x51895229e12f9876011789b04f8698af06ccd6da` | `0x9c01845705b3078aa2e8cff7520a6376fd766de5` | `0xcE24439F2D9C6a2289F741120FE202248B666666` ($U, 18 decimals) |
| BSC Testnet (97) | `0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de` | `0xd7d36d66d2f1b608a0f943f722d27e3744f66f25` | `0xd6a4217588f6b1f5657a92a3e94e6422ad771cea` | `0xc70b8741b8b07a6d61e54fd4b20f22fa648e5565` ($U testnet) |

The v1 deployment pattern sets the EvaluatorRouter as evaluator + hook for jobs created through the SDK (`createJob` defaults both to the Router). If you create a job with the buyer wallet as evaluator instead, the router-based dispute policy does not apply.

## Required variables

For a browser wallet, use the `NEXT_PUBLIC_` form. The unprefixed form is also accepted by the server adapter for server side checks.

```bash
# Required. Supported values are bsc-mainnet or bsc-testnet.
NEXT_PUBLIC_HIRE_NETWORK=bsc-mainnet

# Required. The deployed ERC 8183 contract for the selected network.
NEXT_PUBLIC_ERC8183_CONTRACT_ADDRESS=0x...

# Required. The ERC 20 token used by the ERC 8183 deployment.
NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS=0x...

# Required. The evaluator router and policy used by the deployment.
NEXT_PUBLIC_ERC8183_ROUTER_ADDRESS=0x...
NEXT_PUBLIC_ERC8183_POLICY_ADDRESS=0x...

# Required. The x402 paid resource. It must return HTTP 402 before payment.
NEXT_PUBLIC_X402_RESOURCE_URL=https://agent.example/paid-resource

# Required safety switch. Keep false until both settlement paths are tested together.
NEXT_PUBLIC_HIRE_COMBINED_SETTLEMENT=false
```

The older payment token name `NEXT_PUBLIC_ERC8183_PAYMENT_TOKEN_ADDRESS` remains supported. `NEXT_PUBLIC_X402_RESOURCE` is also accepted as an alias for the resource URL.

## Optional variables

```bash
# Compatibility override only. The canonical flow uses the router as evaluator.
NEXT_PUBLIC_ERC8183_EVALUATOR_ADDRESS=0x...

# Compatibility override only. The canonical flow uses the router as hook.
NEXT_PUBLIC_ERC8183_HOOK_ADDRESS=0x...

# Optional x402 facilitator metadata. The resource still issues the challenge.
NEXT_PUBLIC_X402_FACILITATOR_URL=https://facilitator.example

# Optional RPC. The default is a public BSC RPC and is not recommended for production.
NEXT_PUBLIC_BSC_RPC_URL=https://your-bsc-rpc.example
```

## Activation checklist

1. Deploy or select an ERC 8183 kernel, evaluator router, and policy that match the reference interfaces on BSC Mainnet or BSC Testnet.
2. Confirm bytecode exists at the kernel, router, and policy addresses. Confirm that the kernel `paymentToken()` value exactly matches `NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS`.
3. Confirm that the kernel job uses the router as both evaluator and hook, and that the router registers the selected policy.
4. Configure an x402 resource that binds its challenge to the supplied durable marketplace `jobId` and ERC 8004 `agentId` query values.
5. Make the resource challenge use the stored job amount, selected CAIP network, payment token, provider recipient, and a unique Permit2 nonce.
6. Test on BSC Testnet first. Confirm registration, x402 settlement, funding, provider submission, router settlement, dispute handling, and expiry refund.
7. On a submitted job, call the evaluator preflight from the job page. Confirm a pending policy shows its unlock time without opening a wallet prompt. After the policy window, confirm the preflight returns an approved or rejected verdict, then perform one client wallet settlement and verify the receipt.
8. Set `NEXT_PUBLIC_HIRE_COMBINED_SETTLEMENT=true` and rebuild the application. Next.js embeds public variables at build time.

The setup checklist appears in the quick hire screen and Jobs pages. It reports every missing required value. A local draft can still be saved, but it is labelled local and never represents a network job or a successful payment. The quick hire screen uses one primary action with safe defaults. It starts the agent automatically after funding. Wallet confirmations remain visible and required.

## Optional guarded PancakeSwap action

The rebalancing job page can expose one fixed token swap after the job is active and paid. Configure all four values below only after verifying the router and both token contracts on the selected network:

```bash
NEXT_PUBLIC_PANCAKESWAP_REBALANCE_ROUTER_ADDRESS=0x...
NEXT_PUBLIC_PANCAKESWAP_REBALANCE_TOKEN_IN_ADDRESS=0x...
NEXT_PUBLIC_PANCAKESWAP_REBALANCE_TOKEN_OUT_ADDRESS=0x...
NEXT_PUBLIC_PANCAKESWAP_REBALANCE_MAX_SLIPPAGE_BPS=100
```

The input token must equal the ERC 8183 payment token. This keeps the permission spend cap in the same asset as the action. The configured router must support the PancakeSwap V2 `getAmountsOut` and `swapExactTokensForTokens` functions. The action reads a two token quote, checks token balance and contract code, applies the configured slippage limit, then asks the client wallet to approve the exact amount and submit the swap. The recipient is the same client wallet. No native BNB is sent.

The server checks the quote against the current router quote and reserves one action in the durable job record before any wallet prompt. Approval and swap hashes are recorded before receipt waits. A broadcast action is not automatically released, because retrying after an uncertain RPC result can move funds twice. The user must inspect the transaction before taking another action.

This first action is a bounded token swap. It is not a V3 LP range reset and it does not give a provider or Altana session key custody of funds. A true LP range reset is a separate audited contract integration.

Live hiring also requires durable job storage. Set `DATABASE_URL` and apply [`db/001_jobs.sql`](./db/001_jobs.sql). For an existing installation, also apply [`db/002_jobs_status_check.sql`](./db/002_jobs_status_check.sql). The wizard creates the pending server record before it requests the ERC 8183 transaction. If the database is not ready, no network job transaction starts.

## Runtime checks

At submission time the wallet must be on the selected BSC chain. The adapter checks kernel, router, and policy bytecode and verifies that the kernel `paymentToken()` matches the configured token. The internal x402 resource resolves the selected agent's verified ERC 8004 owner wallet and does not use one global marketplace payee. The x402 challenge must match the durable job ID, ERC 8004 agent ID, stored amount, asset, recipient, network, and a replay protection identifier. Because Permit2 does not sign application job IDs, the payer also signs a Plow binding message. The server verifies the on chain job binding and that message, then records a successful payment under a database row lock before returning a receipt with a 32 byte transaction hash. Reconciliation checks the target contract, signer, function call, and numeric ERC 8183 job ID before storing any lifecycle transaction.

### Evaluator settlement preflight

The job detail page does not send a settlement transaction until the evaluator policy has a verdict. It calls `POST /api/jobs/{jobId}/evaluate`, which checks the durable job, the verified provider result, the ERC 8183 submission, and the policy state at one BSC block. The response includes `state`, `decision`, `submittedAt`, `settleAt`, `disputeWindowSeconds`, and the reject vote counts.

The deployed OptimisticPolicy uses optimistic settlement. Its `check(jobId, evidence)` call returns `pending` during the dispute window, `approve` after the window without a quorum reject, or `reject` after the configured voter quorum. The policy currently ignores the evidence bytes, so Plow sends the canonical empty value `0x`. Do not replace this with an invented result hash. A pending response is shown to the user with the unlock time, the page rechecks automatically at that time, and the settle button stays disabled until a verdict is ready. The wallet is not connected for a pending check. Once a verdict is ready, the client wallet signs the router settlement and Plow reconciles the confirmed receipt. Terminal on chain states are reconciled idempotently if another caller settled first.

## Agent execution contract

After an ERC 8183 job is active, the quick hire action calls the service endpoint published in the verified agent's ERC 8004 metadata automatically. The job detail page keeps the same action for retry. The endpoint must be public HTTPS and accept this request shape:

```json
{
  "protocol": "plow-agent-execution-v1",
  "job": {
    "id": "job-id",
    "agentId": "42",
    "agentIdentityId": "42",
    "marketplaceAgentId": "erc8004-bsc-42",
    "status": "active",
    "taskSummary": "The buyer task",
    "category": "rebalancing",
    "clientAddress": "0x...",
    "onchainNetwork": "BSC Mainnet",
    "onchainChainId": 56,
    "termsHash": "0x...",
    "price": "0.25",
    "currency": "U",
    "onchainJobId": "7",
    "payment": {
      "status": "paid",
      "amount": "0.25",
      "currency": "U",
      "transactionHash": "0x..."
    },
    "terms": { "protocol": "ERC-8183", "taskSummary": "The buyer task", "category": "rebalancing", "expiresAt": "2026-09-01" }
  }
}
```

The included controlled provider validates these paid job fields before it runs. A custom provider may use the full payload to perform its own verification, but it must not treat the request as proof of payment without checking the Plow authorization and its own settlement policy.

It must return HTTP 2xx with JSON containing a non empty `resultSummary` and an optional HTTPS `resultUri`. The response is limited to 64 KB and the request times out after 30 seconds. To submit the result on chain, include both `deliverableHash` and `submissionTransactionHash`, each a 32 byte hex value. A nested `submission` object may use `deliverableHash` and `transaction` instead. Plow verifies the provider signer, target contract, `submit` call, job ID, deliverable, and current on chain state before storing the job as submitted. A summary without a verified submission remains an active job.

### Agent readiness contract

An ERC 8004 registration is not hireable because it has an arbitrary URL. The metadata must publish an explicit Plow execution service, a health service, and an x402 price. The execution service entry must use the exact `plow-agent-execution-v1` protocol. The health service must be read only and return a JSON heartbeat for the same agent ID.

```json
{
  "services": [
    {
      "name": "Plow execution",
      "protocol": "plow-agent-execution-v1",
      "endpoint": "https://provider.example/execute"
    }
  ],
  "plow": {
    "health": { "endpoint": "https://provider.example/health" },
    "x402": {
      "supported": true,
      "amount": "0.25",
      "currency": "U",
      "unit": "per task"
    }
  }
}
```

The health endpoint must return a response such as `{"status":"ok","agentId":"42","heartbeatAt":"2026-08-31T12:00:00.000Z"}`. Plow verifies HTTPS, rejects private or local hosts, checks the heartbeat is no more than 15 minutes old, and requires a completed paid execution in the durable job database before it marks an agent hireable. The one configured provider may perform one first paid execution when its provider signer, ERC 8004 owner, agent ID, and exact service endpoint match; the successful result then becomes the required execution evidence. A generic A2A card, an indexer timestamp, a declared price without x402 support, or a local development URL does not pass these gates.

## Controlled provider service

This repository includes a small provider service for a controlled testnet agent. It is disabled by default. Enable it only on a deployment that you operate as the provider:

```bash
PLOW_PROVIDER_ENABLED=true
# Use the legacy variables for one identity and one marketplace listing.
PLOW_PROVIDER_AGENT_ID=42
PLOW_PROVIDER_PRICE=0.25
PLOW_PROVIDER_CURRENCY=U
PLOW_PROVIDER_REQUEST_SECRET=<at least 32 random characters>
PLOW_PROVIDER_PRIVATE_KEY=<private key for the ERC 8004 identity owner>
PLOW_PROVIDER_PUBLIC_URL=https://your-provider.example
PLOW_PROVIDER_SUPPORTED_CATEGORIES=rebalancing,grid-trading,yield-optimisation,health-factor-monitoring
PLOW_PROVIDER_POOL_ADDRESS=0x...
PLOW_PROVIDER_YIELD_VAULTS='[{"address":"0x...","name":"Stable route"}]'
PLOW_PROVIDER_LENDING_POOL_ADDRESS=0x...
```

You can start this setup from the `/provider` page. The page sends no private key to Plow. Click `Create new ERC 8004 identity` while the wallet is on BSC Mainnet, then copy the returned agent ID into `PLOW_PROVIDER_AGENT_ID`. The provider server must also have a dedicated signing key in `PLOW_PROVIDER_PRIVATE_KEY`. Its derived address must be the ERC 8004 identity owner and the provider address in every ERC 8183 job. Do not use a personal wallet key in a shared deployment. After the provider deployment returns successful health and metadata responses, use the page to verify wallet ownership and publish the metadata URI with `setAgentURI`. The identity registry is on BSC Mainnet even when the hire escrow is on BSC Testnet.

For independent marketplace listings, use multi identity mode instead of the legacy variables:

```bash
PLOW_PROVIDER_PROFILES='[{"agentId":"325479","categories":["rebalancing"],"price":"0.25","currency":"U","privateKey":"<server-only key for agent 325479>"},{"agentId":"<grid agent ID>","categories":["grid-trading"],"price":"0.25","currency":"U","privateKey":"<server-only grid key>"},{"agentId":"<yield agent ID>","categories":["yield-optimisation"],"price":"0.25","currency":"U","privateKey":"<server-only yield key>"},{"agentId":"<health agent ID>","categories":["health-factor-monitoring"],"price":"0.25","currency":"U","privateKey":"<server-only health key>"}]'
```

Do not copy this example with placeholder IDs or keys. Register and verify each identity first. Every profile must use a real identity that the matching signer address owns. If `executionUrl` or `healthUrl` is omitted, Plow scopes the shared route with `?agentId=<agent-id>` and checks that scope during execution. Add those fields when a profile runs on a separate provider service. The shared execution route is safe for multiple profiles because it selects the profile by the job agent ID, then checks that profile's signer against the funded ERC 8183 provider address. One identity with all four categories remains valid when four separate listings are not needed.

The routes are:

* `GET /api/provider/health`
* `GET /api/provider/metadata`
* `POST /api/provider/execute`

The metadata route publishes the exact execution and health URLs that an ERC 8004 token URI can reference. Set the token URI to `https://your-provider.example/api/provider/metadata` in legacy mode. In multi identity mode, set the token URI to `https://your-provider.example/api/provider/metadata?agentId=<agent-id>` for the matching profile. Every configured agent ID must be an ERC 8004 identity that the operator controls. Do not use agent `323657` unless its owner is under your control.

The execution route requires a signed request from Plow. The marketplace executor signs the raw JSON body only when the target URL matches `PLOW_PROVIDER_EXECUTION_URL` or its derived public URL. It also requires a paid active job and a matching x402 amount. The controlled provider selects the profile from the job agent ID, verifies the funded ERC 8183 job, derives a deterministic deliverable hash from the request and result, submits it from that profile's server only key, waits for confirmation, and verifies the resulting `submitted` state. If the profile key is absent or does not own the job, the route fails closed with no completion result.

The controlled provider supports four first class strategy implementations behind that endpoint. Rebalancing and grid trading use a configured PancakeSwap V3 pool. Yield optimisation compares configured ERC 4626 vault snapshots. Health factor monitoring reads `getUserAccountData` from a configured lending pool. Every result includes a current BSC Mainnet block and clearly states when an optional source is not configured. These strategies are read only. They return recommendations and do not move user funds. The provider metadata advertises `plow-provider-strategies-v1` and the supported category IDs.

After deployment, verify the three routes, publish the metadata URL in the controlled ERC 8004 registration, and run one small BSC Testnet hire. The agent remains blocked until Plow records that completed paid execution and verified provider submission in Neon.

ERC 8183 is a draft standard. No contract address is included in this repository.
