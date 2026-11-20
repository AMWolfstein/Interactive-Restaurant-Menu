import { getApps, initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  connectAuthEmulator,
  getAuth,
  indexedDBLocalPersistence,
  initializeAuth,
} from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim(),
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim(),
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim(),
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID?.trim(),
};

export function isFirebaseConfigured(): boolean {
  return Boolean(config.apiKey && config.projectId);
}

function initializeBrowserFirebase() {
  const existing = getApps().find((candidate) => candidate.name === "store-catalog");
  if (existing) return { auth: getAuth(existing), firestore: getFirestore(existing) };

  const app = initializeApp(config, "store-catalog");
  const auth = initializeAuth(app, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
  });
  const firestore = getFirestore(app);
  const authEmulator = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL;
  const firestoreEmulator = process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST;
  if (authEmulator) connectAuthEmulator(auth, authEmulator, { disableWarnings: true });
  if (firestoreEmulator) {
    const address = new URL(`http://${firestoreEmulator}`);
    connectFirestoreEmulator(firestore, address.hostname, Number(address.port));
  }
  return { auth, firestore };
}

let client: ReturnType<typeof initializeBrowserFirebase> | undefined;

export function getFirebaseBrowser() {
  if (typeof window === "undefined" || !isFirebaseConfigured()) return null;
  return client ??= initializeBrowserFirebase();
}
