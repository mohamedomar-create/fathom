# Security and tenancy

- **Isolation:** row-level security on every table; every company table checks access through `private.company_can`
  (0057/0058), which applies the person's organisation role or their role in that company. Tenant guard triggers stop a
  row moving between companies (0038). CI fails if a migration adds a company check that asks only the organisation.
- **Roles:** owner, admin, editor, viewer per organisation; editor, viewer or no access per company, set by an admin,
  audited. Admins are never limited.
- **Sign-in:** two-step sign-in required for admins (7-day grace), fresh password for destructive actions, 30-minute idle
  sign-out, password change needs the current password and signs out other devices.
- **Data:** private storage bucket; Odoo keys encrypted with rotation; rate limits in the database; audit tables for
  organisation, data resets, Odoo actions; 14-day undo for deleted companies and organisations.
- **AI:** used only on request; figures it writes are checked against the facts it was given; usage and budget recorded.
- **Repository:** public; real company data never committed (guard scan before every push).
