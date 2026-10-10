import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/shell/legal-page";
import { APP_NAME } from "@/lib/brand";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = { title: "Terms of use", description: `The terms for using ${APP_NAME}.` };

export default function TermsPage() {
  const mail = <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>;
  return (
    <LegalPage title="Terms of use">
      <p className="mt-6">
        These terms are an agreement between you (and the organisation you act for) and {LEGAL.entity}, the operator of {APP_NAME}. By creating an account or using the service you accept them.
        Our <Link href="/privacy">privacy policy</Link> explains how we handle data.
      </p>

      <h2>A free beta</h2>
      <p>
        {APP_NAME} is offered free of charge as a beta. Features may change, be limited or be withdrawn, and the service may sometimes be unavailable. We will give reasonable notice before
        introducing paid plans, and nothing you have created will be charged for without your agreement.
      </p>

      <h2>Not professional advice</h2>
      <p>
        The service organises and analyses the financial data you provide. Its results, KPIs, forecasts and commentary (including text written by AI) are for information and can be wrong or incomplete,
        especially when the source data is. They are not accounting, audit, tax, legal or investment advice. Check important figures against your books and consult a qualified professional before relying on them.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>You must be at least 18 and able to act for the organisation you register.</li>
        <li>Keep your password safe and tell us at once if you think your account has been misused. You are responsible for activity under your account.</li>
        <li>Organisation admins decide who can see and change their organisation&apos;s companies.</li>
      </ul>

      <h2>Your data</h2>
      <ul>
        <li>You keep all rights to the data you upload or connect. You give us permission to store and process it only to provide the service to you.</li>
        <li>You confirm you are allowed to share the data with us, including any personal data of third parties it contains.</li>
        <li>You can download or delete your data at any time from the app.</li>
      </ul>

      <h2>Acceptable use</h2>
      <p>Do not:</p>
      <ul>
        <li>break the law, or upload data you have no right to use;</li>
        <li>try to access other organisations&apos; data, probe or attack the service, or get round its limits;</li>
        <li>overload the service, scrape it, or resell it without our written agreement.</li>
      </ul>
      <p>We may suspend accounts that break these rules, telling you why unless the law or security prevents it.</p>

      <h2>Liability</h2>
      <p>
        The service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. To the extent Egyptian law allows, we are not liable for indirect or consequential loss, lost profits,
        or decisions made using the service, and our total liability for any claim is limited to EGP 1,000 while the service is free. Nothing in these terms limits liability that cannot be limited by law,
        such as for fraud or gross negligence.
      </p>

      <h2>Ending the agreement</h2>
      <p>
        You can stop at any time by deleting your account (Account → Delete account). We may end the service or your access with 30 days&apos; notice, or immediately for serious breach of these terms;
        where possible we will give you time to download your data.
      </p>

      <h2>Changes</h2>
      <p>We may update these terms. If a change matters, we will tell signed-in users before it takes effect; continuing to use the service after that means you accept the new terms.</p>

      <h2>Law and disputes</h2>
      <p>These terms are governed by the laws of the Arab Republic of Egypt. Disputes go to the competent courts of Cairo, after we have both tried in good faith to settle them by talking to each other.</p>

      <h2>Contact</h2>
      <p>{LEGAL.entity}, operator of {APP_NAME}: {mail}.</p>
    </LegalPage>
  );
}
