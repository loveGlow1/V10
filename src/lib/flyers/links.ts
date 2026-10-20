/* Where a flier image lives on this app — a stable address the thread can
   keep, served to its owner by /api/flyers/[id]/file. Pure. */

/** A flier image on this app's own file route; with download, saved as a clean PNG. */
export const imageUrl = (origin: string, jobId: string, path: string, download = false) =>
  `${origin}/api/flyers/${jobId}/file?path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`;
