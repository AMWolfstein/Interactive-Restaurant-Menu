import { DEFAULT_DATA } from "../lib/defaults";
import type { CommerceSettings, ContactSettings, MenuData } from "../lib/types";

/**
 * مساعدات بناء بيانات الاختبار.
 *
 * بنبني فوق `DEFAULT_DATA` بدل ما نكتب كائن كامل في كل اختبار، عشان لما
 * يتضاف حقل جديد للإعدادات ما نضطرش نعدّل كل ملفات الاختبار.
 */

export function commerce(overrides: Partial<CommerceSettings> = {}): CommerceSettings {
  return { ...DEFAULT_DATA.commerce, ...overrides };
}

export function contact(overrides: Partial<ContactSettings> = {}): ContactSettings {
  return { ...DEFAULT_DATA.contact, ...overrides };
}

export function menu(
  commerceOverrides: Partial<CommerceSettings> = {},
  contactOverrides: Partial<ContactSettings> = {},
): Pick<MenuData, "commerce" | "contact"> {
  return {
    commerce: commerce(commerceOverrides),
    contact: contact(contactOverrides),
  };
}

/** محل مفتوح دايماً — عشان اختبارات القواعد التانية ما تتأثرش بالمواعيد */
export const ALWAYS_OPEN: Partial<ContactSettings> = { isOpen: true, autoSchedule: false };

/** جدول أسبوعي كامل بمواعيد واحدة لكل الأيام */
export function weeklySchedule(open: string, close: string, enabled = true) {
  return Array.from({ length: 7 }, (_, day) => ({ day, enabled, open, close }));
}
