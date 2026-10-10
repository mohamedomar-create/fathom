import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/shell/legal-page";
import { APP_NAME } from "@/lib/brand";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = { title: "Privacy policy", description: `How ${APP_NAME} collects, uses and protects your data.` };

export default function PrivacyPage() {
  const mail = <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>;
  return (
    <LegalPage title="Privacy policy">
      <h2>Who we are</h2>
      <p>
        {APP_NAME} is a financial analysis service operated by {LEGAL.entity} (&ldquo;we&rdquo;). We are the controller of the personal data described here,
        within the meaning of Egypt&apos;s Personal Data Protection Law No. 151 of 2020. Questions or requests: {mail}.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Account details:</strong> your name, email address, a securely hashed password, the organisations you belong to and your role in each.</li>
        <li><strong>Financial data you provide:</strong> files you upload (for example general ledger, trial balance and profit and loss exports) or data read from your Odoo database when you connect it, plus settings, targets, commentary and reports you create. This can include names of customers, suppliers or staff that appear in account names or notes.</li>
        <li><strong>Odoo credentials:</strong> the address, database, login and API key you enter. The API key is encrypted before it is stored and is never shown again or included in exports.</li>
        <li><strong>Technical data:</strong> your IP address and request details in server logs and, for abuse protection, in rate-limit records kept for up to 8 days.</li>
        <li><strong>Cookies:</strong> only the essential cookies that keep you signed in. We use no advertising or analytics cookies.</li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To provide the service: read and organise your financial data, calculate analysis and KPIs, and produce reports you choose to share.</li>
        <li>To run your account: sign-in, password reset, invitations from colleagues and service emails.</li>
        <li>To keep the service secure and reliable: preventing abuse, investigating errors and keeping logs.</li>
      </ul>
      <p>
        We process your data to perform our agreement with you (these purposes) and, where the law requires it, with your consent, which you give when you create an account and can withdraw by deleting it.
        We do not sell your data, use it for advertising, or use your financial data to train AI models.
      </p>

      <h2>AI commentary</h2>
      <p>
        When someone in your organisation asks for AI-written commentary, the figures and business context needed for that commentary are sent to Anthropic, our AI provider, to generate the text.
        Anthropic processes it on our behalf and does not use it to train its models. Nothing is sent to the AI provider unless a user asks for commentary.
      </p>

      <h2>Who processes data for us</h2>
      <ul>
        <li><strong>Supabase</strong>: database and sign-in. Data is stored in {LEGAL.dataRegion}.</li>
        <li><strong>Vercel</strong>: hosting of the application.</li>
        <li><strong>Anthropic</strong>: AI commentary, only when requested.</li>
        <li><strong>Email delivery</strong>: the provider that sends sign-in and invitation emails.</li>
      </ul>
      <p>
        These providers act on our instructions under contracts that require them to protect the data. Because they operate outside Egypt, your data is transferred to and stored outside Egypt,
        in countries with data protection rules at least comparable to Law 151/2020 (in particular the European Union). By using the service you agree to this transfer.
      </p>

      <h2>Who else can see your data</h2>
      <p>
        Members of your organisation see its companies according to the role an admin gives them. A report becomes visible to anyone with its link only when you publish it,
        and you can stop sharing or set the link to expire at any time. We disclose data to authorities only when Egyptian law requires it.
      </p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Your account and financial data are kept while your account is open.</li>
        <li>Deleting a company, an organisation or your account removes that data from our database immediately. Encrypted backups held by our database provider are overwritten on their normal cycle, within 30 days.</li>
        <li>Server logs and rate-limit records are kept for a short time (rate-limit records up to 8 days).</li>
      </ul>

      <h2>Your rights</h2>
      <p>Under Law 151/2020 you can:</p>
      <ul>
        <li><strong>Access and portability:</strong> download your personal data from <Link href="/account">Account</Link> → Your data, and each company&apos;s data from its settings → Profile.</li>
        <li><strong>Correction:</strong> change your name and password on the Account page, and edit company data at any time.</li>
        <li><strong>Deletion:</strong> delete companies, organisations or your whole account yourself, from the app.</li>
        <li><strong>Objection and withdrawal of consent:</strong> stop using the service and delete your account, or write to us.</li>
      </ul>
      <p>For anything you cannot do in the app, email {mail}. We answer within 30 days. You may also complain to Egypt&apos;s Personal Data Protection Centre.</p>

      <h2>Security</h2>
      <p>
        Data is encrypted in transit and at rest. Access is restricted by organisation and role, Odoo API keys are encrypted with a separate key, and every company&apos;s data is isolated in the database.
        No system is perfectly secure; if a breach affects your personal data, we will inform you and the authorities as the law requires.
      </p>

      <h2>Children</h2>
      <p>The service is for businesses and is not intended for anyone under 18.</p>

      <h2>Changes</h2>
      <p>If we change this policy in a way that matters, we will tell signed-in users before the change takes effect. The date at the top shows the latest version.</p>

      <h2>Contact</h2>
      <p>{LEGAL.entity}, operator of {APP_NAME}: {mail}.</p>
    </LegalPage>
  );
}
