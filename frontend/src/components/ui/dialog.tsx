/**
 * shadcn/ui Dialog 模态弹窗原语（基于 Radix Dialog）。
 */
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/** 弹窗根组件。 */
export const Dialog = DialogPrimitive.Root;
/** 弹窗触发器组件。 */
export const DialogTrigger = DialogPrimitive.Trigger;
/** 弹窗 Portal 组件。 */
export const DialogPortal = DialogPrimitive.Portal;
/** 弹窗关闭触发器。 */
export const DialogClose = DialogPrimitive.Close;

/**
 * 弹窗遮罩层组件。
 *
 * @param props Radix Overlay 属性
 * @returns 遮罩层元素
 */
export function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        'fixed inset-0 z-50 bg-black/50 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out',
        className,
      )}
      {...props}
    />
  );
}

/**
 * 弹窗居中内容容器。
 *
 * @param props Radix Content 属性
 * @returns 居中弹窗内容元素
 */
export function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-background p-6 shadow-lg duration-200',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer"
          aria-label="关闭弹窗"
        >
          <X className="h-4 w-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

/**
 * 弹窗头部布局容器。
 *
 * @param props div 元素属性
 * @returns 头部元素
 */
export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)} {...props} />
  );
}

/**
 * 弹窗底部操作区布局容器。
 *
 * @param props div 元素属性
 * @returns 底部元素
 */
export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)}
      {...props}
    />
  );
}

/**
 * 弹窗标题组件。
 *
 * @param props Radix Title 属性
 * @returns 标题元素
 */
export function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-lg font-semibold leading-none tracking-tight', className)}
      {...props}
    />
  );
}

/**
 * 弹窗描述组件。
 *
 * @param props Radix Description 属性
 * @returns 描述元素
 */
export function DialogDescription({
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
