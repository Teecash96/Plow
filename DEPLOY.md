# Public deployment

This project is a Next.js application. It can run in discovery only mode with no hire configuration. It must not be presented as live hiring until the ERC 8183 deployment, payment token, and x402 resource have been tested together.

## 1. Prepare the GitHub repository

1. Create a GitHub repository named `Plow` under the intended account or organization.
2. Set the repository visibility to **Public** in **Settings**, **General**, **Danger Zone**, **Change repository visibility**.
3. From the project directory, verify that the remote points to that repository:

   ```bash
   git remote -v
   ```

4. Install dependencies and run the local gates:

   ```bash
   npm install
   npm run lint
   npx tsc --noEmit
   npm run build
   npx playwright install chromium
   npm run a11y
   npm run a11y:contrast
   ```

5. Confirm that `.env.example` is tracked. `.env.local`, `.env.production`, and other real environment files are ignored by `.gitignore`.
6. Search the repository for accidental secrets before pushing. Do not commit private keys, seed phrases, facilitator credentials, or real payment tokens.
7. Commit and push the application:

   ```bash
   git add .
   git commit -m "Prepare public deployment"
   git branch -M main
   git push -u origin main
   ```

If the remote does not exist or returns 404, create it first or update the remote URL. Do not publish secrets to fix a remote access problem.

## 2. Import into Vercel

1. Open [vercel.com/new](https://vercel.com/new).
2. Select **Continue with GitHub** and authorize the intended GitHub account.
3. Import the public `Plow` repository.
4. Keep the detected framework as **Next.js**.
5. Use the repository root as the project root. The default build command is `npm run build`.
6. Add the environment variables in the Vercel project settings for the required environments. Set them for **Production** and **Preview** only when the values are safe for that environment.
7. Deploy. Vercel will provide a URL ending in `.vercel.app`.

## 3. Environment variables

Start from [.env.example](./.env.example). Vercel public variables are embedded at build time, so redeploy after changing them.

### Job persistence

| Variable | Required for live jobs | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Managed Postgres connection string for server job records. |

Before the first deployment that accepts live jobs, run [`db/001_jobs.sql`](./db/001_jobs.sql) in the managed database console. For an existing installation, also run [`db/002_jobs_status_check.sql`](./db/002_jobs_status_check.sql). Vercel filesystem storage is ephemeral and is not a valid replacement. The current owner cookie is browser scoped. It prevents simple cross browser listing, but wallet signed authentication is still needed for cross device accounts.

### Discovery

| Variable | Required | Purpose |
| --- | --- | --- |
| `BSC_RPC_URL` | No | Server side BSC RPC for ERC 8004 discovery. The app uses a public default when blank. |
| `ERC8004_SCAN_BLOCKS` | No | Requested historical scan range. The adapter applies a safety cap. |
| `ERC8004_FROM_BLOCK` | No | Exact starting block for an archive capable RPC. |
| `ERC8004_MAX_AGENTS` | No | Maximum live identities returned. Default is 100. |
| `ERC8004_LOG_CHUNK` | No | Log query chunk size. |
| `ERC8004_MAX_SCAN_MS` | No | Maximum discovery time budget. |
| `ERC8004_INDEXER_URL` | No | Supplemental indexer endpoint. Use `off` to disable it. |

### Hire path

| Variable | Required for live hiring | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_HIRE_NETWORK` | Yes | `bsc-mainnet` or `bsc-testnet`. |
| `NEXT_PUBLIC_ERC8183_CONTRACT_ADDRESS` | Yes | Tested ERC 8183 job contract for the selected network. |
| `NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS` | Yes | ERC 20 token used by that deployment. |
| `NEXT_PUBLIC_ERC8183_ROUTER_ADDRESS` | Yes | Evaluator router that registers and settles jobs. |
| `NEXT_PUBLIC_ERC8183_POLICY_ADDRESS` | Yes | Evaluator policy registered with the router. |
| `NEXT_PUBLIC_X402_RESOURCE_URL` | Yes | Resource that returns and verifies the job bound x402 challenge. |
| `NEXT_PUBLIC_X402_FACILITATOR_URL` | No | Facilitator metadata when the resource uses one. |
| `NEXT_PUBLIC_HIRE_COMBINED_SETTLEMENT` | Yes | Must remain `false` until service settlement and escrow funding are tested together. |
| `NEXT_PUBLIC_BSC_RPC_URL` | No | Browser wallet and contract read RPC. The adapter can use `BSC_RPC_URL` or its public default. |
| `NEXT_PUBLIC_ERC8183_EVALUATOR_ADDRESS` | No | Compatibility override. The canonical flow uses the router. |
| `NEXT_PUBLIC_ERC8183_HOOK_ADDRESS` | No | Compatibility override. The canonical flow uses the router. |

### Guarded PancakeSwap action

These values are optional. Leave them blank until the fixed router and token pair have been verified on the selected BSC network.

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_PANCAKESWAP_REBALANCE_ROUTER_ADDRESS` | No | One verified PancakeSwap router used by the bounded action. |
| `NEXT_PUBLIC_PANCAKESWAP_REBALANCE_TOKEN_IN_ADDRESS` | No | Fixed input token. It must equal `NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS`. |
| `NEXT_PUBLIC_PANCAKESWAP_REBALANCE_TOKEN_OUT_ADDRESS` | No | Fixed output token. It must be different and included in the job permission. |
| `NEXT_PUBLIC_PANCAKESWAP_REBALANCE_MAX_SLIPPAGE_BPS` | No | Integer from 1 to 500. Defaults to 100 bps. |

The job detail page asks the client wallet for an explicit approval and swap confirmation. It uses an exact approval amount, no native value, a fixed path, and a five minute deadline. Postgres stores one action reservation per job. Never treat this path as an autonomous agent wallet or as a V3 LP range manager.

The compatibility aliases `NEXT_PUBLIC_ERC8183_PAYMENT_TOKEN_ADDRESS` and `NEXT_PUBLIC_X402_RESOURCE` are also accepted. Use the names in `.env.example` for new deployments.

### Controlled provider service

The repository includes a provider service for a testnet agent. Leave it disabled unless this deployment is operated by the ERC 8004 identity owner.

| Variable | Required for provider mode | Purpose |
| --- | --- | --- |
| `PLOW_PROVIDER_ENABLED` | Yes | Set `true` to enable the provider routes. |
| `PLOW_PROVIDER_AGENT_ID` | Yes in legacy mode | ERC 8004 identity controlled by the provider operator. |
| `PLOW_PROVIDER_PRICE` | Yes in legacy mode | Positive x402 price returned in provider metadata. |
| `PLOW_PROVIDER_CURRENCY` | Yes in legacy mode | Payment token symbol. Use `U` for the deployed BSC ERC 8183 payment token. |
| `PLOW_PROVIDER_REQUEST_SECRET` | Yes | At least 32 random characters shared by the executor and provider route. |
| `PLOW_PROVIDER_PUBLIC_URL` | Yes for metadata | Public HTTPS origin used to build service URLs. |
| `PLOW_PROVIDER_EXECUTION_URL` | No | Exact execution URL. Defaults to `/api/provider/execute` under the public URL. |
| `PLOW_PROVIDER_SUPPORTED_CATEGORIES` | No | Comma separated category IDs for legacy mode. Defaults to all four required categories. |
| `PLOW_PROVIDER_PROFILES` | Yes in multi identity mode | JSON array of profiles. Each profile must contain a unique `agentId`, `categories`, `price`, `currency`, and its own server only `privateKey`. |
| `PLOW_PROVIDER_POOL_ADDRESS` | No | Default PancakeSwap V3 pool used by rebalancing and grid reads. A task may also include a pool address. |
| `PLOW_PROVIDER_YIELD_VAULTS` | No | JSON array of configured ERC 4626 vault addresses and names for yield comparison. |
| `PLOW_PROVIDER_LENDING_POOL_ADDRESS` | No | Lending pool exposing `getUserAccountData` for health factor reads. |

The metadata URL to publish in the ERC 8004 registration is `https://your-provider.example/api/provider/metadata` in legacy mode. In multi identity mode, publish `https://your-provider.example/api/provider/metadata?agentId=<agent-id>` for the matching profile. Do not publish a localhost URL. See [HIRE_SETUP.md](./HIRE_SETUP.md) for the request contract and the remaining onchain submission step.

Use the deployed `/provider` page to register a new identity, check the provider routes, and publish the metadata URI. Registration and URI updates require the identity owner wallet on BSC Mainnet.

The provider service exposes four category strategies through the same signed execution endpoint. It selects the signer profile from the job agent ID, so a job for one identity cannot submit through another identity's key. The strategies read live BSC Mainnet state and return bounded plans. They do not place swaps, grid orders, deposits, withdrawals, rebalances, liquidations, or repayments. Configure the category source addresses before presenting the corresponding metric as live. A separate session key and explicit contract allowlist are required before adding fund moving actions.

## 4. Discovery only mode

Leave the contract address, payment token, and x402 resource blank, and keep `NEXT_PUBLIC_HIRE_COMBINED_SETTLEMENT=false`. The public site will still support:

1. Homepage discovery
2. `/agents` browsing and filtering
3. Agent detail pages
4. `/hire/[agentId]` task and terms previews
5. Local draft jobs on `/jobs`

The setup checklist will show the missing values. Hire buttons stay disabled, no x402 challenge is requested, and no network job or payment is marked successful.

## 5. Verify the public deployment

After Vercel finishes the build, open the assigned URL and check:

1. `/`
2. `/agents`
3. `/agents/demo-rebalancer-001`
4. `/hire/demo-rebalancer-001`
5. `/jobs`

In discovery only mode, confirm that the setup checklist says live hiring is blocked. Confirm that demo records show `Demo fixture`, live records show `Live on BSC`, and performance values remain honest when no source exists.

Use Vercel deployment logs if a page fails. The BSC registry scan can fall back to a recent block window when the selected RPC does not support historical logs. That warning is expected and is shown in the browse page coverage panel.

For a live job, the quick hire action starts the agent after funding. The job detail page shows `Run agent` as a retry action if needed. The agent metadata must publish a public HTTPS endpoint that follows the `plow-agent-execution-v1` contract described in [`HIRE_SETUP.md`](./HIRE_SETUP.md). A result summary appears after a valid response. Escrow advances to `submitted` only after the endpoint returns a deliverable hash and a verified provider submission transaction.

For a submitted live job, use the job page's evaluator preflight before settling. A pending policy must show its unlock time without opening a wallet prompt. The page rechecks automatically at the unlock time and keeps the settle button disabled until the verdict is ready. After that, it may request one client wallet settlement and then record the verified router receipt. If the job is already terminal on chain, refresh the page and confirm the durable record reconciles without another transaction.

## 6. Enable live hiring later

1. Test the ERC 8183 kernel, router, and policy on BSC Testnet first.
2. Confirm their bytecode and the kernel `paymentToken()` value.
3. Configure an x402 resource that binds job ID, agent ID, amount, asset, recipient, network, and replay protection.
4. Set the required Vercel variables, including router and policy addresses.
5. Test provider submission, dispute, router settlement, and expiry refund.
6. Keep combined settlement disabled until every transfer is verified.
7. Rebuild and run a real wallet test before enabling `NEXT_PUBLIC_HIRE_COMBINED_SETTLEMENT=true`.

See [HIRE_SETUP.md](./HIRE_SETUP.md) for the adapter safety checks and activation requirements.
