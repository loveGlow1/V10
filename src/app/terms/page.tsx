import type { Metadata } from "next";

import LegalPage, { Clause, L, Points } from "@/components/legal/LegalPage";
import { PUBLISH_COST, REDEPLOY_COST } from "@/app/dashboard/credits";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The agreement between you and QuickStark.Ai — accounts, credits, billing, what you own, and what you are responsible for.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      intro="These terms form the agreement between you and QuickStark.Ai. By creating an account or using the service, you accept them."
    >
      <Clause n={1} title="Who we are">
        <p>
          QuickStark.Ai (“QuickStark”, “we”, “us”) is operated by <L k="entity" name="legal entity name" />,
          registered in <L k="country" name="country of registration" /> at <L k="address" name="registered address" />.
          You can reach us at <L k="contactEmail" name="contact email" />.
        </p>
        <p>
          If you are accepting these terms on behalf of a company, you confirm you are authorised to bind it.
        </p>
      </Clause>

      <Clause n={2} title="Accounts">
        <p>
          You need an account to build anything. You can create one with an email address, a phone number,
          or a Google, GitHub, Apple or Facebook sign-in. You are responsible for keeping access to your
          account secure and for everything done through it.
        </p>
        <p>
          You must be at least {LEGAL.minimumAge} years old, or the minimum age of digital consent where
          you live, whichever is higher.
        </p>
      </Clause>

      <Clause n={3} title="What the service does">
        <p>
          You describe a product in plain language. QuickStark generates an application from that
          description — the interface, the backend, a database schema and a sign-in flow — and runs it in a
          private sandbox where you can iterate. Nothing is public until you choose to publish.
        </p>
        <p>
          When you publish, we take a snapshot of the generated code into a repository in your own GitHub
          account and deploy it. Published projects are served from a quickstark.tech subdomain, or from your
          own domain on plans that allow it.
        </p>
        <p>
          The service is generative. Output varies between runs, may contain errors, and is not guaranteed
          to be fit for any particular purpose. See clause 7.
        </p>
      </Clause>

      <Clause n={4} title="Credits">
        <p>
          Work on the platform is metered in credits. Credits are a unit of account for usage of our
          service — they are not money, have no cash value, and cannot be transferred between accounts or
          redeemed for cash.
        </p>
        <Points
          items={[
            "Chat and planning costs between nothing and one credit. Short exchanges are free.",
            "Code generation and file edits cost between half a credit and two and a half, depending on how much is written and how many files change.",
            `Taking a project live costs a flat ${PUBLISH_COST} credits. Deploying a change to a project that is already live costs ${REDEPLOY_COST}.`,
            "Runtime and database use is included, metered against your plan's limits rather than your credit balance.",
          ]}
        />
        <p>
          Credits are drawn from the bucket that expires soonest. Daily credits are granted each day and do
          not carry over. Monthly plan credits are granted each billing cycle; on paid plans, unused monthly
          credits roll over for one further cycle and then expire. Purchased top-up credits do not expire
          while your account is open, and are spent last.
        </p>
        <p>
          A new account receives a one-off welcome credit. Promotional credits may be withdrawn where an
          account is used to abuse the offer, including by creating multiple accounts to claim it repeatedly.
        </p>
        <p>
          We may change what an action costs. If a change materially increases what an existing paid plan
          costs to use, we will give at least {LEGAL.noticeDays} days’ notice first.
        </p>
      </Clause>

      <Clause n={5} title="Plans, billing and refunds">
        <p>
          The Free plan costs nothing and requires no card. Paid plans are billed monthly in advance at the
          price shown at checkout and renew automatically until cancelled. Top-up packs are one-off purchases.
        </p>
        <p>
          You can cancel at any time. Cancelling stops the next renewal; it does not refund the current
          period, and you keep access until that period ends. Unused monthly credits are forfeited when a
          subscription ends.
        </p>
        <p>
          Where you have a statutory right to cancel or to a refund — including consumer withdrawal rights
          in the EU and UK — that right applies, and nothing here limits it.
        </p>
        <p>
          Prices exclude VAT and sales tax unless stated. Payments are processed by{" "}
          <L k="paymentProvider" name="payment provider" />; we do not receive or store your full card details.
        </p>
      </Clause>

      <Clause n={6} title="Who owns what">
        <p>
          <strong className="text-ink">You own your inputs.</strong> The descriptions, prompts, text,
          images and data you supply remain yours.
        </p>
        <p>
          <strong className="text-ink">You own your output.</strong> As between you and us, you own the
          application code generated for you, and may use, modify, sell and distribute it without
          restriction or royalty.
        </p>
        <p>
          Because the same or a similar description may be given by other users, we do not warrant that
          generated output is unique, and similar output may be generated for others.
        </p>
        <p>
          <strong className="text-ink">We own the platform.</strong> The service itself — the interface,
          the generation system, our prompts, our name and marks — remains ours.
        </p>
        <p>
          You grant us a limited licence to store, process and display your inputs and outputs for the
          purpose of operating the service for you: running the generation, showing you the preview, and
          publishing when you ask. That licence goes no further — in particular, we do not use your
          prompts or your generated code to train or improve any model.
        </p>
      </Clause>

      <Clause n={7} title="Your responsibility for what you build">
        <p>
          Generated code is a starting point, not a finished, audited product. You are responsible for
          reviewing it before you rely on it, and in particular before you put it in front of other people
          or handle their data with it. That includes:
        </p>
        <Points
          items={[
            "checking the application's security, access rules and data handling;",
            "meeting your own legal obligations to your users — privacy law, consumer law, accessibility, and any rules specific to your industry;",
            "obtaining the rights to any content, data or third-party service you bring in;",
            "testing before launch, and keeping the application maintained afterwards.",
          ]}
        />
        <p>
          If your published application collects personal data from other people, you are the controller of
          that data and we are not.
        </p>
      </Clause>

      <Clause n={8} title="Acceptable use">
        <p>You may not use QuickStark to build, host or distribute anything that:</p>
        <Points
          items={[
            "breaks the law, or helps someone else break it;",
            "infringes someone's intellectual property, privacy or other rights;",
            "is malware, a phishing site or a scam, or is designed to gain unauthorised access to systems or accounts;",
            "sexualises children in any form;",
            "harasses or threatens people, incites violence, or promotes hatred against a protected group;",
            "deliberately impersonates a real person or organisation in order to deceive.",
          ]}
        />
        <p>You also may not:</p>
        <Points
          items={[
            "circumvent credit metering, plan limits or rate limits, including by creating multiple accounts;",
            "resell access to the service itself, or use it to build a competing generation service;",
            "probe or attack our infrastructure, or attempt to reach another account's data.",
          ]}
        />
        <p>
          We may suspend or remove content or accounts that breach this clause. Where a breach is not
          serious and can be fixed, we will normally tell you first and give you a chance to fix it.
        </p>
      </Clause>

      <Clause n={9} title="Publishing and third-party accounts">
        <p>
          Publishing connects your account to third-party services — at minimum a repository host and a
          deployment platform. Your use of those services is governed by their terms, not ours, and their
          availability and pricing are outside our control.
        </p>
        <p>
          When you authorise us to act on one of those accounts, you permit us to create repositories, push
          code and trigger deployments on your behalf for as long as the connection is in place. You can
          revoke it at any time.
        </p>
        <p>
          Applications published on a quickstark.tech subdomain are hosted by us and remain subject to
          clause 8. We may remove a published project that breaches it, and will tell you why.
        </p>
      </Clause>

      <Clause n={10} title="Availability">
        <p>
          We aim to keep the service running but do not promise it will be uninterrupted or error-free. We
          may change, suspend or discontinue features. Where a change materially reduces what a paid plan
          provides, we will give reasonable notice, and you may cancel and receive a pro-rata refund of the
          unused part of the period you paid for.
        </p>
        <p>
          We depend on third parties for hosting, databases, model access and payments. An outage in one of
          those may interrupt the service, and we are not liable for outages beyond our reasonable control.
        </p>
      </Clause>

      <Clause n={11} title="Ending the agreement">
        <p>
          You can close your account at any time. We can suspend or close an account for a serious or
          repeated breach of these terms, for non-payment, or where the law requires it.
        </p>
        <p>
          When an account closes, sandbox projects and unpublished work are deleted after{" "}
          {LEGAL.deletionDays} days and credits are forfeited. Applications already published to your own
          GitHub and deployment accounts are unaffected and remain yours. Export anything you want to keep
          before closing.
        </p>
      </Clause>

      <Clause n={12} title="Disclaimers and liability">
        <p>
          The service is provided “as is”. To the extent the law allows, we exclude implied warranties of
          merchantability, fitness for a particular purpose and non-infringement, and we do not warrant that
          generated output is accurate, secure, complete or fit for your purpose.
        </p>
        <p>
          To the extent the law allows, we are not liable for lost profits, lost revenue, lost data, or
          indirect or consequential loss. Our total liability in connection with these terms is limited to
          the amount you paid us in the {LEGAL.liabilityMonths} months before the claim.
        </p>
        <p>
          Nothing here limits liability that cannot be limited by law — including death or personal injury
          caused by negligence, fraud, and, for consumers, statutory rights.
        </p>
        <p>
          You will indemnify us against third-party claims arising from applications you build and publish,
          from your breach of clause 8, or from content you supply.
        </p>
      </Clause>

      <Clause n={13} title="Changes to these terms">
        <p>
          We may update these terms. For material changes we will give at least {LEGAL.noticeDays} days’
          notice by email or in the product before they take effect. Continuing to use the service after
          that means you accept the change; if you do not, you may cancel.
        </p>
      </Clause>

      <Clause n={14} title="Governing law">
        <p>
          These terms are governed by the law of <L k="jurisdiction" name="governing jurisdiction" />, whose
          courts have exclusive jurisdiction — except that if you are a consumer, you keep the protection of
          the mandatory law of the country you live in, and may bring proceedings there.
        </p>
      </Clause>
    </LegalPage>
  );
}
