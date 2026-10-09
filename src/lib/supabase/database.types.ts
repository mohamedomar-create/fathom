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
  confidence: number | null; mapped_by: string; sort_order: number;
}
export type AccountBalanceRow = { account_id: string; company_id: string; period: string; amount: number }
export type ImportRow = { id: string; company_id: string; kind: string; filename: string | null; status: string; report: Json; created_by: string | null; created_at: string }
export type OdooConnectionRow = {
  company_id: string; url: string; db: string; login: string; api_key_enc: string; odoo_company_id: number | null; odoo_company_name: string | null;
  include_branches: boolean; months_history: number; version: string | null; status: string; last_error: string | null; last_sync_at: string | null; updated_at: string;
}
export type CommentaryRow = { company_id: string; period_key: string; section: string; body: string; source: string; updated_by: string | null; updated_at: string }
export type ReportRow = {
  id: string; company_id: string; title: string; period_type: string; period_end: string; sections: Json; status: string; share_token: string | null;
  published_at: string | null; created_by: string | null; created_at: string; updated_at: string;
}

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
      commentary: Table<CommentaryRow, "company_id" | "period_key" | "section" | "body">;
      reports: Table<ReportRow, "company_id" | "period_end">;
    };
    Views: { [_ in never]: never };
    Functions: {
      accept_pending_invites: { Args: Record<string, never>; Returns: number };
      get_published_report: { Args: { p_token: string }; Returns: Json };
      reclassify_accounts: { Args: { p_company: string; p_changes: Json }; Returns: number };
      replace_company_data: { Args: { p_company: string; p_accounts: Json; p_import?: Json; p_notes?: Json }; Returns: number };
    };
    Enums: { member_role: MemberRole };
    CompositeTypes: { [_ in never]: never };
  };
};
