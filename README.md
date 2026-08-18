# Agent Studio on BNB Chain

Marketplace foundation for discovering ERC 8004 agent identities on BSC Mainnet. Demo records remain visible while live identity data is enriched.

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

The default RPC is `https://bsc.publicnode.com`. The adapter requests the most recent 100,000 blocks, then falls back to a bounded 4,000 block window when the public endpoint rejects archive logs. Set these variables when a wider archive scan is available:

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

## Real hire path

The hire adapter uses the reference ERC 8183 interface and the current x402 JavaScript SDK. ERC 8183 is a draft standard and does not publish an official BSC Mainnet deployment. The application therefore fails closed until an operator supplies a deployment that has been tested with the configured token and hook.

Set these public variables only for a deployment you control:

```bash
# Required network: bsc-mainnet or bsc-testnet
NEXT_PUBLIC_HIRE_NETWORK=bsc-mainnet
NEXT_PUBLIC_ERC8183_CONTRACT_ADDRESS=0x...
NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS=0x...
# Optional. If omitted, the buyer wallet becomes the evaluator.
NEXT_PUBLIC_ERC8183_EVALUATOR_ADDRESS=0x...
NEXT_PUBLIC_ERC8183_HOOK_ADDRESS=0x...
NEXT_PUBLIC_BSC_RPC_URL=https://your-bsc-rpc.example
NEXT_PUBLIC_X402_RESOURCE_URL=https://agent.example/paid-resource
# Optional facilitator URL for operator documentation. The resource issues the 402 challenge.
NEXT_PUBLIC_X402_FACILITATOR_URL=https://facilitator.example
# Safety gate. Keep false until x402 settlement and ERC 8183 escrow are tested together.
NEXT_PUBLIC_HIRE_COMBINED_SETTLEMENT=false
```

The real sequence is wallet connection, BSC chain check, ERC 8183 job creation, x402 challenge verification, budget configuration, token allowance, x402 settlement, and ERC 8183 funding. The local job stores every verified transaction reference. Demo agents and records without a verified provider address cannot enter this path. The combined settlement flag is deliberately off by default because a service payment and an escrow payment can be two separate transfers on an untrusted deployment.

The local draft action remains available as an explicit fallback. It does not create a network job or claim a payment.

See [HIRE_SETUP.md](./HIRE_SETUP.md) for the full setup checklist and activation steps.

## Public deployment

The project is ready to import into Vercel. It runs in discovery only mode when hire variables are blank. Follow [DEPLOY.md](./DEPLOY.md) to make the GitHub repository public, configure Vercel, and verify the assigned URL.

## Accessibility audits

Run the Playwright and axe core audit across the homepage, agent pages, hire wizard, jobs list, and job detail:

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
