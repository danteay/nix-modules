import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import type { State } from "./lifecycle"

/** Desvio-owned storage. Never open or modify OpenCode's database here. */
export class StateStore {
  private db: Database
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true })
    this.db = new Database(path, { create: true })
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;")
    this.db.exec(`CREATE TABLE IF NOT EXISTS state (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS lease (id TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS route (session TEXT, message TEXT, value TEXT NOT NULL,
        PRIMARY KEY(session,message));`)
  }
  get(id: string): State | undefined {
    const row = this.db.query("SELECT value FROM state WHERE id=?").get(id) as {
      value: string
    } | null
    if (!row) return
    // Routing state governs which model a session runs on. Fail closed with a labeled
    // error rather than silently degrading to fresh state, which could route a session
    // to the wrong model without anyone noticing.
    let value: State
    try {
      value = JSON.parse(row.value)
    } catch (error) {
      throw new Error(`Desvio state for session ${id} is corrupt (invalid JSON): ${error}`)
    }
    if (value.version !== 1)
      throw new Error(`Desvio state for session ${id} has unsupported version ${value.version}`)
    return value
  }
  put(s: State) {
    this.db.query("INSERT OR REPLACE INTO state VALUES (?,?)").run(s.sessionID, JSON.stringify(s))
  }
  record(id: string, message: string, value: unknown) {
    this.db
      .query("INSERT OR IGNORE INTO route VALUES (?,?,?)")
      .run(id, message, JSON.stringify(value))
  }
  route(id: string, message: string) {
    const row = this.db
      .query("SELECT value FROM route WHERE session=? AND message=?")
      .get(id, message) as { value: string } | null
    return row ? JSON.parse(row.value) : undefined
  }
  delete(id: string) {
    this.db.transaction(() => {
      this.db.query("DELETE FROM state WHERE id=?").run(id)
      this.db.query("DELETE FROM route WHERE session=?").run(id)
    })()
  }
  async locked<T>(id: string, fn: () => Promise<T> | T): Promise<T> {
    const owner = crypto.randomUUID(),
      deadline = Date.now() + 10_000
    while (true) {
      const acquired = this.db
        .query(`INSERT INTO lease VALUES (?,?,?) ON CONFLICT(id)
        DO UPDATE SET owner=excluded.owner, expires=excluded.expires WHERE lease.expires < ?`)
        .run(id, owner, Date.now() + 30_000, Date.now()).changes
      if (acquired) break
      if (Date.now() > deadline) throw new Error("Desvio session busy; retry the request")
      await Bun.sleep(10)
    }
    // Adapter operations have a 5s timeout; keep the lease alive for longer operations.
    const heartbeat = setInterval(
      () =>
        this.db
          .query("UPDATE lease SET expires=? WHERE id=? AND owner=?")
          .run(Date.now() + 30_000, id, owner),
      5_000,
    )
    try {
      return await fn()
    } finally {
      clearInterval(heartbeat)
      this.db.query("DELETE FROM lease WHERE id=? AND owner=?").run(id, owner)
    }
  }
  close() {
    this.db.close()
  }
}
