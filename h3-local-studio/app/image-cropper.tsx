"use client";

import { SyntheticEvent, useEffect, useMemo, useState } from "react";
import ReactCrop, { centerCrop, makeAspectCrop, type PercentCrop } from "react-image-crop";

/** A crop rectangle in the coordinates of the original, full-resolution image. */
export type CropRect = { x: number; y: number; width: number; height: number };

/**
 * Cuts `rect` out of `file` on a canvas and returns it as a new PNG file.
 * The file on disk is only read, never written, so the user's original image
 * stays untouched. PNG avoids a second lossy pass over an already-compressed
 * JPG.
 */
export async function cropImageFile(file: File, rect: CropRect) {
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Canvas 2D context unavailable");
  }
  context.drawImage(bitmap, Math.round(rect.x), Math.round(rect.y), width, height, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Canvas produced no image");
  return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}-crop.png`, { type: "image/png" });
}

export async function readImageDimensions(file: File) {
  const bitmap = await createImageBitmap(file);
  const dimensions = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return dimensions;
}

/**
 * Turns the percentage crop into original-image pixels. With a locked aspect the
 * height is derived from the width, so rounding in the percentages cannot drift
 * the result off the ratio the user was shown.
 */
function cropRectFor(crop: PercentCrop, size: { width: number; height: number }, aspect?: number): CropRect {
  const x = (crop.x / 100) * size.width;
  const y = (crop.y / 100) * size.height;
  const width = (crop.width / 100) * size.width;
  const height = aspect ? width / aspect : (crop.height / 100) * size.height;
  return { x, y, width: Math.min(width, size.width - x), height: Math.min(height, size.height - y) };
}

type ImageCropperProps = {
  file: File;
  title: string;
  hint: string;
  /** Locks the crop box to this ratio. Omit for a free crop. */
  aspect?: number;
  onCancel: () => void;
  onApply: (rect: CropRect) => void;
};

export function ImageCropper({ file, title, hint, aspect, onCancel, onApply }: ImageCropperProps) {
  const source = useMemo(() => URL.createObjectURL(file), [file]);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [crop, setCrop] = useState<PercentCrop | null>(null);

  useEffect(() => () => URL.revokeObjectURL(source), [source]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onCancel]);

  // The crop is held as percentages so it survives the preview being laid out
  // at a different size than the original image.
  function startCrop(event: SyntheticEvent<HTMLImageElement>) {
    const image = event.currentTarget;
    setSize({ width: image.naturalWidth, height: image.naturalHeight });
    const initial: PercentCrop = aspect
      ? makeAspectCrop({ unit: "%", width: 80 }, aspect, image.width, image.height)
      : { unit: "%", x: 0, y: 0, width: 80, height: 80 };
    setCrop(centerCrop(initial, image.width, image.height));
  }

  const rect: CropRect | null = crop && size && crop.width > 0 && crop.height > 0
    ? cropRectFor(crop, size, aspect)
    : null;

  return (
    <div className="crop-modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="crop-modal-panel">
        <header>
          <h3>{title}</h3>
          <p>{hint}</p>
        </header>
        <div className="crop-modal-canvas">
          <ReactCrop
            crop={crop ?? undefined}
            aspect={aspect}
            minWidth={24}
            minHeight={24}
            keepSelection
            onChange={(_, percentCrop) => setCrop(percentCrop)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={source} alt={title} onLoad={startCrop} />
          </ReactCrop>
        </div>
        <div className="crop-modal-actions">
          <span>
            {rect && size
              ? `原圖 ${size.width} × ${size.height} · 裁切後 ${Math.round(rect.width)} × ${Math.round(rect.height)}`
              : "正在讀取圖片…"}
          </span>
          <button type="button" onClick={onCancel}>取消</button>
          <button type="button" className="primary" disabled={!rect} onClick={() => rect && onApply(rect)}>
            套用裁切
          </button>
        </div>
      </div>
    </div>
  );
}
