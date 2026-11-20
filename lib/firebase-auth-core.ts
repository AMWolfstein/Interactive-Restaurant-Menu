import { onIdTokenChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { getFirebaseBrowser, isFirebaseConfigured } from "./firebase-browser";

/**
 * حالة دخول صاحب المحل عن طريق Firebase Auth (إيميل + باسورد).
 * دي الطريقة الوحيدة للدخول للوحة التحكم — مفيش أي دخول محلي أو رقم سري.
 * كل طلب بيتبعت للـ API المحمي بيتحمل معاه access token والسيرفر بيتحقق منه.
 */
export interface AuthState {
  /** متغيرات Firebase موجودة */
  configured: boolean;
  /** خلّصنا قراءة الجلسة من المتصفح */
  checked: boolean;
  email: string | null;
  userId: string | null;
  busy: boolean;
  error: string | null;
}

export const AUTH_SERVER_STATE: AuthState = {
  configured: false,
  checked: false,
  email: null,
  userId: null,
  busy: false,
  error: null,
};

export const MISSING_ENV_MESSAGE =
  "إعدادات Firebase غير موجودة على السيرفر — أضف NEXT_PUBLIC_FIREBASE_PROJECT_ID و NEXT_PUBLIC_FIREBASE_API_KEY";

let state: AuthState = AUTH_SERVER_STATE;
let initialized = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of [...listeners]) listener();
}

function set(patch: Partial<AuthState>) {
  state = { ...state, ...patch };
  emit();
}

function ensureInit() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  if (!isFirebaseConfigured()) {
    set({ configured: false, checked: true, error: MISSING_ENV_MESSAGE });
    return;
  }

  const client = getFirebaseBrowser();
  if (!client) {
    set({ configured: false, checked: true, error: MISSING_ENV_MESSAGE });
    return;
  }

  set({ configured: true });

  onIdTokenChanged(client.auth, (user) => {
    set({ checked: true, email: user?.email ?? null, userId: user?.uid ?? null });
  });
}

export function subscribeAuth(listener: () => void): () => void {
  listeners.add(listener);
  ensureInit();
  return () => {
    listeners.delete(listener);
  };
}

export function getAuthSnapshot(): AuthState {
  return state;
}

export async function signInWithPassword(email: string, password: string): Promise<boolean> {
  const client = getFirebaseBrowser();
  if (!client) {
    set({ error: MISSING_ENV_MESSAGE });
    return false;
  }
  set({ busy: true, error: null });
  try {
    const { user } = await signInWithEmailAndPassword(client.auth, email.trim(), password);
    set({ busy: false, error: null, email: user.email, userId: user.uid });
    return true;
  } catch (error) {
    set({
      busy: false,
      error: error instanceof Error ? translateAuthError(error.message) : "تعذّر الاتصال بالسيرفر",
    });
    return false;
  }
}

export async function signOutFromCloud() {
  const client = getFirebaseBrowser();
  if (!client) return;
  set({ busy: true });
  try {
    await signOut(client.auth);
  } catch {
    /* حتى لو الشبكة فشلت بنمسح الحالة من المتصفح */
  }
  set({ busy: false, email: null, userId: null, error: null });
}

export function clearAuthError() {
  if (state.error) set({ error: null });
}

/** access token الحالي — بيتحط في Authorization لكل طلبات الأدمن */
export async function currentAccessToken(): Promise<string | null> {
  const client = getFirebaseBrowser();
  if (!client) return null;
  await client.auth.authStateReady();
  return client.auth.currentUser?.getIdToken() ?? null;
}

/** fetch بيضيف access token الحالي للطلبات المحمية */
export async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const token = await currentAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

function translateAuthError(message: string): string {
  const text = message.toLowerCase();
  if (text.includes("invalid login") || text.includes("invalid-credential") || text.includes("wrong-password") || text.includes("user-not-found")) return "الإيميل أو الباسورد غلط";
  if (text.includes("email not confirmed")) return "الإيميل لسه متأكدش — افتح رسالة التأكيد";
  if (text.includes("rate limit") || text.includes("too many") || text.includes("too-many-requests")) return "محاولات كتير — استنى شوية وجرّب تاني";
  if (text.includes("failed to fetch") || text.includes("network")) return "مفيش اتصال بسيرفر المصادقة";
  return message;
}
