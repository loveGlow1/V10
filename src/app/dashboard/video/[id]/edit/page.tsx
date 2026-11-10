"use client";

/* The visual editor for one video (components/video/VideoEditor.tsx). */

import { use } from "react";

import VideoEditor from "../../../components/video/VideoEditor";

export default function VideoEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <VideoEditor id={id} />;
}
