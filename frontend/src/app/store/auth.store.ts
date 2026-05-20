import { create } from 'zustand';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  setTokens(tokens: { accessToken: string; refreshToken: string }): void;
  clear(): void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  refreshToken: null,
  setTokens: (tokens) => set(tokens),
  clear: () => set({ accessToken: null, refreshToken: null })
}));