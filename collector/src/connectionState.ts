import { EventEmitter } from "events";

export type ConnectionStatus = "disconnected" | "qr_pending" | "connected";

export interface ConnectionState {
  status: ConnectionStatus;
  qr?: string;
}

export const connectionEvents = new EventEmitter();

let state: ConnectionState = { status: "disconnected" };

export function getConnectionState(): ConnectionState {
  return state;
}

export function setConnectionState(next: ConnectionState): void {
  state = next;
  connectionEvents.emit("update", next);
}
