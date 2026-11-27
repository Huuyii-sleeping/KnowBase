// Only loaded by the test child, controlled over its private IPC channel.
class FaultControl {
  rules = [];
  waiting = new Map();
  counts = {};
  constructor(send) {
    this.send = send;
  }
  arm(rule) {
    if (
      !rule ||
      !['pause', 'throw'].includes(rule.action) ||
      typeof rule.point !== 'string'
    )
      throw Error('Invalid fault rule');
    this.rules.push({ ...rule, remaining: rule.times ?? 1 });
  }
  async hit(point, documentId) {
    const key = point + ':' + documentId;
    this.counts[key] = (this.counts[key] || 0) + 1;
    const rule = this.rules.find(
      (r) =>
        r.remaining > 0 &&
        r.point === point &&
        (!r.documentId || r.documentId === documentId),
    );
    if (!rule) return;
    rule.remaining--;
    if (rule.action === 'pause') {
      await new Promise((resolve) => {
        this.waiting.set(rule.id, resolve);
        this.send({ event: 'paused', id: rule.id, point, documentId });
      });
    }
    if (rule.action === 'throw' || rule.throwAfter)
      throw Error('Injected resilience fault: ' + rule.id);
  }
  release(id) {
    const resolve = this.waiting.get(id);
    if (!resolve) throw Error('No paused rule ' + id);
    this.waiting.delete(id);
    resolve();
  }
}
module.exports = { FaultControl };
