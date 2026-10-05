// 业务层：创建算例、查询、导出寄存器表、核验候选结果
import { BoothResult, BoothStep, runBooth, signedRange, toSigned } from "./booth";
import { MultiplicationRecord, Store } from "./db";
import { ApiError, ERR } from "./errors";
import { InputMode, parseBitWidth, parseMode, parseOperand } from "./validate";

export interface CreateInput {
  bitWidth: unknown;
  mode: unknown;
  multiplicand: unknown;
  multiplier: unknown;
}

export class BoothService {
  constructor(private store: Store) {}

  /** 校验输入、完整运行、原子持久化 */
  create(input: CreateInput): { record: MultiplicationRecord; steps: BoothStep[] } {
    const bitWidth = parseBitWidth(input.bitWidth);
    const mode = parseMode(input.mode);
    const multiplicandRaw = String(input.multiplicand);
    const multiplierRaw = String(input.multiplier);
    const m = parseOperand(input.multiplicand, bitWidth, mode, "multiplicand");
    const q = parseOperand(input.multiplier, bitWidth, mode, "multiplier");
    const result = runBooth(bitWidth, m, q);
    const id = this.store.save(
      { bitWidth, mode, multiplicandRaw, multiplierRaw },
      result,
    );
    return { record: this.store.get(id)!, steps: result.steps };
  }

  get(id: number): { record: MultiplicationRecord; steps: BoothStep[] } {
    const record = this.store.get(id);
    if (!record) throw new ApiError(ERR.NOT_FOUND, `算例 ${id} 不存在`);
    return { record, steps: this.store.getSteps(id) };
  }

  getStep(id: number, round: number): BoothStep {
    const record = this.store.get(id);
    if (!record) throw new ApiError(ERR.NOT_FOUND, `算例 ${id} 不存在`);
    if (!Number.isInteger(round) || round < 1 || round > record.bitWidth) {
      throw new ApiError(ERR.ROUND_RANGE, `轮次必须在 1..${record.bitWidth}，收到：${round}`);
    }
    return this.store.getStep(id, round)!;
  }

  list(): MultiplicationRecord[] {
    return this.store.list();
  }

  /** 导出对齐的寄存器表（纯文本） */
  exportTable(id: number): string {
    const { record, steps } = this.get(id);
    const w = record.bitWidth;
    const aw = w + 1;
    const lines: string[] = [];
    lines.push(`# Booth 乘法 #${id}  ${record.multiplicandValue} x ${record.multiplierValue} = ${record.productValue}`);
    lines.push(`# 位宽 n=${w}，工作位宽 n+1=${aw}，规则版本 ${record.ruleVersion}`);
    const pad = (s: string, len: number) => s.padEnd(len);
    const aw2 = aw + 2;
    lines.push(
      `${"轮".padStart(2)} | ${pad("A(前)", aw2)} ${pad("Q(前)", w + 2)} Q-1 | 对 | 操作 | ${pad("A(算后)", aw2)} | ${pad("A(移后)", aw2)} ${pad("Q(移后)", w + 2)} Q-1`,
    );
    for (const s of steps) {
      const opText = s.op === "add" ? "A+=M" : s.op === "sub" ? "A-=M" : "无";
      lines.push(
        `${String(s.round).padStart(2)} | ${pad(s.before.aBits, aw2)} ${pad(s.before.qBits, w + 2)} ${s.before.qm1}   | ${s.pair} | ${opText.padEnd(4)} | ${pad(s.aAfterOpBits, aw2)} | ${pad(s.after.aBits, aw2)} ${pad(s.after.qBits, w + 2)} ${s.after.qm1}`,
      );
    }
    lines.push(`# 组合 A++Q = ${record.combinedBits}（冗余符号位核对：${record.redundantSignOk ? "通过" : "失败"}）`);
    lines.push(`# 乘积低 2n 位 = ${record.productBits} = ${record.productValue}`);
    return lines.join("\n");
  }

  /** 核验候选乘积：检查位数、补码解释与乘积是否相符 */
  verify(id: number, input: { mode: unknown; candidate: unknown }): {
    ok: boolean;
    expected: { bits: string; value: string };
    candidate: { bits: string; value: string };
    mismatch?: { firstDiffPosition?: number; message: string };
  } {
    const { record } = this.get(id);
    const width = 2 * record.bitWidth;
    const mode = parseMode(input.mode);
    const raw = String(input.candidate).trim();
    const expected = { bits: record.productBits, value: record.productValue };

    let candBits: string;
    if (mode === "binary") {
      if (!/^[01]+$/.test(raw)) {
        const badAt = [...raw].findIndex((c) => c !== "0" && c !== "1");
        throw new ApiError(ERR.CANDIDATE_FORMAT, "候选值含非法二进制字符", {
          position: badAt >= 0 ? badAt + 1 : undefined,
        });
      }
      if (raw.length !== width) {
        throw new ApiError(
          ERR.CANDIDATE_WIDTH,
          `候选值长度 ${raw.length} 与期望 ${width} 位不符（不接受超宽截断）`,
          { expectedLength: width, actualLength: raw.length },
        );
      }
      candBits = raw;
    } else {
      if (!/^-?\d+$/.test(raw)) {
        throw new ApiError(ERR.CANDIDATE_FORMAT, `候选值不是合法十进制整数："${raw}"`);
      }
      const v = BigInt(raw);
      const { min, max } = signedRange(width);
      if (v < min || v > max) {
        throw new ApiError(ERR.CANDIDATE_FORMAT, `候选值 ${v} 超出 ${width} 位有符号范围 [${min}, ${max}]`);
      }
      candBits = (v & ((1n << BigInt(width)) - 1n)).toString(2).padStart(width, "0");
    }
    const candValue = toSigned(BigInt("0b" + candBits), width).toString();

    if (candBits !== expected.bits) {
      let firstDiff = 0;
      while (firstDiff < width && candBits[firstDiff] === expected.bits[firstDiff]) firstDiff++;
      return {
        ok: false,
        expected,
        candidate: { bits: candBits, value: candValue },
        mismatch: {
          firstDiffPosition: firstDiff + 1, // 自左起 1 基
          message: `乘积不符：候选 ${candValue}，期望 ${expected.value}，首个不同位在第 ${firstDiff + 1} 位（自左）`,
        },
      };
    }
    return { ok: true, expected, candidate: { bits: candBits, value: candValue } };
  }
}

export { BoothResult };
