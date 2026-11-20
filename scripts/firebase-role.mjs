import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const projectId = (process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID)?.trim();
const [email, role, ...rest] = process.argv.slice(2);
if (!projectId || !email || !["admin", "invoice_staff"].includes(role) || rest.length) {
  throw new Error("Set FIREBASE_PROJECT_ID. Usage: npm run firestore:role -- <email> <admin|invoice_staff>");
}

const auth = getAuth(initializeApp({ projectId, credential: applicationDefault() }));
const user = await auth.getUserByEmail(email);
await auth.setCustomUserClaims(user.uid, { ...user.customClaims, role });
await auth.revokeRefreshTokens(user.uid);
console.log(`Assigned ${role} in ${projectId}. The user needs to sign in again.`);
