import { app } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import initSqlJs from "sql.js";
import type { AgentActivity, AgentStateSnapshot, AgentTask } from "../../shared/types/agent";

type SqlJsStatic = Awaited<ReturnType<typeof initSqlJs>>;
type SqlDatabase = InstanceType<SqlJsStatic["Database"]>;

export interface HistoryStoreOptions {
  retentionDays?: number;
  maxTasks?: number;
  maxActivities?: number;
  now?: () => Date;
}

export interface HistoryStoreRuntimeStatus {
  loaded: boolean;
  filePath: string;
  recoveredFromCorruption: boolean;
  lastCorruptBackupPath: string | null;
  lastCleanupAt: string | null;
  lastCleanupDeletedTaskCount: number;
  lastCleanupDeletedActivityCount: number;
  retentionDays: number;
  maxTasks: number;
  maxActivities: number;
  lastError: string | null;
}

const resolveSqlJsFile = (file: string): string => path.join(path.dirname(require.resolve("sql.js/dist/sql-wasm.js")), file);
const defaultRetentionDays = 90;
const defaultMaxTasks = 5000;
const defaultMaxActivities = 50000;

const createSchema = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  title TEXT NOT NULL,
  project_name TEXT NOT NULL,
  project_path TEXT,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  last_activity_at TEXT NOT NULL,
  snapshot_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_provider_status ON tasks(provider_id, status);

CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL,
  snapshot_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activities_task_created ON activities(task_id, created_at DESC);
`;

const taskUpsertSql = `
INSERT INTO tasks (
  id,
  provider_id,
  session_id,
  title,
  project_name,
  project_path,
  status,
  priority,
  started_at,
  updated_at,
  completed_at,
  last_activity_at,
  snapshot_json
) VALUES (
  :id,
  :providerId,
  :sessionId,
  :title,
  :projectName,
  :projectPath,
  :status,
  :priority,
  :startedAt,
  :updatedAt,
  :completedAt,
  :lastActivityAt,
  :snapshotJson
)
ON CONFLICT(id) DO UPDATE SET
  provider_id = excluded.provider_id,
  session_id = excluded.session_id,
  title = excluded.title,
  project_name = excluded.project_name,
  project_path = excluded.project_path,
  status = excluded.status,
  priority = excluded.priority,
  started_at = excluded.started_at,
  updated_at = excluded.updated_at,
  completed_at = excluded.completed_at,
  last_activity_at = excluded.last_activity_at,
  snapshot_json = excluded.snapshot_json;
`;

const activityUpsertSql = `
INSERT INTO activities (
  id,
  task_id,
  provider_id,
  type,
  title,
  description,
  created_at,
  snapshot_json
) VALUES (
  :id,
  :taskId,
  :providerId,
  :type,
  :title,
  :description,
  :createdAt,
  :snapshotJson
)
ON CONFLICT(id) DO UPDATE SET
  task_id = excluded.task_id,
  provider_id = excluded.provider_id,
  type = excluded.type,
  title = excluded.title,
  description = excluded.description,
  created_at = excluded.created_at,
  snapshot_json = excluded.snapshot_json;
`;

const firstColumnValues = (database: SqlDatabase, sql: string, params?: Record<string, string | number>): string[] => {
  const [result] = database.exec(sql, params);

  if (!result) {
    return [];
  }

  return result.values.map((row) => String(row[0] ?? ""));
};

const firstColumnNumber = (database: SqlDatabase, sql: string, params?: Record<string, string | number>): number => {
  const [result] = database.exec(sql, params);
  const value = result?.values[0]?.[0];
  return Number(value ?? 0);
};

const readPositiveInteger = (value: number | undefined, fallback: number): number => {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.floor(value ?? fallback));
};

export class HistoryStore {
  private database: SqlDatabase | null = null;
  private saveQueue: Promise<void> = Promise.resolve();
  private readonly filePath: string;
  private readonly locateFile: (file: string) => string;
  private readonly retentionDays: number;
  private readonly maxTasks: number;
  private readonly maxActivities: number;
  private readonly now: () => Date;
  private recoveredFromCorruption = false;
  private lastCorruptBackupPath: string | null = null;
  private lastCleanupAt: string | null = null;
  private lastCleanupDeletedTaskCount = 0;
  private lastCleanupDeletedActivityCount = 0;
  private lastError: string | null = null;

  constructor(
    filePath = path.join(app.getPath("userData"), "history.sqlite"),
    locateFile: (file: string) => string = resolveSqlJsFile,
    options: HistoryStoreOptions = {}
  ) {
    this.filePath = filePath;
    this.locateFile = locateFile;
    this.retentionDays = readPositiveInteger(options.retentionDays, defaultRetentionDays);
    this.maxTasks = readPositiveInteger(options.maxTasks, defaultMaxTasks);
    this.maxActivities = readPositiveInteger(options.maxActivities, defaultMaxActivities);
    this.now = options.now ?? (() => new Date());
  }

  async load(): Promise<void> {
    const SQL = await initSqlJs({
      locateFile: this.locateFile
    });

    this.database = await this.openDatabase(SQL);
    this.database.run(createSchema);
    this.cleanupHistory(this.database);
    await this.flush();
  }

  async saveSnapshot(snapshot: AgentStateSnapshot): Promise<void> {
    const saveOperation = this.saveQueue.catch(() => undefined).then(async () => {
      const database = this.requireDatabase();

      database.run("BEGIN TRANSACTION");
      try {
        for (const task of snapshot.tasks) {
          database.run(taskUpsertSql, {
            ":id": task.id,
            ":providerId": task.providerId,
            ":sessionId": task.sessionId,
            ":title": task.title,
            ":projectName": task.projectName,
            ":projectPath": task.projectPath,
            ":status": task.status,
            ":priority": task.priority,
            ":startedAt": task.startedAt,
            ":updatedAt": task.updatedAt,
            ":completedAt": task.completedAt,
            ":lastActivityAt": task.lastActivityAt,
            ":snapshotJson": JSON.stringify(task)
          });
        }

        for (const activity of snapshot.activities) {
          database.run(activityUpsertSql, {
            ":id": activity.id,
            ":taskId": activity.taskId,
            ":providerId": activity.providerId,
            ":type": activity.type,
            ":title": activity.title,
            ":description": activity.description,
            ":createdAt": activity.createdAt,
            ":snapshotJson": JSON.stringify(activity)
          });
        }

        database.run("COMMIT");
      } catch (error) {
        database.run("ROLLBACK");
        throw error;
      }

      this.cleanupHistory(database);
      await this.flush();
    });

    this.saveQueue = saveOperation.catch(() => undefined);
    return saveOperation;
  }

  getRecentTasks(limit = 100): AgentTask[] {
    const database = this.requireDatabase();
    return firstColumnValues(
      database,
      "SELECT snapshot_json FROM tasks ORDER BY updated_at DESC LIMIT :limit",
      {
        ":limit": limit
      }
    ).map((item) => JSON.parse(item) as AgentTask);
  }

  getTaskActivities(taskId: string, limit = 100): AgentActivity[] {
    const database = this.requireDatabase();
    return firstColumnValues(
      database,
      "SELECT snapshot_json FROM activities WHERE task_id = :taskId ORDER BY created_at DESC LIMIT :limit",
      {
        ":taskId": taskId,
        ":limit": limit
      }
    ).map((item) => JSON.parse(item) as AgentActivity);
  }

  async close(): Promise<void> {
    await this.saveQueue;
    await this.flush();
    this.database?.close();
    this.database = null;
  }

  getRuntimeStatus(): HistoryStoreRuntimeStatus {
    return {
      loaded: this.database !== null,
      filePath: this.filePath,
      recoveredFromCorruption: this.recoveredFromCorruption,
      lastCorruptBackupPath: this.lastCorruptBackupPath,
      lastCleanupAt: this.lastCleanupAt,
      lastCleanupDeletedTaskCount: this.lastCleanupDeletedTaskCount,
      lastCleanupDeletedActivityCount: this.lastCleanupDeletedActivityCount,
      retentionDays: this.retentionDays,
      maxTasks: this.maxTasks,
      maxActivities: this.maxActivities,
      lastError: this.lastError
    };
  }

  private async openDatabase(SQL: SqlJsStatic): Promise<SqlDatabase> {
    let data: Uint8Array | null = null;

    this.recoveredFromCorruption = false;
    this.lastCorruptBackupPath = null;
    this.lastError = null;

    try {
      data = await readFile(this.filePath);
    } catch {
      data = null;
    }

    if (!data || data.length === 0) {
      return new SQL.Database();
    }

    try {
      const database = new SQL.Database(data);
      this.assertDatabaseIntegrity(database);
      return database;
    } catch (error) {
      this.recoveredFromCorruption = true;
      this.lastError = error instanceof Error ? error.message : "历史数据库损坏";
      this.lastCorruptBackupPath = await this.backupCorruptDatabase();
      return new SQL.Database();
    }
  }

  private assertDatabaseIntegrity(database: SqlDatabase): void {
    const [result] = database.exec("PRAGMA integrity_check;");
    const status = result?.values[0]?.[0];

    if (status !== "ok") {
      throw new Error(`历史数据库完整性检查失败：${String(status ?? "未知错误")}`);
    }
  }

  private async backupCorruptDatabase(): Promise<string | null> {
    await mkdir(path.dirname(this.filePath), {
      recursive: true
    });

    const timestamp = this.now().toISOString().replace(/[-:TZ.]/g, "").slice(0, 17);
    const backupPath = `${this.filePath}.corrupt-${timestamp}`;

    try {
      await rename(this.filePath, backupPath);
      return backupPath;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "历史数据库损坏备份失败";
      return null;
    }
  }

  private cleanupHistory(database: SqlDatabase): void {
    const now = this.now();
    const nowMs = now.getTime();

    if (!Number.isFinite(nowMs)) {
      return;
    }

    let deletedTaskCount = 0;
    let deletedActivityCount = 0;
    const cutoff = new Date(nowMs - this.retentionDays * 24 * 60 * 60 * 1000).toISOString();

    deletedActivityCount += this.deleteByCount(
      database,
      "SELECT COUNT(*) FROM activities WHERE created_at < :cutoff",
      "DELETE FROM activities WHERE created_at < :cutoff",
      {
        ":cutoff": cutoff
      }
    );
    deletedTaskCount += this.deleteByCount(
      database,
      "SELECT COUNT(*) FROM tasks WHERE updated_at < :cutoff",
      "DELETE FROM tasks WHERE updated_at < :cutoff",
      {
        ":cutoff": cutoff
      }
    );
    deletedTaskCount += this.deleteByCount(
      database,
      "SELECT COUNT(*) FROM tasks WHERE id NOT IN (SELECT id FROM tasks ORDER BY updated_at DESC LIMIT :limit)",
      "DELETE FROM tasks WHERE id NOT IN (SELECT id FROM tasks ORDER BY updated_at DESC LIMIT :limit)",
      {
        ":limit": this.maxTasks
      }
    );
    deletedActivityCount += this.deleteByCount(
      database,
      "SELECT COUNT(*) FROM activities WHERE task_id NOT IN (SELECT id FROM tasks)",
      "DELETE FROM activities WHERE task_id NOT IN (SELECT id FROM tasks)"
    );
    deletedActivityCount += this.deleteByCount(
      database,
      "SELECT COUNT(*) FROM activities WHERE id NOT IN (SELECT id FROM activities ORDER BY created_at DESC LIMIT :limit)",
      "DELETE FROM activities WHERE id NOT IN (SELECT id FROM activities ORDER BY created_at DESC LIMIT :limit)",
      {
        ":limit": this.maxActivities
      }
    );

    this.lastCleanupAt = now.toISOString();
    this.lastCleanupDeletedTaskCount = deletedTaskCount;
    this.lastCleanupDeletedActivityCount = deletedActivityCount;
  }

  private deleteByCount(
    database: SqlDatabase,
    countSql: string,
    deleteSql: string,
    params?: Record<string, string | number>
  ): number {
    const count = firstColumnNumber(database, countSql, params);

    if (count > 0) {
      database.run(deleteSql, params);
    }

    return count;
  }

  private async flush(): Promise<void> {
    const database = this.requireDatabase();
    await mkdir(path.dirname(this.filePath), {
      recursive: true
    });
    await writeFile(this.filePath, database.export());
  }

  private requireDatabase(): SqlDatabase {
    if (!this.database) {
      throw new Error("历史数据库尚未初始化");
    }

    return this.database;
  }
}
