// CLI：create / list / show / step / export / verify / demo / serve
import path from "node:path";
import { Store } from "./db";
import { BoothService } from "./service";
import { startServer } from "./server";
import { ApiError } from "./errors";

const DATA_DIR = process.env.BOOTH_DATA_DIR ?? path.join(process.cwd(), "data");

function parseArgs(argv: string[]): { cmd: string; flags: Record<string, string> } {
  const [cmd = "help", ...rest] = argv;
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    }
  }
  return { cmd, flags };
}

function printStep(step: ReturnType<BoothService["getStep"]>): void {
  const opText = step.op === "add" ? "A += M" : step.op === "sub" ? "A -= M" : "无操作";
  console.log(`第 ${step.round} 轮`);
  console.log(`  操作前: A=${step.before.aBits}(${step.before.aValue}) Q=${step.before.qBits}(${step.before.qValue}) Q-1=${step.before.qm1}`);
  console.log(`  判定位对: ${step.pair}  ->  ${opText}`);
  console.log(`  算后 A: ${step.aAfterOpBits}(${step.aAfterOpValue})`);
  console.log(`  移位后: A=${step.after.aBits}(${step.after.aValue}) Q=${step.after.qBits}(${step.after.qValue}) Q-1=${step.after.qm1}`);
}

function printFull(service: BoothService, id: number): void {
  const { record, steps } = service.get(id);
  console.log(`算例 #${record.id}: n=${record.bitWidth} 模式=${record.mode} 规则=${record.ruleVersion}`);
  console.log(`  输入: multiplicand=${record.multiplicandRaw} (${record.multiplicandValue}), multiplier=${record.multiplierRaw} (${record.multiplierValue})`);
  for (const s of steps) printStep(s);
  console.log(`组合 A++Q = ${record.combinedBits}  冗余符号位核对: ${record.redundantSignOk ? "通过" : "失败"}`);
  console.log(`乘积 = ${record.productBits} = ${record.productValue}`);
}

function runDemo(service: BoothService): void {
  const demos: [number, string, string, string][] = [
    [4, "decimal", "-3", "5"],
    [4, "decimal", "-8", "-8"],
    [4, "decimal", "-8", "-1"],
  ];
  for (const [n, mode, m, q] of demos) {
    const { record } = service.create({ bitWidth: n, mode, multiplicand: m, multiplier: q });
    printFull(service, record.id);
    console.log("");
  }
}

const HELP = `用法: node dist/cli.js <命令> [参数]
  create --n <位宽> --mode <decimal|binary> --m <被乘数> --q <乘数>
  list
  show --id <id>
  step --id <id> --round <r>
  export --id <id>
  verify --id <id> --mode <decimal|binary> --candidate <候选乘积>
  demo
  serve [--port <端口>]   (缺省自动选择空闲端口)
`;

async function main(): Promise<void> {
  const { cmd, flags } = parseArgs(process.argv.slice(2));
  const store = new Store(DATA_DIR);
  const service = new BoothService(store);
  try {
    switch (cmd) {
      case "create": {
        const { record } = service.create({
          bitWidth: flags.n,
          mode: flags.mode ?? "decimal",
          multiplicand: flags.m,
          multiplier: flags.q,
        });
        console.log(`已创建算例 #${record.id}，乘积 ${record.productBits} = ${record.productValue}`);
        break;
      }
      case "list": {
        for (const r of service.list()) {
          console.log(`#${r.id} n=${r.bitWidth} ${r.mode} ${r.multiplicandRaw} x ${r.multiplierRaw} = ${r.productValue} (${r.productBits})`);
        }
        break;
      }
      case "show":
        printFull(service, Number(flags.id));
        break;
      case "step":
        printStep(service.getStep(Number(flags.id), Number(flags.round)));
        break;
      case "export":
        console.log(service.exportTable(Number(flags.id)));
        break;
      case "verify": {
        const r = service.verify(Number(flags.id), { mode: flags.mode ?? "decimal", candidate: flags.candidate });
        console.log(JSON.stringify(r, null, 2));
        break;
      }
      case "demo":
        runDemo(service);
        break;
      case "serve": {
        const port = flags.port ? Number(flags.port) : 0;
        const { port: actual } = await startServer(service, port);
        console.log(`API 服务已启动: http://127.0.0.1:${actual}  (数据目录: ${DATA_DIR})`);
        return; // 保持进程
      }
      default:
        process.stdout.write(HELP);
    }
  } catch (e) {
    if (e instanceof ApiError) {
      console.error(`错误 [${e.code}] ${e.message}`);
      process.exitCode = 2;
    } else {
      throw e;
    }
  } finally {
    if (cmd !== "serve") store.close();
  }
}

void main();
