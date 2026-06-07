import * as FileSystem from 'expo-file-system/legacy';

import { getDatabase, initDb } from './db';
import { isSupabaseConfigured, supabase } from './supabase';
import type { AuditLog, CashTransaction, DailyCash, Project, ProjectUser, User } from './types';

type SyncTable = 'users' | 'projects' | 'project_users' | 'daily_cash' | 'transactions' | 'audit_log';
const PHOTO_BUCKET = 'transaction-photos';
const LOCAL_PHOTO_ERROR = 'LOCAL_PHOTO_UNAVAILABLE';

export type SyncResult = {
  pushed: number;
  pulled: number;
  syncedAt: string;
};

const userColumns = ['local_user_id', 'username', 'name', 'role', 'pin', 'password', 'active', 'created_at_local', 'updated_at_local'] as const;
const projectColumns = ['local_project_id', 'project_name', 'location', 'active', 'created_at_local', 'updated_at_local'] as const;
const projectUserColumns = ['local_project_id', 'local_user_id', 'role_in_project', 'active', 'created_at_local'] as const;
const dailyCashColumns = [
  'local_daily_id',
  'local_project_id',
  'local_user_id',
  'date',
  'initial_usd',
  'initial_lrd',
  'actual_usd',
  'actual_lrd',
  'note',
  'created_by',
  'created_at_local',
  'updated_by',
  'updated_at_local',
  'sync_status',
] as const;
const transactionColumns = [
  'local_transaction_id',
  'transaction_no',
  'local_project_id',
  'date',
  'type',
  'amount',
  'currency',
  'category',
  'note',
  'area',
  'from_currency',
  'from_amount',
  'to_currency',
  'to_amount',
  'exchange_rate',
  'change_usd',
  'change_lrd',
  'photo_uri',
  'transfer_to_user_id',
  'transfer_from_user_id',
  'linked_transaction_id',
  'active',
  'created_by',
  'created_at_local',
  'updated_by',
  'updated_at_local',
  'sync_status',
] as const;
const auditColumns = [
  'local_audit_id',
  'table_name',
  'record_id',
  'action',
  'old_value_json',
  'new_value_json',
  'edited_by',
  'edited_at_local',
  'local_project_id',
] as const;

function toRemoteRows<T extends Record<string, unknown>>(rows: T[], columns: readonly string[]) {
  return rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column] ?? null])));
}

function rowTimestamp(row: { created_at_local?: string | null; updated_at_local?: string | null }) {
  const value = row.updated_at_local || row.created_at_local || '';
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function remoteIsNewer(
  local: { created_at_local?: string | null; updated_at_local?: string | null; sync_status?: string | null } | null,
  remote: { created_at_local?: string | null; updated_at_local?: string | null }
) {
  if (!local) return true;
  if (local.sync_status === 'pending') return false;
  return rowTimestamp(remote) >= rowTimestamp(local);
}

function localRowsNewerThanRemote<T extends Record<string, unknown>>(
  localRows: T[],
  remoteRows: T[],
  idColumn: keyof T
) {
  const remoteById = new Map(remoteRows.map((row) => [row[idColumn], row]));
  return localRows.filter((local) => {
    const remote = remoteById.get(local[idColumn]);
    return !remote || rowTimestamp(local) > rowTimestamp(remote);
  });
}

async function pushTable<T extends Record<string, unknown>>(table: SyncTable, rows: T[], columns: readonly string[], onConflict: string) {
  if (!supabase || rows.length === 0) return 0;
  const { error } = await supabase.from(table).upsert(toRemoteRows(rows, columns), { onConflict });
  if (error) throw error;
  return rows.length;
}

async function pullTable<T>(table: SyncTable) {
  if (!supabase) return [];
  const { data, error } = await supabase.from(table).select('*');
  if (error) throw error;
  return (data ?? []) as T[];
}

async function markSynced(table: 'daily_cash' | 'transactions', idColumn: string, ids: string[]) {
  if (ids.length === 0) return;
  const db = await getDatabase();
  for (const id of ids) {
    await db.runAsync(`UPDATE ${table} SET sync_status = 'synced' WHERE ${idColumn} = ?`, id);
  }
}

function isLocalPhotoUri(uri: string | null | undefined) {
  return Boolean(uri && !uri.startsWith('storage://') && !uri.startsWith('http://') && !uri.startsWith('https://'));
}

function storagePathForTransaction(row: CashTransaction) {
  return `${row.local_project_id}/${row.date.slice(0, 10)}/${row.local_transaction_id}.jpg`;
}

function base64ToArrayBuffer(base64: string) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = base64.replace(/=+$/, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (const char of clean) {
    const value = chars.indexOf(char);
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  return new Uint8Array(bytes).buffer;
}

function isStorageLimitError(error: unknown) {
  const message = error instanceof Error ? error.message : JSON.stringify(error);
  return /storage|quota|limit|exceed|payload|size/i.test(message);
}

async function cleanupOldestRemotePhotoDay() {
  if (!supabase) return false;
  const { data, error } = await supabase
    .from('transactions')
    .select('local_transaction_id, local_project_id, date, photo_uri')
    .not('photo_uri', 'is', null)
    .order('date', { ascending: true })
    .limit(1);
  if (error) throw error;
  const oldest = data?.[0];
  if (!oldest?.date) return false;
  const day = String(oldest.date).slice(0, 10);
  const { data: dayRows, error: rowsError } = await supabase
    .from('transactions')
    .select('local_transaction_id, photo_uri')
    .like('date', `${day}%`);
  if (rowsError) throw rowsError;
  const rows = dayRows ?? [];
  const paths = rows
    .map((row) => String(row.photo_uri ?? '').replace('storage://', ''))
    .filter(Boolean);
  if (paths.length) await supabase.storage.from(PHOTO_BUCKET).remove(paths);
  const ids = rows.map((row) => row.local_transaction_id).filter(Boolean);
  if (ids.length) {
    const { error: deleteError } = await supabase.from('transactions').delete().in('local_transaction_id', ids);
    if (deleteError) throw deleteError;
  }
  return true;
}

async function uploadOnePhoto(row: CashTransaction) {
  if (!supabase || !isLocalPhotoUri(row.photo_uri)) return row.photo_uri ?? null;
  const path = storagePathForTransaction(row);
  const info = await FileSystem.getInfoAsync(row.photo_uri!);
  if (!info.exists || !info.size) {
    throw new Error(LOCAL_PHOTO_ERROR);
  }
  const base64 = await FileSystem.readAsStringAsync(row.photo_uri!, { encoding: FileSystem.EncodingType.Base64 });
  const fileBody = base64ToArrayBuffer(base64);
  if (fileBody.byteLength === 0) {
    throw new Error(LOCAL_PHOTO_ERROR);
  }
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, fileBody, {
    contentType: 'image/jpeg',
    upsert: true,
  });
  if (error) throw error;
  return `storage://${path}`;
}

async function uploadPendingPhotos(rows: CashTransaction[]) {
  if (!supabase) return;
  const db = await getDatabase();
  for (const row of rows) {
    if (!isLocalPhotoUri(row.photo_uri)) continue;
    try {
      const storageUri = await uploadOnePhoto(row);
      row.photo_uri = storageUri;
      await db.runAsync('UPDATE transactions SET photo_uri = ? WHERE local_transaction_id = ?', storageUri, row.local_transaction_id);
    } catch (error) {
      if (error instanceof Error && error.message === LOCAL_PHOTO_ERROR) {
        row.photo_uri = null;
        await db.runAsync('UPDATE transactions SET photo_uri = NULL WHERE local_transaction_id = ?', row.local_transaction_id);
        continue;
      }
      if (!isStorageLimitError(error)) throw error;
      const cleaned = await cleanupOldestRemotePhotoDay();
      if (!cleaned) throw error;
      const storageUri = await uploadOnePhoto(row);
      row.photo_uri = storageUri;
      await db.runAsync('UPDATE transactions SET photo_uri = ? WHERE local_transaction_id = ?', storageUri, row.local_transaction_id);
    }
  }
}

async function upsertLocalUsers(rows: User[]) {
  const db = await getDatabase();
  for (const row of rows) {
    const existing = await db.getFirstAsync<User>('SELECT * FROM users WHERE local_user_id = ?', row.local_user_id);
    if (existing && !remoteIsNewer(existing, row)) continue;
    await db.runAsync(
      `INSERT INTO users (local_user_id, username, name, role, pin, password, active, created_at_local, updated_at_local)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(local_user_id) DO UPDATE SET
       username = excluded.username, name = excluded.name, role = excluded.role, pin = excluded.pin,
       password = excluded.password, active = excluded.active, updated_at_local = excluded.updated_at_local`,
      row.local_user_id,
      row.username,
      row.name,
      row.role,
      row.pin,
      row.password,
      row.active,
      row.created_at_local,
      row.updated_at_local
    );
  }
}

async function upsertLocalProjects(rows: Project[]) {
  const db = await getDatabase();
  for (const row of rows) {
    const existing = await db.getFirstAsync<Project>('SELECT * FROM projects WHERE local_project_id = ?', row.local_project_id);
    const isUneditedDefaultSeed = existing?.local_project_id === 'project_gold_field_default'
      && !existing.updated_at_local;
    if (existing && !isUneditedDefaultSeed && !remoteIsNewer(existing, row)) continue;
    await db.runAsync(
      `INSERT INTO projects (local_project_id, project_name, location, active, created_at_local, updated_at_local)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(local_project_id) DO UPDATE SET
       project_name = excluded.project_name, location = excluded.location, active = excluded.active, updated_at_local = excluded.updated_at_local`,
      row.local_project_id,
      row.project_name,
      row.location,
      row.active,
      row.created_at_local,
      row.updated_at_local
    );
  }
}

async function upsertLocalProjectUsers(rows: ProjectUser[]) {
  const db = await getDatabase();
  for (const row of rows) {
    const existing = await db.getFirstAsync<ProjectUser>(
      'SELECT * FROM project_users WHERE local_project_id = ? AND local_user_id = ?',
      row.local_project_id,
      row.local_user_id
    );
    if (existing) {
      await db.runAsync(
        'UPDATE project_users SET role_in_project = ?, active = ?, created_at_local = ? WHERE id = ?',
        row.role_in_project,
        row.active,
        row.created_at_local,
        existing.id
      );
    } else {
      await db.runAsync(
        'INSERT INTO project_users (local_project_id, local_user_id, role_in_project, active, created_at_local) VALUES (?, ?, ?, ?, ?)',
        row.local_project_id,
        row.local_user_id,
        row.role_in_project,
        row.active,
        row.created_at_local
      );
    }
  }
}

async function upsertLocalDailyCash(rows: DailyCash[]) {
  const db = await getDatabase();
  for (const row of rows) {
    const existing = await db.getFirstAsync<DailyCash>('SELECT * FROM daily_cash WHERE local_daily_id = ?', row.local_daily_id);
    if (existing && !remoteIsNewer(existing, row)) continue;
    await db.runAsync(
      `INSERT INTO daily_cash
       (local_daily_id, local_project_id, local_user_id, date, initial_usd, initial_lrd, actual_usd, actual_lrd, note, created_by, created_at_local, updated_by, updated_at_local, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')
       ON CONFLICT(local_daily_id) DO UPDATE SET
       local_project_id = excluded.local_project_id, local_user_id = excluded.local_user_id, date = excluded.date,
       initial_usd = excluded.initial_usd, initial_lrd = excluded.initial_lrd, actual_usd = excluded.actual_usd,
       actual_lrd = excluded.actual_lrd, note = excluded.note, created_by = excluded.created_by,
       updated_by = excluded.updated_by, updated_at_local = excluded.updated_at_local,
       sync_status = CASE WHEN daily_cash.sync_status = 'pending' THEN daily_cash.sync_status ELSE 'synced' END`,
      row.local_daily_id,
      row.local_project_id,
      row.local_user_id,
      row.date,
      row.initial_usd,
      row.initial_lrd,
      row.actual_usd,
      row.actual_lrd,
      row.note,
      row.created_by,
      row.created_at_local,
      row.updated_by,
      row.updated_at_local
    );
  }
}

async function upsertLocalTransactions(rows: CashTransaction[]) {
  const db = await getDatabase();
  for (const row of rows) {
    const existing = await db.getFirstAsync<CashTransaction>('SELECT * FROM transactions WHERE local_transaction_id = ?', row.local_transaction_id);
    if (existing && !remoteIsNewer(existing, row)) continue;
    await db.runAsync(
      `INSERT INTO transactions
       (local_transaction_id, transaction_no, local_project_id, date, type, amount, currency, category, note, area,
        from_currency, from_amount, to_currency, to_amount, exchange_rate, change_usd, change_lrd, photo_uri,
        transfer_to_user_id, transfer_from_user_id, linked_transaction_id, active, created_by, created_at_local,
        updated_by, updated_at_local, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')
       ON CONFLICT(local_transaction_id) DO UPDATE SET
       transaction_no = excluded.transaction_no, local_project_id = excluded.local_project_id, date = excluded.date,
       type = excluded.type, amount = excluded.amount, currency = excluded.currency, category = excluded.category,
       note = excluded.note, area = excluded.area, from_currency = excluded.from_currency, from_amount = excluded.from_amount,
       to_currency = excluded.to_currency, to_amount = excluded.to_amount, exchange_rate = excluded.exchange_rate,
       change_usd = excluded.change_usd, change_lrd = excluded.change_lrd, photo_uri = excluded.photo_uri,
       transfer_to_user_id = excluded.transfer_to_user_id, transfer_from_user_id = excluded.transfer_from_user_id,
       linked_transaction_id = excluded.linked_transaction_id,
       active = excluded.active, updated_by = excluded.updated_by, updated_at_local = excluded.updated_at_local,
       sync_status = CASE WHEN transactions.sync_status = 'pending' THEN transactions.sync_status ELSE 'synced' END`,
      row.local_transaction_id,
      row.transaction_no,
      row.local_project_id,
      row.date,
      row.type,
      row.amount,
      row.currency,
      row.category,
      row.note,
      row.area,
      row.from_currency,
      row.from_amount,
      row.to_currency,
      row.to_amount,
      row.exchange_rate,
      row.change_usd,
      row.change_lrd,
      row.photo_uri,
      row.transfer_to_user_id,
      row.transfer_from_user_id,
      row.linked_transaction_id,
      row.active,
      row.created_by,
      row.created_at_local,
      row.updated_by,
      row.updated_at_local
    );
  }
}

async function upsertLocalAuditLog(rows: AuditLog[]) {
  const db = await getDatabase();
  for (const row of rows) {
    await db.runAsync(
      `INSERT OR IGNORE INTO audit_log
       (local_audit_id, table_name, record_id, action, old_value_json, new_value_json, edited_by, edited_at_local, local_project_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.local_audit_id,
      row.table_name,
      row.record_id,
      row.action,
      row.old_value_json,
      row.new_value_json,
      row.edited_by,
      row.edited_at_local,
      row.local_project_id
    );
  }
}

export async function syncWithSupabase(): Promise<SyncResult> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured.');
  }

  await initDb();
  const db = await getDatabase();
  const [remoteUsersBeforePush, remoteProjectsBeforePush] = await Promise.all([
    pullTable<User>('users'),
    pullTable<Project>('projects'),
  ]);
  await upsertLocalUsers(remoteUsersBeforePush);
  await upsertLocalProjects(remoteProjectsBeforePush);

  const [users, projects, projectUsers, pendingDailyCash, pendingTransactions, auditRows] = await Promise.all([
    db.getAllAsync<User>('SELECT * FROM users'),
    db.getAllAsync<Project>('SELECT * FROM projects'),
    db.getAllAsync<ProjectUser>('SELECT * FROM project_users'),
    db.getAllAsync<DailyCash>("SELECT * FROM daily_cash WHERE sync_status = 'pending'"),
    db.getAllAsync<CashTransaction>("SELECT * FROM transactions WHERE sync_status = 'pending'"),
    db.getAllAsync<AuditLog>('SELECT * FROM audit_log'),
  ]);

  await uploadPendingPhotos(pendingTransactions);
  const changedUsers = localRowsNewerThanRemote(users, remoteUsersBeforePush, 'local_user_id');
  const changedProjects = localRowsNewerThanRemote(projects, remoteProjectsBeforePush, 'local_project_id');

  let pushed = 0;
  pushed += await pushTable('users', changedUsers, userColumns, 'local_user_id');
  pushed += await pushTable('projects', changedProjects, projectColumns, 'local_project_id');
  pushed += await pushTable('project_users', projectUsers, projectUserColumns, 'local_project_id,local_user_id');
  pushed += await pushTable('daily_cash', pendingDailyCash, dailyCashColumns, 'local_daily_id');
  pushed += await pushTable('transactions', pendingTransactions, transactionColumns, 'local_transaction_id');
  pushed += await pushTable('audit_log', auditRows, auditColumns, 'local_audit_id');

  await markSynced('daily_cash', 'local_daily_id', pendingDailyCash.map((row) => row.local_daily_id));
  await markSynced('transactions', 'local_transaction_id', pendingTransactions.map((row) => row.local_transaction_id));

  const [remoteUsers, remoteProjects, remoteProjectUsers, remoteDailyCash, remoteTransactions, remoteAudit] = await Promise.all([
    pullTable<User>('users'),
    pullTable<Project>('projects'),
    pullTable<ProjectUser>('project_users'),
    pullTable<DailyCash>('daily_cash'),
    pullTable<CashTransaction>('transactions'),
    pullTable<AuditLog>('audit_log'),
  ]);

  await upsertLocalUsers(remoteUsers);
  await upsertLocalProjects(remoteProjects);
  await upsertLocalProjectUsers(remoteProjectUsers);
  await upsertLocalDailyCash(remoteDailyCash);
  await upsertLocalTransactions(remoteTransactions);
  await upsertLocalAuditLog(remoteAudit);

  return {
    pushed,
    pulled: remoteUsers.length + remoteProjects.length + remoteProjectUsers.length + remoteDailyCash.length + remoteTransactions.length + remoteAudit.length,
    syncedAt: new Date().toISOString(),
  };
}

export async function pullLoginDataFromSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured.');
  }

  await initDb();
  const [remoteUsers, remoteProjects, remoteProjectUsers] = await Promise.all([
    pullTable<User>('users'),
    pullTable<Project>('projects'),
    pullTable<ProjectUser>('project_users'),
  ]);

  await upsertLocalUsers(remoteUsers);
  await upsertLocalProjects(remoteProjects);
  await upsertLocalProjectUsers(remoteProjectUsers);

  return remoteUsers.length + remoteProjects.length + remoteProjectUsers.length;
}
