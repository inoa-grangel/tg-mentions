/**
 * Port interface for OS-backed credential storage.
 */
export class SecretVault {
  getSecret(_account) {
    throw new Error("Not implemented");
  }
  setSecret(_account, _secretValue) {
    throw new Error("Not implemented");
  }
  deleteSecret(_account) {
    throw new Error("Not implemented");
  }
  purgeAll(_accounts) {
    throw new Error("Not implemented");
  }
}
