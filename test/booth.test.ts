import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bitsOf, maskOf, runBooth, signedRange, toSigned } from "../src/booth";
import { Store } from "../src/db";
import { BoothService } from "../src/service";
import { ApiError } from "../src/errors";

function tmpService(): { service: BoothService; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "booth-test-"));
  return { service: new BoothService(new Store(dir)), dir };
}

test("演示: 4 位 -3 x 5 = -15, 位型 11110001", () => {
  const r = runBooth(4, -3n, 5n);
  assert.equal(r.productValue, "-15");
  assert.equal(r.productBits, "11110001");
  assert.equal(r.steps.length, 4);
  assert.ok(r.redundantSignOk);
});

test("演示: 4 位最小负数 -8 x -8 = 64", () => {
  const r = runBooth(4, -8n, -8n);
  assert.equal(r.productValue, "64");
  assert.equal(r.productBits, "01000000");
  assert.ok(r.redundantSignOk);
});

test("演示: 4 位 -8 x -1 = 8（最小负数取反不溢出）", () => {
  const r = runBooth(4, -8n, -1n);
  assert.equal(r.productValue, "8");
  assert.equal(r.productBits, "00001000");
});

test("穷举: n=2..5 全部输入组合与独立 BigInt 乘法核对", () => {
  for (let n = 2; n <= 5; n++) {
    const { min, max } = signedRange(n);
    for (let a = min; a <= max; a++) {
      for (let b = min; b <= max; b++) {
        const r = runBooth(n, a, b);
        const expect = a * b;
        assert.equal(r.productValue, expect.toString(), `n=${n} ${a}x${b}`);
        assert.equal(r.productBits, bitsOf(expect, 2 * n), `bits n=${n} ${a}x${b}`);
        assert.ok(r.redundantSignOk, `redundant sign n=${n} ${a}x${b}`);
        assert.equal(r.steps.length, n);
      }
    }
  }
});

test("逐轮: 寄存器位宽与算术移位正确", () => {
  for (let n = 2; n <= 6; n++) {
    const { min, max } = signedRange(n);
    for (let a = min; a <= max; a += 3n) {
      for (let b = min; b <= max; b += 3n) {
        const r = runBooth(n, a, b);
        for (const s of r.steps) {
          assert.equal(s.before.aBits.length, n + 1);
          assert.equal(s.before.qBits.length, n);
          assert.equal(s.after.aBits.length, n + 1);
          assert.match(s.before.qm1, /^[01]$/);
          // 用 before + op 重算移位，验证移位关系
          const workMask = maskOf(n + 1);
          const mWide = BigInt.asUintN(n + 1, a);
          let aAfter = BigInt("0b" + s.before.aBits);
          if (s.op === "add") aAfter = (aAfter + mWide) & workMask;
          if (s.op === "sub") aAfter = (aAfter - mWide) & workMask;
          assert.equal(s.aAfterOpBits, bitsOf(aAfter, n + 1));
          const qBefore = BigInt("0b" + s.before.qBits);
          const expQm1 = qBefore & 1n;
          const expQ = ((qBefore >> 1n) | ((aAfter & 1n) << BigInt(n - 1))) & maskOf(n);
          const sign = aAfter & (1n << BigInt(n));
          const expA = ((aAfter >> 1n) | sign) & workMask;
          assert.equal(s.after.qm1, expQm1.toString());
          assert.equal(s.after.qBits, bitsOf(expQ, n));
          assert.equal(s.after.aBits, bitsOf(expA, n + 1));
          // 算术移位复制符号位
          assert.equal(s.after.aBits[0], s.aAfterOpBits[0]);
        }
      }
    }
  }
});

test("乘积解码值落在 2n 位有符号范围内", () => {
  for (let n = 2; n <= 8; n++) {
    const { min, max } = signedRange(n);
    for (const v of [min, -1n, 0n, 1n, max]) {
      const r = runBooth(n, v, v);
      const p = BigInt(r.productValue);
      const range = signedRange(2 * n);
      assert.ok(p >= range.min && p <= range.max);
    }
  }
});

test("交换操作数: 轨迹可不同但最终值相同", () => {
  const r1 = runBooth(5, -7n, 11n);
  const r2 = runBooth(5, 11n, -7n);
  assert.equal(r1.productValue, r2.productValue);
  assert.equal(r1.productBits, r2.productBits);
});

test("边界: 零、最大正数、最小负数、全一", () => {
  const n = 6;
  const { min, max } = signedRange(n);
  assert.equal(runBooth(n, 0n, max).productValue, "0");
  assert.equal(runBooth(n, max, max).productValue, (max * max).toString());
  assert.equal(runBooth(n, min, min).productValue, (min * min).toString());
  assert.equal(runBooth(n, min, -1n).productValue, (-min).toString());
  assert.equal(runBooth(n, -1n, -1n).productValue, "1");
});

test("校验: 非法位宽", () => {
  const { service } = tmpService();
  for (const bad of [0, 1, 33, -2, 2.5, "x"]) {
    assert.throws(
      () => service.create({ bitWidth: bad, mode: "decimal", multiplicand: 1, multiplier: 1 }),
      (e: unknown) => e instanceof ApiError && e.code === "E_BIT_WIDTH",
    );
  }
});

test("校验: 十进制超范围与非法格式", () => {
  const { service } = tmpService();
  assert.throws(
    () => service.create({ bitWidth: 4, mode: "decimal", multiplicand: 8, multiplier: 1 }),
    (e: unknown) => e instanceof ApiError && e.code === "E_OPERAND_RANGE",
  );
  assert.throws(
    () => service.create({ bitWidth: 4, mode: "decimal", multiplicand: -9, multiplier: 1 }),
    (e: unknown) => e instanceof ApiError && e.code === "E_OPERAND_RANGE",
  );
  assert.throws(
    () => service.create({ bitWidth: 4, mode: "decimal", multiplicand: "1.5", multiplier: 1 }),
    (e: unknown) => e instanceof ApiError && e.code === "E_OPERAND_FORMAT",
  );
});

test("校验: 二进制模式、前导零与超宽拒绝", () => {
  const { service } = tmpService();
  // 前导零合法且按补码解释: 0011 = 3
  const ok = service.create({ bitWidth: 4, mode: "binary", multiplicand: "0011", multiplier: "1111" });
  assert.equal(ok.record.multiplicandValue, "3");
  assert.equal(ok.record.multiplierValue, "-1");
  assert.equal(ok.record.productValue, "-3");
  // 超宽拒绝，不静默截断
  assert.throws(
    () => service.create({ bitWidth: 4, mode: "binary", multiplicand: "00011", multiplier: "1111" }),
    (e: unknown) => e instanceof ApiError && e.code === "E_BINARY_FORMAT",
  );
  assert.throws(
    () => service.create({ bitWidth: 4, mode: "binary", multiplicand: "011", multiplier: "1111" }),
    (e: unknown) => e instanceof ApiError && e.code === "E_BINARY_FORMAT",
  );
  assert.throws(
    () => service.create({ bitWidth: 4, mode: "binary", multiplicand: "01x1", multiplier: "1111" }),
    (e: unknown) => e instanceof ApiError && e.code === "E_BINARY_FORMAT",
  );
});

test("持久化: 重启后逐位查看原过程", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "booth-test-"));
  const s1 = new BoothService(new Store(dir));
  const { record, steps } = s1.create({ bitWidth: 4, mode: "decimal", multiplicand: -3, multiplier: 5 });
  const s2 = new BoothService(new Store(dir)); // 模拟重启
  const got = s2.get(record.id);
  assert.deepEqual(got.steps, steps);
  assert.equal(got.record.productBits, "11110001");
  assert.equal(got.record.multiplicandRaw, "-3");
  assert.equal(got.record.ruleVersion, "booth-radix2-v1");
  // 修改位宽产生新算例
  const { record: r2 } = s2.create({ bitWidth: 5, mode: "decimal", multiplicand: -3, multiplier: 5 });
  assert.notEqual(r2.id, record.id);
  assert.equal(s2.get(record.id).record.bitWidth, 4);
});

test("核验候选: 正确、十进制不符、二进制不符定位、超宽拒绝", () => {
  const { service } = tmpService();
  const { record } = service.create({ bitWidth: 4, mode: "decimal", multiplicand: -3, multiplier: 5 });
  const okR = service.verify(record.id, { mode: "decimal", candidate: "-15" });
  assert.ok(okR.ok);
  const okB = service.verify(record.id, { mode: "binary", candidate: "11110001" });
  assert.ok(okB.ok);
  const badD = service.verify(record.id, { mode: "decimal", candidate: "-13" });
  assert.equal(badD.ok, false);
  assert.equal(badD.mismatch?.firstDiffPosition, 7); // 11110001 vs 11110011
  const badB = service.verify(record.id, { mode: "binary", candidate: "11110000" });
  assert.equal(badB.ok, false);
  assert.equal(badB.mismatch?.firstDiffPosition, 8);
  assert.throws(
    () => service.verify(record.id, { mode: "binary", candidate: "011110001" }),
    (e: unknown) => e instanceof ApiError && e.code === "E_CANDIDATE_WIDTH",
  );
  assert.throws(
    () => service.verify(record.id, { mode: "decimal", candidate: "999" }),
    (e: unknown) => e instanceof ApiError && e.code === "E_CANDIDATE_FORMAT",
  );
});

test("查询: 单轮与轮次越界", () => {
  const { service } = tmpService();
  const { record } = service.create({ bitWidth: 4, mode: "decimal", multiplicand: 3, multiplier: -2 });
  const step = service.getStep(record.id, 1);
  assert.equal(step.round, 1);
  assert.throws(
    () => service.getStep(record.id, 5),
    (e: unknown) => e instanceof ApiError && e.code === "E_ROUND_RANGE",
  );
  assert.throws(
    () => service.get(9999),
    (e: unknown) => e instanceof ApiError && e.code === "E_NOT_FOUND",
  );
});

test("导出寄存器表包含全部轮次", () => {
  const { service } = tmpService();
  const { record } = service.create({ bitWidth: 4, mode: "decimal", multiplicand: -3, multiplier: 5 });
  const table = service.exportTable(record.id);
  assert.ok(table.includes("11110001"));
  assert.ok(table.includes("-15"));
  assert.equal(table.split("\n").filter((l) => /^\s*\d+ \|/.test(l)).length, 4);
});

test("32 位大位宽不丢高位（BigInt 掩码）", () => {
  const n = 32;
  const { min, max } = signedRange(n);
  assert.equal(runBooth(n, min, min).productValue, (min * min).toString());
  assert.equal(runBooth(n, max, min).productValue, (max * min).toString());
  assert.equal(runBooth(n, -1n, min).productValue, (-min).toString());
});
