const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_DIMENSION = 1400;
const MIN_QUALITY = 0.6;
const DEFAULT_IMAGE_MIME = "image/jpeg";
const DEFAULT_IMAGE_EXTENSION = "jpg";

export interface PreparedImageFile {
  file: File;
  mimeType: string;
  extension: string;
  originalName: string;
  originalSizeBytes: number;
  finalSizeBytes: number;
  originalWidth?: number;
  originalHeight?: number;
  finalWidth?: number;
  finalHeight?: number;
  wasCompressed: boolean;
}

function sanitizeExtension(ext?: string) {
  const cleaned = (ext || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (cleaned === "jpeg" || cleaned === "jpg") return "jpg";
  if (cleaned === "png") return "png";
  if (cleaned === "webp") return "webp";
  return DEFAULT_IMAGE_EXTENSION;
}

function inferMimeType(file: File, ext: string) {
  const rawMime = (file.type || "").toLowerCase();
  if (rawMime === "image/jpg") return "image/jpeg";
  if (rawMime === "image/heic" || rawMime === "image/heif") return DEFAULT_IMAGE_MIME;
  if (rawMime === "image/png" || rawMime === "image/jpeg" || rawMime === "image/webp") {
    return rawMime;
  }

  const safeExt = sanitizeExtension(ext);
  if (safeExt === "png") return "image/png";
  if (safeExt === "webp") return "image/webp";
  return DEFAULT_IMAGE_MIME;
}

function getExtensionForMime(mimeType: string) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return DEFAULT_IMAGE_EXTENSION;
}

function buildSafeFileName(originalName: string, extension: string) {
  const baseName = (originalName || "image").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/_+/g, "_");
  const trimmedBase = baseName.replace(/\.[^.]+$/, "") || "image";
  return `${trimmedBase}_${Date.now()}.${extension}`;
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("Failed to read image file"));
    reader.readAsDataURL(file);
  });
}

function loadImageFromDataUrl(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode image"));
    img.src = dataUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

export async function prepareImageForUpload(file: File): Promise<PreparedImageFile> {
  const originalName = file.name || "image";
  const originalExtension = sanitizeExtension(originalName.split(".").pop());
  const inferredMime = inferMimeType(file, originalExtension);
  const normalizedMime = inferredMime === "image/heic" || inferredMime === "image/heif" ? DEFAULT_IMAGE_MIME : inferredMime;
  const normalizedExtension = getExtensionForMime(normalizedMime);
  const safeName = buildSafeFileName(originalName, normalizedExtension);

  const originalSizeBytes = file.size;
  let finalFile = file;
  let finalMimeType = normalizedMime;
  let finalExtension = normalizedExtension;
  let finalWidth: number | undefined;
  let finalHeight: number | undefined;
  let wasCompressed = false;

  if (!file.type.startsWith("image/")) {
    throw new Error("Only image files are supported");
  }

  const dataUrl = await readAsDataUrl(file);
  const img = await loadImageFromDataUrl(dataUrl);
  const originalWidth = img.naturalWidth;
  const originalHeight = img.naturalHeight;
  finalWidth = originalWidth;
  finalHeight = originalHeight;

  const shouldResize = originalWidth > MAX_DIMENSION || originalHeight > MAX_DIMENSION || originalSizeBytes > MAX_IMAGE_BYTES;
  if (shouldResize || normalizedMime !== file.type.toLowerCase() || normalizedMime === DEFAULT_IMAGE_MIME) {
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, MAX_DIMENSION / Math.max(originalWidth, originalHeight));
    const targetWidth = Math.max(1, Math.round(originalWidth * scale));
    const targetHeight = Math.max(1, Math.round(originalHeight * scale));
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas is not available in this browser");
    }

    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
    finalWidth = targetWidth;
    finalHeight = targetHeight;

    const outputMime = normalizedMime === "image/png" ? "image/png" : "image/jpeg";
    let quality = 0.9;
    let blob: Blob | null = null;
    let attempts = 0;

    while (attempts < 6) {
      blob = await canvasToBlob(canvas, outputMime, quality);
      if (!blob) break;
      if (blob.size <= MAX_IMAGE_BYTES || quality <= MIN_QUALITY) break;
      quality -= 0.1;
      attempts += 1;
    }

    if (blob && blob.size < originalSizeBytes) {
      finalFile = new File([blob], safeName, { type: outputMime });
      finalMimeType = outputMime;
      finalExtension = getExtensionForMime(outputMime);
      wasCompressed = true;
    }
  }

  return {
    file: finalFile,
    mimeType: finalMimeType,
    extension: finalExtension,
    originalName,
    originalSizeBytes,
    finalSizeBytes: finalFile.size,
    originalWidth,
    originalHeight,
    finalWidth,
    finalHeight,
    wasCompressed,
  };
}
