export interface RoleHandle {
  /** Stops the role; safe to call once. */
  stop(): Promise<void>;
}
