import * as SQLite from 'expo-sqlite';

import { requestAutoSync } from './syncSignal';
import type {
  Area,
  AuditLog,
  CashTransaction,
  Currency,
  DailyCash,
  DailyCashOverview,
  DailySummary,
  Project,
  ProjectUser,
  TransactionType,
  User,
} from './types';

const DB_NAME = 'gold_field_cashbox.db';
const ADMIN_ID = 'user_admin_default';
const PROJECT_ID = 'project_gold_field_default';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let currentUserId: string | null = null;
let activeProjectId: string | null = null;
const authListeners = new Set<() => void>();

export const EXPENSE_CATEGORIES = ['燃油', '食品', '工资', '维修', '村庄', '政府', '警察 / 检查站', '司机', '小费', '医疗', '运输', '其他'];
export const CASH_IN_CATEGORIES = ['黄金销售', '经理退回', '退款', '转入', '其他'];
export const AREA_OPTIONS: Area[] = ['矿区', '外围'];

const padDatePart = (value: number) => String(value).padStart(2, '0');
const padMilliseconds = (value: number) => String(value).padStart(3, '0');
const formatLocalDate = (date: Date) =>
  `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
const todayIso = () => formatLocalDate(new Date());
const timezoneOffset = (date: Date) => {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  return `${sign}${padDatePart(Math.floor(absolute / 60))}:${padDatePart(absolute % 60)}`;
};
const nowIso = () => {
  const date = new Date();
  return `${formatLocalDate(date)}T${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}:${padDatePart(date.getSeconds())}.${padMilliseconds(date.getMilliseconds())}${timezoneOffset(date)}`;
};
const localId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
async function getDb() {
  if (!dbPromise) dbPromise = SQLite.openDatabaseAsync(DB_NAME);
  return dbPromise;
}

export async function getDatabase() {
  return getDb();
}

function notifyAuth() {
  authListeners.forEach((listener) => listener());
}

export function subscribeAuth(listener: () => void) {
  authListeners.add(listener);
  return () => {
    authListeners.delete(listener);
  };
}

export function getCurrentUserId() {
  return currentUserId;
}

export function getActiveProjectId() {
  return activeProjectId;
}

export function setActiveProjectId(projectId: string | null) {
  activeProjectId = projectId;
  notifyAuth();
}

export function logout() {
  currentUserId = null;
  activeProjectId = null;
  notifyAuth();
}

async function addColumnIfMissing(table: string, column: string, ddl: string) {
  const db = await getDb();
  const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  if (!columns.some((item) => item.name === column)) {
    await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

export async function initDb() {
  const db = await getDb();
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_user_id TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      pin TEXT,
      password TEXT,
      active INTEGER DEFAULT 1,
      created_at_local TEXT NOT NULL,
      updated_at_local TEXT
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_project_id TEXT UNIQUE NOT NULL,
      project_name TEXT NOT NULL,
      location TEXT,
      active INTEGER DEFAULT 1,
      created_at_local TEXT NOT NULL,
      updated_at_local TEXT
    );

    CREATE TABLE IF NOT EXISTS project_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_project_id TEXT NOT NULL,
      local_user_id TEXT NOT NULL,
      role_in_project TEXT DEFAULT 'manager',
      active INTEGER DEFAULT 1,
      created_at_local TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS daily_cash (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_daily_id TEXT UNIQUE NOT NULL,
      local_project_id TEXT NOT NULL,
      local_user_id TEXT,
      date TEXT NOT NULL,
      initial_usd REAL DEFAULT 0,
      initial_lrd REAL DEFAULT 0,
      actual_usd REAL,
      actual_lrd REAL,
      note TEXT,
      created_by TEXT,
      created_at_local TEXT NOT NULL,
      updated_by TEXT,
      updated_at_local TEXT,
      sync_status TEXT DEFAULT 'pending'
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_transaction_id TEXT UNIQUE NOT NULL,
      transaction_no TEXT NOT NULL,
      local_project_id TEXT NOT NULL,
      date TEXT NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      category TEXT NOT NULL,
      note TEXT,
      area TEXT,
      from_currency TEXT,
      from_amount REAL,
      to_currency TEXT,
      to_amount REAL,
      exchange_rate REAL,
      change_usd REAL,
      change_lrd REAL,
      photo_uri TEXT,
      transfer_to_user_id TEXT,
      transfer_from_user_id TEXT,
      linked_transaction_id TEXT,
      active INTEGER DEFAULT 1,
      created_by TEXT NOT NULL,
      created_at_local TEXT NOT NULL,
      updated_by TEXT,
      updated_at_local TEXT,
      sync_status TEXT DEFAULT 'pending'
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_audit_id TEXT UNIQUE NOT NULL,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      action TEXT NOT NULL,
      old_value_json TEXT,
      new_value_json TEXT,
      edited_by TEXT,
      edited_at_local TEXT NOT NULL,
      local_project_id TEXT
    );
  `);

  await addColumnIfMissing('users', 'username', 'username TEXT');
  await addColumnIfMissing('users', 'password', 'password TEXT');
  await addColumnIfMissing('daily_cash', 'local_user_id', 'local_user_id TEXT');
  await addColumnIfMissing('transactions', 'area', 'area TEXT');
  await addColumnIfMissing('transactions', 'from_currency', 'from_currency TEXT');
  await addColumnIfMissing('transactions', 'from_amount', 'from_amount REAL');
  await addColumnIfMissing('transactions', 'to_currency', 'to_currency TEXT');
  await addColumnIfMissing('transactions', 'to_amount', 'to_amount REAL');
  await addColumnIfMissing('transactions', 'exchange_rate', 'exchange_rate REAL');
  await addColumnIfMissing('transactions', 'change_usd', 'change_usd REAL');
  await addColumnIfMissing('transactions', 'change_lrd', 'change_lrd REAL');
  await addColumnIfMissing('transactions', 'photo_uri', 'photo_uri TEXT');
  await addColumnIfMissing('transactions', 'transfer_to_user_id', 'transfer_to_user_id TEXT');
  await addColumnIfMissing('transactions', 'transfer_from_user_id', 'transfer_from_user_id TEXT');
  await addColumnIfMissing('transactions', 'linked_transaction_id', 'linked_transaction_id TEXT');
  await addColumnIfMissing('transactions', 'active', 'active INTEGER DEFAULT 1');
  await db.execAsync('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)');
  await db.runAsync('UPDATE daily_cash SET local_user_id = COALESCE(local_user_id, created_by, ?) WHERE local_user_id IS NULL', ADMIN_ID);

  const createdAt = nowIso();
  await db.runAsync(
    `INSERT OR IGNORE INTO users
      (local_user_id, username, name, role, pin, password, active, created_at_local)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    ADMIN_ID,
    'admin',
    '管理员',
    'admin',
    '1234',
    'admin',
    createdAt
  );
  await db.runAsync(
    `UPDATE users SET username = ?, name = ?, role = 'admin', active = 1
     WHERE local_user_id = ?`,
    'admin',
    '管理员',
    ADMIN_ID
  );
  await db.runAsync(
    `INSERT OR IGNORE INTO projects
      (local_project_id, project_name, location, active, created_at_local)
      VALUES (?, ?, ?, 1, ?)`,
    PROJECT_ID,
    '金矿项目',
    '利比里亚',
    createdAt
  );
  const assignment = await db.getFirstAsync<ProjectUser>(
    'SELECT * FROM project_users WHERE local_project_id = ? AND local_user_id = ?',
    PROJECT_ID,
    ADMIN_ID
  );
  if (!assignment) {
    await db.runAsync(
      `INSERT INTO project_users (local_project_id, local_user_id, role_in_project, active, created_at_local)
       VALUES (?, ?, 'admin', 1, ?)`,
      PROJECT_ID,
      ADMIN_ID,
      createdAt
    );
  }
  await db.runAsync(
    'UPDATE projects SET project_name = ?, location = ? WHERE local_project_id = ? AND project_name = ?',
    '金矿项目',
    '利比里亚',
    PROJECT_ID,
    'Gold Field Project'
  );
}

async function audit(params: {
  tableName: string;
  recordId: string;
  action: 'create' | 'edit' | 'deactivate';
  oldValue?: unknown;
  newValue?: unknown;
  projectId?: string | null;
}) {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO audit_log
      (local_audit_id, table_name, record_id, action, old_value_json, new_value_json, edited_by, edited_at_local, local_project_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    localId('audit'),
    params.tableName,
    params.recordId,
    params.action,
    params.oldValue === undefined ? null : JSON.stringify(params.oldValue),
    params.newValue === undefined ? null : JSON.stringify(params.newValue),
    currentUserId,
    nowIso(),
    params.projectId ?? null
  );
  requestAutoSync();
}

export async function login(username: string, password: string) {
  await initDb();
  const db = await getDb();
  const user = await db.getFirstAsync<User>(
    'SELECT * FROM users WHERE username = ? AND password = ? AND active = 1',
    username.trim(),
    password
  );
  if (!user) return null;
  currentUserId = user.local_user_id;
  const projects = await listProjectsForCurrentUser();
  activeProjectId = projects[0]?.local_project_id ?? null;
  notifyAuth();
  return user;
}

export async function getCurrentUser() {
  if (!currentUserId) return null;
  const db = await getDb();
  return db.getFirstAsync<User>('SELECT * FROM users WHERE local_user_id = ? AND active = 1', currentUserId);
}

export async function isAdmin() {
  const user = await getCurrentUser();
  return user?.role === 'admin';
}

export async function listUsers() {
  const db = await getDb();
  return db.getAllAsync<User>("SELECT * FROM users WHERE active = 1 AND role != 'viewer' ORDER BY role, name");
}

export async function listManagers() {
  const db = await getDb();
  return db.getAllAsync<User>("SELECT * FROM users WHERE active = 1 AND role = 'manager' ORDER BY name");
}

export async function listProjectAssignableUsers() {
  const db = await getDb();
  return db.getAllAsync<User>("SELECT * FROM users WHERE active = 1 AND role IN ('manager', 'viewer') ORDER BY role, name");
}

export async function listProjectsForCurrentUser() {
  const db = await getDb();
  const user = await getCurrentUser();
  if (!user) return [];
  if (user.role === 'admin') {
    return db.getAllAsync<Project>('SELECT * FROM projects WHERE active = 1 ORDER BY project_name');
  }
  return db.getAllAsync<Project>(
    `SELECT p.* FROM projects p
     JOIN project_users pu ON pu.local_project_id = p.local_project_id
     WHERE pu.local_user_id = ? AND pu.active = 1 AND p.active = 1
     ORDER BY p.project_name`,
    user.local_user_id
  );
}

async function getLatestDailyCashForUser(projectId: string, date: string, userId: string) {
  const db = await getDb();
  return db.getFirstAsync<DailyCash>(
    `SELECT * FROM daily_cash
     WHERE local_project_id = ? AND date = ? AND COALESCE(local_user_id, created_by) = ?
     ORDER BY COALESCE(updated_at_local, created_at_local, '') DESC, id DESC
     LIMIT 1`,
    projectId,
    date,
    userId
  );
}

async function getLatestPreviousDailyCashForUser(projectId: string, date: string, userId: string) {
  const db = await getDb();
  return db.getFirstAsync<DailyCash>(
    `SELECT * FROM daily_cash
     WHERE local_project_id = ? AND date < ? AND COALESCE(local_user_id, created_by) = ?
     ORDER BY date DESC, COALESCE(updated_at_local, created_at_local, '') DESC, id DESC
     LIMIT 1`,
    projectId,
    date,
    userId
  );
}

async function getCarryForwardBalance(projectId: string, date: string, userId: string) {
  const previousDay = await getLatestPreviousDailyCashForUser(projectId, date, userId);
  if (!previousDay) return { usd: 0, lrd: 0 };
  const previousSummary = await getDailySummary(projectId, previousDay.date, userId, true);
  const expectedUsd =
    previousDay.initial_usd +
    previousSummary.cash_in_usd +
    previousSummary.exchange_in_usd -
    previousSummary.cash_out_usd -
    previousSummary.exchange_out_usd;
  const expectedLrd =
    previousDay.initial_lrd +
    previousSummary.cash_in_lrd +
    previousSummary.exchange_in_lrd -
    previousSummary.cash_out_lrd -
    previousSummary.exchange_out_lrd;
  return {
    usd: previousDay.actual_usd ?? expectedUsd,
    lrd: previousDay.actual_lrd ?? expectedLrd,
  };
}

function buildSyntheticDailyCash(projectId: string, date: string, userId: string, initial: { usd: number; lrd: number }) {
  return {
    id: 0,
    local_daily_id: '',
    local_project_id: projectId,
    local_user_id: userId,
    date,
    initial_usd: initial.usd,
    initial_lrd: initial.lrd,
    actual_usd: null,
    actual_lrd: null,
    note: null,
    created_by: userId,
    created_at_local: '',
    updated_by: null,
    updated_at_local: null,
    sync_status: 'pending',
  };
}

function dailyCashSortValue(row: Pick<DailyCash, 'id' | 'created_at_local' | 'updated_at_local'>) {
  const timestamp = new Date(String(row.updated_at_local ?? row.created_at_local ?? '')).getTime();
  return { timestamp: Number.isNaN(timestamp) ? 0 : timestamp, id: Number(row.id) || 0 };
}

function isNewerDailyCashRow(next: DailyCash, current: DailyCash) {
  const nextValue = dailyCashSortValue(next);
  const currentValue = dailyCashSortValue(current);
  if (nextValue.timestamp !== currentValue.timestamp) return nextValue.timestamp > currentValue.timestamp;
  return nextValue.id > currentValue.id;
}

export async function getOrCreateDailyCash(projectId: string, date = todayIso()) {
  const user = await getCurrentUser();
  const userId = currentUserId ?? ADMIN_ID;
  if (user?.role === 'viewer') {
    return {
      id: 0,
      local_daily_id: '',
      local_project_id: projectId,
      local_user_id: userId,
      date,
      initial_usd: 0,
      initial_lrd: 0,
      actual_usd: null,
      actual_lrd: null,
      note: null,
      created_by: userId,
      created_at_local: '',
      updated_by: null,
      updated_at_local: null,
      sync_status: 'synced',
    };
  }
  const existing = await getLatestDailyCashForUser(projectId, date, userId);
  if (existing) return existing;
  const previousBalance = await getCarryForwardBalance(projectId, date, userId);
  return buildSyntheticDailyCash(projectId, date, userId, previousBalance);
}

export async function getExpectedOpeningBalance(projectId: string, date = todayIso(), userId = currentUserId ?? ADMIN_ID) {
  return getCarryForwardBalance(projectId, date, userId);
}

async function createDailyCashForUser(
  projectId: string,
  date: string,
  userId: string,
  values: { initial_usd?: number; initial_lrd?: number; actual_usd?: number | null; actual_lrd?: number | null; note?: string | null } = {}
) {
  const db = await getDb();
  const previousBalance = await getCarryForwardBalance(projectId, date, userId);
  const row: Omit<DailyCash, 'id'> = {
    local_daily_id: localId('daily'),
    local_project_id: projectId,
    local_user_id: userId,
    date,
    initial_usd: values.initial_usd ?? previousBalance.usd,
    initial_lrd: values.initial_lrd ?? previousBalance.lrd,
    actual_usd: values.actual_usd ?? null,
    actual_lrd: values.actual_lrd ?? null,
    note: values.note ?? null,
    created_by: currentUserId,
    created_at_local: nowIso(),
    updated_by: null,
    updated_at_local: null,
    sync_status: 'pending',
  };
  await db.runAsync(
    `INSERT INTO daily_cash
      (local_daily_id, local_project_id, local_user_id, date, initial_usd, initial_lrd, actual_usd, actual_lrd, note, created_by, created_at_local, sync_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    row.sync_status
  );
  await audit({ tableName: 'daily_cash', recordId: row.local_daily_id, action: 'create', newValue: row, projectId });
  return getLatestDailyCashForUser(projectId, date, userId);
}

async function ensureDailyCashForUser(projectId: string, date: string, userId: string) {
  const existing = await getLatestDailyCashForUser(projectId, date, userId);
  if (existing) return existing;
  return createDailyCashForUser(projectId, date, userId);
}

export async function getDailySummary(projectId: string, date = todayIso(), userFilterId?: string | null, bypassRole = false) {
  const db = await getDb();
  const user = await getCurrentUser();
  const clauses = ["local_project_id = ?", "substr(date, 1, 10) = ?", "active = 1", "created_by NOT IN (SELECT local_user_id FROM users WHERE role = 'viewer')"];
  const params = [projectId, date];
  if (!bypassRole && user?.role === 'manager') {
    clauses.push('created_by = ?');
    params.push(user.local_user_id);
  } else if (userFilterId) {
    clauses.push('created_by = ?');
    params.push(userFilterId);
  }
  const rows = await db.getAllAsync<CashTransaction>(
    `SELECT * FROM transactions
     WHERE ${clauses.join(' AND ')}`,
    params
  );
  const summary = blankDailySummary();
  rows.forEach((row) => {
    if (row.type === 'cash_in') {
      const hasComponents = row.from_currency === 'USD' || row.to_currency === 'LRD';
      if (hasComponents) {
        summary.cash_in_usd += row.from_currency === 'USD' ? Number(row.from_amount) || 0 : 0;
        summary.cash_in_lrd += row.to_currency === 'LRD' ? Number(row.to_amount) || 0 : 0;
      } else {
        if (row.currency === 'USD') summary.cash_in_usd += Number(row.amount) || 0;
        if (row.currency === 'LRD') summary.cash_in_lrd += Number(row.amount) || 0;
      }
    }
    if (row.type === 'expense') {
      const hasComponents = row.from_currency === 'USD' || row.to_currency === 'LRD';
      if (hasComponents) {
        summary.cash_out_usd += row.from_currency === 'USD' ? Number(row.from_amount) || 0 : 0;
        summary.cash_out_lrd += row.to_currency === 'LRD' ? Number(row.to_amount) || 0 : 0;
      } else {
        if (row.currency === 'USD') summary.cash_out_usd += Number(row.amount) || 0;
        if (row.currency === 'LRD') summary.cash_out_lrd += Number(row.amount) || 0;
      }
      summary.cash_in_usd += Number(row.change_usd) || 0;
      summary.cash_in_lrd += Number(row.change_lrd) || 0;
    }
    if (row.type === 'transfer') {
      if (row.currency === 'USD') summary.cash_out_usd += Number(row.amount) || 0;
      if (row.currency === 'LRD') summary.cash_out_lrd += Number(row.amount) || 0;
    }
    if (row.type === 'exchange') {
      if (row.from_currency === 'USD') summary.exchange_out_usd += Number(row.from_amount) || 0;
      if (row.from_currency === 'LRD') summary.exchange_out_lrd += Number(row.from_amount) || 0;
      if (row.to_currency === 'USD') summary.exchange_in_usd += Number(row.to_amount) || 0;
      if (row.to_currency === 'LRD') summary.exchange_in_lrd += Number(row.to_amount) || 0;
    }
  });
  return summary;
}

export async function getDailyCashOverview(projectId: string, date = todayIso(), userFilterId?: string | null) {
  const db = await getDb();
  const cashRows = await db.getAllAsync<DailyCash & { user_name?: string; user_role?: string }>(
    `SELECT dc.*, u.name as user_name, u.role as user_role
     FROM daily_cash dc
     LEFT JOIN users u ON u.local_user_id = COALESCE(dc.local_user_id, dc.created_by)
     WHERE dc.local_project_id = ? AND dc.date = ? AND COALESCE(u.role, '') != 'viewer'
       ${userFilterId ? 'AND COALESCE(dc.local_user_id, dc.created_by) = ?' : ''}
     ORDER BY u.name`,
    userFilterId ? [projectId, date, userFilterId] : [projectId, date]
  );
  const assignedUsers = await db.getAllAsync<{ local_user_id: string; name: string; role: User['role'] }>(
    `SELECT DISTINCT u.local_user_id, u.name, u.role
     FROM project_users pu
     JOIN users u ON u.local_user_id = pu.local_user_id
     WHERE pu.local_project_id = ? AND pu.active = 1 AND u.active = 1 AND u.role != 'viewer'
       ${userFilterId ? 'AND u.local_user_id = ?' : ''}
     ORDER BY u.name`,
    userFilterId ? [projectId, userFilterId] : [projectId]
  );
  const txnUsers = await db.getAllAsync<{ local_user_id: string; name: string; role: string }>(
    `SELECT DISTINCT t.created_by as local_user_id, u.name, u.role
     FROM transactions t
     LEFT JOIN users u ON u.local_user_id = t.created_by
     WHERE t.local_project_id = ? AND substr(t.date, 1, 10) = ? AND t.active = 1 AND COALESCE(u.role, '') != 'viewer'
       ${userFilterId ? 'AND t.created_by = ?' : ''}`,
    userFilterId ? [projectId, date, userFilterId] : [projectId, date]
  );

  const byUser = new Map<string, DailyCash & { user_name?: string; user_role?: string }>();
  cashRows.forEach((row) => {
    const id = row.local_user_id ?? row.created_by;
    const current = id ? byUser.get(id) : null;
    if (id && (!current || isNewerDailyCashRow(row, current))) {
      byUser.set(id, row);
    }
  });
  for (const user of [...assignedUsers, ...txnUsers]) {
    if (!byUser.has(user.local_user_id)) {
      const carried = await getCarryForwardBalance(projectId, date, user.local_user_id);
      byUser.set(user.local_user_id, {
        ...buildSyntheticDailyCash(projectId, date, user.local_user_id, carried),
        user_name: user.name,
        user_role: user.role,
      });
    }
  }

  const overview: DailyCashOverview = {
    initial_usd: 0,
    initial_lrd: 0,
    expected_usd: 0,
    expected_lrd: 0,
    balance_usd: 0,
    balance_lrd: 0,
    actual_count: 0,
    users: [],
  };

  for (const row of byUser.values()) {
    if (row.user_role === 'viewer') continue;
    const userId = row.local_user_id ?? row.created_by ?? '';
    const summary = await getDailySummary(projectId, date, userId, true);
    const expectedUsd = row.initial_usd + summary.cash_in_usd + summary.exchange_in_usd - summary.cash_out_usd - summary.exchange_out_usd;
    const expectedLrd = row.initial_lrd + summary.cash_in_lrd + summary.exchange_in_lrd - summary.cash_out_lrd - summary.exchange_out_lrd;
    const balanceUsd = row.actual_usd ?? expectedUsd;
    const balanceLrd = row.actual_lrd ?? expectedLrd;
    if (row.actual_usd !== null || row.actual_lrd !== null) overview.actual_count += 1;
    overview.initial_usd += row.initial_usd;
    overview.initial_lrd += row.initial_lrd;
    overview.expected_usd += expectedUsd;
    overview.expected_lrd += expectedLrd;
    overview.balance_usd += balanceUsd;
    overview.balance_lrd += balanceLrd;
    overview.users.push({
      local_user_id: userId,
      name: row.user_name ?? userId,
      role: row.user_role === 'admin' ? 'admin' : row.user_role === 'viewer' ? 'viewer' : 'manager',
      initial_usd: row.initial_usd,
      initial_lrd: row.initial_lrd,
      expected_usd: expectedUsd,
      expected_lrd: expectedLrd,
      balance_usd: balanceUsd,
      balance_lrd: balanceLrd,
      actual_usd: row.actual_usd,
      actual_lrd: row.actual_lrd,
    });
  }

  return overview;
}

export async function updateDailyCash(
  dailyId: string,
  values: { initial_usd?: number; initial_lrd?: number; actual_usd?: number | null; actual_lrd?: number | null; note?: string | null }
) {
  const db = await getDb();
  const oldRow = await db.getFirstAsync<DailyCash>('SELECT * FROM daily_cash WHERE local_daily_id = ?', dailyId);
  if (!oldRow) return;
  const next = { ...oldRow, ...values, updated_by: currentUserId, updated_at_local: nowIso() };
  await db.runAsync(
    `UPDATE daily_cash
     SET initial_usd = ?, initial_lrd = ?, actual_usd = ?, actual_lrd = ?, note = ?,
         updated_by = ?, updated_at_local = ?, sync_status = 'pending'
     WHERE local_daily_id = ?`,
    next.initial_usd,
    next.initial_lrd,
    next.actual_usd,
    next.actual_lrd,
    next.note,
    next.updated_by,
    next.updated_at_local,
    dailyId
  );
  await audit({ tableName: 'daily_cash', recordId: dailyId, action: 'edit', oldValue: oldRow, newValue: next, projectId: oldRow.local_project_id });
}

export async function saveDailyCash(
  projectId: string,
  date: string,
  values: { initial_usd?: number; initial_lrd?: number; actual_usd?: number | null; actual_lrd?: number | null; note?: string | null }
) {
  const user = await getCurrentUser();
  if (!currentUserId) throw new Error('Missing active user');
  if (user?.role === 'viewer') throw new Error('Viewers cannot create records.');
  const existing = await getLatestDailyCashForUser(projectId, date, currentUserId);
  if (existing) {
    await updateDailyCash(existing.local_daily_id, values);
    return;
  }
  await createDailyCashForUser(projectId, date, currentUserId, values);
}

async function nextTransactionNo(type: TransactionType, dateText: string) {
  const db = await getDb();
  const ymd = dateText.slice(0, 10).replaceAll('-', '');
  const prefix = type === 'expense' ? `EXP-${ymd}` : type === 'cash_in' ? `CASHIN-${ymd}` : type === 'transfer' ? `TRF-${ymd}` : `EXCH-${ymd}`;
  const countRow = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM transactions WHERE transaction_no LIKE ?',
    `${prefix}-%`
  );
  return `${prefix}-${String((countRow?.count ?? 0) + 1).padStart(3, '0')}`;
}

export async function createTransaction(input: {
  type: TransactionType;
  amount?: number;
  currency?: Currency;
  category: string;
  note: string;
  projectId?: string;
  area?: Area | null;
  fromCurrency?: Currency;
  fromAmount?: number;
  toCurrency?: Currency;
  toAmount?: number;
  changeUsd?: number;
  changeLrd?: number;
  photoUri?: string | null;
  date?: string;
}) {
  const db = await getDb();
  const projectId = input.projectId ?? activeProjectId;
  if (!projectId || !currentUserId) throw new Error('Missing active project or user');
  const user = await getCurrentUser();
  if (user?.role === 'viewer') throw new Error('Viewers cannot create records.');
  const dateText = input.date ? `${input.date.slice(0, 10)}${nowIso().slice(10)}` : nowIso();
  await ensureDailyCashForUser(projectId, dateText.slice(0, 10), currentUserId);
  const exchangeRate = input.type === 'exchange' && input.fromAmount && input.toAmount ? input.toAmount / input.fromAmount : null;
  const row = {
    local_transaction_id: localId('txn'),
    transaction_no: await nextTransactionNo(input.type, dateText),
    local_project_id: projectId,
    date: dateText,
    type: input.type,
    amount: input.type === 'exchange' ? input.fromAmount ?? 0 : input.amount ?? 0,
    currency: input.type === 'exchange' ? input.fromCurrency ?? 'USD' : input.currency ?? 'USD',
    category: input.category,
    note: input.note.trim() || null,
    area: input.area ?? null,
    from_currency: input.fromCurrency ?? null,
    from_amount: input.fromAmount ?? null,
    to_currency: input.toCurrency ?? null,
    to_amount: input.toAmount ?? null,
    exchange_rate: exchangeRate,
    change_usd: input.changeUsd ?? null,
    change_lrd: input.changeLrd ?? null,
    photo_uri: input.photoUri ?? null,
    transfer_to_user_id: null,
    transfer_from_user_id: null,
    linked_transaction_id: null,
    active: 1,
    created_by: currentUserId,
    created_at_local: dateText,
    sync_status: 'pending',
  };
  await db.runAsync(
    `INSERT INTO transactions
      (local_transaction_id, transaction_no, local_project_id, date, type, amount, currency, category, note, area,
       from_currency, from_amount, to_currency, to_amount, exchange_rate, change_usd, change_lrd, photo_uri,
       transfer_to_user_id, transfer_from_user_id, linked_transaction_id, active, created_by, created_at_local, sync_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
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
    row.created_by,
    row.created_at_local,
    row.sync_status
  );
  await audit({ tableName: 'transactions', recordId: row.local_transaction_id, action: 'create', newValue: row, projectId });
  return row.transaction_no;
}

export async function createManagerTransfer(input: {
  amount: number;
  currency: Currency;
  toUserId: string;
  note: string;
  photoUri?: string | null;
  projectId?: string;
  date?: string;
}) {
  const db = await getDb();
  const projectId = input.projectId ?? activeProjectId;
  if (!projectId || !currentUserId) throw new Error('Missing active project or user');
  const user = await getCurrentUser();
  if (user?.role === 'viewer') throw new Error('Viewers cannot create records.');
  if (input.toUserId === currentUserId) throw new Error('Cannot transfer to yourself');
  const dateText = input.date ? `${input.date.slice(0, 10)}${nowIso().slice(10)}` : nowIso();
  const sender = user;
  const receiver = await db.getFirstAsync<User>('SELECT * FROM users WHERE local_user_id = ? AND active = 1', input.toUserId);
  await ensureDailyCashForUser(projectId, dateText.slice(0, 10), currentUserId);
  await ensureDailyCashForUser(projectId, dateText.slice(0, 10), input.toUserId);
  const senderId = localId('txn');
  const receiverId = localId('txn');
  const baseNote = input.note.trim();
  const senderNote = `${receiver?.name ?? input.toUserId} 收款${baseNote ? ` - ${baseNote}` : ''}`;
  const senderRow = {
    local_transaction_id: senderId,
    transaction_no: await nextTransactionNo('transfer', dateText),
    local_project_id: projectId,
    date: dateText,
    type: 'transfer' as TransactionType,
    amount: input.amount,
    currency: input.currency,
    category: '经理转出',
    note: senderNote,
    area: null,
    from_currency: null,
    from_amount: null,
    to_currency: null,
    to_amount: null,
    exchange_rate: null,
    change_usd: null,
    change_lrd: null,
    photo_uri: input.photoUri ?? null,
    transfer_to_user_id: input.toUserId,
    transfer_from_user_id: null,
    linked_transaction_id: receiverId,
    active: 1,
    created_by: currentUserId,
    created_at_local: dateText,
    updated_by: null,
    updated_at_local: null,
    sync_status: 'pending',
  };
  const receiverRow = {
    local_transaction_id: receiverId,
    transaction_no: await nextTransactionNo('cash_in', dateText),
    local_project_id: projectId,
    date: dateText,
    type: 'cash_in' as TransactionType,
    amount: input.amount,
    currency: input.currency,
    category: '经理转入',
    note: `${sender?.name ?? '转出人'} 转入${baseNote ? ` - ${baseNote}` : ''}`,
    area: null,
    from_currency: null,
    from_amount: null,
    to_currency: null,
    to_amount: null,
    exchange_rate: null,
    change_usd: null,
    change_lrd: null,
    photo_uri: input.photoUri ?? null,
    transfer_to_user_id: null,
    transfer_from_user_id: currentUserId,
    linked_transaction_id: senderId,
    active: 1,
    created_by: input.toUserId,
    created_at_local: dateText,
    updated_by: null,
    updated_at_local: null,
    sync_status: 'pending',
  };
  for (const row of [senderRow, receiverRow]) {
    await db.runAsync(
      `INSERT INTO transactions
        (local_transaction_id, transaction_no, local_project_id, date, type, amount, currency, category, note, area,
         from_currency, from_amount, to_currency, to_amount, exchange_rate, change_usd, change_lrd, photo_uri,
         transfer_to_user_id, transfer_from_user_id, linked_transaction_id, active, created_by, created_at_local,
         updated_by, updated_at_local, sync_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
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
      row.created_by,
      row.created_at_local,
      row.updated_by,
      row.updated_at_local,
      row.sync_status
    );
    await audit({ tableName: 'transactions', recordId: row.local_transaction_id, action: 'create', newValue: row, projectId });
  }
  return `${senderRow.transaction_no} -> ${receiver?.name ?? input.toUserId}`;
}

export async function listTransactions(projectId: string, dateFilter?: string, search?: string, userFilterId?: string | null, bypassRole = false) {
  const db = await getDb();
  const user = await getCurrentUser();
  const clauses = ["t.local_project_id = ?", "t.active = 1", "COALESCE(u.role, '') != 'viewer'"];
  const params: string[] = [projectId];
  if (!bypassRole && user?.role === 'manager') {
    clauses.push('t.created_by = ?');
    params.push(user.local_user_id);
  } else if (userFilterId) {
    clauses.push('t.created_by = ?');
    params.push(userFilterId);
  }
  if (dateFilter?.trim()) {
    clauses.push('substr(t.date, 1, 10) = ?');
    params.push(dateFilter.trim());
  }
  if (search?.trim()) {
    clauses.push('(t.transaction_no LIKE ? OR t.note LIKE ? OR t.category LIKE ? OR t.area LIKE ?)');
    const term = `%${search.trim()}%`;
    params.push(term, term, term, term);
  }
  return db.getAllAsync<CashTransaction>(
    `SELECT t.*, u.name as created_by_name, p.project_name
     FROM transactions t
     LEFT JOIN users u ON u.local_user_id = t.created_by
     LEFT JOIN projects p ON p.local_project_id = t.local_project_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY t.date ASC, t.created_at_local ASC`,
    params
  );
}

export async function updateTransaction(transactionId: string, values: Partial<CashTransaction>) {
  const db = await getDb();
  const oldRow = await db.getFirstAsync<CashTransaction>('SELECT * FROM transactions WHERE local_transaction_id = ?', transactionId);
  if (!oldRow) return;
  const next = { ...oldRow, ...values, updated_by: currentUserId, updated_at_local: nowIso() };
  await db.runAsync(
    `UPDATE transactions
     SET amount = ?, currency = ?, category = ?, note = ?, date = ?, area = ?,
         from_currency = ?, from_amount = ?, to_currency = ?, to_amount = ?, exchange_rate = ?,
         change_usd = ?, change_lrd = ?, photo_uri = ?,
         transfer_to_user_id = ?, transfer_from_user_id = ?, linked_transaction_id = ?,
         updated_by = ?, updated_at_local = ?, sync_status = 'pending'
     WHERE local_transaction_id = ?`,
    next.amount,
    next.currency,
    next.category,
    next.note,
    next.date,
    next.area,
    next.from_currency,
    next.from_amount,
    next.to_currency,
    next.to_amount,
    next.exchange_rate,
    next.change_usd,
    next.change_lrd,
    next.photo_uri,
    next.transfer_to_user_id,
    next.transfer_from_user_id,
    next.linked_transaction_id,
    next.updated_by,
    next.updated_at_local,
    transactionId
  );
  await audit({ tableName: 'transactions', recordId: transactionId, action: 'edit', oldValue: oldRow, newValue: next, projectId: oldRow.local_project_id });
}

export async function deleteTransaction(transaction: CashTransaction) {
  const db = await getDb();
  await db.runAsync(
    "UPDATE transactions SET active = 0, updated_by = ?, updated_at_local = ?, sync_status = 'pending' WHERE local_transaction_id = ?",
    currentUserId,
    nowIso(),
    transaction.local_transaction_id
  );
  if (transaction.linked_transaction_id) {
    await db.runAsync(
      "UPDATE transactions SET active = 0, updated_by = ?, updated_at_local = ?, sync_status = 'pending' WHERE local_transaction_id = ?",
      currentUserId,
      nowIso(),
      transaction.linked_transaction_id
    );
  }
  await audit({ tableName: 'transactions', recordId: transaction.local_transaction_id, action: 'deactivate', oldValue: transaction, projectId: transaction.local_project_id });
}

export async function createProject(projectName: string, location: string) {
  const db = await getDb();
  const row = { local_project_id: localId('project'), project_name: projectName.trim(), location: location.trim() || null, active: 1, created_at_local: nowIso() };
  await db.runAsync(
    'INSERT INTO projects (local_project_id, project_name, location, active, created_at_local) VALUES (?, ?, ?, 1, ?)',
    row.local_project_id,
    row.project_name,
    row.location,
    row.created_at_local
  );
  await audit({ tableName: 'projects', recordId: row.local_project_id, action: 'create', newValue: row });
}

export async function updateProject(project: Project, values: { project_name: string; location: string }) {
  const db = await getDb();
  const next = { ...project, project_name: values.project_name.trim(), location: values.location.trim() || null, updated_at_local: nowIso() };
  await db.runAsync(
    'UPDATE projects SET project_name = ?, location = ?, updated_at_local = ? WHERE local_project_id = ?',
    next.project_name,
    next.location,
    next.updated_at_local,
    project.local_project_id
  );
  await audit({ tableName: 'projects', recordId: project.local_project_id, action: 'edit', oldValue: project, newValue: next });
}

export async function deleteProject(project: Project) {
  const db = await getDb();
  await db.runAsync('UPDATE projects SET active = 0, updated_at_local = ? WHERE local_project_id = ?', nowIso(), project.local_project_id);
  await db.runAsync('UPDATE project_users SET active = 0 WHERE local_project_id = ?', project.local_project_id);
  if (activeProjectId === project.local_project_id) activeProjectId = null;
  await audit({ tableName: 'projects', recordId: project.local_project_id, action: 'deactivate', oldValue: project });
}

export async function createManager(username: string, name: string, password: string, role: 'manager' | 'viewer' = 'manager') {
  const db = await getDb();
  const row = { local_user_id: localId('user'), username: username.trim(), name: name.trim(), role, password, pin: password, active: 1, created_at_local: nowIso() };
  await db.runAsync(
    `INSERT INTO users (local_user_id, username, name, role, pin, password, active, created_at_local)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    row.local_user_id,
    row.username,
    row.name,
    row.role,
    row.pin,
    row.password,
    row.created_at_local
  );
  await audit({ tableName: 'users', recordId: row.local_user_id, action: 'create', newValue: row });
}

export async function updateUser(user: User, values: { username: string; name: string; password: string }) {
  const db = await getDb();
  const next = { ...user, username: values.username.trim(), name: values.name.trim(), password: values.password, pin: values.password, updated_at_local: nowIso() };
  await db.runAsync(
    'UPDATE users SET username = ?, name = ?, password = ?, pin = ?, updated_at_local = ? WHERE local_user_id = ?',
    next.username,
    next.name,
    next.password,
    next.pin,
    next.updated_at_local,
    user.local_user_id
  );
  await audit({ tableName: 'users', recordId: user.local_user_id, action: 'edit', oldValue: user, newValue: next });
}

export async function assignManager(projectId: string, userId: string) {
  const db = await getDb();
  const user = await db.getFirstAsync<User>('SELECT * FROM users WHERE local_user_id = ?', userId);
  const projectRole = user?.role === 'viewer' ? 'viewer' : 'manager';
  const existing = await db.getFirstAsync<ProjectUser>('SELECT * FROM project_users WHERE local_project_id = ? AND local_user_id = ?', projectId, userId);
  if (existing) {
    await db.runAsync('UPDATE project_users SET active = 1, role_in_project = ? WHERE id = ?', projectRole, existing.id);
    await audit({ tableName: 'project_users', recordId: String(existing.id), action: 'edit', oldValue: existing, newValue: { ...existing, active: 1, role_in_project: projectRole }, projectId });
    return;
  }
  const createdAt = nowIso();
  await db.runAsync(
    'INSERT INTO project_users (local_project_id, local_user_id, role_in_project, active, created_at_local) VALUES (?, ?, ?, 1, ?)',
    projectId,
    userId,
    projectRole,
    createdAt
  );
  await audit({ tableName: 'project_users', recordId: `${projectId}:${userId}`, action: 'create', newValue: { projectId, userId, role: projectRole, createdAt }, projectId });
}

export async function removeManagerAssignment(assignment: ProjectUser) {
  const db = await getDb();
  await db.runAsync('UPDATE project_users SET active = 0 WHERE id = ?', assignment.id);
  await audit({
    tableName: 'project_users',
    recordId: String(assignment.id),
    action: 'deactivate',
    oldValue: assignment,
    projectId: assignment.local_project_id,
  });
}

export async function listProjectUsers() {
  const db = await getDb();
  return db.getAllAsync<ProjectUser>(
    `SELECT pu.*, u.name as manager_name, p.project_name
     FROM project_users pu
     JOIN users u ON u.local_user_id = pu.local_user_id
     JOIN projects p ON p.local_project_id = pu.local_project_id
     WHERE pu.active = 1 AND u.active = 1 AND p.active = 1
     ORDER BY p.project_name, u.name`
  );
}

export async function listAuditLog(limit = 80) {
  const db = await getDb();
  return db.getAllAsync<AuditLog>(
    `SELECT a.*, u.name as edited_by_name
     FROM audit_log a
     LEFT JOIN users u ON u.local_user_id = a.edited_by
     ORDER BY a.edited_at_local DESC
     LIMIT ?`,
    limit
  );
}

export function blankDailySummary(): DailySummary {
  return {
    cash_in_usd: 0,
    cash_in_lrd: 0,
    cash_out_usd: 0,
    cash_out_lrd: 0,
    exchange_in_usd: 0,
    exchange_in_lrd: 0,
    exchange_out_usd: 0,
    exchange_out_lrd: 0,
  };
}

export function getTodayIso() {
  return todayIso();
}

export function addLocalDays(base: string, offset: number) {
  const [year, month, day] = base.slice(0, 10).split('-').map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);
  date.setDate(date.getDate() + offset);
  return formatLocalDate(date);
}

export function replaceLocalDate(timestamp: string, date: string) {
  const timeMatch = timestamp.match(/T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/);
  const [, hour = '00', minute = '00', second = '00', millisecond = '000'] = timeMatch ?? [];
  const [year, month, day] = date.slice(0, 10).split('-').map(Number);
  const local = new Date(
    year,
    (month || 1) - 1,
    day || 1,
    Number(hour),
    Number(minute),
    Number(second),
    Number(millisecond.padEnd(3, '0'))
  );
  return `${formatLocalDate(local)}T${padDatePart(local.getHours())}:${padDatePart(local.getMinutes())}:${padDatePart(local.getSeconds())}.${padMilliseconds(local.getMilliseconds())}${timezoneOffset(local)}`;
}
