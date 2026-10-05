import test from "node:test";
import assert from "node:assert/strict";
import {
  BoothError, fromTwos, maskOf, maxValue, minValue, parseOperand, runBooth, toTwos, validateWidth, verifyProduct,
} from "../src/booth.js";

test("穷举 n=2..5 全部输入组合, 与独立 BigInt 乘法核对", () => {
  for (let n = 2; n <= 5; n++) {
    const lo = minValue(n), hi = maxValue(n);
    for (let m = lo; m <= hi; m++) {
      for (let q = lo; q <= hi; q++) {
        const r = runBooth(n, m, q);
        assert.equal(r.productValue, m * q, `n=${n} ${m}*${q}`);
        assert.equal(r.rounds.length, n, "总轮数");
        assert.ok(r.redundantSignOk, "冗余符号位");
        assert.equal(r.productBits.length, 2 * n);
        assert.equal(fromTwos(BigInt("0b" + r.productBits), 2 * n), m * q);
        // 逐轮寄存器位宽
        for (const s of r.rounds) {
          assert.equal(s.aBefore.length, n + 1);
          assert.equal(s.qBefore.length, n);
          assert.equal(s.aAfterShift.length, n + 1);
          assert.equal(s.qAfterShift.length, n);
          assert.match(s.qm1Before, /^[01]$/);
        }
      }
    }
  }
});

test("交换操作数最终值相同", () => {
  for (const [a, b] of [[-3n, 5n], [-8n, -1n], [7n, -2n]] as const) {
    const r1 = runBooth(4, a, b);
    const r2 = runBooth(4, b, a);
    assert.equal(r1.productValue, r2.productValue);
  }
});

test("演示用例: -3*5=-15 补码 11110001", () => {
  const r = runBooth(4, -3n, 5n);
  assert.equal(r.productValue, -15n);
  assert.equal(r.productBits, "11110001");
});

test("最小负数: -8*-8=64, -8*-1=8", () => {
  assert.equal(runBooth(4, -8n, -8n).productValue, 64n);
  assert.equal(runBooth(4, -8n, -1n).productValue, 8n);
  assert.equal(runBooth(32, minValue(32), minValue(32)).productValue, minValue(32) * minValue(32));
});

test("零与全一", () => {
  assert.equal(runBooth(4, 0n, 0n).productValue, 0n);
  assert.equal(runBooth(4, 0n, -8n).productValue, 0n);
  assert.equal(runBooth(4, -1n, -1n).productValue, 1n);
  assert.equal(runBooth(4, 7n, 7n).productValue, 49n);
});

test("算术右移复制符号位", () => {
  // -1 * 1: A 应出现全一并保持
  const r = runBooth(4, -1n, 1n);
  const last = r.rounds[r.rounds.length - 1];
  assert.equal(last.aAfterShift, "11111");
});

test("位宽校验", () => {
  assert.throws(() => validateWidth(1), BoothError);
  assert.throws(() => validateWidth(33), BoothError);
  assert.throws(() => validateWidth(2.5), BoothError);
  assert.throws(() => validateWidth("4"), BoothError);
  assert.doesNotThrow(() => validateWidth(2));
  assert.doesNotThrow(() => validateWidth(32));
});

test("十进制操作数范围", () => {
  assert.equal(parseOperand("-8", "decimal", 4, "m"), -8n);
  assert.equal(parseOperand("7", "decimal", 4, "m"), 7n);
  assert.throws(() => parseOperand("8", "decimal", 4, "m"), (e: unknown) => (e as BoothError).code === "E_OPERAND_RANGE");
  assert.throws(() => parseOperand("-9", "decimal", 4, "m"), (e: unknown) => (e as BoothError).code === "E_OPERAND_RANGE");
  assert.throws(() => parseOperand("abc", "decimal", 4, "m"), (e: unknown) => (e as BoothError).code === "E_OPERAND_FORMAT");
});

test("二进制补码模式: 固定长度, 拒绝超宽截断与前导零歧义", () => {
  assert.equal(parseOperand("1000", "binary", 4, "m"), -8n);
  assert.equal(parseOperand("0111", "binary", 4, "m"), 7n);
  assert.equal(parseOperand("0011", "binary", 4, "m"), 3n); // 前导零合法
  assert.throws(() => parseOperand("111", "binary", 4, "m"), (e: unknown) => (e as BoothError).code === "E_OPERAND_WIDTH");
  assert.throws(() => parseOperand("00111", "binary", 4, "m"), (e: unknown) => (e as BoothError).code === "E_OPERAND_WIDTH");
  assert.throws(() => parseOperand("10a1", "binary", 4, "m"), (e: unknown) => (e as BoothError).code === "E_OPERAND_FORMAT");
});

test("候选核验: 十进制与二进制, 错误定位", () => {
  const r = runBooth(4, -3n, 5n);
  assert.deepEqual(verifyProduct(r, "-15", "decimal"), { ok: true, errors: [] });
  assert.deepEqual(verifyProduct(r, "11110001", "binary"), { ok: true, errors: [] });
  assert.equal(verifyProduct(r, "-14", "decimal").ok, false);
  assert.equal(verifyProduct(r, "11110010", "binary").ok, false);
  assert.equal(verifyProduct(r, "111100011", "binary").ok, false); // 超宽
  assert.equal(verifyProduct(r, "111", "binary").ok, false);
  const bad = verifyProduct(r, "11110x01", "binary");
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /第 6 个字符/);
  assert.equal(verifyProduct(r, "999999999999", "decimal").ok, false); // 超范围
});

test("补码编解码", () => {
  assert.equal(toTwos(-1n, 4), 15n);
  assert.equal(fromTwos(15n, 4), -1n);
  assert.equal(fromTwos(8n, 4), -8n);
  assert.equal(maskOf(5), 31n);
});

