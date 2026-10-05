// 输入校验：位宽、十进制/二进制两种模式的操作数解析
import { MAX_BIT_WIDTH, MIN_BIT_WIDTH, signedRange, toSigned } from "./booth";
import { ApiError, ERR } from "./errors";

export type InputMode = "decimal" | "binary";

export function parseBitWidth(raw: unknown): number {
  const n = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isInteger(n)) {
    throw new ApiError(ERR.BIT_WIDTH, `位宽必须是整数，收到：${String(raw)}`);
  }
  if (n < MIN_BIT_WIDTH || n > MAX_BIT_WIDTH) {
    throw new ApiError(ERR.BIT_WIDTH, `位宽必须在 ${MIN_BIT_WIDTH}..${MAX_BIT_WIDTH} 之间，收到：${n}`);
  }
  return n;
}

export function parseMode(raw: unknown): InputMode {
  if (raw === "decimal" || raw === "binary") return raw;
  throw new ApiError(ERR.MODE, `mode 必须是 "decimal" 或 "binary"，收到：${String(raw)}`);
}

/** 十进制模式：必须落在 n 位有符号范围内 */
export function parseDecimalOperand(raw: unknown, bitWidth: number, name: string): bigint {
  const s = String(raw).trim();
  if (!/^-?\d+$/.test(s)) {
    throw new ApiError(ERR.OPERAND_FORMAT, `${name} 不是合法十进制整数："${s}"`, { operand: name });
  }
  const v = BigInt(s);
  const { min, max } = signedRange(bitWidth);
  if (v < min || v > max) {
    throw new ApiError(
      ERR.OPERAND_RANGE,
      `${name}=${v} 超出 ${bitWidth} 位有符号范围 [${min}, ${max}]`,
      { operand: name, value: v.toString(), min: min.toString(), max: max.toString() },
    );
  }
  return v;
}

/** 二进制模式：必须恰好 bitWidth 个 0/1 字符，按补码解释；超宽直接报错，不静默截断 */
export function parseBinaryOperand(raw: unknown, bitWidth: number, name: string): bigint {
  const s = String(raw).trim();
  if (!/^[01]+$/.test(s)) {
    const badAt = [...s].findIndex((c) => c !== "0" && c !== "1");
    throw new ApiError(ERR.BINARY_FORMAT, `${name} 含非法二进制字符`, {
      operand: name,
      position: badAt >= 0 ? badAt + 1 : undefined,
    });
  }
  if (s.length !== bitWidth) {
    throw new ApiError(
      ERR.BINARY_FORMAT,
      `${name} 长度 ${s.length} 与位宽 ${bitWidth} 不符（不接受超宽截断或前导补零猜测）`,
      { operand: name, expectedLength: bitWidth, actualLength: s.length },
    );
  }
  return toSigned(BigInt("0b" + s), bitWidth);
}

export function parseOperand(raw: unknown, bitWidth: number, mode: InputMode, name: string): bigint {
  return mode === "decimal"
    ? parseDecimalOperand(raw, bitWidth, name)
    : parseBinaryOperand(raw, bitWidth, name);
}
