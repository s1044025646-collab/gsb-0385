import * as http from "node:http";
import * as path from "node:path";
import { BoothError } from "./booth.js";
import { Store } from "./store.js";
import { createAndRun, resultView, verifyCandidate } from "./service.js";

const STATUS_BY_CODE: Record<string, number> = {
  E_INVALID_WIDTH: 400,
  E_OPERAND_FORMAT: 400,
  E_OPERAND_RANGE: 400,
  E_OPERAND_WIDTH: 400,
  E_MODE_REQUIRED: 400,
  E_NOT_FOUND: 404,
  E_INTERNAL: 500,
};

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(data);
}

function sendError(res: http.ServerResponse, e: unknown) {
  if (e instanceof BoothError) {
    sendJson(res, STATUS_BY_CODE[e.code] ?? 400, { error: { code: e.code, message: e.message, details: e.details ?? null } });
  } else {
    sendJson(res, 500, { error: { code: "E_INTERNAL", message: String(e) } });
  }
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new BoothError("E_OPERAND_FORMAT", "请求体必须是合法 JSON");
  }
}

export function createServer(store: Store): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      const method = req.method ?? "GET";

      if (method === "POST" && url.pathname === "/api/cases") {
        const body = (await readBody(req)) as Record<string, unknown>;
        const { id, result } = createAndRun(store, body as never);
        sendJson(res, 201, { id, ...resultView(result) });
        return;
      }
      if (method === "GET" && url.pathname === "/api/cases") {
        sendJson(res, 200, { cases: store.listCases() });
        return;
      }
      if (parts[0] === "api" && parts[1] === "cases" && parts[2] !== undefined) {
        const id = Number(parts[2]);
        if (!Number.isInteger(id)) throw new BoothError("E_NOT_FOUND", "算例 id 非法");
        const row = store.getCase(id);
        if (!row) throw new BoothError("E_NOT_FOUND", `算例 ${id} 不存在`);

        if (method === "GET" && parts.length === 3) {
          const { runBooth } = await import("./booth.js");
          const result = runBooth(row.n, BigInt(row.m_value), BigInt(row.q_value));
          sendJson(res, 200, { id, case: row, ...resultView(result) });
          return;
        }
        if (method === "GET" && parts[3] === "rounds" && parts[4] !== undefined) {
          const round = Number(parts[4]);
          const step = store.getStep(id, round);
          if (!step) throw new BoothError("E_NOT_FOUND", `算例 ${id} 没有第 ${parts[4]} 轮`);
          sendJson(res, 200, { caseId: id, step });
          return;
        }
        if (method === "GET" && parts[3] === "table") {
          const steps = store.getSteps(id);
          if (url.searchParams.get("format") === "csv") {
            const header = "round,a_before,q_before,qm1_before,pair,op,a_after_op,a_after_shift,q_after_shift,qm1_after_shift";
            const lines = steps.map((s) =>
              [s.round, s.a_before, s.q_before, s.qm1_before, s.pair, s.op, s.a_after_op, s.a_after_shift, s.q_after_shift, s.qm1_after_shift].join(",")
            );
            res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8" });
            res.end([header, ...lines].join("\n") + "\n");
          } else {
            sendJson(res, 200, { caseId: id, n: row.n, steps });
          }
          return;
        }
        if (method === "POST" && parts[3] === "verify") {
          const body = (await readBody(req)) as Record<string, unknown>;
          sendJson(res, 200, verifyCandidate(store, id, body.mode, body.product));
          return;
        }
      }
      throw new BoothError("E_NOT_FOUND", `未知路由 ${method} ${url.pathname}`);
    } catch (e) {
      sendError(res, e);
    }
  });
}

export function startServer(port: number, dbPath: string): { server: http.Server; store: Store } {
  const store = new Store(dbPath);
  const server = createServer(store);
  server.listen(port, () => {
    const addr = server.address();
    const p = typeof addr === "object" && addr ? addr.port : port;
    console.log(`Booth 乘法服务已启动: http://127.0.0.1:${p} (数据库: ${dbPath})`);
  });
  return { server, store };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith("server.js");
if (isMain) {
  const portArg = process.argv.find((a) => a.startsWith("--port="));
  const port = portArg ? Number(portArg.split("=")[1]) : 0; // 默认 0 = 选择空闲端口
  const dbPath = process.env.BOOTH_DB ?? path.join(process.cwd(), "data", "booth.db");
  startServer(port, dbPath);
}
