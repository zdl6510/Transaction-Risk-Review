# Transaction Risk Review

Cloudflare Worker API for an OKX.AI API service. It protects `POST /review`
with x402 and returns a deterministic transaction pre-check for transfers,
token approvals, and contract-call parameters.

## Endpoints

- `GET /health` - deployment health check
- `GET /schema` - request and response shape
- `POST /review` - paid transaction risk review

Example request body:

```json
{
  "chain": "xlayer",
  "transactionType": "erc20 approval",
  "to": "0x1111111111111111111111111111111111111111",
  "amount": "10",
  "symbol": "USDT",
  "calldata": "0x095ea7b3..."
}
```

## Local Development

```bash
npm install
npm run typecheck
npm test
npm run dev
```

## Deploy

```bash
npm run deploy
```

After deployment, use this endpoint when registering the OKX.AI API service:

```text
https://<your-worker-name>.<your-subdomain>.workers.dev/review
```

## Configuration

The Worker reads these variables from `wrangler.toml` or Cloudflare dashboard:

- `PAY_TO` - EVM address that receives x402 payments
- `X402_NETWORK` - CAIP-2 network id, default `eip155:84532`
- `X402_PRICE` - x402 price string, default `$0.002`
- `X402_FACILITATOR_URL` - facilitator URL, default `https://facilitator.x402.org`

The current default `PAY_TO` is the Agentic Wallet EVM address:

```text
0x97a2c493228310e601769c36dc393aec68035abe
```

## Notes

This service is a deterministic pre-check. It does not replace wallet
simulation, contract audits, or independent verification before signing.
