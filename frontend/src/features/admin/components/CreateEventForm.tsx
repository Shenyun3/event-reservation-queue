/**
 * 创建新活动表单组件（复用 CreateEventInputSchema 客户端校验，支持 datetime-local 转 ISO 与快捷预设）。
 */
import { CreateEventInputSchema } from '@queue-reservation/shared';
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useCreateEventMutation } from '../hooks/use-admin';

interface FormState {
  name: string;
  description: string;
  startTimeLocal: string;
  endTimeLocal: string;
  capacity: string;
  maxPerUser: string;
  confirmTimeoutSec: string;
}

type FieldErrors = Partial<Record<keyof FormState, string>>;

function toLocalDateTimeInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());
  const minute = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function buildDefaultFormState(): FormState {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(14, 0, 0, 0);

  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);

  return {
    name: '',
    description: '',
    startTimeLocal: toLocalDateTimeInputValue(start),
    endTimeLocal: toLocalDateTimeInputValue(end),
    capacity: '5',
    maxPerUser: '1',
    confirmTimeoutSec: '600',
  };
}

function localInputToIsoString(localValue: string): string {
  if (!localValue) {
    return '';
  }
  const parsed = new Date(localValue);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  return parsed.toISOString();
}

/** 创建活动表单组件属性。 */
export interface CreateEventFormProps {
  /** 当前管理员用户 ID。 */
  userId: string;
}

/**
 * 运营管理台「创建新活动」表单组件，基于共享 Zod Schema 执行提交前校验。
 *
 * @param props 管理员身份 ID
 * @returns 创建活动表单卡片元素
 */
export function CreateEventForm({ userId }: CreateEventFormProps) {
  const [form, setForm] = useState<FormState>(() => buildDefaultFormState());
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const createEventMutation = useCreateEventMutation(userId);

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      if (!prev[key]) {
        return prev;
      }
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (createEventMutation.isPending) {
      return;
    }

    const parsed = CreateEventInputSchema.safeParse({
      name: form.name,
      description: form.description,
      startTime: localInputToIsoString(form.startTimeLocal),
      endTime: localInputToIsoString(form.endTimeLocal),
      capacity: form.capacity,
      maxPerUser: form.maxPerUser,
      confirmTimeoutSec: form.confirmTimeoutSec,
    });

    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      const nextErrors: FieldErrors = {};
      if (flat.name?.[0]) nextErrors.name = flat.name[0];
      if (flat.description?.[0]) nextErrors.description = flat.description[0];
      if (flat.startTime?.[0]) nextErrors.startTimeLocal = flat.startTime[0];
      if (flat.endTime?.[0]) nextErrors.endTimeLocal = flat.endTime[0];
      if (flat.capacity?.[0]) nextErrors.capacity = flat.capacity[0];
      if (flat.maxPerUser?.[0]) nextErrors.maxPerUser = flat.maxPerUser[0];
      if (flat.confirmTimeoutSec?.[0]) {
        nextErrors.confirmTimeoutSec = flat.confirmTimeoutSec[0];
      }
      setFieldErrors(nextErrors);
      return;
    }

    setFieldErrors({});
    createEventMutation.mutate(parsed.data, {
      onSuccess: () => {
        setForm(buildDefaultFormState());
      },
    });
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base">创建新活动</CardTitle>
        <CardDescription>
          配置活动时间、总名额上限、单人限购数（可设为 2 演示同用户多单流转）与确认锁单超时秒数。
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5 md:col-span-2 lg:col-span-1">
              <Label htmlFor="event-name">活动名称 *</Label>
              <Input
                id="event-name"
                placeholder="例如：春季咖啡品鉴会（限量 5 席）"
                value={form.name}
                onChange={(e) => updateField('name', e.target.value)}
                disabled={createEventMutation.isPending}
              />
              {fieldErrors.name ? (
                <p className="text-xs text-destructive">{fieldErrors.name}</p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="event-start">开始时间 *</Label>
              <Input
                id="event-start"
                type="datetime-local"
                value={form.startTimeLocal}
                onChange={(e) => updateField('startTimeLocal', e.target.value)}
                disabled={createEventMutation.isPending}
              />
              {fieldErrors.startTimeLocal ? (
                <p className="text-xs text-destructive">
                  {fieldErrors.startTimeLocal}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="event-end">结束时间 *</Label>
              <Input
                id="event-end"
                type="datetime-local"
                value={form.endTimeLocal}
                onChange={(e) => updateField('endTimeLocal', e.target.value)}
                disabled={createEventMutation.isPending}
              />
              {fieldErrors.endTimeLocal ? (
                <p className="text-xs text-destructive">
                  {fieldErrors.endTimeLocal}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="event-capacity">总名额上限（Capacity）*</Label>
              <Input
                id="event-capacity"
                type="number"
                min={1}
                max={100000}
                value={form.capacity}
                onChange={(e) => updateField('capacity', e.target.value)}
                disabled={createEventMutation.isPending}
              />
              {fieldErrors.capacity ? (
                <p className="text-xs text-destructive">{fieldErrors.capacity}</p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="event-max-per-user">单人限购数（MaxPerUser）*</Label>
              <Input
                id="event-max-per-user"
                type="number"
                min={1}
                max={100}
                value={form.maxPerUser}
                onChange={(e) => updateField('maxPerUser', e.target.value)}
                disabled={createEventMutation.isPending}
              />
              {fieldErrors.maxPerUser ? (
                <p className="text-xs text-destructive">{fieldErrors.maxPerUser}</p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="event-timeout">确认超时（秒，最小 10 秒）*</Label>
              <Input
                id="event-timeout"
                type="number"
                min={10}
                max={86400}
                value={form.confirmTimeoutSec}
                onChange={(e) => updateField('confirmTimeoutSec', e.target.value)}
                disabled={createEventMutation.isPending}
              />
              {fieldErrors.confirmTimeoutSec ? (
                <p className="text-xs text-destructive">
                  {fieldErrors.confirmTimeoutSec}
                </p>
              ) : null}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="event-description">活动简介（可选）</Label>
            <Textarea
              id="event-description"
              rows={2}
              placeholder="介绍活动亮点、入场凭证说明或候补规则..."
              value={form.description}
              onChange={(e) => updateField('description', e.target.value)}
              disabled={createEventMutation.isPending}
            />
            {fieldErrors.description ? (
              <p className="text-xs text-destructive">{fieldErrors.description}</p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>快捷预设：</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => updateField('confirmTimeoutSec', '30')}
                disabled={createEventMutation.isPending}
              >
                超时 30 秒（演示回收）
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => updateField('confirmTimeoutSec', '60')}
                disabled={createEventMutation.isPending}
              >
                超时 1 分钟
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => updateField('confirmTimeoutSec', '600')}
                disabled={createEventMutation.isPending}
              >
                超时 10 分钟
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => updateField('maxPerUser', '2')}
                disabled={createEventMutation.isPending}
              >
                限购 2 份（多单演示）
              </Button>
            </div>

            <Button type="submit" disabled={createEventMutation.isPending}>
              <Plus className="h-4 w-4" />
              {createEventMutation.isPending ? '正在创建...' : '创建活动并发布'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
