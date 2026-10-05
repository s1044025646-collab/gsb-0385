import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Store } from "../src/store.js";
import { createAndRun, verifyCandidate } from "../src/service.js";
import { createServer } from "../src/server.js";

function tmpDb(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "booth-")), "t.db");
}

test("持久化: 保存后重开数据库仍可逐步读取", () => {
  const db = tmpDb();
  let store = new Store(db);
  const { id } = createAndRun(store, { n: 4, mode: "decimal", multiplicand: "-3", multiplier: "5" });
  store.close();
  store = new Store(db);
  const row = store.getCase(id)!;
  assert.equal(row.m_value, "-3");
  assert.equal(row.product_value, "-15");
  assert.equal(row.product_bits, "11110001");
  const steps = store.getSteps(id);
  assert.equal(steps.length, 4);
  assert.equal(store.getStep(id, 1)!.round, 1);
  store.close();
});

test("修改位宽产生新算例, 不重新解释旧二进制串", () => {
  const store = new Store(tmpDb());
  const a = createAndRun(store, { n: 4, mode: "binary", multiplicand: "1111", multiplier: "0001" });
  const b = createAndRun(store, { n: 5, mode: "binary", multiplicand: "11111", multiplier: "00001" });
  assert.notEqual(a.id, b.id);
  assert.equal(store.getCase(a.id)!.m_value, "-1");
  assert.equal(store.getCase(b.id)!.m_value, "-1");
  assert.equal(store.getCase(a.id)!.n, 4);
  assert.equal(store.getCase(b.id)!.n, 5);
  store.close();
});

test("verifyCandidate 服务层", () => {
  const store = new Store(tmpDb());
  const { id } = createAndRun(store, { n: 4, mode: "decimal", multiplicand: "-8", multiplier: "-8" });
  assert.equal(verifyCandidate(store, id, "decimal", "64").ok, true);
  assert.equal(verifyCandidate(store, id, "binary", "01000000").ok, true);
  assert.equal(verifyCandidate(store, id, "decimal", "63").ok, false);
  store.close();
});

test("HTTP API 端到端", async () => {
  const store = new Store(tmpDb());
  const server = createServer(store);
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const created = await fetch(`${base}/api/cases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ n: 4, mode: "decimal", multiplicand: "-3", multiplier: "5" }),
  });
  assert.equal(created.status, 201);
  const body = (await created.json()) as { id: number; product: { value: string; bits: string } };
  assert.equal(body.product.value, "-15");
  assert.equal(body.product.bits, "11110001");

  const one = await (await fetch(`${base}/api/cases/${body.id}`)).json() as { rounds: unknown[] };
  assert.equal(one.rounds.length, 4);

  const round = await (await fetch(`${base}/api/cases/${body.id}/rounds/2`)).json() as { step: { round: number } };
  assert.equal(round.step.round, 2);

  const table = await (await fetch(`${base}/api/cases/${body.id}/table`)).json() as { steps: unknown[] };
  assert.equal(table.steps.length, 4);

  const csv = await fetch(`${base}/api/cases/${body.id}/table?format=csv`);
  assert.match(await csv.text(), /^round,a_before/);

  const verify = await (await fetch(`${base}/api/cases/${body.id}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "binary", product: "11110001" }),
  })).json() as { ok: boolean };
  assert.equal(verify.ok, true);

  const bad = await fetch(`${base}/api/cases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ n: 4, mode: "decimal", multiplicand: "8", multiplier: "1" }),
  });
  assert.equal(bad.status, 400);
  const badBody = (await bad.json()) as { error: { code: string } };
  assert.equal(badBody.error.code, "E_OPERAND_RANGE");

  const missing = await fetch(`${base}/api/cases/999`);
  assert.equal(missing.status, 404);

  await new Promise<void>((r) => server.close(() => r()));
  store.close();
});
