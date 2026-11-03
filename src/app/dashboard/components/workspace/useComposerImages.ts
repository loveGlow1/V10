"use client";

import { useEffect, useState } from "react";

import { COMPOSER_IMAGES_EVENT, composerImagesFor, type ComposerImage } from "./visual-ask";

/** The pictures the composer is holding for this project, kept current. */
export function useComposerImages(projectId: string | null | undefined): ComposerImage[] {
  const [images, setImages] = useState<ComposerImage[]>(() => composerImagesFor(projectId));
  useEffect(() => {
    setImages(composerImagesFor(projectId));
    const onChange = (event: Event) => {
      if ((event as CustomEvent<{ projectId: string }>).detail?.projectId === projectId) setImages(composerImagesFor(projectId));
    };
    window.addEventListener(COMPOSER_IMAGES_EVENT, onChange);
    return () => window.removeEventListener(COMPOSER_IMAGES_EVENT, onChange);
  }, [projectId]);
  return images;
}
