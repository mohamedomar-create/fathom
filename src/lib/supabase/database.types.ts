// Database types (mirrors supabase/migrations). Regenerate with the Supabase type generator if the schema changes.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
export type MemberRole = "admin" | "editor" | "viewer";

type Table<Row, Required extends keyof Row> = {
  Row: Row;
  Insert: Pick<Row, Required> & Partial<Omit<Row, Required>>;
  Update: Partial<Row>;
  Relationships: [];
};

export type OrganizationRow = { id: string; name: string; logo_url: string | null; brand_colour: string | null; disclaimer: string; report_footer: string | null; created_by: string | null; created_at: string }
export type MembershipRow = { org_id: string; user_id: string; role: MemberRole; created_at: string }
export type ProfileRow = { id: string; email: string; full_name: string | null; created_at: string }
export type InviteRow = { id: string; org_id: string; email: string; role: MemberRole; invited_by: string | null; created_at: string; accepted_at: string | null }
export type CompanyRow = {
  id: string; org_id: string; name: string; currency: string; fy_start_month: number; tax_rate: number; source: string; industry: string | null;
  ai_context: Json; kpi_config: Json; notes: Json; data_version: number; last_synced_at: string | null; created_by: string | null; created_at: string; updated_at: string;
}
export type SourceAccountRow = {
  id: string; company_id: string; version: number; code: string; name: string; statement: "PL" | "BS"; class: string; odoo_id: number | null; odoo_type: string | null;
  confidence: number | null; mapped_by: string; sort_order: number; refs: Json;
}
export type AccountBalanceRow = { account_id: string; company_id: string; period: string; amount: number; import_id: string | null }
export type ImportRow = { id: string; company_id: string; kind: string; filename: string | null; status: string; report: Json; created_by: string | null; created_at: string; data_version: number | null; action: "import" | "restore" }
export type OdooConnectionRow = {
  company_id: string; url: string; db: string; login: string; api_key_enc: string; odoo_company_id: number | null; odoo_company_name: string | null;
  include_branches: boolean; months_history: number; version: string | null; status: string; last_error: string | null; last_sync_at: string | null; updated_at: string;
  has_key: boolean; key_expires_on: string | null; sync_started_at: string | null; created_at: string;
}
export type OdooAuditRow = { id: number; company_id: string; user_id: string | null; action: string; ok: boolean; detail: string | null; rows_read: number | null; at: string }
export type CommentaryRow = { company_id: string; period_key: string; section: string; body: string; source: string; updated_by: string | null; updated_at: string }
export type ReportRow = {
  id: string; company_id: string; title: string; period_type: string; period_end: string; sections: Json; status: string; share_token: string | null; expires_at: string | null;
  published_at: string | null; created_by: string | null; created_at: string; updated_at: string;
}
export type SalesLineRow = { id: number; company_id: string; batch_id: string; source: "ledger" | "file"; day: string | null; period: string; doc: string; series: string; customer: string; product: string; category: string; salesperson: string; qty: number | null; amount: number; cost: number | null; sale_order: string | null; end_user: string | null; map_method: "order" | "contact" | "shipping" | null; note: string | null }
export type ExpenseLineRow = { id: number; company_id: string; batch_id: string; source: "ledger" | "file"; day: string | null; period: string; doc: string; series: string; supplier: string; account: string; cls: string | null; category: string; label: string; amount: number }
export type ExpenseBatchRow = { id: string; company_id: string; source: "ledger" | "file"; filename: string | null; periods: string[]; report: Json; created_by: string | null; created_at: string }
export type CashUploadRow = { id: string; company_id: string; filename: string; months: string[]; mode: "add" | "replace_months"; status: "open" | "done"; rows: number; skipped: number; created_by: string | null; created_at: string }
export type SalesBatchRow = { id: string; company_id: string; source: "ledger" | "file"; filename: string | null; periods: string[]; report: Json; created_by: string | null; created_at: string }
export type PaymentBatchRow = { id: string; company_id: string; filename: string | null; periods: string[]; report: Json; source: "file" | "ledger"; created_by: string | null; created_at: string }
export type AgedReportRow = { id: string; company_id: string; side: "receivable" | "payable"; as_of: string; buckets: string[]; totals: Json; findings: Json; filename: string | null; created_by: string | null; created_at: string }
export type InventoryBatchRow = { id: string; company_id: string; kind: "valuation" | "moves" | "onhand" | "products"; filename: string | null; periods: string[]; mode: "replace" | "add" | "all" | "update"; status: "open" | "done"; report: Json; created_by: string | null; created_at: string }
export type StockLayerRow = { id: number; company_id: string; batch_id: string; odoo_key: string; day: string | null; period: string; ref: string; kind: string; product: string; code: string; category: string; lot: string; qty: number; unit_value: number; value: number; partner: string; landed_ref: string; live: boolean }
export type StockMoveRow = { id: number; company_id: string; batch_id: string; odoo_key: string; day: string | null; period: string; ref: string; kind: string; product: string; code: string; lot: string; from_loc: string; to_loc: string; qty: number; uom: string; partner: string; live: boolean }
export type ImportJobStatus = "preparing" | "queued" | "checking" | "needs_review" | "saving" | "done" | "failed" | "cancelled";
export type ImportJobRow = { id: string; company_id: string; kind: "inventory"; mode: "replace" | "add" | "all" | "update"; status: ImportJobStatus; accept_invalid: boolean; options: Json; counts: Json; message: string | null; created_by: string | null; created_at: string; updated_at: string; queued_at: string | null; started_at: string | null; finished_at: string | null }
export type ImportFileRow = { id: string; job_id: string; company_id: string; filename: string; size: number; export_key: string; kind: "valuation" | "moves" | "onhand" | "products"; storage_path: string; stored: boolean; rows_declared: number | null; counts: Json; created_at: string }
export type ImportRowRow = { file_id: string; n: number; job_id: string; line: number | null; data: Json; error: string | null }
export type AccountMapRow = { company_id: string; key: string; cls: string; name: string; updated_by: string | null; updated_at: string }
export type AgencyStatementBatchRow = { id: string; company_id: string; filename: string | null; sheets: string[]; report: Json; created_by: string | null; created_at: string }
export type AgencyStatementLineRow = { id: number; company_id: string; batch_id: string; day: string; dn: string; ref: string; hospital: string; funding: string; region: string; value: number; sheet: string }
export type EndUserMapRow = { company_id: string; kind: "alias" | "order" | "agency" | "not_agency"; key: string; hospital: string; updated_by: string | null; updated_at: string }
export type InputProfileRow = { company_id: string; kind: string; headings: string[]; read: string[]; ignored: string[]; sheet: string; history: Json; updated_by: string | null; updated_at: string }
export type ImportTemplateRow = { company_id: string; export_key: string; mapping: Json; updated_by: string | null; updated_at: string }
export type StockLedgerBatchRow = { id: string; company_id: string; source: "ledger"; filename: string | null; periods: string[]; report: Json; created_by: string | null; created_at: string }
export type StockLedgerLineRow = { id: number; company_id: string; batch_id: string; source: "ledger"; day: string | null; period: string; ref: string; account: string; amount: number }

export type Database = {
  public: {
    Tables: {
      organizations: Table<OrganizationRow, "name">;
      memberships: Table<MembershipRow, "org_id" | "user_id">;
      profiles: Table<ProfileRow, "id" | "email">;
      invites: Table<InviteRow, "org_id" | "email">;
      companies: Table<CompanyRow, "org_id" | "name">;
      source_accounts: Table<SourceAccountRow, "company_id" | "name" | "statement" | "class">;
      account_balances: Table<AccountBalanceRow, "account_id" | "company_id" | "period" | "amount">;
      imports: Table<ImportRow, "company_id" | "kind">;
      odoo_connections: Table<OdooConnectionRow, "company_id" | "url" | "db" | "login" | "api_key_enc">;
      odoo_audit: Table<OdooAuditRow, "company_id" | "action" | "ok">;
      commentary: Table<CommentaryRow, "company_id" | "period_key" | "section" | "body">;
      reports: Table<ReportRow, "company_id" | "period_end">;
      sales_batches: Table<SalesBatchRow, "company_id" | "source">;
      cash_uploads: Table<CashUploadRow, "company_id">;
      payment_batches: Table<PaymentBatchRow, "company_id">;
      aged_reports: Table<AgedReportRow, "company_id" | "side" | "as_of" | "buckets">;
      sales_lines: Table<SalesLineRow, "company_id" | "batch_id" | "source" | "period" | "amount">;
      expense_batches: Table<ExpenseBatchRow, "company_id" | "source">;
      expense_lines: Table<ExpenseLineRow, "company_id" | "batch_id" | "source" | "period" | "amount">;
      inventory_batches: Table<InventoryBatchRow, "company_id" | "kind">;
      stock_layers: Table<StockLayerRow, "company_id" | "batch_id" | "odoo_key" | "period">;
      stock_moves: Table<StockMoveRow, "company_id" | "batch_id" | "odoo_key" | "period">;
      stock_ledger_batches: Table<StockLedgerBatchRow, "company_id">;
      stock_ledger_lines: Table<StockLedgerLineRow, "company_id" | "batch_id" | "period" | "amount">;
      import_jobs: Table<ImportJobRow, "company_id" | "kind" | "mode">;
      import_files: Table<ImportFileRow, "job_id" | "company_id" | "filename" | "export_key" | "kind" | "storage_path">;
      import_rows: Table<ImportRowRow, "file_id" | "n" | "job_id">;
      import_templates: Table<ImportTemplateRow, "company_id" | "export_key">;
      account_map: Table<AccountMapRow, "company_id" | "key" | "cls">;
      end_user_map: Table<EndUserMapRow, "company_id" | "kind" | "key">;
      agency_statement_batches: Table<AgencyStatementBatchRow, "company_id">;
      agency_statement_lines: Table<AgencyStatementLineRow, "company_id" | "batch_id" | "day" | "hospital" | "value">;
      input_profiles: Table<InputProfileRow, "company_id" | "kind" | "headings">;
    };
    Views: { [_ in never]: never };
    Functions: {
      accept_pending_invites: { Args: Record<string, never>; Returns: number };
      get_published_report: { Args: { p_token: string }; Returns: Json };
      reclassify_accounts: { Args: { p_company: string; p_changes: Json }; Returns: number };
      restamp_expense_classes: { Args: { p_company: string }; Returns: number };
      replace_company_data: { Args: { p_company: string; p_accounts: Json; p_import?: Json; p_notes?: Json }; Returns: number };
      save_company_version: { Args: { p_company: string; p_accounts: Json; p_import?: Json; p_notes?: Json }; Returns: Json };
      restore_company_version: { Args: { p_company: string; p_version: number }; Returns: string };
      hit_rate_limit: { Args: { p_key: string; p_window_s: number; p_max: number }; Returns: boolean };
      rate_limit_hit: { Args: { p_scope: string; p_subject: string }; Returns: boolean };
      rate_limit_link: { Args: { p_token: string }; Returns: boolean };
      cash_to_full_preview: { Args: { p_company: string }; Returns: Json };
      rate_limit_demo: { Args: Record<string, never>; Returns: boolean };
      transfer_company: { Args: { p_company: string; p_target_org: string }; Returns: undefined };
      odoo_secret: { Args: { p_company: string }; Returns: string | null };
      company_balances: { Args: { p_company: string; p_version: number }; Returns: Json };
      save_aged_report: { Args: { p_company: string; p_side: string; p_as_of: string; p_buckets: string[]; p_totals: Json; p_findings: Json; p_filename: string; p_items: Json }; Returns: number };
      begin_payment_batch: { Args: { p_company: string; p_periods: string[]; p_filename?: string | null; p_report?: Json; p_source?: "file" | "ledger" }; Returns: string };
      add_payment_lines: { Args: { p_batch: string; p_lines: Json }; Returns: number };
      payments_summary: { Args: { p_company: string }; Returns: Json };
      summary_state: { Args: { p_company: string; p_kind: string; p_have?: number | null }; Returns: Json };
      odoo_audit_log: { Args: { p_company: string; p_action: string; p_ok: boolean; p_detail?: string | null; p_rows?: number | null }; Returns: undefined };
      odoo_claim_sync: { Args: { p_company: string }; Returns: boolean };
      odoo_save: { Args: { p_company: string; p_url: string; p_db: string; p_login: string; p_key_enc: string | null; p_odoo_company_id: number; p_odoo_company_name: string; p_include_branches: boolean; p_months: number; p_version: string; p_key_expires_on: string | null }; Returns: undefined };
      leave_organisation: { Args: { p_org: string }; Returns: undefined };
      delete_organisation: { Args: { p_org: string; p_name: string }; Returns: undefined };
      delete_my_account: { Args: { p_email: string }; Returns: undefined };
      begin_sales_batch: { Args: { p_company: string; p_source: string; p_periods: string[]; p_filename?: string; p_report?: Json; p_all?: boolean }; Returns: string };
      add_sales_lines: { Args: { p_batch: string; p_lines: Json }; Returns: number };
      sales_summary: { Args: { p_company: string }; Returns: Json };
      end_user_summary: { Args: { p_company: string }; Returns: Json };
      save_agency_statement: { Args: { p_company: string; p_filename: string; p_sheets: string[]; p_report: Json; p_lines: Json }; Returns: number };
      remove_agency_statement: { Args: { p_company: string }; Returns: undefined };
      data_reset_preview: { Args: { p_company: string }; Returns: Json };
      clear_company_data: { Args: { p_company: string; p_scope: string; p_confirm: number }; Returns: Json };
      delete_company: { Args: { p_company: string; p_name: string }; Returns: Json };
      note_files_left: { Args: { p_company: string; p_left: number }; Returns: undefined };
      get_published_sales: { Args: { p_token: string }; Returns: Json };
      begin_expense_batch: { Args: { p_company: string; p_source: string; p_periods: string[]; p_filename?: string; p_report?: Json; p_all?: boolean }; Returns: string };
      line_months: { Args: { p_company: string; p_kind: string; p_source: string }; Returns: Json };
      simple_lines: { Args: { p_company: string }; Returns: Json };
      cash_entries_list: { Args: { p_company: string }; Returns: Json };
      cash_upload_begin: { Args: { p_company: string; p_filename: string; p_months: string[]; p_mode: string; p_skipped?: number; p_directions?: string[] }; Returns: string };
      cash_upload_add: { Args: { p_upload: string; p_entries: Json }; Returns: number };
      cash_upload_finish: { Args: { p_upload: string }; Returns: Json };
      cash_upload_remove: { Args: { p_upload: string }; Returns: number };
      cash_entry_add: { Args: { p_company: string; p_entry: Json }; Returns: number };
      cash_entry_update: { Args: { p_id: number; p_entry: Json }; Returns: undefined };
      cash_entry_delete: { Args: { p_id: number }; Returns: undefined };
      cash_entries_clear: { Args: { p_company: string }; Returns: number };
      cash_to_full: { Args: { p_company: string }; Returns: Json };
      cash_from_full: { Args: { p_company: string }; Returns: number };
      add_line: { Args: { p_company: string; p_kind: string; p_line: Json }; Returns: number };
      update_line: { Args: { p_kind: string; p_id: number; p_line: Json }; Returns: undefined };
      delete_line: { Args: { p_kind: string; p_id: number }; Returns: undefined };
      stage_lines_begin: { Args: { p_company: string; p_kind: string; p_source: string; p_periods: string[]; p_filename?: string; p_report?: Json; p_all?: boolean }; Returns: string };
      stage_lines_add: { Args: { p_stage: string; p_lines: Json }; Returns: number };
      stage_lines_finish: { Args: { p_stage: string }; Returns: Json };
      stage_lines_cancel: { Args: { p_stage: string }; Returns: undefined };
      add_expense_lines: { Args: { p_batch: string; p_lines: Json }; Returns: number };
      expense_summary: { Args: { p_company: string }; Returns: Json };
      get_published_expenses: { Args: { p_token: string }; Returns: Json };
      ledger_line_totals: { Args: { p_company: string }; Returns: Json };
      begin_inventory_batch: { Args: { p_company: string; p_kind: string; p_periods: string[]; p_filename?: string; p_mode?: string; p_report?: Json }; Returns: string };
      add_stock_layers: { Args: { p_batch: string; p_rows: Json }; Returns: Json };
      add_stock_moves: { Args: { p_batch: string; p_rows: Json }; Returns: Json };
      finish_inventory_batch: { Args: { p_batch: string }; Returns: Json };
      set_stock_onhand: { Args: { p_batch: string; p_as_of: string; p_rows: Json }; Returns: number };
      set_inventory_products: { Args: { p_company: string; p_rows: Json }; Returns: number };
      inventory_summary: { Args: { p_company: string }; Returns: Json };
      begin_stock_ledger_batch: { Args: { p_company: string; p_periods: string[]; p_filename?: string }; Returns: string };
      add_stock_ledger_lines: { Args: { p_batch: string; p_lines: Json }; Returns: number };
      create_import_job: { Args: { p_company: string; p_kind: string; p_mode: string; p_files: Json; p_options?: Json }; Returns: Json };
      stage_import_rows: { Args: { p_file: string; p_rows: Json }; Returns: number };
      import_staged: { Args: { p_job: string }; Returns: Json };
      mark_import_file_stored: { Args: { p_file: string }; Returns: undefined };
      queue_import_job: { Args: { p_job: string; p_totals: Json }; Returns: undefined };
      act_on_import_job: { Args: { p_job: string; p_action: string }; Returns: undefined };
      save_import_template: { Args: { p_company: string; p_export: string; p_mapping: Json }; Returns: undefined };
    };
    Enums: { member_role: MemberRole };
    CompositeTypes: { [_ in never]: never };
  };
};
