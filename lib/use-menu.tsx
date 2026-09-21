"use client";

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import {
  MENU_SERVER_STATE,
  addItem,
  addCategory,
  deleteCategory,
  deleteItem,
  duplicateItem,
  exportJson,
  getMenuSnapshot,
  importJson,
  moveCategory,
  patchBrand,
  patchCommerce,
  patchContact,
  resetToDefaults,
  setCategoryAvailability,
  subscribeMenu,
  updateCategory,
  updateItem,
  updateMenu,
  type MenuState,
} from "./menu-store-core";
import type { MenuData } from "./types";

/**
 * بيانات الكتالوج اللي السيرفر قراها من قاعدة البيانات ورسم بيها الصفحة.
 * بنستخدمها كبداية للواجهة لحد ما أول قراءة من `/api/menu` تخلص — وبكده
 * الزائر ما يشوفش بيانات البداية (محل البركة/اللون البرتقاني) ولا أي «وميض»
 * قبل ما بيانات المحل الحقيقية تظهر.
 */
const InitialMenuContext = createContext<MenuData | null>(null);

export function MenuProvider({ initialData, children }: { initialData: MenuData; children: ReactNode }) {
  return <InitialMenuContext.Provider value={initialData}>{children}</InitialMenuContext.Provider>;
}

/** كل مكونات الموقع بتقرا البيانات من الباك إند عن طريق هنا — والتعديلات بتتحفظ أوتوماتيك */
export function useMenu() {
  const initialData = useContext(InitialMenuContext);
  // لقطة ثابتة للسيرفر وللمرحلة اللي قبل أول قراءة من الباك إند، عشان
  // رندر السيرفر ورندر المتصفح يبقوا متطابقين (hydration) ومن غير وميض.
  const initialState = useMemo<MenuState>(
    () =>
      initialData
        ? { ...MENU_SERVER_STATE, data: initialData, ready: true, isCustomized: true }
        : MENU_SERVER_STATE,
    [initialData],
  );
  const state = useSyncExternalStore(subscribeMenu, getMenuSnapshot, () => initialState);
  // الستور بيفضل غير جاهز لحد ما `/api/menu` ترد؛ خلال الوقت ده بنعرض بيانات
  // السيرفر بدل بيانات البداية. لاحظ إن `ready` بتفضل كما هي من الستور عشان
  // لوحة التحكم ما تسمحش بتعديل قبل ما البيانات الحقيقية توصل للستور.
  const data = state.ready ? state.data : initialState.data;

  return {
    ...state,
    data,
    update: updateMenu,
    patchBrand,
    patchContact,
    patchCommerce,
    addCategory,
    updateCategory,
    deleteCategory,
    moveCategory,
    addItem,
    updateItem,
    deleteItem,
    duplicateItem,
    setCategoryAvailability,
    exportJson,
    importJson,
    resetToDefaults,
  };
}
