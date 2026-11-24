/**
 * shadcn/ui Sheet 侧边抽屉原语（基于 Radix Dialog）。
 */
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/** 抽屉根组件。 */
export const Sheet = DialogPrimitive.Root;
/** 抽屉触发器组件。 */
export const SheetTrigger = DialogPrimitive.Trigger;
/** 抽屉关闭按钮组件。 */
export const SheetClose = DialogPrimitive.Close;
/** 抽屉 Portal 组件。 */
export const SheetPortal = DialogPrimitive.Portal;

/**
 * 抽屉遮罩层组件。
 *
 * @param props Radix Overlay 属性
 * @returns 遮罩层元素
 */
export function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn('fixed inset-0 z-50 bg-black/50 backdrop-blur-[1px]', className)}
      {...props}
    />
  );
}

/** SheetContent 属性类型。 */
export interface SheetContentProps
  extends React.ComponentProps<typeof DialogPrimitive.Content> {
  side?: 'left' | 'right';
}

/**
 * 侧边抽屉内容面板组件。
 *
 * @param props 抽屉方向与 Radix Content 属性
 * @returns 抽屉面板元素
 */
export function SheetContent({
  side = 'right',
  className,
  children,
  ...props
}: SheetContentProps) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Content
        className={cn(
          'fixed inset-y-0 z-50 flex h-full w-full max-w-md flex-col gap-4 border bg-background p-6 shadow-xl transition ease-in-out',
          side === 'right' ? 'right-0 border-l' : 'left-0 border-r',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer"
          aria-label="关闭抽屉"
        >
          <X className="h-4 w-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </SheetPortal>
  );
}

/**
 * 抽屉头部区域。
 *
 * @param props div 元素属性
 * @returns 抽屉头部元素
 */
export function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col space-y-1.5 text-left', className)} {...props} />;
}

/**
 * 抽屉标题组件。
 *
 * @param props Radix Title 属性
 * @returns 抽屉标题元素
 */
export function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-base font-semibold text-foreground', className)}
      {...props}
    />
  );
}

/**
 * 抽屉副标题描述组件。
 *
 * @param props Radix Description 属性
 * @returns 抽屉描述元素
 */
export function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}
