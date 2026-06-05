export type UserRole = 'admin' | 'manager' | 'viewer';
export type TransactionType = 'expense' | 'cash_in' | 'exchange' | 'transfer';
export type Currency = 'USD' | 'LRD';
export type Area = '矿区' | '外围';
export type TransferState =
  | 'transfer:pending'
  | 'transfer:accepted'
  | 'transfer:accepted_seen'
  | 'transfer:rejected'
  | 'transfer:rejected_seen';

export type User = {
  id: number;
  local_user_id: string;
  username: string;
  name: string;
  role: UserRole;
  pin: string | null;
  password: string | null;
  active: number;
  created_at_local: string;
  updated_at_local: string | null;
};

export type Project = {
  id: number;
  local_project_id: string;
  project_name: string;
  location: string | null;
  active: number;
  created_at_local: string;
  updated_at_local: string | null;
};

export type DailyCash = {
  id: number;
  local_daily_id: string;
  local_project_id: string;
  local_user_id: string | null;
  date: string;
  initial_usd: number;
  initial_lrd: number;
  actual_usd: number | null;
  actual_lrd: number | null;
  note: string | null;
  created_by: string | null;
  created_at_local: string;
  updated_by: string | null;
  updated_at_local: string | null;
  sync_status: string;
};

export type UserDailyCashSummary = {
  local_user_id: string;
  name: string;
  role: UserRole;
  initial_usd: number;
  initial_lrd: number;
  expected_usd: number;
  expected_lrd: number;
  balance_usd: number;
  balance_lrd: number;
  actual_usd: number | null;
  actual_lrd: number | null;
};

export type DailyCashOverview = {
  initial_usd: number;
  initial_lrd: number;
  expected_usd: number;
  expected_lrd: number;
  balance_usd: number;
  balance_lrd: number;
  actual_count: number;
  users: UserDailyCashSummary[];
};

export type CashTransaction = {
  id: number;
  local_transaction_id: string;
  transaction_no: string;
  local_project_id: string;
  date: string;
  type: TransactionType;
  amount: number;
  currency: Currency;
  category: string;
  note: string | null;
  area: Area | TransferState | null;
  from_currency: Currency | null;
  from_amount: number | null;
  to_currency: Currency | null;
  to_amount: number | null;
  exchange_rate: number | null;
  change_usd: number | null;
  change_lrd: number | null;
  photo_uri: string | null;
  transfer_to_user_id: string | null;
  transfer_from_user_id: string | null;
  linked_transaction_id: string | null;
  active: number;
  created_by: string;
  created_at_local: string;
  updated_by: string | null;
  updated_at_local: string | null;
  sync_status: string;
  created_by_name?: string;
  project_name?: string;
  transfer_from_name?: string;
  transfer_to_name?: string;
};

export type AuditLog = {
  id: number;
  local_audit_id: string;
  table_name: string;
  record_id: string;
  action: 'create' | 'edit' | 'deactivate';
  old_value_json: string | null;
  new_value_json: string | null;
  edited_by: string | null;
  edited_at_local: string;
  local_project_id: string | null;
  edited_by_name?: string;
};

export type DailySummary = {
  cash_in_usd: number;
  cash_in_lrd: number;
  cash_out_usd: number;
  cash_out_lrd: number;
  exchange_in_usd: number;
  exchange_in_lrd: number;
  exchange_out_usd: number;
  exchange_out_lrd: number;
};

export type ProjectUser = {
  id: number;
  local_project_id: string;
  local_user_id: string;
  role_in_project: string;
  active: number;
  created_at_local: string;
  manager_name?: string;
  project_name?: string;
};
