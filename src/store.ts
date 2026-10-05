import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { BoothResult, InputMode, RULE_VERSION } from "./booth.js";

export interface CaseRow {
  id: number;
  created_at: string;
  n: number;
  mode: InputMode;
  m_input: string;
  q_input: string;
  m_value: string;
  q_value: string;
  product_value: string;
  product_bits: string;
  rule_version: string;
}

export interface StepRow {
  case_id: number;
  round: number;
  a_before: string;
  q_before: string;
  qm1_before: string;
  pair: string;
  op: string;
  a_after_op: string;
  a_after_shift: string;
  q_after_shift: string;
  qm1_after_shift: string;
}

export class Store {
  private db: DatabaseSync;
  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS cases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        n INTEGER NOT NULL,
        mode TEXT NOT NULL,
        m_input TEXT NOT NULL,
        q_input TEXT NOT NULL,
        m_value TEXT NOT NULL,
        q_value TEXT NOT NULL,
        product_value TEXT NOT NULL,
        product_bits TEXT NOT NULL,
        rule_version TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS steps (
        case_id INTEGER NOT NULL REFERENCES cases(id),
        round INTEGER NOT NULL,
        a_before TEXT NOT NULL,
        q_before TEXT NOT NULL,
        qm1_before TEXT NOT NULL,
        pair TEXT NOT NULL,
        op TEXT NOT NULL,
        a_after_op TEXT NOT NULL,
        a_after_shift TEXT NOT NULL,
        q_after_shift TEXT NOT NULL,
        qm1_after_shift TEXT NOT NULL,
        PRIMARY KEY (case_id, round)
      );
    `);
  }

  /** 原子写入算例与全部步骤 */
  saveCase(
    meta: { n: number; mode: InputMode; mInput: string; qInput: string },
    result: BoothResult
  ): number {
    this.db.exec("BEGIN");
    try {
      const r = this.db
        .prepare(
          `INSERT INTO cases (created_at, n, mode, m_input, q_input, m_value, q_value, product_value, product_bits, rule_version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          new Date().toISOString(),
          meta.n,
          meta.mode,
          meta.mInput,
          meta.qInput,
          result.mValue.toString(),
          result.qValue.toString(),
          result.productValue.toString(),
          result.productBits,
          RULE_VERSION
        );
      const id = Number(r.lastInsertRowid);
      const ins = this.db.prepare(
        `INSERT INTO steps (case_id, round, a_before, q_before, qm1_before, pair, op, a_after_op, a_after_shift, q_after_shift, qm1_after_shift)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const s of result.rounds) {
        ins.run(id, s.round, s.aBefore, s.qBefore, s.qm1Before, s.pair, s.op, s.aAfterOp, s.aAfterShift, s.qAfterShift, s.qm1AfterShift);
      }
      this.db.exec("COMMIT");
      return id;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  getCase(id: number): CaseRow | undefined {
    return this.db.prepare("SELECT * FROM cases WHERE id = ?").get(id) as unknown as CaseRow | undefined;
  }

  listCases(): CaseRow[] {
    return this.db.prepare("SELECT * FROM cases ORDER BY id").all() as unknown as CaseRow[];
  }

  getSteps(id: number): StepRow[] {
    return this.db.prepare("SELECT * FROM steps WHERE case_id = ? ORDER BY round").all(id) as unknown as StepRow[];
  }

  getStep(id: number, round: number): StepRow | undefined {
    return this.db.prepare("SELECT * FROM steps WHERE case_id = ? AND round = ?").get(id, round) as unknown as StepRow | undefined;
  }

  close(): void {
    this.db.close();
  }
}
