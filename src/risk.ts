export type ReviewRequest = {
  chain?: string;
  transactionType?: string;
  from?: string;
  to?: string;
  contractAddress?: string;
  tokenAddress?: string;
  amount?: string | number;
  symbol?: string;
  calldata?: string;
  method?: string;
  spender?: string;
  notes?: string;
};

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type Finding = {
  id: string;
  level: RiskLevel;
  title: string;
  detail: string;
  recommendation: string;
};

export type ReviewResult = {
  ok: true;
  riskScore: number;
  riskLevel: RiskLevel;
  summary: string;
  findings: Finding[];
  normalized: Required<Pick<ReviewRequest, "chain" | "transactionType">> &
    Omit<ReviewRequest, "chain" | "transactionType">;
  nextSteps: string[];
  disclaimer: string;
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MAX_UINT256 =
  "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
const APPROVE_SELECTOR = "0x095ea7b3";
const TRANSFER_SELECTOR = "0xa9059cbb";
const TRANSFER_FROM_SELECTOR = "0x23b872dd";
const SET_APPROVAL_FOR_ALL_SELECTOR = "0xa22cb465";

const privateAddressPatterns = [
  /^0x0{40}$/i,
  /^0xdead0{36}$/i,
  /^0x000000000000000000000000000000000000dead$/i,
];

export function reviewTransaction(input: ReviewRequest): ReviewResult {
  const normalized = normalize(input);
  const findings: Finding[] = [];

  checkAddressShape(normalized, findings);
  checkCalldata(normalized, findings);
  checkAmount(normalized, findings);
  checkContextCompleteness(normalized, findings);

  const rawScore = findings.reduce((sum, finding) => sum + scoreFor(finding.level), 8);
  const riskScore = clamp(
    findings.some((finding) => finding.level === "critical")
      ? Math.max(rawScore, 80)
      : rawScore,
    0,
    100,
  );
  const riskLevel = levelForScore(riskScore);

  return {
    ok: true,
    riskScore,
    riskLevel,
    summary: summarize(riskLevel, findings),
    findings,
    normalized,
    nextSteps: nextStepsFor(riskLevel, findings),
    disclaimer:
      "This review is a deterministic pre-check, not financial advice. Verify addresses, contract intent, and simulation results before signing.",
  };
}

function normalize(input: ReviewRequest): ReviewResult["normalized"] {
  return {
    ...input,
    chain: String(input.chain || "unknown").trim().toLowerCase(),
    transactionType: String(input.transactionType || input.method || "unknown")
      .trim()
      .toLowerCase(),
    amount:
      input.amount === undefined || input.amount === null
        ? undefined
        : String(input.amount).trim(),
    calldata: input.calldata?.trim(),
    to: input.to?.trim(),
    from: input.from?.trim(),
    contractAddress: input.contractAddress?.trim(),
    tokenAddress: input.tokenAddress?.trim(),
    spender: input.spender?.trim(),
    symbol: input.symbol?.trim(),
    method: input.method?.trim(),
    notes: input.notes?.trim(),
  };
}

function checkAddressShape(
  input: ReviewResult["normalized"],
  findings: Finding[],
) {
  const addressFields = ["from", "to", "contractAddress", "tokenAddress", "spender"] as const;

  for (const field of addressFields) {
    const value = input[field];
    if (!value) continue;

    if (value.startsWith("0x") && !/^0x[a-fA-F0-9]{40}$/.test(value)) {
      findings.push({
        id: `invalid-${field}`,
        level: "high",
        title: `Invalid ${field} address`,
        detail: `${field} is not a valid 20-byte EVM address.`,
        recommendation: "Re-check the address from the source application before signing.",
      });
    }

    if (privateAddressPatterns.some((pattern) => pattern.test(value))) {
      findings.push({
        id: `sentinel-${field}`,
        level: "critical",
        title: `Unsafe ${field} address`,
        detail: `${field} points to a burn, zero, or sentinel address.`,
        recommendation: "Do not proceed unless this is an intentional burn or revoke flow.",
      });
    }
  }
}

function checkCalldata(input: ReviewResult["normalized"], findings: Finding[]) {
  const calldata = input.calldata?.toLowerCase();
  if (!calldata) return;

  if (!/^0x([a-f0-9]{2})*$/i.test(calldata)) {
    findings.push({
      id: "invalid-calldata",
      level: "high",
      title: "Malformed calldata",
      detail: "The calldata is not valid hex.",
      recommendation: "Regenerate the transaction data from the source dApp.",
    });
    return;
  }

  if (calldata.startsWith(APPROVE_SELECTOR)) {
    const spender = decodeAddressSlot(calldata, 0);
    const amount = decodeUintSlot(calldata, 1);
    findings.push({
      id: "erc20-approve",
      level: amount === MAX_UINT256 ? "critical" : "medium",
      title: amount === MAX_UINT256 ? "Unlimited token approval" : "Token approval",
      detail: `This call approves ${spender || "a spender"} to use tokens from your wallet.`,
      recommendation:
        amount === MAX_UINT256
          ? "Avoid unlimited approvals. Set the allowance to the minimum amount needed."
          : "Confirm the spender address and allowance match your intended action.",
    });
  }

  if (calldata.startsWith(SET_APPROVAL_FOR_ALL_SELECTOR)) {
    findings.push({
      id: "approval-for-all",
      level: "critical",
      title: "Approval for all assets",
      detail: "This call may grant an operator control over all NFTs or assets in a collection.",
      recommendation: "Only proceed if you fully trust the operator and collection contract.",
    });
  }

  if (calldata.startsWith(TRANSFER_SELECTOR) || calldata.startsWith(TRANSFER_FROM_SELECTOR)) {
    findings.push({
      id: "token-transfer",
      level: "medium",
      title: "Token transfer detected",
      detail: "The calldata appears to move tokens.",
      recommendation: "Verify recipient, token contract, and amount with a transaction simulation.",
    });
  }
}

function checkAmount(input: ReviewResult["normalized"], findings: Finding[]) {
  if (input.amount === undefined || input.amount === "") return;
  const amount = Number(input.amount);

  if (!Number.isFinite(amount) || amount < 0) {
    findings.push({
      id: "invalid-amount",
      level: "high",
      title: "Invalid amount",
      detail: "The amount is negative or not a number.",
      recommendation: "Provide the amount in normal display units, such as 1.5 ETH.",
    });
    return;
  }

  if (amount === 0 && !String(input.transactionType).includes("revoke")) {
    findings.push({
      id: "zero-amount",
      level: "low",
      title: "Zero amount",
      detail: "The amount is zero. This can be normal for approvals or contract calls.",
      recommendation: "Confirm the transaction is not expected to transfer value.",
    });
  }

  if (amount > 100_000) {
    findings.push({
      id: "large-amount",
      level: "high",
      title: "Large amount",
      detail: "The amount is unusually large for an automated request.",
      recommendation: "Confirm token decimals and USD value before signing.",
    });
  }
}

function checkContextCompleteness(
  input: ReviewResult["normalized"],
  findings: Finding[],
) {
  if (input.chain === "unknown") {
    findings.push({
      id: "missing-chain",
      level: "medium",
      title: "Missing chain",
      detail: "The request did not specify which chain the transaction targets.",
      recommendation: "Provide a chain such as xlayer, ethereum, base, bsc, or solana.",
    });
  }

  if (!input.to && !input.contractAddress) {
    findings.push({
      id: "missing-destination",
      level: "medium",
      title: "Missing destination",
      detail: "No recipient or contract address was supplied.",
      recommendation: "Provide the transaction recipient or target contract.",
    });
  }
}

function decodeAddressSlot(calldata: string, slot: number) {
  const start = 10 + slot * 64;
  const word = calldata.slice(start, start + 64);
  if (word.length !== 64) return undefined;
  return `0x${word.slice(24)}`;
}

function decodeUintSlot(calldata: string, slot: number) {
  const start = 10 + slot * 64;
  const word = calldata.slice(start, start + 64);
  if (word.length !== 64) return undefined;
  return `0x${word}`;
}

function scoreFor(level: RiskLevel) {
  return { low: 6, medium: 16, high: 30, critical: 50 }[level];
}

function levelForScore(score: number): RiskLevel {
  if (score >= 75) return "critical";
  if (score >= 45) return "high";
  if (score >= 20) return "medium";
  return "low";
}

function summarize(level: RiskLevel, findings: Finding[]) {
  if (findings.length === 0) {
    return "No obvious deterministic risk indicators were found in the supplied fields.";
  }
  return `${findings.length} finding(s) detected. Overall deterministic risk level is ${level}.`;
}

function nextStepsFor(level: RiskLevel, findings: Finding[]) {
  const steps = ["Run a wallet or node simulation before signing."];
  if (level === "critical" || level === "high") {
    steps.unshift("Pause signing until the flagged fields are corrected or independently verified.");
  }
  if (findings.some((finding) => finding.id.includes("approve"))) {
    steps.push("Prefer a limited allowance and revoke stale approvals after use.");
  }
  steps.push("Verify the final transaction in your wallet UI character-for-character.");
  return steps;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
