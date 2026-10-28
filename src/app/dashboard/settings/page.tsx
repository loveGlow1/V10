import { redirect } from "next/navigation";

/* Settings live in the settings panel on Home. This address used to be a
   developer placeholder asking for the deployment's Stripe and Vercel secret
   keys — fields that went nowhere, and secrets no customer should ever be
   asked for. It now opens the real panel. */
export default function SettingsPage() {
  redirect("/dashboard?settings=account");
}
