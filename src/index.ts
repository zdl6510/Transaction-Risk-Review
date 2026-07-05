import { Hono } from "hono";
import { cors } from "hono/cors";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { Network } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { reviewTransaction, type ReviewRequest } from "./risk";

type Env = {
  PAY_TO?: string;
  X402_NETWORK?: string;
  X402_PRICE?: string;
  X402_FACILITATOR_URL?: string;
};

const DEFAULT_PAY_TO = "0x97a2c493228310e601769c36dc393aec68035abe";
const DEFAULT_NETWORK = "eip155:84532";
const DEFAULT_PRICE = "$0.002";
const DEFAULT_FACILITATOR = "https://x402.org/facilitator";

const app = new Hono<{ Bindings: Env }>();

app.onError((err, c) => {
  console.error(err);
  return c.json(
    {
      ok: false,
      error: err.name || "WorkerError",
      message: err.message || "Unexpected Worker error",
    },
    500,
  );
});

app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization", "X-PAYMENT"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    exposeHeaders: ["X-PAYMENT-RESPONSE", "PAYMENT-REQUIRED"],
  }),
);

app.get("/", (c) =>
  c.json({
    name: "Transaction Risk Review",
    description:
      "A paid API service that performs deterministic pre-checks for wallet transfers, approvals, and contract-call parameters.",
    endpoints: {
      health: "GET /health",
      schema: "GET /schema",
      review: "POST /review",
    },
  }),
);

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "transaction-risk-review",
    version: "1.0.0",
  }),
);

app.get("/schema", (c) =>
  c.json({
    input: {
      type: "object",
      required: ["chain", "transactionType"],
      properties: {
        chain: { type: "string", example: "xlayer" },
        transactionType: {
          type: "string",
          example: "erc20 approval | native transfer | contract call",
        },
        from: { type: "string" },
        to: { type: "string" },
        contractAddress: { type: "string" },
        tokenAddress: { type: "string" },
        amount: { type: "string", example: "10.5" },
        symbol: { type: "string", example: "USDT" },
        calldata: { type: "string" },
        method: { type: "string" },
        spender: { type: "string" },
        notes: { type: "string" },
      },
    },
    output: {
      riskScore: "0-100",
      riskLevel: "low | medium | high | critical",
      findings: "array of deterministic findings",
      nextSteps: "array of recommended verification actions",
    },
  }),
);

app.use("/review", async (c, next) => {
  const payTo = c.env.PAY_TO || DEFAULT_PAY_TO;
  const network = (c.env.X402_NETWORK || DEFAULT_NETWORK) as Network;
  const price = c.env.X402_PRICE || DEFAULT_PRICE;
  const facilitatorUrl = c.env.X402_FACILITATOR_URL || DEFAULT_FACILITATOR;

  const facilitator = new HTTPFacilitatorClient({ url: facilitatorUrl });
  const server = new x402ResourceServer(facilitator).register(
    network,
    new ExactEvmScheme(),
  );

  const middleware = paymentMiddleware(
    {
      "POST /review": {
        accepts: {
          scheme: "exact",
          price,
          network,
          payTo,
          maxTimeoutSeconds: 90,
        },
        description:
          "Transaction Risk Review: deterministic pre-check for transfers, approvals, and contract-call parameters.",
        mimeType: "application/json",
      },
    },
    server,
    undefined,
    undefined,
    true,
  );

  return middleware(c, next);
});

app.post("/review", async (c) => {
  let body: ReviewRequest;
  try {
    body = await c.req.json<ReviewRequest>();
  } catch {
    return c.json(
      {
        ok: false,
        error: "INVALID_JSON",
        message: "Request body must be valid JSON.",
      },
      400,
    );
  }

  return c.json(reviewTransaction(body));
});

export default app;
