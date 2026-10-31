/**
 * FR-3.1.2 (client-side, browser-only): EXIF-rotation correction and
 * downscale to the model's effective resolution ceiling. Perspective
 * de-skew (the optional third piece of FR-3.1.2) needs real document-edge
 * detection and is deferred past this pass.
 *
 * `createImageBitmap({ imageOrientation: "from-image" })` applies the EXIF
 * orientation tag natively, which is simpler and more robust than parsing
 * EXIF bytes by hand.
 */
const MAX_DIMENSION = 1568; // Anthropic's documented long-edge sweet spot for vision input
const JPEG_QUALITY = 0.85;

export async function preprocessImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context is not available");
    ctx.drawImage(bitmap, 0, 0, width, height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Failed to encode image"))),
        "image/jpeg",
        JPEG_QUALITY,
      );
    });
  } finally {
    bitmap.close();
  }
}
