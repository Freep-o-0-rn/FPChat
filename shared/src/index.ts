export type Role = 'owner' | 'member';

export type DeliveryState = 'sent' | 'delivered' | 'read';

export interface ApiError {
  code: string;
  message: string;
}

export interface JwtPayload {
  sub: string;
  sessionId: string;
  nickname: string;
}