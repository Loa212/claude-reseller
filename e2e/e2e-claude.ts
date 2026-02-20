/**
 * E2E payment test — exercises the full x402 payment cycle with Claude on Base Sepolia.
 *
 * Flow: POST /v1/messages → 402 → sign EIP-3009 → resend → 200 + Claude response + tx hash
 *
 * Prerequisites:
 *   1. bun add viem
 *   2. Fund a wallet with testnet USDC on Base Sepolia (https://faucet.circle.com)
 *   3. Start tollbooth:  bun run dev
 *
 * Run:
 *   bun run --env-file=.env e2e/e2e-claude.ts
 */
import { randomBytes } from "node:crypto";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

// ── Constants ─────────────────────────────────────────────────────────────────

const BASE = process.env.TEST_GATEWAY_URL ?? "http://localhost:3000";

// USDC on Base Sepolia — https://developers.circle.com/stablecoins/usdc-on-test-networks
const USDC_CONTRACT =
	"0x036CbD53842c5426634e7929541eC2318f3dCF7e" as `0x${string}`;

const CLAUDE_BODY = {
	model: "claude-sonnet-4-5-20250929",
	max_tokens: 256,
	messages: [{ role: "user", content: "Say hello in exactly 5 words." }],
};

// ── Validate env ──────────────────────────────────────────────────────────────

const rawKey = process.env.TEST_PRIVATE_KEY;
if (!rawKey) {
	console.error("Error: TEST_PRIVATE_KEY is required.");
	console.error("Usage: bun run --env-file=.env e2e/e2e-claude.ts");
	process.exit(1);
}

const privateKey = (
	rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`
) as `0x${string}`;

const account = privateKeyToAccount(privateKey);

console.log(`\n🔑 Payer wallet:   ${account.address}`);
console.log(`   Network:        Base Sepolia (chain ${baseSepolia.id})`);
console.log(`   USDC contract:  ${USDC_CONTRACT}`);
console.log(`   Gateway:        ${BASE}\n`);

// ── Step 1: Initial request → 402 ────────────────────────────────────────────

console.log("── Step 1: POST /v1/messages (expect 402) ──");

const res1 = await fetch(`${BASE}/v1/messages`, {
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify(CLAUDE_BODY),
});

if (res1.status !== 402) {
	console.error(
		`Expected 402, got ${res1.status}. Is tollbooth running on ${BASE}?`,
	);
	const body = await res1.text();
	if (body) console.error("Body:", body);
	process.exit(1);
}

const paymentRequiredHeader = res1.headers.get("payment-required");
if (!paymentRequiredHeader) {
	console.error("Missing payment-required header in 402 response.");
	process.exit(1);
}

interface PaymentRequirement {
	scheme: string;
	network: string;
	maxAmountRequired: string;
	resource: string;
	description: string;
	payTo: string;
	maxTimeoutSeconds: number;
	asset: string;
}

const requirements = JSON.parse(
	atob(paymentRequiredHeader),
) as PaymentRequirement[];
const req = requirements[0];

if (!req) {
	console.error("No payment requirements found in 402 response.");
	process.exit(1);
}

console.log("✓ Got 402 with payment requirements:");
console.log(`  scheme:             ${req.scheme}`);
console.log(`  network:            ${req.network}`);
console.log(`  asset:              ${req.asset}`);
console.log(
	`  maxAmountRequired:  ${req.maxAmountRequired} (${Number(req.maxAmountRequired) / 1_000_000} USDC)`,
);
console.log(`  payTo:              ${req.payTo}`);
console.log(`  maxTimeoutSeconds:  ${req.maxTimeoutSeconds}`);

if (req.scheme !== "exact") {
	console.error(`Unsupported payment scheme: ${req.scheme}. Expected "exact".`);
	process.exit(1);
}

// ── Step 2: Sign the payment ──────────────────────────────────────────────────

console.log("\n── Step 2: Sign EIP-3009 transferWithAuthorization ──");

const walletClient = createWalletClient({
	account,
	chain: baseSepolia,
	transport: http(),
});

const validBefore = Math.floor(Date.now() / 1000) + req.maxTimeoutSeconds;
const nonce = `0x${randomBytes(32).toString("hex")}` as `0x${string}`;

const signature = await walletClient.signTypedData({
	domain: {
		name: "USDC",
		version: "2",
		chainId: baseSepolia.id,
		verifyingContract: USDC_CONTRACT,
	},
	types: {
		TransferWithAuthorization: [
			{ name: "from", type: "address" },
			{ name: "to", type: "address" },
			{ name: "value", type: "uint256" },
			{ name: "validAfter", type: "uint256" },
			{ name: "validBefore", type: "uint256" },
			{ name: "nonce", type: "bytes32" },
		],
	},
	primaryType: "TransferWithAuthorization",
	message: {
		from: account.address,
		to: req.payTo as `0x${string}`,
		value: BigInt(req.maxAmountRequired),
		validAfter: 0n,
		validBefore: BigInt(validBefore),
		nonce,
	},
});

const paymentPayload = {
	x402Version: 1,
	scheme: req.scheme,
	network: req.network,
	payload: {
		signature,
		authorization: {
			from: account.address,
			to: req.payTo,
			value: req.maxAmountRequired,
			validAfter: "0",
			validBefore: validBefore.toString(),
			nonce,
		},
	},
};

const paymentSignatureHeader = btoa(JSON.stringify(paymentPayload));

console.log("✓ Payment signed:");
console.log(`  from:         ${account.address}`);
console.log(`  to:           ${req.payTo}`);
console.log(
	`  value:        ${req.maxAmountRequired} (${Number(req.maxAmountRequired) / 1_000_000} USDC)`,
);
console.log(`  validBefore:  ${new Date(validBefore * 1000).toISOString()}`);
console.log(`  nonce:        ${nonce}`);

// ── Step 3: Resend with payment → Claude response ─────────────────────────────

console.log("\n── Step 3: Resend POST /v1/messages + payment-signature (expect 200) ──");

const res2 = await fetch(`${BASE}/v1/messages`, {
	method: "POST",
	headers: {
		"Content-Type": "application/json",
		"Accept-Encoding": "identity",
		"payment-signature": paymentSignatureHeader,
	},
	body: JSON.stringify(CLAUDE_BODY),
});

console.log(`Status: ${res2.status}`);

if (res2.status !== 200) {
	const body = await res2.text();
	console.error(`\n❌ Expected 200, got ${res2.status}`);
	console.error("Body:", body);
	console.error("\nCommon causes:");
	console.error(
		"  - Insufficient USDC balance (fund at https://faucet.circle.com)",
	);
	console.error("  - ANTHROPIC_API_KEY not set or invalid");
	console.error("  - Facilitator is unreachable (check network)");
	process.exit(1);
}

// ── Step 4: Verify payment + Claude response ──────────────────────────────────

console.log("\n── Step 4: Verify payment-response header + Claude output ──");

const paymentResponseHeader = res2.headers.get("payment-response");
if (!paymentResponseHeader) {
	console.error("❌ Missing payment-response header in 200 response.");
	process.exit(1);
}

interface PaymentResponse {
	transaction?: string;
	network?: string;
	payer?: string;
	amount?: string;
}

const paymentResponse = JSON.parse(atob(paymentResponseHeader)) as PaymentResponse;

if (!paymentResponse.transaction) {
	console.error("❌ Missing transaction hash in payment-response header.");
	console.error("Payment response:", JSON.stringify(paymentResponse, null, 2));
	process.exit(1);
}

interface ClaudeResponse {
	content?: { text: string }[];
	usage?: { input_tokens: number; output_tokens: number };
	model?: string;
}

const body = (await res2.json()) as ClaudeResponse;

console.log("\n✅ E2E test passed!");
console.log("──────────────────────────────────────────────────────────────");
console.log(`  Tx hash:  ${paymentResponse.transaction}`);
console.log(`  Network:  ${paymentResponse.network}`);
console.log(`  Payer:    ${paymentResponse.payer}`);
console.log(`  Amount:   ${paymentResponse.amount} raw units`);
console.log("──────────────────────────────────────────────────────────────");
console.log(`\nClaude (${body.model}):`);
console.log(`  "${body.content?.[0]?.text}"`);
console.log(`  Tokens: ${body.usage?.input_tokens} in / ${body.usage?.output_tokens} out`);
console.log(
	`\n🔗 View on Basescan: https://sepolia.basescan.org/tx/${paymentResponse.transaction}`,
);
