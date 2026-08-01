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
  acceptTransfer: (sessionId: string) => Promise<void>;
  rejectTransfer: (sessionId: string) => Promise<void>;
  cancelTransfer: (sessionId: string) => Promise<void>;
  pauseTransfer: (sessionId: string) => Promise<void>;
  resumeTransfer: (sessionId: string) => Promise<void>;
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
    set({
      sessions: get().sessions.map(s =>
        s.id === session.id ? session : s
      ),
    });
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

  acceptTransfer: async (sessionId) => {
    await window.lightningshare.acceptTransfer(sessionId);
    get().clearIncomingTransfer(sessionId);
  },

  rejectTransfer: async (sessionId) => {
    await window.lightningshare.rejectTransfer(sessionId);
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
}));
