(() => {
  function chunks(groups) {
    const result = []; let batch = [], size = 0;
    for (const group of groups) {
      if (batch.length && (size + group.source.length > 1200 || /^H[1-3]$/.test(group.block.tagName))) {
        result.push(batch); batch = []; size = 0;
      }
      batch.push(group); size += group.source.length;
    }
    if (batch.length) result.push(batch);
    return result;
  }
  function plan(groups) {
    const first = groups.find(g => g.article && g.block.tagName === 'P') || groups[0];
    return first ? [[[first]], chunks(groups.filter(g => g.article && g !== first)), chunks(groups.filter(g => !g.article && g !== first))] : [];
  }
  async function execute(groups, request, active) {
    for (const phase of plan(groups)) {
      let next = 0;
      async function worker() {while (active() && next < phase.length) await request(phase[next++]);}
      await Promise.all([worker(), worker()]);
      if (!active()) return;
    }
  }
  globalThis.IndexSchedule = {chunks, plan, execute};
})();
