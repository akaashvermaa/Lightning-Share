import { create } from 'zustand';
import { TransferSession, IncomingTransfer, FileInfo } from '../../shared/types';

interface TransferState {
  sessions: TransferSession[];
  incomingTransfers: IncomingTransfer[];

  setSessions: (sessions: TransferSession[]) => void;
  addSession: (session: TransferSession) => void;
  updateSession: (session: TransferSession) => void;
  removeSession: (sessionId: string) => void;
  setIncomingTransfer: (transfer: IncomingTransfer) => void;
  clearIncomingTransfer: (sessionId: string) => void;

  startTransfer: (deviceId: string, files: FileInfo[]) => Promise<string | null>;
  acceptTransfer: (sessionId: string, downloadPath?: string) => Promise<void>;
  rejectTransfer: (sessionId: string) => Promise<void>;
  cancelTransfer: (sessionId: string) => Promise<void>;
  pauseTransfer: (sessionId: string) => Promise<void>;
  resumeTransfer: (sessionId: string) => Promise<void>;
  retryTransfer: (sessionId: string) => Promise<string | null>;
  clearHistory: () => Promise<void>;
}

export const useTransferStore = create<TransferState>((set, get) => ({
  sessions: [],
  incomingTransfers: [],

  setSessions: (sessions) => set({ sessions }),

  addSession: (session) => {
    const exists = get().sessions.some(s => s.id === session.id);
    if (!exists) {
      set({ sessions: [...get().sessions, session] });
    }
  },

  updateSession: (session) => {
    const sessions = get().sessions;
    const exists = sessions.some(s => s.id === session.id);
    if (exists) {
      set({
        sessions: sessions.map(s =>
          s.id === session.id ? session : s
        ),
      });
    } else {
      set({ sessions: [...sessions, session] });
    }
  },

  removeSession: (sessionId) => {
    set({ sessions: get().sessions.filter(s => s.id !== sessionId) });
  },

  setIncomingTransfer: (transfer) => {
    const exists = get().incomingTransfers.some(t => t.sessionId === transfer.sessionId);
    if (!exists) {
      set({ incomingTransfers: [...get().incomingTransfers, transfer] });
    }
  },

  clearIncomingTransfer: (sessionId) => {
    set({
      incomingTransfers: get().incomingTransfers.filter(t => t.sessionId !== sessionId),
    });
  },

  startTransfer: async (deviceId, files) => {
    const result = await window.lightningshare.startTransfer(deviceId, files);
    if (result.success && result.sessionId) {
      const session = await window.lightningshare.getTransferSession(result.sessionId);
      if (session) {
        get().addSession(session);
        return result.sessionId;
      }
    }
    return null;
  },

  acceptTransfer: async (sessionId, downloadPath) => {
    console.log('[STORE] acceptTransfer START', { sessionId, downloadPath });
    try {
      const result = await window.lightningshare.acceptTransfer(sessionId, downloadPath);
      console.log('[STORE] acceptTransfer API result:', result);
    } catch (e: any) {
      console.error('[STORE] acceptTransfer API FAILED:', e?.message || e);
      throw e;
    }
    const incoming = get().incomingTransfers.find(t => t.sessionId === sessionId);
    if (incoming) {
      get().addSession({
        id: sessionId,
        deviceId: incoming.deviceId,
        deviceName: incoming.deviceName,
        deviceIp: '',
        files: incoming.files,
        totalSize: incoming.totalSize,
        transferredBytes: 0,
        status: 'transferring',
        direction: 'receiving',
        speed: 0,
        remainingTime: 0,
        startedAt: Date.now(),
        chunks: [],
        acknowledgedChunks: new Set(),
        lastAcknowledgedByte: 0,
        speedHistory: [],
      });
    }
  },

  rejectTransfer: async (sessionId) => {
    console.log('[STORE] rejectTransfer START', { sessionId });
    try {
      await window.lightningshare.rejectTransfer(sessionId);
      console.log('[STORE] rejectTransfer API OK');
    } catch (e: any) {
      console.error('[STORE] rejectTransfer API FAILED:', e?.message || e);
      throw e;
    }
    get().clearIncomingTransfer(sessionId);
  },

  cancelTransfer: async (sessionId) => {
    await window.lightningshare.cancelTransfer(sessionId);
  },

  pauseTransfer: async (sessionId) => {
    await window.lightningshare.pauseTransfer(sessionId);
  },

  resumeTransfer: async (sessionId) => {
    await window.lightningshare.resumeTransfer(sessionId);
  },

  retryTransfer: async (sessionId) => {
    const session = get().sessions.find(item => item.id === sessionId);
    if (!session || session.direction !== 'sending') return null;
    const result = await window.lightningshare.startTransfer(session.deviceId, session.files);
    if (!result.success || !result.sessionId) return null;
    const nextSession = await window.lightningshare.getTransferSession(result.sessionId);
    if (nextSession) get().addSession(nextSession);
    return result.sessionId;
  },

  clearHistory: async () => {
    await window.lightningshare.clearHistory();
    set({
      sessions: get().sessions.filter(s => !['completed', 'failed', 'cancelled', 'declined'].includes(s.status))
    });
  },
}));
