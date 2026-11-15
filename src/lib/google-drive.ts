"use client";

/* Files from the person's Google Drive, through Google's own picker: they sign
 * in with Google (read-only access to the files they pick), choose files, and
 * each is downloaded here and handed to the composer like any other upload.
 * A Google Doc, Sheet or Slides file comes as a PDF.
 *
 * Switched on by three public settings, like the AI providers — nothing to
 * flip in the code:
 *   NEXT_PUBLIC_GOOGLE_CLIENT_ID   an OAuth client (Web application) whose
 *                                  authorised JavaScript origins include the site
 *   NEXT_PUBLIC_GOOGLE_API_KEY     an API key with the Google Picker API enabled
 *   NEXT_PUBLIC_GOOGLE_APP_ID      optional: the Cloud project number
 * Without the first two, the menu simply has no Google Drive entry. */

type PickerDoc = { id: string; name: string; mimeType: string; sizeBytes?: number };

declare global {
  interface Window {
    gapi?: { load: (name: string, callback: () => void) => void };
    google?: {
      accounts?: { oauth2: { initTokenClient: (config: Record<string, unknown>) => { requestAccessToken: (options?: Record<string, unknown>) => void } } };
      picker?: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    };
  }
}

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_API_KEY ?? "";
const APP_ID = process.env.NEXT_PUBLIC_GOOGLE_APP_ID ?? "";

/** Whether Google Drive can be offered on this deployment. */
export const driveReady = Boolean(CLIENT_ID && API_KEY);

/** The most taken from Drive at once, and the largest file. */
const MAX_FILES = 10;
const MAX_BYTES = 400 * 1024 * 1024;

let token: { value: string; until: number } | null = null;

function script(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const tag = document.createElement("script");
    tag.src = src;
    tag.async = true;
    tag.onload = () => resolve();
    tag.onerror = () => reject(new Error("Google Drive could not be reached."));
    document.head.appendChild(tag);
  });
}

async function ready(): Promise<void> {
  await Promise.all([script("https://apis.google.com/js/api.js"), script("https://accounts.google.com/gsi/client")]);
  if (!window.google?.picker) await new Promise<void>((resolve) => window.gapi!.load("picker", resolve));
}

function accessToken(): Promise<string> {
  if (token && token.until > Date.now() + 60_000) return Promise.resolve(token.value);
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts!.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: "https://www.googleapis.com/auth/drive.readonly",
      callback: (response: { access_token?: string; expires_in?: number; error?: string }) => {
        if (!response.access_token) return reject(new Error(response.error === "access_denied" ? "Google Drive was not allowed." : "Google sign-in did not finish."));
        token = { value: response.access_token, until: Date.now() + (response.expires_in ?? 3000) * 1000 };
        resolve(response.access_token);
      },
      error_callback: () => reject(new Error("Google sign-in was closed.")),
    });
    client.requestAccessToken({ prompt: token ? "" : "consent" });
  });
}

/* A Google-native file cannot be downloaded as it is: it is exported as a PDF. */
const NATIVE = /^application\/vnd\.google-apps\./;

async function download(doc: PickerDoc, bearer: string): Promise<File | null> {
  if (doc.sizeBytes && doc.sizeBytes > MAX_BYTES) return null;
  const native = NATIVE.test(doc.mimeType);
  const url = native
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(doc.id)}/export?mimeType=application/pdf`
    : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(doc.id)}?alt=media`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${bearer}` } });
  if (!response.ok) return null;
  const blob = await response.blob();
  const name = native && !/\.pdf$/i.test(doc.name) ? `${doc.name}.pdf` : doc.name;
  return new File([blob], name, { type: native ? "application/pdf" : doc.mimeType || blob.type });
}

/** Opens Google's picker and resolves with the files chosen, downloaded — an empty list if none. */
export async function pickFromDrive(options: { mimeTypes?: string } = {}): Promise<File[]> {
  if (!driveReady) throw new Error("Google Drive is not set up on this site yet.");
  await ready();
  const bearer = await accessToken();
  const picker = window.google!.picker!;
  const chosen = await new Promise<PickerDoc[]>((resolve) => {
    const view = new picker.DocsView(picker.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(false);
    if (options.mimeTypes) view.setMimeTypes(options.mimeTypes);
    const builder = new picker.PickerBuilder()
      .addView(view)
      .enableFeature(picker.Feature.MULTISELECT_ENABLED)
      .setOAuthToken(bearer)
      .setDeveloperKey(API_KEY)
      .setCallback((data: Record<string, any>) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        const action = data[picker.Response.ACTION];
        if (action === picker.Action.PICKED) {
          resolve(
            (data[picker.Response.DOCUMENTS] as Record<string, any>[]).slice(0, MAX_FILES).map((d) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
              id: d[picker.Document.ID],
              name: d[picker.Document.NAME],
              mimeType: d[picker.Document.MIME_TYPE],
              sizeBytes: Number(d.sizeBytes) || undefined,
            })),
          );
        } else if (action === picker.Action.CANCEL) resolve([]);
      });
    if (APP_ID) builder.setAppId(APP_ID);
    builder.build().setVisible(true);
  });
  const files = await Promise.all(chosen.map((doc) => download(doc, bearer).catch(() => null)));
  return files.filter((file): file is File => Boolean(file));
}

/** A picked list as a FileList, which the composers' upload takes. */
export function asFileList(files: File[]): FileList {
  const transfer = new DataTransfer();
  files.forEach((file) => transfer.items.add(file));
  return transfer.files;
}
