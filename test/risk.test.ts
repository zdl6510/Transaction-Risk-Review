import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewTransaction } from "../src/risk.js";

test("flags unlimited ERC-20 approval as critical", () => {
  const result = reviewTransaction({
    chain: "xlayer",
    transactionType: "approval",
    to: "0x1111111111111111111111111111111111111111",
    calldata:
      "0x095ea7b30000000000000000000000002222222222222222222222222222222222222222ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  });

  assert.equal(result.riskLevel, "critical");
  assert.ok(result.findings.some((finding) => finding.id === "erc20-approve"));
});

test("returns low risk for complete plain transfer fields", () => {
  const result = reviewTransaction({
    chain: "base",
    transactionType: "native transfer",
    to: "0x1111111111111111111111111111111111111111",
    amount: "0.01",
    symbol: "ETH",
  });

  assert.equal(result.riskLevel, "low");
});
