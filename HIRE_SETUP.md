# Live hire setup

The live hire path is disabled until the deployment configuration is complete. This is deliberate. The application must not create a job or accept a payment when it cannot prove the target contract, token, network, and x402 resource.

## Known deployments

The bnbagent-sdk v1 stack ships deployed ERC 8183 contracts. These were verified onchain: `paymentToken()` matches the $U token and `getJob`/`jobCounter` respond.

| Network | AgenticCommerce | Payment token |
| --- | --- | --- |
| BSC Mainnet (56) | `0xea4daa3100a767e86fded867729ae7446476eba6` | `0xcE24439F2D9C6a2289F741120FE202248B666666` ($U, 18 decimals) |
| BSC Testnet (97) | `0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de` | `0xc70b8741b8b07a6d61e54fd4b20f22fa648e5565` ($U testnet) |

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

# Required. The x402 paid resource. It must return HTTP 402 before payment.
NEXT_PUBLIC_X402_RESOURCE_URL=https://agent.example/paid-resource

# Required safety switch. Keep false until both settlement paths are tested together.
NEXT_PUBLIC_HIRE_COMBINED_SETTLEMENT=false
```

The older payment token name `NEXT_PUBLIC_ERC8183_PAYMENT_TOKEN_ADDRESS` remains supported. `NEXT_PUBLIC_X402_RESOURCE` is also accepted as an alias for the resource URL.

## Optional variables

```bash
# Optional evaluator. Without it, the buyer wallet is used as evaluator.
NEXT_PUBLIC_ERC8183_EVALUATOR_ADDRESS=0x...

# Optional hook. The selected deployment must whitelist this hook.
NEXT_PUBLIC_ERC8183_HOOK_ADDRESS=0x...

# Optional x402 facilitator metadata. The resource still issues the challenge.
NEXT_PUBLIC_X402_FACILITATOR_URL=https://facilitator.example

# Optional RPC. The default is a public BSC RPC and is not recommended for production.
NEXT_PUBLIC_BSC_RPC_URL=https://your-bsc-rpc.example
```

## Activation checklist

1. Deploy or select an ERC 8183 contract that matches the reference ABI on BSC Mainnet or BSC Testnet.
2. Confirm that its `paymentToken()` value exactly matches `NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS`.
3. Confirm that the hook address is whitelisted by the deployment. If the zero address is not whitelisted, set `NEXT_PUBLIC_ERC8183_HOOK_ADDRESS`.
4. Configure an x402 resource that binds its challenge resource to the supplied `jobId` and `agentId` query values.
5. Make the resource challenge use the selected CAIP network, exact amount, payment token, provider recipient, and a unique nonce.
6. Test on BSC Testnet first. Confirm the x402 response and ERC 8183 funding receipt before enabling the combined settlement flag.
7. Set `NEXT_PUBLIC_HIRE_COMBINED_SETTLEMENT=true` and rebuild the application. Next.js embeds public variables at build time.

The setup checklist appears in the Hire Wizard and Jobs pages. It reports every missing required value. A local draft can still be saved, but it is labelled local and never represents a network job or a successful payment.

## Runtime checks

At submission time the wallet must be on the selected BSC chain. The adapter checks that contract bytecode exists and that the deployment `paymentToken()` matches the configured token. The x402 challenge must match the job ID, agent ID, amount, asset, recipient, network, and a replay protection identifier. A payment is marked paid only after the resource returns a successful response with a payment receipt containing a 32 byte transaction hash.

ERC 8183 is a draft standard. No contract address is included in this repository.
