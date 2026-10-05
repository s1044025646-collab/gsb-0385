// SQLite 持久化：原始输入、位宽、规范值、规则版本与全部步骤，原子写入
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { BoothResult, BoothStep, RULE_VERSION } from "./booth";
import { InputMode } from "./validate";

export interface MultiplicationRecord {
  id: number;
  bitWidth: number;
  mode: InputMode;
  multiplicandRaw: string;
  multiplierRaw: string;
  multiplicandValue: string;
  multiplierValue: string;
  productBits: string;
  productValue: string;
  combinedBits: string;
  redundantSignOk: boolean;
  ruleVersion: string;
  createdAt: string;
}

export class Store {
  private db: DatabaseSync;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, "booth.db"));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS multiplications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bit_width INTEGER NOT NULL,
        mode TEXT NOT NULL,
        multiplicand_raw TEXT NOT NULL,
        multiplier_raw TEXT NOT NULL,
        multiplicand_value TEXT NOT NULL,
        multiplier_value TEXT NOT NULL,
        product_bits TEXT NOT NULL,
        product_value TEXT NOT NULL,
        combined_bits TEXT NOT NULL,
        redundant_sign_ok INTEGER NOT NULL,
        rule_version TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS steps (
        mult_id INTEGER NOT NULL REFERENCES multiplications(id),
        round INTEGER NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (mult_id, round)
      );
    `);
  }

  /** 原子写入算例与全部步骤 */
  save(
    meta: {
      bitWidth: number;
      mode: InputMode;
      multiplicandRaw: string;
      multiplierRaw: string;
    },
    result: BoothResult,
  ): number {
    this.db.exec("BEGIN");
    try {
      const ins = this.db.prepare(`
        INSERT INTO multiplications
          (bit_width, mode, multiplicand_raw, multiplier_raw, multiplicand_value,
           multiplier_value, product_bits, product_value, combined_bits,
           redundant_sign_ok, rule_version, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const r = ins.run(
        meta.bitWidth,
        meta.mode,
        meta.multiplicandRaw,
        meta.multiplierRaw,
        result.multiplicandValue,
        result.multiplierValue,
        result.productBits,
        result.productValue,
        result.combinedBits,
        result.redundantSignOk ? 1 : 0,
        RULE_VERSION,
        new Date().toISOString(),
      );
      const id = Number(r.lastInsertRowid);
      const insStep = this.db.prepare("INSERT INTO steps (mult_id, round, data) VALUES (?, ?, ?)");
      for (const step of result.steps) {
        insStep.run(id, step.round, JSON.stringify(step));
      }
      this.db.exec("COMMIT");
      return id;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  get(id: number): MultiplicationRecord | null {
    const row = this.db.prepare("SELECT * FROM multiplications WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return {
      id: row.id as number,
      bitWidth: row.bit_width as number,
      mode: row.mode as InputMode,
      multiplicandRaw: row.multiplicand_raw as string,
      multiplierRaw: row.multiplier_raw as string,
      multiplicandValue: row.multiplicand_value as string,
      multiplierValue: row.multiplier_value as string,
      productBits: row.product_bits as string,
      productValue: row.product_value as string,
      combinedBits: row.combined_bits as string,
      redundantSignOk: (row.redundant_sign_ok as number) === 1,
      ruleVersion: row.rule_version as string,
      createdAt: row.created_at as string,
    };
  }

  list(): MultiplicationRecord[] {
    const rows = this.db.prepare("SELECT id FROM multiplications ORDER BY id").all() as { id: number }[];
    return rows.map((r) => this.get(r.id)!);
  }

  getSteps(id: number): BoothStep[] {
    const rows = this.db
      .prepare("SELECT data FROM steps WHERE mult_id = ? ORDER BY round")
      .all(id) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as BoothStep);
  }

  getStep(id: number, round: number): BoothStep | null {
    const row = this.db
      .prepare("SELECT data FROM steps WHERE mult_id = ? AND round = ?")
      .get(id, round) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as BoothStep) : null;
  }

  close(): void {
    this.db.close();
  }
}
