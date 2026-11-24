/**
 * 前端通用工具函数（Tailwind 类名合并与时间/格式辅助）。
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * 合并 Tailwind CSS 类名并自动解决冲突。
 *
 * @param inputs 待合并的类名片段
 * @returns 合并后的类名字符串
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * 将 ISO 时间字符串格式化为简洁本地日期时间文本。
 *
 * @param isoString ISO 8601 时间字符串或 null/undefined
 * @returns 格式化文本；输入为空时返回 "-"
 */
export function formatDateTime(isoString: string | null | undefined): string {
  if (!isoString) {
    return '-';
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}
