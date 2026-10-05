// 基二 Booth 有符号乘法核心算法。
// 全部位运算使用 BigInt 与显式掩码，避免 JS 默认 32 位截断。

export const RULE_VERSION = "booth-radix2-v1";
export const MIN_BIT_WIDTH = 2;
export const MAX_BIT_WIDTH = 32;

export type OpKind = "add" | "sub" | "none";

export interface RegisterSnapshot {
  /** A 寄存器，n+1 位无符号表示（补码位型） */
  aBits: string;
  /** A 的有符号十进制解释 */
  aValue: string;
  /** Q 寄存器，n 位 */
  qBits: string;
  qValue: string;
  /** Q-1，1 位 */
  qm1: string;
}

export interface BoothStep {
  round: number; // 1..n
  before: RegisterSnapshot;
  pair: string; // "00" | "01" | "10" | "11"
  op: OpKind;
  /** 加减（或无操作）后的 A */
  aAfterOpBits: string;
  aAfterOpValue: string;
  after: RegisterSnapshot;
}

export interface BoothResult {
  bitWidth: number;
  workWidth: number; // n+1
  multiplicandValue: string;
  multiplierValue: string;
  steps: BoothStep[];
  /** A(n+1) ++ Q(n) 的 2n+1 位组合结果 */
  combinedBits: string;
  /** 冗余符号位核对：额外位是否确为符号扩展 */
  redundantSignOk: boolean;
  /** 低 2n 位完整补码乘积 */
  productBits: string;
  productValue: string;
}

export function maskOf(width: number): bigint {
  return (1n << BigInt(width)) - 1n;
}

/** 将 width 位补码无符号位型解释为有符号值 */
export function toSigned(bits: bigint, width: number): bigint {
  const sign = 1n << BigInt(width - 1);
  const m = maskOf(width);
  const v = bits & m;
  return v & sign ? v - (1n << BigInt(width)) : v;
}

/** 将有符号值编码为 width 位补码无符号位型 */
export function toUnsigned(value: bigint, width: number): bigint {
  return value & maskOf(width);
}

export function bitsOf(value: bigint, width: number): string {
  return (value & maskOf(width)).toString(2).padStart(width, "0");
}

export function signedRange(width: number): { min: bigint; max: bigint } {
  const min = -(1n << BigInt(width - 1));
  const max = (1n << BigInt(width - 1)) - 1n;
  return { min, max };
}

function snapshot(a: bigint, q: bigint, qm1: bigint, n: number, workW: number): RegisterSnapshot {
  return {
    aBits: bitsOf(a, workW),
    aValue: toSigned(a, workW).toString(),
    qBits: bitsOf(q, n),
    qValue: toSigned(q, n).toString(),
    qm1: qm1.toString(),
  };
}

/**
 * 执行一次基二 Booth 乘法，返回全部逐轮寄存器轨迹。
 * multiplicand / multiplier 为 n 位有符号值（BigInt）。
 */
export function runBooth(bitWidth: number, multiplicand: bigint, multiplier: bigint): BoothResult {
  const n = bitWidth;
  const workW = n + 1; // A 与被乘数工作寄存器多一位，容纳最小负数的相反数
  const workMask = maskOf(workW);
  const signBit = 1n << BigInt(workW - 1);

  // 输入先符号扩展到工作位宽
  let a = 0n;
  const m = toUnsigned(multiplicand, workW);
  let q = toUnsigned(multiplier, n);
  let qm1 = 0n;

  const steps: BoothStep[] = [];
  for (let round = 1; round <= n; round++) {
    const before = snapshot(a, q, qm1, n, workW);
    const pair = `${q & 1n}${qm1}`;
    let op: OpKind = "none";
    if (pair === "01") {
      a = (a + m) & workMask;
      op = "add";
    } else if (pair === "10") {
      a = (a - m) & workMask;
      op = "sub";
    }
    const aAfterOpBits = bitsOf(a, workW);
    const aAfterOpValue = toSigned(a, workW).toString();

    // 对组合寄存器 {A, Q, Q-1} 做一次算术右移：复制 A 最高符号位，
    // A 低位进入 Q 高位，Q 低位进入 Q-1。
    const newQm1 = q & 1n;
    const newQ = ((q >> 1n) | ((a & 1n) << BigInt(n - 1))) & maskOf(n);
    const newA = (a >> 1n) | (a & signBit ? signBit : 0n);
    q = newQ;
    qm1 = newQm1;
    a = newA & workMask;

    steps.push({
      round,
      before,
      pair,
      op,
      aAfterOpBits,
      aAfterOpValue,
      after: snapshot(a, q, qm1, n, workW),
    });
  }

  // 组合 A(n+1) 与 Q(n) 得到 2n+1 位带冗余符号位的结果
  const combined = (a << BigInt(n)) | q;
  const combinedBits = bitsOf(combined, 2 * n + 1);
  const extraBit = combinedBits[0];
  const signBitChar = combinedBits[1];
  const redundantSignOk = extraBit === signBitChar;
  const productBits = combinedBits.slice(1); // 低 2n 位
  const productValue = toSigned(BigInt("0b" + productBits), 2 * n).toString();

  return {
    bitWidth: n,
    workWidth: workW,
    multiplicandValue: multiplicand.toString(),
    multiplierValue: multiplier.toString(),
    steps,
    combinedBits,
    redundantSignOk,
    productBits,
    productValue,
  };
}
