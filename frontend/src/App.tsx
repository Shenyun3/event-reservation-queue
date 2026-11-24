/**
 * 前端应用根组件：挂载 React Query、全局身份上下文、通知系统与全量 P0/P1 路由装配。
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AppLayout } from '@/components/layout/AppLayout';
import { AdminPage } from '@/features/admin/components/AdminPage';
import { EventDetailPage } from '@/features/events/components/EventDetailPage';
import { EventsLobbyPage } from '@/features/events/components/EventsLobbyPage';
import { MyReservationsPage } from '@/features/reservations/components/MyReservationsPage';
import { StressTestPage } from '@/features/stress-test/components/StressTestPage';
import { UserProvider } from '@/lib/user-context';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

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
              <Route path="/stress-test" element={<StressTestPage />} />
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
