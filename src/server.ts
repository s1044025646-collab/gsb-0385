// HTTP API：仅后端，无外部依赖，使用 node:http
import http from "node:http";
import { AddressInfo } from "node:net";
import { ApiError, ERR } from "./errors";
import { BoothService } from "./service";

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(data);
}

function sendText(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => (buf += c));
    req.on("end", () => {
      if (!buf) return resolve({});
      try {
        resolve(JSON.parse(buf));
      } catch {
        reject(new ApiError(ERR.BAD_JSON, "请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

export function createServer(service: BoothService): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      const method = req.method ?? "GET";
      if (method === "GET" && url.pathname === "/api/health") {
        return sendJson(res, 200, { ok: true });
      }
      if (method === "POST" && url.pathname === "/api/multiplications") {
        const body = (await readBody(req)) as Record<string, unknown>;
        const { record, steps } = service.create({
          bitWidth: body.bitWidth,
          mode: body.mode,
          multiplicand: body.multiplicand,
          multiplier: body.multiplier,
        });
        return sendJson(res, 201, { record, steps });
      }
      if (parts[0] === "api" && parts[1] === "multiplications") {
        if (parts.length === 2 && method === "GET") {
          return sendJson(res, 200, { items: service.list() });
        }
        const id = Number(parts[2]);
        if (!Number.isInteger(id)) throw new ApiError(ERR.ROUTE, "非法算例 id");
        if (parts.length === 3 && method === "GET") {
          return sendJson(res, 200, service.get(id));
        }
        if (parts[3] === "steps" && parts.length === 5 && method === "GET") {
          return sendJson(res, 200, { step: service.getStep(id, Number(parts[4])) });
        }
        if (parts[3] === "export" && parts.length === 4 && method === "GET") {
          return sendText(res, 200, service.exportTable(id) + "\n");
        }
        if (parts[3] === "verify" && parts.length === 4 && method === "POST") {
          const body = (await readBody(req)) as Record<string, unknown>;
          return sendJson(res, 200, service.verify(id, { mode: body.mode, candidate: body.candidate }));
        }
      }
      throw new ApiError(ERR.ROUTE, `未匹配路由：${method} ${url.pathname}`);
    } catch (e) {
      if (e instanceof ApiError) {
        return sendJson(res, e.code === ERR.NOT_FOUND ? 404 : 400, {
          error: { code: e.code, message: e.message, details: e.details ?? null },
        });
      }
      return sendJson(res, 500, { error: { code: "E_INTERNAL", message: String(e) } });
    }
  });
}

/** 启动服务；port 为 0 或未提供时选择空闲端口 */
export function startServer(service: BoothService, port = 0, host = "127.0.0.1"): Promise<{ port: number; close: () => void }> {
  const server = createServer(service);
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, host, () => {
      const addr = server.address() as AddressInfo;
      resolve({ port: addr.port, close: () => server.close() });
    });
  });
}
