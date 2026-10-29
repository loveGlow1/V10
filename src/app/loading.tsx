import { LoadingScreen } from "./StatusScreen";

/* While a page's server work is in flight — the first visit, a reload on a
   slow network, a sign-in landing on the dashboard — this is what is on screen
   instead of a half-drawn page. It fades in after a beat, so a fast load never
   flashes it. */
export default function Loading() {
  return <LoadingScreen />;
}
