# claude-reseller

Reselling Claude API credits for USDC micropayments via the [x402 protocol](https://x402.org). No API keys needed — just pay and use.

Powered by [x402-tollbooth](https://www.npmjs.com/package/x402-tollbooth).

## How it works

1. Send a request to `POST /v1/messages` (same as the Anthropic API)
2. Get back a `402 Payment Required` with USDC payment details
3. Sign an EIP-3009 payment and resend
4. Receive a Claude response — payment settles on-chain

## Pricing

| Model | Price per request |
|-------|-------------------|
| `claude-haiku-4-5-20251001` | $0.006 |
| `claude-sonnet-4-5-20250929` | $0.025 |
| `claude-opus-4-6` | $0.12 |

## Setup

```bash
bun install
cp .env.example .env
# Fill in ANTHROPIC_API_KEY, PAY_TO_ADDRESS, NETWORK
bun run dev
```

## E2E test

Runs the full payment flow locally on Base Sepolia testnet:

```bash
# 1. Set NETWORK=base-sepolia in .env
# 2. Fund your buyer wallet with test USDC (https://faucet.circle.com)
# 3. Start tollbooth, then in another terminal:
bun run e2e/e2e-claude.ts
```

The test sends a request → gets 402 → signs USDC payment → gets Claude response → prints the Basescan tx link.
