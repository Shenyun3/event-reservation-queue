/**
 * shadcn/ui Textarea 多行文本输入框原语。
 */
import type * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * 通用多行文本输入框组件。
 *
 * @param props textarea 元素属性
 * @returns textarea 元素
 */
export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
