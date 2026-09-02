/* Dark is the default, and only a person can change that.
 *
 * The rule this guards: a browser that has never been told which theme to use
 * gets DARK, whatever the operating system prefers. Light happens because
 * somebody pressed Light, or because they pressed Match system and their OS is
 * light. Nothing else turns the light palette on.
 *
 * It is worth a test because the failure is invisible to whoever causes it.
 * Change the default back to "system" and nothing breaks, no type complains,
 * and the app still looks right on the machine of the person who made the
 * change — it is only wrong for visitors whose laptop happens to be set to
 * light, which is most of them and none of us.
 *
 * The boot script is read out of src/app/theme.ts and executed as the real
 * string, not reimplemented here: a copy of the logic would pass while the
 * shipped one was broken, which is the one thing this must not do.
 */

import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/app/theme.ts", import.meta.url), "utf8");

const found = source.match(/THEME_BOOT_SCRIPT = `([\s\S]*?)`;/);
if (!found) {
  console.error("check:theme — THEME_BOOT_SCRIPT is not in src/app/theme.ts any more.");
  process.exit(1);
}

/* The one template hole in it is the storage key. Substituted rather than
   evaluated, so this stays a plain read of the file. */
const boot = found[1].replace(/\$\{JSON\.stringify\(\s*THEME_KEY,?\s*\)\}/, '"quickstark.theme"');

let failures = 0;

function check(name, got, want) {
  const ok = got === want;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${got}, wanted ${want}`}`);
}

/* Runs the shipped boot script against a browser we describe: what is in
   localStorage, and what the OS prefers. Returns the palette it painted. */
function painted(stored, osPrefersLight) {
  let attribute = null;
  const document = {
    documentElement: {
      setAttribute(name, value) {
        if (name === "data-theme") attribute = value;
      },
    },
  };
  const localStorage = { getItem: () => stored };
  const window = {
    matchMedia: (query) => ({
      matches: query.includes("light") ? osPrefersLight : !osPrefersLight,
    }),
  };

  new Function("document", "localStorage", "window", boot)(document, localStorage, window);
  return attribute === "light" ? "light" : "dark";
}

console.log("A browser that has never been told:");
check("an OS set to dark gets dark", painted(null, false), "dark");
check("an OS set to LIGHT still gets dark", painted(null, true), "dark");
check("an empty string is not a choice either", painted("", true), "dark");
check("a value that is not a theme is ignored", painted("banana", true), "dark");

console.log("A browser that has been told:");
check("Light, on a dark OS, is light", painted("light", false), "light");
check("Dark, on a light OS, is dark", painted("dark", true), "dark");
check("Match system follows a light OS", painted("system", true), "light");
check("Match system follows a dark OS", painted("system", false), "dark");

/* The provider's own fallback has to agree with the boot script's, or the page
   paints dark and then React corrects it to something else a frame later. */
console.log("The provider agrees with the boot script:");
check(
  'DEFAULT_THEME is "dark"',
  /export const DEFAULT_THEME: ThemeChoice = "dark";/.test(source) ? "yes" : "no",
  "yes",
);

const provider = readFileSync(
  new URL("../src/app/dashboard/components/ThemeProvider.tsx", import.meta.url),
  "utf8",
);
check(
  "ThemeProvider falls back to DEFAULT_THEME, not a literal",
  /isThemeChoice\(stored\) \? stored : DEFAULT_THEME/.test(provider) ? "yes" : "no",
  "yes",
);
check(
  "ThemeProvider starts on DEFAULT_THEME",
  /useState<ThemeChoice>\(DEFAULT_THEME\)/.test(provider) ? "yes" : "no",
  "yes",
);

console.log(failures ? `\n${failures} failed.` : "\nAll 11 passed.");
process.exit(failures ? 1 : 0);
