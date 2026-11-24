/**
 * shadcn/ui Input 输入框原语。
 */
import type * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * 通用单行文本输入框组件。
 *
 * @param props input 元素属性
 * @returns input 元素
 */
export function Input({ className, type, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
