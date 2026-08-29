import type { Metadata } from "next";

import LegalPage, { Clause, L, Points } from "@/components/legal/LegalPage";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What QuickStark.Ai collects, why, who else processes it, where it is stored, and the rights you have over it.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro="What we collect, why we process it, who else touches it, and what you can ask us to do with it."
    >
      <Clause n={1} title="Who controls your data">
        <p>
          <L k="entity" name="legal entity name" />, <L k="address" name="registered address" />, is the
          controller of the personal data described here. Contact us about privacy at{" "}
          <L k="privacyEmail" name="privacy email" />.
        </p>
        <p>
          This policy covers the QuickStark.Ai service. It does not cover applications that other people
          build and publish with QuickStark — for those, the person who built the application is the
          controller, and their own policy applies.
        </p>
      </Clause>

      <Clause n={2} title="What we collect">
        <Points
          items={[
            <><strong className="text-white">Account</strong> — email address or phone number, display name, avatar image, and which sign-in provider you used.</>,
            <><strong className="text-white">Projects</strong> — project names, the descriptions and prompts you write, generated code, and project status.</>,
            <><strong className="text-white">Usage and credits</strong> — your credit balance and a ledger of every credit movement: the action, the amount, when it happened, and which project it belonged to.</>,
            <><strong className="text-white">Connections</strong> — details of integrations you configure, including server names, URLs and access keys.</>,
            <><strong className="text-white">Billing</strong> — plan, subscription status and payment history. Card details are held by our payment processor, not by us.</>,
            <><strong className="text-white">Support</strong> — messages you send us through in-product chat or email.</>,
            <><strong className="text-white">Technical</strong> — IP address, browser and device information, and server logs.</>,
          ]}
        />
        <p>
          We do not ask for special category data — health, biometrics, political opinions and the like —
          and you should not put it into prompts or project descriptions.
        </p>
      </Clause>

      <Clause n={3} title="Why we process it">
        <Points
          items={[
            "Creating your account and signing you in — to perform our contract with you.",
            "Generating, previewing and publishing your applications — to perform our contract with you.",
            "Metering credits, enforcing plan limits and taking payment — to perform our contract with you.",
            "Keeping records for tax and accounting — because the law requires it.",
            "Preventing abuse, fraud and multiple-account credit farming — our legitimate interest in running the service sustainably.",
            "Security monitoring and debugging — our legitimate interest in keeping the service safe.",
            "Product emails you have asked for — with your consent, withdrawable at any time.",
          ]}
        />
        <p>
          We do not sell personal data, and we do not use it for advertising or share it with advertisers.
        </p>
      </Clause>

      <Clause n={4} title="Prompts and generated code">
        <p>
          To generate an application we send your description, and relevant context from your project, to{" "}
          <L k="aiProvider" name="AI model provider" />. That provider processes it to produce the output
          and returns it to us.
        </p>
        <p>
          Your prompts and generated code are stored against your account so you can return to a project.
          They are visible to you, and to our staff only where necessary to operate the service, investigate
          a support request you have raised, or respond to a security or abuse issue.
        </p>
      </Clause>

      <Clause n={5} title="Who else processes it">
        <Points
          items={[
            <><strong className="text-white">Supabase</strong> — database and authentication. Sees account, project, credit and connection data.</>,
            <><strong className="text-white">Vercel</strong> — hosting and deployment. Sees technical and log data, and published project code.</>,
            <><strong className="text-white"><L k="aiProvider" name="AI model provider" /></strong> — code generation. Sees prompts and project context.</>,
            <><strong className="text-white">GitHub</strong> — repository creation when you publish, if you connect it. Sees generated code.</>,
            <><strong className="text-white">Google, Apple and Facebook</strong> — sign-in, if you choose it. See your email address and basic profile.</>,
            <><strong className="text-white"><L k="paymentProvider" name="payment provider" /></strong> — payments and subscriptions. Sees billing details and payment history.</>,
          ]}
        />
        <p>
          We may also disclose data where the law requires it, or to establish or defend legal claims. If
          the business is sold or merged, data may transfer with it, and we will tell you before that happens.
        </p>
      </Clause>

      <Clause n={6} title="Where it is stored">
        <p>
          Our database and authentication run in the European Union. Some processors listed above operate
          outside the EU and the UK, so data may be transferred there. Where it is, those transfers rely on
          the European Commission’s Standard Contractual Clauses or an adequacy decision.
        </p>
      </Clause>

      <Clause n={7} title="How long we keep it">
        <Points
          items={[
            <>Account and project data — while your account is open, and for {LEGAL.deletionDays} days after you close it.</>,
            <>Credit ledger and billing records — {LEGAL.billingYears} years, because tax and accounting law requires it.</>,
            "Support messages — two years.",
            "Server logs — 90 days.",
            "Abuse records — as long as needed to stop the abuse recurring.",
          ]}
        />
      </Clause>

      <Clause n={8} title="How it is protected">
        <p>
          Data is encrypted in transit and at rest. Every table in our database enforces row-level security,
          so one account’s records are not readable by another. Credit balances cannot be written from a
          browser at all — only the server can move credits, and every movement is recorded in an
          append-only ledger.
        </p>
        <p>
          Access keys you store for integrations are write-only: they can be set and replaced but never read
          back, including by you.
        </p>
        <p>
          No system is perfectly secure. If a breach affects your personal data and is likely to result in a
          risk to your rights, we will notify the relevant supervisory authority within 72 hours and tell
          you without undue delay where the law requires it.
        </p>
      </Clause>

      <Clause n={9} title="Your rights">
        <p>
          Depending on where you live, you can ask us to give you a copy of your data, correct it, delete
          it, restrict or object to how we use it, give it to you in a portable format, or withdraw consent
          where consent is the basis.
        </p>
        <p>
          Ask at <L k="privacyEmail" name="privacy email" />. We will respond within one month. There is no
          charge unless a request is manifestly unfounded or excessive.
        </p>
        <p>
          If you are unhappy with how we handled it, you can complain to your local data protection
          authority. If you are in California, you also have rights under the CCPA and CPRA, including to
          know, delete and correct, and not to be discriminated against for exercising them. We do not sell
          or share personal information as those terms are defined there.
        </p>
      </Clause>

      <Clause n={10} title="Cookies">
        <p>
          We set cookies that are strictly necessary to run the service — principally to keep you signed in
          and to keep your session secure. These do not require consent, and we do not use advertising
          cookies.
        </p>
      </Clause>

      <Clause n={11} title="Children">
        <p>
          The service is not for children under {LEGAL.minimumAge}. We do not knowingly collect their data,
          and if we learn we have, we will delete it. If you believe a child has given us data, contact{" "}
          <L k="privacyEmail" name="privacy email" />.
        </p>
      </Clause>

      <Clause n={12} title="Changes and contact">
        <p>
          We will post any change here and update the date at the top. For material changes we will tell you
          by email or in the product before they take effect.
        </p>
        <p>
          Questions, requests and complaints: <L k="privacyEmail" name="privacy email" />, or write to{" "}
          <L k="address" name="registered address" />.
        </p>
      </Clause>
    </LegalPage>
  );
}
