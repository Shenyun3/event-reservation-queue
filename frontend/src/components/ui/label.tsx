/**
 * shadcn/ui Label 表单标签原语（基于 Radix Label）。
 */
import * as LabelPrimitive from '@radix-ui/react-label';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * 通用表单字段标签组件。
 *
 * @param props Radix Label 属性
 * @returns label 元素
 */
export function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn(
        'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        className,
      )}
      {...props}
    />
  );
}
