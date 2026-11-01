"use client";

import { useEffect, useRef, useState } from "react";
import { CrystalIcon } from "@/components/icons";

/**
 * A photo large, contained in the dark photo well (rocks come in every shape,
 * and cropping cuts off the specimen). A HEIC original a desktop browser
 * cannot draw falls back to Jasper's thumbnail, and to a placeholder before
 * Jasper has written one. The server-rendered <img> can fail before React is
 * listening (a HEIC on a desktop browser fails at once), so it is checked on
 * mount as well as on error. Key it by photo, so a new photo starts afresh.
 */
export function PhotoView({ url, thumbUrl, alt }: { url: string; thumbUrl: string; alt: string }) {
  const [src, setSrc] = useState(url);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  const onError = () => (src === url ? setSrc(thumbUrl) : setFailed(true));
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setSrc((s) => (s === url ? thumbUrl : s));
  }, [url, thumbUrl]);
  if (failed)
    return (
      <div className="flex flex-col items-center gap-2 text-surface">
        <CrystalIcon className="size-14 opacity-70" />
        <span>No preview on this device</span>
      </div>
    );
  // eslint-disable-next-line @next/next/no-img-element -- a photo from the data directory; next/image would re-encode it on the box
  return <img ref={ref} src={src} alt={alt} onError={onError} className="size-full object-contain" />;
}
