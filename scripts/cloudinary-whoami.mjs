#!/usr/bin/env node
/**
 * أداة تساعدك تعرف حساب Cloudinary اللي الصور بتاعتك متخزنة عليه.
 *
 * الفكرة: كل رابط صورة على Cloudinary جواه اسم الحساب (cloud name)،
 * وده المفتاح اللي تقدر تدوّر بيه وتتواصل بيه مع الدعم.
 *
 * الاستخدام:
 *   node scripts/cloudinary-whoami.mjs backup.json
 *   node scripts/cloudinary-whoami.mjs                 (يقرأ من الموقع المنشور)
 *
 * لو مديتش ملف، بيقرأ الكتالوج من NEXT_PUBLIC_SITE_URL/api/menu
 * أو من http://localhost:3000/api/menu.
 */

import { readFile } from "node:fs/promises";

/** يطلع اسم الحساب من أي رابط Cloudinary بأي شكل من أشكاله */
function cloudNameFrom(url) {
  if (typeof url !== "string") return null;
  const match =
    /https?:\/\/res\.cloudinary\.com\/([^/]+)\//i.exec(url) ||
    /https?:\/\/([^.]+)-res\.cloudinary\.com\//i.exec(url) ||
    /https?:\/\/api\.cloudinary\.com\/v1_1\/([^/]+)/i.exec(url);
  return match ? decodeURIComponent(match[1]) : null;
}

/** يمشي على الشجرة كلها ويجمع كل الروابط */
function collectUrls(value, found = []) {
  if (typeof value === "string") {
    if (value.includes("cloudinary.com")) found.push(value);
    return found;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectUrls(entry, found);
    return found;
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) collectUrls(entry, found);
  }
  return found;
}

async function loadCatalog(path) {
  if (path) return JSON.parse(await readFile(path, "utf8"));

  const base = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
  const endpoint = `${base}/api/menu`;
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error(`تعذّر قراءة الكتالوج من ${endpoint} (${response.status})`);
  return response.json();
}

const [, , file] = process.argv;

let catalog;
try {
  catalog = await loadCatalog(file);
} catch (error) {
  console.error(`\n✖ ${error.message}\n`);
  console.error("جرّب: node scripts/cloudinary-whoami.mjs مسار-النسخة-الاحتياطية.json\n");
  process.exit(1);
}

const urls = collectUrls(catalog);
const counts = new Map();
for (const url of urls) {
  const name = cloudNameFrom(url);
  if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
}

console.log("");
if (!counts.size) {
  console.log("لقيت " + urls.length + " رابط، بس مفيش ولا واحد على Cloudinary.");
  console.log("يعني صور الكتالوج الحالي مترفوعة في مكان تاني (روابط مباشرة أو dataURL).");
  console.log("");
  process.exit(0);
}

const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
console.log("✅ حسابات Cloudinary اللي صورك عليها (cloud name):\n");
for (const [name, count] of sorted) {
  console.log(`   • ${name}  —  ${count} صورة`);
  console.log(`     الميديا: https://console.cloudinary.com/console/${name}/media_library`);
  console.log(`     مثال رابط: ${urls.find((url) => cloudNameFrom(url) === name)}`);
  console.log("");
}

const [primary] = sorted[0];
console.log("الخطوات الجاية:");
console.log(`  1. افتح https://cloudinary.com/users/login واضغط "Forgot password"`);
console.log(`     وجرّب كل إيميل جوجل عندك — الإيميل الصح بس هو اللي هيوصله رسالة.`);
console.log(`  2. أو ابعت لـ support@cloudinary.com واذكر إن الـ cloud name هو: ${primary}`);
console.log(`  3. أول ما تدخل: Settings → Product Environments تلاقي نفس الاسم،`);
console.log(`     ومن Settings → My Profile اعمل باسورد مباشر عشان متعتمدش على جوجل تاني.`);
console.log("");
