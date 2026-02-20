# claude-reseller

Reselling Claude API credits for USDC micropayments. No API keys needed on the buyer side — just pay and use.

Powered by [x402-tollbooth](https://www.npmjs.com/package/x402-tollbooth) and the [x402 payment protocol](https://x402.org).

## How it works

1. Client sends a request to `POST /v1/messages` (same as the Anthropic API)
2. Tollbooth returns `402 Payment Required` with a USDC payment request
3. Client signs an EIP-3009 payment and resends with the payment header
4. Tollbooth verifies the payment, settles USDC, and proxies the request to Anthropic
5. Client receives the Claude response (streaming supported)

## Pricing

Token-based pricing — you pay for what you use, not a flat fee per request.

| Model | Price |
|-------|-------|
| `claude-haiku-4-5-20251001` | $0.006 / 1k tokens |
| `claude-sonnet-4-5-20250929` | $0.025 / 1k tokens |
| `claude-opus-4-6` | $0.12 / 1k tokens |

Tollbooth reads `usage.prompt_tokens` + `usage.completion_tokens` from the response and charges accordingly.

## Self-hosting

### Prerequisites

- Docker
- An [Anthropic API key](https://console.anthropic.com/settings/keys)
- A Base wallet address to receive USDC payments

### Setup

```bash
cp .env.example .env
# Edit .env with your values
```

### Deploy with Docker

```bash
docker build -t claude-reseller .
docker run --env-file .env -p 3000:3000 claude-reseller
```

On Coolify: point it at this repo, it'll pick up the Dockerfile automatically. Add `ANTHROPIC_API_KEY` and `PAY_TO_ADDRESS` as environment variables in the Coolify dashboard.

### Local development

```bash
bun install
bun run dev
```

## Usage

The endpoint is API-compatible with Anthropic's `/v1/messages`. Any x402-enabled client can discover it via `/.well-known/x402`.

### Discovery

```bash
curl https://claude.tollbooth.loa212.com/.well-known/x402
```

### Making a request (step by step)

**Step 1: Send a request and get the payment requirements**

```bash
curl -s -w "\n%{http_code}" \
  https://claude.tollbooth.loa212.com/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-5-20250929",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

This returns a `402` response with payment details in the headers:
- `X-Payment-Required`: base64-encoded payment requirements (amount, recipient, network)

**Step 2: Sign the USDC payment**

Your x402 client signs an EIP-3009 `transferWithAuthorization` for the exact amount.

**Step 3: Resend with payment**

```bash
curl -s https://claude.tollbooth.loa212.com/v1/messages \
  -H "Content-Type: application/json" \
  -H "X-Payment: <base64-signed-payment>" \
  -d '{
    "model": "claude-sonnet-4-5-20250929",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

You get back a standard Anthropic Messages API response.

### Streaming

Works the same way — just add `"stream": true` to the request body:

```bash
curl -N https://claude.tollbooth.loa212.com/v1/messages \
  -H "Content-Type: application/json" \
  -H "X-Payment: <base64-signed-payment>" \
  -d '{
    "model": "claude-sonnet-4-5-20250929",
    "max_tokens": 1024,
    "stream": true,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Using with an x402 client library

The easiest way to interact is with an x402 client that handles the 402 flow automatically:

```typescript
import { createClient } from "x402-axios"; // or x402-fetch

const client = createClient("YOUR_BASE_WALLET_PRIVATE_KEY");

const response = await client.post(
  "https://claude.tollbooth.loa212.com/v1/messages",
  {
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 1024,
    messages: [{ role: "user", content: "Hello!" }],
  }
);

console.log(response.data);
```

The client automatically handles the 402 → sign → resend flow.
