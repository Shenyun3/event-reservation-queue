/**
 * 纯静态 HTML 原型共享状态与模拟业务引擎（localStorage 持久化）
 * 严格区分普通用户（USER）与运营管理员（ADMIN）视角：
 * - 普通用户：仅见可预约活动的基础信息（名称、时间、限购、可预约/可候补状态）与本人预约记录。
 * - 管理员：可见总库存、已确认数、待确认锁单数、候补人数、全量队列名册、活动创建、超时巡检与 20 人并发压测。
 */
(function () {
  const STORAGE_KEY = 'queue_reservation_wireframe_v2';

  const SEED_USERS = [
    { id: 'u1', name: 'Alice', role: 'USER', email: 'alice@example.com' },
    { id: 'u2', name: 'Bob', role: 'USER', email: 'bob@example.com' },
    { id: 'u3', name: 'Charlie', role: 'USER', email: 'charlie@example.com' },
    { id: 'u4', name: 'Diana', role: 'USER', email: 'diana@example.com' },
    { id: 'u5', name: 'Evan', role: 'USER', email: 'evan@example.com' },
    { id: 'admin', name: 'Admin（运营管理员）', role: 'ADMIN', email: 'admin@example.com' }
  ];

  function nowIso(offsetSec = 0) {
    return new Date(Date.now() + offsetSec * 1000).toISOString();
  }

  function createSeedState() {
    const t0 = nowIso(-600);
    const t1 = nowIso(-300);
    const t2 = nowIso(-120);
    const t3 = nowIso(-60);
    const t4 = nowIso(-20);

    return {
      currentUserId: 'u1',
      users: SEED_USERS,
      idempotencyMap: {},
      lastWorkerRunAt: nowIso(0),
      nextResSeq: 108,
      nextEventSeq: 3,
      events: [
        {
          id: 'evt-1',
          name: 'LINE FRIENDS 限量快闪店入场券',
          startTime: '2026-11-25 10:00',
          endTime: '2026-11-25 18:00',
          capacity: 5,
          maxPerUser: 1,
          confirmTimeoutSec: 600,
          description: '热门限量线下主题快闪体验，凭确认后的预约凭证扫码入场。'
        },
        {
          id: 'evt-2',
          name: '2026 高并发架构线下沙龙',
          startTime: '2026-11-28 14:00',
          endTime: '2026-11-28 17:00',
          capacity: 3,
          maxPerUser: 1,
          confirmTimeoutSec: 45,
          description: '一线架构师面对面交流，席位有限，满额后可登记候补。'
        }
      ],
      reservations: [
        {
          id: 'res-101',
          eventId: 'evt-1',
          userId: 'u2',
          userName: 'Bob',
          status: 'CONFIRMED',
          createdAt: t0,
          updatedAt: t1,
          expiresAt: null
        },
        {
          id: 'res-102',
          eventId: 'evt-1',
          userId: 'u3',
          userName: 'Charlie',
          status: 'CONFIRMED',
          createdAt: t0,
          updatedAt: t1,
          expiresAt: null
        },
        {
          id: 'res-103',
          eventId: 'evt-1',
          userId: 'u4',
          userName: 'Diana',
          status: 'PENDING_CONFIRM',
          createdAt: t2,
          updatedAt: t2,
          expiresAt: nowIso(480)
        },
        {
          id: 'res-104',
          eventId: 'evt-2',
          userId: 'u1',
          userName: 'Alice',
          status: 'CONFIRMED',
          createdAt: t0,
          updatedAt: t1,
          expiresAt: null
        },
        {
          id: 'res-105',
          eventId: 'evt-2',
          userId: 'u2',
          userName: 'Bob',
          status: 'CONFIRMED',
          createdAt: t0,
          updatedAt: t1,
          expiresAt: null
        },
        {
          id: 'res-106',
          eventId: 'evt-2',
          userId: 'u3',
          userName: 'Charlie',
          status: 'PENDING_CONFIRM',
          createdAt: t4,
          updatedAt: t4,
          expiresAt: nowIso(35)
        },
        {
          id: 'res-107',
          eventId: 'evt-2',
          userId: 'u4',
          userName: 'Diana',
          status: 'WAITLISTED',
          createdAt: t3,
          updatedAt: t3,
          expiresAt: null
        }
      ],
      auditLogs: [
        {
          id: 'log-1',
          reservationId: 'res-101',
          fromStatus: null,
          toStatus: 'PENDING_CONFIRM',
          trigger: 'USER_ACTION',
          note: '提交预约申请，名额已暂留，等待确认',
          createdAt: t0
        },
        {
          id: 'log-2',
          reservationId: 'res-101',
          fromStatus: 'PENDING_CONFIRM',
          toStatus: 'CONFIRMED',
          trigger: 'USER_ACTION',
          note: '在有效期内完成预约确认',
          createdAt: t1
        },
        {
          id: 'log-3',
          reservationId: 'res-102',
          fromStatus: null,
          toStatus: 'PENDING_CONFIRM',
          trigger: 'USER_ACTION',
          note: '提交预约申请，名额已暂留，等待确认',
          createdAt: t0
        },
        {
          id: 'log-4',
          reservationId: 'res-102',
          fromStatus: 'PENDING_CONFIRM',
          toStatus: 'CONFIRMED',
          trigger: 'USER_ACTION',
          note: '在有效期内完成预约确认',
          createdAt: t1
        },
        {
          id: 'log-5',
          reservationId: 'res-103',
          fromStatus: null,
          toStatus: 'PENDING_CONFIRM',
          trigger: 'USER_ACTION',
          note: '提交预约申请，名额已暂留，等待确认',
          createdAt: t2
        },
        {
          id: 'log-6',
          reservationId: 'res-104',
          fromStatus: null,
          toStatus: 'PENDING_CONFIRM',
          trigger: 'USER_ACTION',
          note: '提交预约申请，名额已暂留，等待确认',
          createdAt: t0
        },
        {
          id: 'log-7',
          reservationId: 'res-104',
          fromStatus: 'PENDING_CONFIRM',
          toStatus: 'CONFIRMED',
          trigger: 'USER_ACTION',
          note: '在有效期内完成预约确认',
          createdAt: t1
        },
        {
          id: 'log-8',
          reservationId: 'res-105',
          fromStatus: null,
          toStatus: 'PENDING_CONFIRM',
          trigger: 'USER_ACTION',
          note: '提交预约申请，名额已暂留，等待确认',
          createdAt: t0
        },
        {
          id: 'log-9',
          reservationId: 'res-105',
          fromStatus: 'PENDING_CONFIRM',
          toStatus: 'CONFIRMED',
          trigger: 'USER_ACTION',
          note: '在有效期内完成预约确认',
          createdAt: t1
        },
        {
          id: 'log-10',
          reservationId: 'res-106',
          fromStatus: null,
          toStatus: 'PENDING_CONFIRM',
          trigger: 'USER_ACTION',
          note: '提交预约申请，名额已暂留，等待确认',
          createdAt: t4
        },
        {
          id: 'log-11',
          reservationId: 'res-107',
          fromStatus: null,
          toStatus: 'WAITLISTED',
          trigger: 'USER_ACTION',
          note: '当前名额已满，已加入候补队列',
          createdAt: t3
        }
      ]
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        const seed = createSeedState();
        saveState(seed);
        return seed;
      }
      return JSON.parse(raw);
    } catch {
      const seed = createSeedState();
      saveState(seed);
      return seed;
    }
  }

  function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function resetSeed() {
    const seed = createSeedState();
    saveState(seed);
    return seed;
  }

  function getCurrentUser(state) {
    const s = state || loadState();
    return s.users.find((u) => u.id === s.currentUserId) || s.users[0];
  }

  function isAdmin(state) {
    return getCurrentUser(state).role === 'ADMIN';
  }

  function appendAudit(state, reservationId, fromStatus, toStatus, trigger, note) {
    state.auditLogs.push({
      id: 'log-' + (state.auditLogs.length + 1) + '-' + Math.random().toString(36).slice(2, 6),
      reservationId,
      fromStatus,
      toStatus,
      trigger,
      note,
      createdAt: nowIso(0)
    });
  }

  function getEventStats(state, eventId) {
    const ev = state.events.find((e) => e.id === eventId);
    if (!ev) return null;
    const list = state.reservations.filter((r) => r.eventId === eventId);
    const confirmed = list.filter((r) => r.status === 'CONFIRMED').length;
    const pending = list.filter((r) => r.status === 'PENDING_CONFIRM').length;
    const waitlisted = list.filter((r) => r.status === 'WAITLISTED').length;
    const occupied = confirmed + pending;
    const available = Math.max(0, ev.capacity - occupied);
    const oversold = occupied > ev.capacity;
    return { confirmed, pending, waitlisted, occupied, available, capacity: ev.capacity, oversold };
  }

  function getWaitlistRank(state, reservation) {
    if (reservation.status !== 'WAITLISTED') return null;
    const queue = state.reservations
      .filter((r) => r.eventId === reservation.eventId && r.status === 'WAITLISTED')
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const idx = queue.findIndex((r) => r.id === reservation.id);
    return idx >= 0 ? idx + 1 : null;
  }

  function promoteNextWaitlisted(state, eventId, reasonNote) {
    const ev = state.events.find((e) => e.id === eventId);
    if (!ev) return null;
    const stats = getEventStats(state, eventId);
    if (stats.available <= 0) return null;

    const queue = state.reservations
      .filter((r) => r.eventId === eventId && r.status === 'WAITLISTED')
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    if (queue.length === 0) return null;
    const head = queue[0];
    head.status = 'PENDING_CONFIRM';
    head.updatedAt = nowIso(0);
    head.expiresAt = nowIso(ev.confirmTimeoutSec);
    appendAudit(
      state,
      head.id,
      'WAITLISTED',
      'PENDING_CONFIRM',
      'WAITLIST_PROMOTED',
      reasonNote || '有空余名额释放，候补自动转正，请在倒计时内确认'
    );
    return head;
  }

  function runExpirationWorker() {
    const state = loadState();
    const now = Date.now();
    let expiredCount = 0;
    let promotedCount = 0;

    state.reservations.forEach((res) => {
      if (res.status === 'PENDING_CONFIRM' && res.expiresAt && new Date(res.expiresAt).getTime() <= now) {
        res.status = 'EXPIRED';
        res.updatedAt = nowIso(0);
        res.expiresAt = null;
        expiredCount++;
        appendAudit(
          state,
          res.id,
          'PENDING_CONFIRM',
          'EXPIRED',
          'SYSTEM_TIMEOUT',
          '未在规定时间内确认，系统已自动释放名额'
        );
        const promoted = promoteNextWaitlisted(
          state,
          res.eventId,
          '有空余名额释放，候补自动转正，请在倒计时内确认'
        );
        if (promoted) promotedCount++;
      }
    });

    state.lastWorkerRunAt = nowIso(0);
    saveState(state);
    return { expiredCount, promotedCount };
  }

  function createReservation({ eventId, userId, userName, idempotencyKey }) {
    const state = loadState();
    const ev = state.events.find((e) => e.id === eventId);
    if (!ev) return { ok: false, error: '活动不存在' };

    if (idempotencyKey && state.idempotencyMap[idempotencyKey]) {
      const existingId = state.idempotencyMap[idempotencyKey];
      const existing = state.reservations.find((r) => r.id === existingId);
      if (existing) {
        return {
          ok: true,
          idempotentHit: true,
          reservation: existing,
          rank: getWaitlistRank(state, existing)
        };
      }
    }

    const activeCount = state.reservations.filter(
      (r) =>
        r.eventId === eventId &&
        r.userId === userId &&
        ['CONFIRMED', 'PENDING_CONFIRM', 'WAITLISTED'].includes(r.status)
    ).length;

    if (activeCount >= ev.maxPerUser) {
      return { ok: false, error: `每人限预约 ${ev.maxPerUser} 份，您已达到上限` };
    }

    const stats = getEventStats(state, eventId);
    const id = 'res-' + state.nextResSeq++;
    const createdAt = nowIso(0);
    const userObj = state.users.find((u) => u.id === userId);
    const resolvedName = userName || (userObj ? userObj.name : userId);

    let reservation;
    if (stats.available > 0) {
      reservation = {
        id,
        eventId,
        userId,
        userName: resolvedName,
        status: 'PENDING_CONFIRM',
        createdAt,
        updatedAt: createdAt,
        expiresAt: nowIso(ev.confirmTimeoutSec)
      };
      state.reservations.push(reservation);
      appendAudit(
        state,
        id,
        null,
        'PENDING_CONFIRM',
        'USER_ACTION',
        '提交预约申请，名额已暂留，等待确认'
      );
    } else {
      reservation = {
        id,
        eventId,
        userId,
        userName: resolvedName,
        status: 'WAITLISTED',
        createdAt,
        updatedAt: createdAt,
        expiresAt: null
      };
      state.reservations.push(reservation);
      const rank = getWaitlistRank(state, reservation);
      appendAudit(
        state,
        id,
        null,
        'WAITLISTED',
        'USER_ACTION',
        `当前名额已满，已进入候补队列第 #${rank} 位`
      );
    }

    if (idempotencyKey) {
      state.idempotencyMap[idempotencyKey] = id;
    }

    saveState(state);
    return {
      ok: true,
      idempotentHit: false,
      reservation,
      rank: getWaitlistRank(state, reservation)
    };
  }

  function confirmReservation(reservationId) {
    const state = loadState();
    const res = state.reservations.find((r) => r.id === reservationId);
    if (!res) return { ok: false, error: '预约单不存在' };
    if (res.status !== 'PENDING_CONFIRM') {
      return { ok: false, error: '当前预约状态无法确认' };
    }
    if (res.expiresAt && new Date(res.expiresAt).getTime() <= Date.now()) {
      res.status = 'EXPIRED';
      res.updatedAt = nowIso(0);
      res.expiresAt = null;
      appendAudit(state, res.id, 'PENDING_CONFIRM', 'EXPIRED', 'SYSTEM_TIMEOUT', '确认时已超过保留时限，预约自动失效');
      promoteNextWaitlisted(state, res.eventId, '有空余名额释放，候补自动转正，请在倒计时内确认');
      saveState(state);
      return { ok: false, error: '预约已超时失效，请重新发起预约' };
    }

    res.status = 'CONFIRMED';
    res.updatedAt = nowIso(0);
    res.expiresAt = null;
    appendAudit(state, res.id, 'PENDING_CONFIRM', 'CONFIRMED', 'USER_ACTION', '在有效期内完成预约确认');
    saveState(state);
    return { ok: true, reservation: res };
  }

  function cancelReservation(reservationId) {
    const state = loadState();
    const res = state.reservations.find((r) => r.id === reservationId);
    if (!res) return { ok: false, error: '预约单不存在' };
    if (!['CONFIRMED', 'PENDING_CONFIRM', 'WAITLISTED'].includes(res.status)) {
      return { ok: false, error: '该预约已结束，无需取消' };
    }

    const prevStatus = res.status;
    res.status = 'CANCELLED';
    res.updatedAt = nowIso(0);
    res.expiresAt = null;
    appendAudit(state, res.id, prevStatus, 'CANCELLED', 'USER_ACTION', '主动取消预约');

    let promoted = null;
    if (prevStatus === 'CONFIRMED' || prevStatus === 'PENDING_CONFIRM') {
      promoted = promoteNextWaitlisted(
        state,
        res.eventId,
        '有空余名额释放，候补自动转正，请在倒计时内确认'
      );
    }

    saveState(state);
    return { ok: true, reservation: res, promoted };
  }

  function createEvent({ name, startTime, endTime, capacity, maxPerUser, confirmTimeoutSec, description }) {
    const state = loadState();
    const id = 'evt-' + state.nextEventSeq++;
    const ev = {
      id,
      name,
      startTime,
      endTime,
      capacity: Number(capacity),
      maxPerUser: Number(maxPerUser),
      confirmTimeoutSec: Number(confirmTimeoutSec),
      description: description || '限时开放预约活动'
    };
    state.events.unshift(ev);
    saveState(state);
    return ev;
  }

  function clearEventReservations(eventId) {
    const state = loadState();
    const removedIds = new Set(
      state.reservations.filter((r) => r.eventId === eventId).map((r) => r.id)
    );
    state.reservations = state.reservations.filter((r) => r.eventId !== eventId);
    state.auditLogs = state.auditLogs.filter((l) => !removedIds.has(l.reservationId));
    Object.keys(state.idempotencyMap).forEach((k) => {
      if (removedIds.has(state.idempotencyMap[k])) delete state.idempotencyMap[k];
    });
    saveState(state);
  }

  function simulateConcurrentRush(eventId, count = 20) {
    const results = [];
    const batchId = Date.now().toString(36).slice(-4);
    for (let i = 1; i <= count; i++) {
      const uid = `sim-${batchId}-${i}`;
      const uname = `并发用户 #${String(i).padStart(2, '0')}`;
      const idemKey = `rush-${eventId}-${batchId}-${i}`;
      const start = performance.now();
      const outcome = createReservation({
        eventId,
        userId: uid,
        userName: uname,
        idempotencyKey: idemKey
      });
      const latencyMs = Math.max(4, Math.round(performance.now() - start + Math.random() * 25));
      results.push({
        index: i,
        userName: uname,
        idempotencyKey: idemKey,
        latencyMs,
        ...outcome
      });
    }
    return results;
  }

  function setCurrentUser(userId) {
    const state = loadState();
    state.currentUserId = userId;
    saveState(state);
  }

  function formatStatus(status, adminMode = false) {
    if (adminMode) {
      const adminMap = {
        CONFIRMED: '已确认 CONFIRMED',
        PENDING_CONFIRM: '待确认锁单 PENDING_CONFIRM',
        WAITLISTED: '候补排队中 WAITLISTED',
        CANCELLED: '已取消 CANCELLED',
        EXPIRED: '已超时 EXPIRED'
      };
      return adminMap[status] || status;
    }
    const userMap = {
      CONFIRMED: '预约成功',
      PENDING_CONFIRM: '待确认',
      WAITLISTED: '候补排队中',
      CANCELLED: '已取消',
      EXPIRED: '已过期'
    };
    return userMap[status] || status;
  }

  function formatTrigger(trigger) {
    const map = {
      USER_ACTION: '用户操作',
      SYSTEM_TIMEOUT: '系统超时自动释放',
      WAITLIST_PROMOTED: '候补自动转正'
    };
    return map[trigger] || trigger;
  }

  function formatCountdown(expiresAt, adminMode = false) {
    if (!expiresAt) return '-';
    const diffSec = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000);
    if (diffSec <= 0) return adminMode ? '已到期（待巡检回收）' : '已过期';
    const m = Math.floor(diffSec / 60);
    const s = diffSec % 60;
    return m > 0 ? `${m}分 ${String(s).padStart(2, '0')}秒` : `${s}秒`;
  }

  function formatTime(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    return d.toLocaleTimeString('zh-CN', { hour12: false });
  }

  function showToast(msg) {
    let el = document.getElementById('global-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'global-toast';
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
      el.style.display = 'none';
    }, 3200);
  }

  function renderTopbar(activePage, onStateChange) {
    const state = loadState();
    const adminMode = isAdmin(state);
    const mount = document.getElementById('topbar-mount');
    if (!mount) return;

    const renderSig = `${activePage}:${adminMode ? 'ADMIN' : 'USER'}`;
    const existingSelect = document.getElementById('global-user-switcher');
    if (existingSelect && mount.dataset.rendered === renderSig) {
      if (document.activeElement !== existingSelect) {
        existingSelect.value = state.currentUserId;
      }
      return;
    }

    const navItems = adminMode
      ? [
          { key: 'index', href: 'index.html', label: '1. 活动大厅（运营视角）' },
          { key: 'admin', href: 'admin.html', label: '2. 运营管理台' },
          { key: 'stress', href: 'stress-test.html', label: '3. 20人并发压测' }
        ]
      : [
          { key: 'index', href: 'index.html', label: '1. 活动大厅' },
          { key: 'my', href: 'my-reservations.html', label: '2. 我的预约' }
        ];

    const userOptions = [
      '<optgroup label="普通用户（C端视角）">',
      ...state.users
        .filter((u) => u.role === 'USER')
        .map(
          (u) =>
            `<option value="${u.id}" ${u.id === state.currentUserId ? 'selected' : ''}>${u.name}</option>`
        ),
      '</optgroup>',
      '<optgroup label="管理员（运营/监控视角）">',
      ...state.users
        .filter((u) => u.role === 'ADMIN')
        .map(
          (u) =>
            `<option value="${u.id}" ${u.id === state.currentUserId ? 'selected' : ''}>${u.name}</option>`
        ),
      '</optgroup>'
    ].join('');

    mount.innerHTML = `
      <header class="topbar">
        <div class="topbar-left">
          <a class="brand" href="index.html">活动预约平台${adminMode ? ' · ADMIN' : ''}</a>
          <nav class="nav">
            ${navItems
              .map(
                (item) =>
                  `<a href="${item.href}" class="${activePage === item.key ? 'active' : ''}">${item.label}</a>`
              )
              .join('')}
          </nav>
        </div>
        <div class="topbar-right">
          <label>
            模拟账号：
            <select id="global-user-switcher">${userOptions}</select>
          </label>
          ${adminMode ? '<button id="global-worker-btn" title="模拟后台 10 秒定时任务扫描过期订单">触发超时巡检</button>' : ''}
          <button id="global-reset-btn" title="演示用：恢复初始测试数据">重置演示数据</button>
        </div>
      </header>
    `;
    mount.dataset.rendered = renderSig;

    document.getElementById('global-user-switcher').addEventListener('change', (e) => {
      setCurrentUser(e.target.value);
      const nextAdmin = isAdmin();
      showToast(nextAdmin ? '已切换至管理员账号（解锁库存看板与运营后台）' : '已切换至普通用户：' + e.target.options[e.target.selectedIndex].text);
      if (onStateChange) onStateChange();
    });

    const workerBtn = document.getElementById('global-worker-btn');
    if (workerBtn) {
      workerBtn.addEventListener('click', () => {
        const { expiredCount, promotedCount } = runExpirationWorker();
        showToast(`超时巡检完成：回收 ${expiredCount} 单，候补转正 ${promotedCount} 人`);
        if (onStateChange) onStateChange();
      });
    }

    document.getElementById('global-reset-btn').addEventListener('click', () => {
      resetSeed();
      showToast('已恢复初始演示数据');
      if (onStateChange) onStateChange();
    });
  }

  function renderAdminOnlyGuard(containerId, pageTitle, onStateChange) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = `
      <section class="box" style="margin-top:20px;">
        <div class="box-title">仅管理员可访问：${pageTitle}</div>
        <p class="muted">当前模拟账号为普通用户，无权查看后台库存统计、活动管理或并发压测工具。</p>
        <div class="actions-row">
          <button id="quick-switch-admin" class="primary">一键切换为管理员账号</button>
          <a class="btn" href="index.html">返回活动大厅</a>
        </div>
      </section>
    `;
    document.getElementById('quick-switch-admin').addEventListener('click', () => {
      setCurrentUser('admin');
      showToast('已切换至管理员账号');
      if (onStateChange) onStateChange();
    });
  }

  function openAuditDrawer(reservationId) {
    const state = loadState();
    const adminMode = isAdmin(state);
    const currentUser = getCurrentUser(state);
    const res = state.reservations.find((r) => r.id === reservationId);

    // 权限保护：普通用户只能查看自己的预约记录
    if (res && !adminMode && res.userId !== currentUser.id) {
      showToast('无权查看其他用户的预约记录');
      return;
    }

    const ev = res ? state.events.find((e) => e.id === res.eventId) : null;
    const logs = state.auditLogs
      .filter((l) => l.reservationId === reservationId)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    let backdrop = document.getElementById('audit-drawer-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'audit-drawer-backdrop';
      backdrop.className = 'drawer-backdrop';
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) backdrop.classList.remove('open');
      });
      document.body.appendChild(backdrop);
    }

    backdrop.innerHTML = `
      <aside class="drawer">
        <div class="drawer-header">
          <div>
            <strong>${adminMode ? '状态变更审计日志（Audit Log）' : '预约状态进度记录'}</strong>
            <div class="muted mono">预约单号：${reservationId}</div>
          </div>
          <button id="close-audit-drawer">关闭</button>
        </div>
        ${
          res
            ? `
          <div class="box" style="padding:10px; margin-bottom:14px;">
            <div><strong>活动：</strong>${ev ? ev.name : res.eventId}</div>
            ${adminMode ? `<div><strong>用户：</strong>${res.userName} (<span class="mono">${res.userId}</span>)</div>` : ''}
            <div><strong>当前状态：</strong><span class="tag tag-${res.status}">${formatStatus(res.status, adminMode)}</span></div>
            ${res.expiresAt ? `<div><strong>剩余确认时间：</strong>${formatCountdown(res.expiresAt, adminMode)}</div>` : ''}
          </div>
        `
            : ''
        }
        <div>
          ${
            logs.length === 0
              ? '<div class="muted">暂无状态记录</div>'
              : logs
                  .map(
                    (l) => `
                <div class="timeline-item">
                  <div class="mono muted">${formatTime(l.createdAt)} · ${formatTrigger(l.trigger)}</div>
                  <div style="margin:4px 0;">
                    ${l.fromStatus ? `<span class="tag">${formatStatus(l.fromStatus, adminMode)}</span> → ` : ''}
                    <span class="tag tag-${l.toStatus}">${formatStatus(l.toStatus, adminMode)}</span>
                  </div>
                  <div>${l.note}</div>
                </div>
              `
                  )
                  .join('')
          }
        </div>
      </aside>
    `;

    backdrop.classList.add('open');
    document.getElementById('close-audit-drawer').addEventListener('click', () => {
      backdrop.classList.remove('open');
    });
  }

  function startAutoWorker(onTick) {
    let sec = 0;
    setInterval(() => {
      sec++;
      if (sec % 10 === 0) {
        const { expiredCount, promotedCount } = runExpirationWorker();
        if (expiredCount > 0 && isAdmin()) {
          showToast(`[自动巡检] 超时回收 ${expiredCount} 单，候补转正 ${promotedCount} 人`);
        }
      }
      if (onTick) onTick();
    }, 1000);
  }

  window.DemoApp = {
    loadState,
    resetSeed,
    getCurrentUser,
    isAdmin,
    setCurrentUser,
    getEventStats,
    getWaitlistRank,
    createReservation,
    confirmReservation,
    cancelReservation,
    createEvent,
    clearEventReservations,
    simulateConcurrentRush,
    runExpirationWorker,
    formatStatus,
    formatTrigger,
    formatCountdown,
    formatTime,
    showToast,
    renderTopbar,
    renderAdminOnlyGuard,
    openAuditDrawer,
    startAutoWorker
  };
})();
