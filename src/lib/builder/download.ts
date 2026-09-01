/* Asking for the file.
 *
 * Someone typed "Semd me à download file" into a workspace whose page had been
 * built forty minutes earlier, and was told: "I can only speak to what's on
 * this page — I don't have a way to package or hand over files." Which was
 * false. The route serves the page as a download, the preview header has had a
 * button for it since it was built, and the answer was written by a model that
 * had been told its only subject is the page in front of it.
 *
 * A request for the file is not a question about the page, so it does not go to
 * the model at all. It is recognised here, answered with the address, and costs
 * nothing — there is no call to bill for.
 *
 * The bar is high on purpose, in one direction. "Add a download button" is an
 * edit to the page and must stay one; handing someone the file when they asked
 * for a button is a worse failure than the one this fixes, because the page is
 * what they were changing.
 */

/* The thing itself. "download" is decisive on its own — nobody types it about a
   page they are editing without also naming what to put it on, which the guard
   below catches. */
const DOWNLOAD = /\bdownloads?(ed|ing|able)?\b/i;

/* Asking for it in other words. Each needs the object as well as the verb:
   "send me" alone is not a request for a file, and "export" alone is a word
   people use about data on the page. */
const HAND_OVER =
  /\b(send|give|share|hand|email|mail|get|have|grab|save|export|package|zip)\b[^.?!]{0,40}\b(file|files|html|code|source|copy|page|site|build|zip|export)\b/i;

/* The whole thing, named by pronoun. "zip it up", "package this for me" — the
   object is the page and there is no noun to match on. */
const BUNDLE_IT = /\b(zip|package|bundle|export)\s+(it|this|that|the\s+(page|site|app|thing))\b/i;

/* The other way round: "can I have a copy of the file", "is there a file I can
   take", "the html please". */
const THE_FILE =
  /\b(a|the|my)\s+(html|source|code)\b|\b(copy|file|zip)\s+of\s+(the|this|my)\b|\bhtml\s+(file|please)\b/i;

/* What a message is about when it names one of these. A page can have a
   download button on it, and asking for one is an edit — the page is the
   subject, not the file. */
const ON_THE_PAGE = /\b(button|link|icon|section|form|field|cta|banner|menu|nav|footer|header)\b/i;

/* The verbs that put something on a page. Paired with the nouns above, they
   turn "add a download button" back into the edit it is. */
const PUTS_IT_THERE =
  /\b(add|make|create|put|place|insert|include|change|move|remove|delete|style|colou?r|rename|resize|swap|replace)\b/i;

/**
 * Whether this message is asking for the built page as a file.
 *
 * False for anything that reads as a change to the page, including a change
 * about downloading — that is the one mistake worth being careful about here.
 */
export function wantsDownload(message: string): boolean {
  const text = message.trim();
  if (!text) return false;

  /* An instruction about a thing on the page, whatever words it uses. */
  if (PUTS_IT_THERE.test(text) && ON_THE_PAGE.test(text)) return false;

  return (
    DOWNLOAD.test(text) || HAND_OVER.test(text) || BUNDLE_IT.test(text) || THE_FILE.test(text)
  );
}
