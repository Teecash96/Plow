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
| `NEXT_PUBLIC_X402_RESOURCE_URL` | Yes | Resource that returns and verifies the job bound x402 challenge. |
| `NEXT_PUBLIC_X402_FACILITATOR_URL` | No | Facilitator metadata when the resource uses one. |
| `NEXT_PUBLIC_HIRE_COMBINED_SETTLEMENT` | Yes | Must remain `false` until service settlement and escrow funding are tested together. |
| `NEXT_PUBLIC_BSC_RPC_URL` | No | Browser wallet and contract read RPC. The adapter can use `BSC_RPC_URL` or its public default. |
| `NEXT_PUBLIC_ERC8183_EVALUATOR_ADDRESS` | No | Evaluator address. The buyer wallet is used when omitted. |
| `NEXT_PUBLIC_ERC8183_HOOK_ADDRESS` | No | Hook address when the deployment does not whitelist the zero address. |

The compatibility aliases `NEXT_PUBLIC_ERC8183_PAYMENT_TOKEN_ADDRESS` and `NEXT_PUBLIC_X402_RESOURCE` are also accepted. Use the names in `.env.example` for new deployments.

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

## 6. Enable live hiring later

1. Test the ERC 8183 deployment on BSC Testnet first.
2. Confirm the contract bytecode and `paymentToken()` value.
3. Configure an x402 resource that binds job ID, agent ID, amount, asset, recipient, network, and replay protection.
4. Set the required Vercel variables.
5. Keep combined settlement disabled until both transfers are verified.
6. Rebuild and run a real wallet test.
7. Enable `NEXT_PUBLIC_HIRE_COMBINED_SETTLEMENT=true` only after the complete sequence is proven.

See [HIRE_SETUP.md](./HIRE_SETUP.md) for the adapter safety checks and activation requirements.
