const cloudName = () => (process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ?? "").trim();
const uploadPreset = () => (process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET ?? "").trim();

export function isCloudinaryConfigured(): boolean {
  return Boolean(cloudName() && uploadPreset());
}

interface CloudinaryUploadResponse {
  secure_url?: string;
  error?: { message?: string };
}

/** رفع مباشر وآمن نسبياً باستخدام unsigned upload preset مقيّد من Cloudinary. */
export async function uploadImageToCloudinary(file: File): Promise<string> {
  if (!isCloudinaryConfigured()) throw new Error("إعدادات Cloudinary غير موجودة");
  if (!file.type.startsWith("image/")) throw new Error("الملف لازم يكون صورة");
  if (file.size > 5 * 1024 * 1024) throw new Error("حجم الملف كبير جداً (الحد 5MB)");

  const body = new FormData();
  body.append("file", file);
  body.append("upload_preset", uploadPreset());

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName())}/image/upload`,
      { method: "POST", body, signal: controller.signal },
    );
    const payload = (await response.json()) as CloudinaryUploadResponse;
    if (!response.ok || !payload.secure_url) {
      throw new Error(payload.error?.message || "تعذّر رفع الصورة إلى Cloudinary");
    }
    return payload.secure_url;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("رفع الصورة استغرق وقتاً طويلاً — حاول مرة أخرى");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}
