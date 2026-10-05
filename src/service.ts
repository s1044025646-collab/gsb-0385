import { BoothError, InputMode, parseOperand, runBooth, validateWidth, verifyProduct, BoothResult } from "./booth.js";
import { Store } from "./store.js";

export interface CreateCaseInput {
  n: unknown;
  mode: unknown;
  multiplicand: unknown;
  multiplier: unknown;
}

export function parseMode(mode: unknown): InputMode {
  if (mode !== "decimal" && mode !== "binary") {
    throw new BoothError("E_MODE_REQUIRED", "mode 必须是 'decimal' 或 'binary'", { mode });
  }
  return mode;
}

export function createAndRun(store: Store, input: CreateCaseInput) {
  const n = validateWidth(input.n);
  const mode = parseMode(input.mode);
  if (typeof input.multiplicand !== "string" || typeof input.multiplier !== "string") {
    throw new BoothError("E_OPERAND_FORMAT", "multiplicand 与 multiplier 必须是字符串");
  }
  const mValue = parseOperand(input.multiplicand, mode, n, "被乘数");
  const qValue = parseOperand(input.multiplier, mode, n, "乘数");
  const result = runBooth(n, mValue, qValue);
  if (!result.redundantSignOk) {
    throw new BoothError("E_INTERNAL", "冗余符号位核对失败");
  }
  const id = store.saveCase({ n, mode, mInput: input.multiplicand, qInput: input.multiplier }, result);
  return { id, result };
}

export function resultView(result: BoothResult) {
  return {
    n: result.n,
    workBits: result.workBits,
    multiplicand: { value: result.mValue.toString(), bits: result.mBits, workBits: result.mWorkBits },
    multiplier: { value: result.qValue.toString(), bits: result.qBits },
    rounds: result.rounds,
    combinedBits: result.combinedBits,
    redundantSignOk: result.redundantSignOk,
    product: { value: result.productValue.toString(), bits: result.productBits },
  };
}

export function verifyCandidate(store: Store, id: number, modeRaw: unknown, productRaw: unknown) {
  const row = store.getCase(id);
  if (!row) throw new BoothError("E_NOT_FOUND", `算例 ${id} 不存在`);
  const mode = parseMode(modeRaw);
  if (typeof productRaw !== "string") {
    throw new BoothError("E_OPERAND_FORMAT", "product 必须是字符串");
  }
  const result = runBooth(row.n, BigInt(row.m_value), BigInt(row.q_value));
  return { caseId: id, ...verifyProduct(result, productRaw, mode) };
}
