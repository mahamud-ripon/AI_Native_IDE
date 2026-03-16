export interface User {
  id: string;
  email: string;
  name?: string;
  avatar?: string;
}

export interface CursorPosition {
  line: number;
  column: number;
}

export interface Selection {
  start: CursorPosition;
  end: CursorPosition;
}

export interface UserPresence {
  user: {
    id: string;
    name: string;
    avatar?: string;
  };
  cursor?: CursorPosition;
  selection?: Selection;
  color: string;
  lastActive: number;
}

export interface GatewayMessage {
  type: 'join' | 'leave' | 'update' | 'awareness' | 'sync';
  fileId: string;
  userId: string;
  payload?: any;
}

export interface JoinPayload {
  projectId: string;
  fileId: string;
  userId: string;
  user: User;
}

export interface UpdatePayload {
  fileId: string;
  userId: string;
  update: Uint8Array;
}

export interface AwarenessPayload {
  fileId: string;
  userId: string;
  awareness: UserPresence;
}

export interface LeavePayload {
  fileId: string;
  userId: string;
}
