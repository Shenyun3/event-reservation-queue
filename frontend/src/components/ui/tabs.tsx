/**
 * shadcn/ui Tabs 选项卡原语（基于 Radix Tabs）。
 */
import * as TabsPrimitive from '@radix-ui/react-tabs';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/** 选项卡根组件。 */
export const Tabs = TabsPrimitive.Root;

/**
 * 选项卡触发按钮容器。
 *
 * @param props Radix TabsList 属性
 * @returns 选项卡列表元素
 */
export function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        'inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

/**
 * 单个选项卡切换触发器。
 *
 * @param props Radix TabsTrigger 属性
 * @returns 触发器按钮元素
 */
export function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs cursor-pointer',
        className,
      )}
      {...props}
    />
  );
}

/**
 * 选项卡对应内容面板。
 *
 * @param props Radix TabsContent 属性
 * @returns 内容面板元素
 */
export function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn(
        'mt-3 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      {...props}
    />
  );
}
