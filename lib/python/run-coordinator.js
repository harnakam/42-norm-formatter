'use strict';

class RunCoordinator {
  constructor() {
    this.sequence = 0;
    this.current = new Map();
  }

  begin(key, documentVersion) {
    const token = Object.freeze({
      key,
      documentVersion,
      id: ++this.sequence
    });
    this.current.set(key, token);
    return token;
  }

  isCurrent(token) {
    return this.current.get(token.key) === token;
  }

  finish(token) {
    if (this.isCurrent(token)) {
      this.current.delete(token.key);
    }
  }

  cancel(key) {
    this.current.delete(key);
  }
}

module.exports = { RunCoordinator };
