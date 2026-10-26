import Link from "next/link";
import { redirect } from "next/navigation";
import { AppBar } from "@/components/shell/app-bar";
import { getUser } from "@/lib/supabase/server";
import { getDict } from "@/lib/i18n/server";
import { DeleteAccount, LeaveOrg, NameForm, PasswordForm, type OrgInfo } from "./account-forms";
import { MfaSetup } from "./mfa-setup";

export async function generateMetadata() { return { title: (await getDict()).account.title }; }

export default async function AccountPage() {
  const { supabase, user } = await getUser();
  if (!user) redirect("/login?next=/account");
  const [{ data: profile }, { data: mine }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    supabase.from("memberships").select("org_id, role, organizations(name)").eq("user_id", user.id).order("created_at"),
  ]);
  const ids = (mine ?? []).map((m) => m.org_id);
  const { data: all } = ids.length ? await supabase.from("memberships").select("org_id, user_id, role").in("org_id", ids) : { data: [] };
  const orgs: OrgInfo[] = (mine ?? []).map((m) => {
    const rows = (all ?? []).filter((r) => r.org_id === m.org_id);
    return {
      id: m.org_id,
      role: m.role,
      name: (m.organizations as unknown as { name: string } | null)?.name ?? "Organisation",
      members: rows.length,
      otherAdmins: rows.filter((r) => r.role === "admin" && r.user_id !== user.id).length,
    };
  });
  const dict = await getDict();
  const d = dict.account;
  const email = user.email ?? "";
  const section = "rounded-lg border border-line bg-white p-5";

  return (
    <>
      <AppBar email={email} orgName={orgs[0]?.name} isAdmin={orgs.some((o) => o.role === "admin")} />
      <main className="mx-auto max-w-3xl space-y-6 px-4 pb-20 pt-8 sm:px-8">
        <div>
          <Link href="/companies" className="text-sm text-mute hover:text-ink">{d.myCompanies}</Link>
          <h1 className="mt-2 text-3xl font-light">{d.yourAccount}</h1>
        </div>

        <section className={section}>
          <h2 className="mb-4 text-lg font-light">{d.profile}</h2>
          <div className="mb-4"><span className="label mb-1 block">{d.email}</span><span data-testid="account-email">{email}</span></div>
          <NameForm initial={profile?.full_name ?? ""} />
        </section>

        <section className={section}>
          <h2 className="mb-4 text-lg font-light">{d.password}</h2>
          <PasswordForm />
        </section>

        <section className={section} id="security">
          <h2 className="mb-4 text-lg font-light">{dict.access.mfaTitle}</h2>
          <MfaSetup />
        </section>

        <section className={section}>
          <h2 className="mb-1 text-lg font-light">{d.orgs}</h2>
          <p className="mb-4 text-sm text-mute">{d.orgsHelp}</p>
          <ul className="divide-y divide-line">
            {orgs.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">{o.name}</div>
                  <div className="text-xs text-mute"><span className="uppercase">{d.roles[o.role as "admin"] ?? o.role}</span> · {d.members(o.members)}</div>
                </div>
                {o.members === 1
                  ? <span className="text-xs text-mute">{o.role === "admin" ? d.onlyMemberAdmin : d.onlyMember}</span>
                  : o.role === "admin" && o.otherAdmins === 0
                    ? <span className="text-xs text-mute">{d.onlyAdmin}</span>
                    : <LeaveOrg org={o} />}
              </li>
            ))}
          </ul>
        </section>

        <section className={section}>
          <h2 className="mb-1 text-lg font-light">{d.yourData}</h2>
          <p className="mb-3 text-sm text-mute">
            {d.yourDataHelp[0]}<Link href="/privacy" className="underline">{d.yourDataHelp[1]}</Link>{d.yourDataHelp[2]}
          </p>
          <a href="/api/export/me" download className="inline-block rounded border border-line px-4 py-2 text-sm hover:bg-band" data-testid="export-me">{d.downloadMe}</a>
        </section>

        <section className="rounded-lg border border-red/30 bg-white p-5">
          <h2 className="mb-1 text-lg font-light text-red">{d.deleteAccount}</h2>
          <DeleteAccount email={email} orgs={orgs} />
        </section>
      </main>
    </>
  );
}
