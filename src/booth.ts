export const RULE_VERSION = "booth-radix2-v1";

export const MIN_N = 2;
export const MAX_N = 32;

export class BoothError extends Error {
  code: string;
  details?: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export type InputMode = "decimal" | "binary";

export function maskOf(bits: number): bigint {
  return (1n << BigInt(bits)) - 1n;
}

/** 有符号十进制值 -> 指定位宽补码位型 (BigInt, 低位对齐) */
export function toTwos(value: bigint, bits: number): bigint {
  return value & maskOf(bits);
}

/** 指定位宽补码位型 -> 有符号十进制值 */
export function fromTwos(bitsValue: bigint, bits: number): bigint {
  const sign = 1n << BigInt(bits - 1);
  const m = maskOf(bits);
  const v = bitsValue & m;
  return (v & sign) !== 0n ? v - (1n << BigInt(bits)) : v;
}

export function toBin(bitsValue: bigint, bits: number): string {
  return (bitsValue & maskOf(bits)).toString(2).padStart(bits, "0");
}

export function minValue(n: number): bigint {
  return -(1n << BigInt(n - 1));
}
export function maxValue(n: number): bigint {
  return (1n << BigInt(n - 1)) - 1n;
}

export function validateWidth(n: unknown): number {
  if (typeof n !== "number" || !Number.isInteger(n)) {
    throw new BoothError("E_INVALID_WIDTH", "位宽 n 必须是整数", { n });
  }
  if (n < MIN_N || n > MAX_N) {
    throw new BoothError("E_INVALID_WIDTH", `位宽 n 必须在 ${MIN_N}..${MAX_N} 之间`, { n });
  }
  return n;
}

export function parseOperand(raw: string, mode: InputMode, n: number, name: string): bigint {
  if (mode === "decimal") {
    if (!/^[+-]?\d+$/.test(raw.trim())) {
      throw new BoothError("E_OPERAND_FORMAT", `${name} 不是合法十进制整数`, { input: raw });
    }
    const v = BigInt(raw.trim());
    if (v < minValue(n) || v > maxValue(n)) {
      throw new BoothError(
        "E_OPERAND_RANGE",
        `${name}=${v} 超出 ${n} 位有符号范围 [${minValue(n)}, ${maxValue(n)}]`,
        { input: raw, min: minValue(n).toString(), max: maxValue(n).toString() }
      );
    }
    return v;
  }
  // binary 模式: 固定长度补码
  if (!/^[01]+$/.test(raw.trim())) {
    throw new BoothError("E_OPERAND_FORMAT", `${name} 二进制补码只能包含 0/1`, { input: raw });
  }
  const s = raw.trim();
  if (s.length !== n) {
    throw new BoothError(
      "E_OPERAND_WIDTH",
      `${name} 必须恰好 ${n} 位, 实际 ${s.length} 位 (不接受超宽截断)`,
      { input: raw, expected: n, actual: s.length }
    );
  }
  return fromTwos(BigInt("0b" + s), n);
}

export interface RoundTrace {
  round: number;
  aBefore: string;
  qBefore: string;
  qm1Before: string;
  pair: string; // "Q0 Q-1", 例如 "01"
  op: "add" | "sub" | "none";
  aAfterOp: string;
  aAfterShift: string;
  qAfterShift: string;
  qm1AfterShift: string;
  // 有符号解释
  aBeforeValue: string;
  aAfterOpValue: string;
  aAfterShiftValue: string;
  qAfterShiftValue: string;
}

export interface BoothResult {
  n: number;
  workBits: number; // n+1
  mValue: bigint;
  qValue: bigint;
  mBits: string; // n 位输入补码
  qBits: string;
  mWorkBits: string; // n+1 位工作补码
  rounds: RoundTrace[];
  combinedBits: string; // 2n+1 位 (A:Q, 含冗余符号位)
  redundantSignOk: boolean;
  productBits: string; // 低 2n 位
  productValue: bigint;
}

/** 基二 Booth 有符号乘法, 逐轮模拟寄存器 */
export function runBooth(n: number, mValue: bigint, qValue: bigint): BoothResult {
  validateWidth(n);
  const w = n + 1; // A 与被乘数工作位宽
  const wMask = maskOf(w);

  let a = 0n; // n+1 位
  let q = toTwos(qValue, n); // n 位
  let qm1 = 0n; // 1 位
  const mWork = toTwos(mValue, w); // 符号扩展后的被乘数
  const negMWork = toTwos(-mValue, w); // 工作位宽内取负, 最小负数安全

  const rounds: RoundTrace[] = [];
  for (let r = 1; r <= n; r++) {
    const aBefore = a;
    const qBefore = q;
    const qm1Before = qm1;
    const q0 = q & 1n;
    const pair = `${q0}${qm1}`;
    let op: RoundTrace["op"] = "none";
    if (q0 === 0n && qm1 === 1n) {
      a = (a + mWork) & wMask;
      op = "add";
    } else if (q0 === 1n && qm1 === 0n) {
      a = (a + negMWork) & wMask;
      op = "sub";
    }
    const aAfterOp = a;
    // 组合 {A(w), Q(n), Q-1(1)} 算术右移一位, 复制符号位
    const combined = (a << BigInt(n + 1)) | (q << 1n) | qm1;
  const signBit = (a >> BigInt(n)) & 1n;
    const shifted = (combined >> 1n) | (signBit << BigInt(w + n));
    a = (shifted >> BigInt(n + 1)) & wMask;
    q = (shifted >> 1n) & maskOf(n);
    qm1 = shifted & 1n;
    rounds.push({
      round: r,
      aBefore: toBin(aBefore, w),
      qBefore: toBin(qBefore, n),
      qm1Before: qm1Before.toString(),
      pair,
      op,
      aAfterOp: toBin(aAfterOp, w),
      aAfterShift: toBin(a, w),
      qAfterShift: toBin(q, n),
      qm1AfterShift: qm1.toString(),
      aBeforeValue: fromTwos(aBefore, w).toString(),
      aAfterOpValue: fromTwos(aAfterOp, w).toString(),
      aAfterShiftValue: fromTwos(a, w).toString(),
      qAfterShiftValue: fromTwos(q, n).toString(),
    });
  }

  const combinedBits = toBin(a, w) + toBin(q, n); // 2n+1 位
  // 冗余符号位核对: A 的最高位(额外位)必须与次高位一致
  const topBit = (a >> BigInt(n)) & 1n;
  const nextBit = (a >> BigInt(n - 1)) & 1n;
  const redundantSignOk = topBit === nextBit;
  const productBitsBig = ((a & maskOf(n)) << BigInt(n)) | q; // 低 2n 位
  const productBits = toBin(productBitsBig, 2 * n);
  const productValue = fromTwos(productBitsBig, 2 * n);

  return {
    n,
    workBits: w,
    mValue,
    qValue,
    mBits: toBin(toTwos(mValue, n), n),
    qBits: toBin(toTwos(qValue, n), n),
    mWorkBits: toBin(mWork, w),
    rounds,
    combinedBits,
    redundantSignOk,
    productBits,
    productValue,
  };
}

/** 核验候选乘积, 返回错误位置信息 */
export function verifyProduct(
  result: BoothResult,
  candidateRaw: string,
  mode: InputMode
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const n2 = 2 * result.n;
  let candidate: bigint;
  if (mode === "binary") {
    const s = candidateRaw.trim();
    if (!/^[01]+$/.test(s)) {
      const bad = s.search(/[^01]/);
      errors.push(`第 ${bad + 1} 个字符不是 0/1`);
      return { ok: false, errors };
    }
    if (s.length !== n2) {
      errors.push(`候选乘积必须恰好 ${n2} 位, 实际 ${s.length} 位 (不接受超宽截断)`);
      return { ok: false, errors };
    }
    candidate = fromTwos(BigInt("0b" + s), n2);
  } else {
    const s = candidateRaw.trim();
    if (!/^[+-]?\d+$/.test(s)) {
      errors.push("候选乘积不是合法十进制整数");
      return { ok: false, errors };
    }
    candidate = BigInt(s);
    const lo = -(1n << BigInt(n2 - 1));
    const hi = (1n << BigInt(n2 - 1)) - 1n;
    if (candidate < lo || candidate > hi) {
      errors.push(`候选乘积 ${candidate} 超出 ${n2} 位有符号范围 [${lo}, ${hi}]`);
      return { ok: false, errors };
    }
  }
  if (candidate !== result.productValue) {
    const candBits = toBin(toTwos(candidate, n2), n2);
    let firstDiff = -1;
    for (let i = 0; i < n2; i++) {
      if (candBits[i] !== result.productBits[i]) { firstDiff = i + 1; break; }
    }
    errors.push(
      `乘积不符: 候选=${candidate} (${candBits}), 期望=${result.productValue} (${result.productBits})` +
        (firstDiff > 0 ? `, 首个不同位在第 ${firstDiff} 位(从左)` : "")
    );
    return { ok: false, errors };
  }
  return { ok: true, errors: [] };
}
