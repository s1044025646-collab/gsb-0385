import * as path from "node:path";
import { BoothError, runBooth } from "./booth.js";
import { Store } from "./store.js";
import { createAndRun, resultView, verifyCandidate } from "./service.js";
import { startServer } from "./server.js";

const DB = process.env.BOOTH_DB ?? path.join(process.cwd(), "data", "booth.db");

function usage(): never {
  console.log(`用法:
  booth run --n <2..32> --mode <decimal|binary> --m <被乘数> --q <乘数>   创建并完整运行
  booth list                                                          列出全部算例
  booth show <id>                                                     查看算例与完整过程
  booth round <id> <r>                                                查看某一轮
  booth table <id> [--csv]                                            导出寄存器表
  booth verify <id> --mode <decimal|binary> --product <候选乘积>       核验候选结果
  booth serve [--port <端口>]                                          启动 API (默认空闲端口)
  booth demo                                                          运行内置演示`);
  process.exit(1);
}

function argOf(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function printResult(id: number, r: ReturnType<typeof resultView>) {
  console.log(`算例 #${id}  n=${r.n}  工作位宽=${r.workBits}`);
  console.log(`被乘数 M=${r.multiplicand.value} (${r.multiplicand.bits})  工作补码 ${r.multiplicand.workBits}`);
  console.log(`乘数   Q=${r.multiplier.value} (${r.multiplier.bits})`);
  console.log("轮 | A(前)        Q(前)   Q-1 | 对  | 操作 | A(加减后)   | A(移后)      Q(移后)   Q-1");
  for (const s of r.rounds) {
    console.log(
      `${String(s.round).padStart(2)} | ${s.aBefore} ${s.qBefore} ${s.qm1Before} | ${s.pair} | ${s.op.padEnd(4)} | ${s.aAfterOp} | ${s.aAfterShift} ${s.qAfterShift} ${s.qm1AfterShift}`
    );
  }
  console.log(`组合 A:Q = ${r.combinedBits}  冗余符号位核对: ${r.redundantSignOk ? "通过" : "失败"}`);
  console.log(`乘积 = ${r.product.value}  补码(${2 * r.n}位) = ${r.product.bits}`);
}

function handle(fn: () => void) {
  try {
    fn();
  } catch (e) {
    if (e instanceof BoothError) {
      console.error(`错误 [${e.code}] ${e.message}`);
      if (e.details) console.error(JSON.stringify(e.details));
      process.exit(2);
    }
    throw e;
  }
}

const args = process.argv.slice(2);
const cmd = args[0];
if (!cmd) usage();

handle(() => {
  if (cmd === "run") {
    const store = new Store(DB);
    const { id, result } = createAndRun(store, {
      n: Number(argOf(args, "--n")),
      mode: argOf(args, "--mode"),
      multiplicand: argOf(args, "--m"),
      multiplier: argOf(args, "--q"),
    });
    printResult(id, resultView(result));
    store.close();
  } else if (cmd === "list") {
    const store = new Store(DB);
    for (const c of store.listCases()) {
      console.log(`#${c.id}  n=${c.n}  ${c.m_value} * ${c.q_value} = ${c.product_value}  (${c.created_at})`);
    }
    store.close();
  } else if (cmd === "show" || cmd === "table") {
    const id = Number(args[1]);
    const store = new Store(DB);
    const row = store.getCase(id);
    if (!row) throw new BoothError("E_NOT_FOUND", `算例 ${id} 不存在`);
    const result = runBooth(row.n, BigInt(row.m_value), BigInt(row.q_value));
    if (cmd === "table" && args.includes("--csv")) {
      console.log("round,a_before,q_before,qm1_before,pair,op,a_after_op,a_after_shift,q_after_shift,qm1_after_shift");
      for (const s of result.rounds) {
        console.log([s.round, s.aBefore, s.qBefore, s.qm1Before, s.pair, s.op, s.aAfterOp, s.aAfterShift, s.qAfterShift, s.qm1AfterShift].join(","));
      }
    } else {
      printResult(id, resultView(result));
    }
    store.close();
  } else if (cmd === "round") {
    const store = new Store(DB);
    const step = store.getStep(Number(args[1]), Number(args[2]));
    if (!step) throw new BoothError("E_NOT_FOUND", "算例或轮次不存在");
    console.log(JSON.stringify(step, null, 2));
    store.close();
  } else if (cmd === "verify") {
    const store = new Store(DB);
    const out = verifyCandidate(store, Number(args[1]), argOf(args, "--mode"), argOf(args, "--product"));
    console.log(out.ok ? "核验通过: 候选乘积正确" : `核验失败:\n- ${out.errors.join("\n- ")}`);
    store.close();
    if (!out.ok) process.exit(3);
  } else if (cmd === "serve") {
    const p = argOf(args, "--port");
    startServer(p ? Number(p) : 0, DB);
  } else if (cmd === "demo") {
    const store = new Store(DB);
    const demos: Array<[number, string, string, string]> = [
      [4, "decimal", "-3", "5"],
      [4, "decimal", "-8", "-8"],
      [4, "decimal", "-8", "-1"],
    ];
    for (const [n, mode, m, q] of demos) {
      const { id, result } = createAndRun(store, { n, mode, multiplicand: m, multiplier: q });
      printResult(id, resultView(result));
      console.log("");
    }
    store.close();
  } else {
    usage();
  }
});
