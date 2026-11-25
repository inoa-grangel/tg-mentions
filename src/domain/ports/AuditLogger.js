/**
 * Port interface for tamper-evident security audit logs.
 */
export class AuditLogger {
  async init() {
    throw new Error("Not implemented");
  }
  async log(_action, _details, _onError) {
    throw new Error("Not implemented");
  }
}
