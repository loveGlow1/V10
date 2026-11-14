import { redirect } from "next/navigation";

/* Analytics was a page of placeholder cards ("TODO: connect live warehouse")
   that anyone could reach from the footer. Until it has real numbers, the
   address leads back to the dashboard rather than to a page of dashes. */
export default function AnalyticsPage() {
  redirect("/dashboard");
}
