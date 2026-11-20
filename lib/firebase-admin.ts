import "server-only";

import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

export function firebaseProjectId() {
  return (process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "").trim();
}

function getFirebaseAdmin() {
  const existing = getApps().find((app) => app.name === "store-catalog");
  if (existing) return existing;

  const projectId = firebaseProjectId();
  if (!projectId) throw new Error("إعدادات Firebase غير موجودة على السيرفر");

  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (Boolean(clientEmail) !== Boolean(privateKey)) {
    throw new Error("بيانات اعتماد Firebase غير مكتملة");
  }
  const credential = clientEmail && privateKey
    ? cert({ projectId, clientEmail, privateKey })
    : applicationDefault();
  return initializeApp({ projectId, credential }, "store-catalog");
}

export function firestoreDb() {
  return getFirestore(getFirebaseAdmin());
}

export function firebaseAdminAuth() {
  return getAuth(getFirebaseAdmin());
}
