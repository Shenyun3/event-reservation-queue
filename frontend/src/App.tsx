/**
 * 前端应用根组件：挂载 React Query、全局身份上下文、通知系统与全量 P0 路由装配。
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Flame } from 'lucide-react';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AdminOnlyGuard } from '@/components/layout/AdminOnlyGuard';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { AdminPage } from '@/features/admin/components/AdminPage';
import { EventDetailPage } from '@/features/events/components/EventDetailPage';
import { EventsLobbyPage } from '@/features/events/components/EventsLobbyPage';
import { MyReservationsPage } from '@/features/reservations/components/MyReservationsPage';
import { UserProvider, useUser } from '@/lib/user-context';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function StressTestPlaceholderPage() {
  const { isAdmin, isLoadingUsers } = useUser();

  if (!isLoadingUsers && !isAdmin) {
    return <AdminOnlyGuard pageTitle="20 人并发压测实验室" />;
  }

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Flame className="h-5 w-5 text-amber-600" />
          <CardTitle>20 人并发压测实验室（Phase 3B 待接入）</CardTitle>
        </div>
        <CardDescription>
          本页面将在 Phase 3B 接入服务端同毫秒并发抢购接口（POST /api/events/:eventId/simulate-burst）与清空活动预约能力。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" asChild>
          <Link to="/">返回活动看板</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * 应用顶层组件。
 *
 * @returns 完整 React 应用树
 */
export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <UserProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/" element={<EventsLobbyPage />} />
              <Route path="/events/:eventId" element={<EventDetailPage />} />
              <Route path="/my-reservations" element={<MyReservationsPage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/stress-test" element={<StressTestPlaceholderPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="top-right" richColors />
      </UserProvider>
    </QueryClientProvider>
  );
}

export default App;
