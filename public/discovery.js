(function (root) {
  const stages = [
    { id: 'start', label: '모집 시작', hint: '충원 1자리 이하' },
    { id: 'growing', label: '모이는 중', hint: '여러 자리 충원' },
    { id: 'near', label: '완료 임박', hint: '한 자리 남음' },
    { id: 'full', label: '모집 완료', hint: '모든 파트 충원' },
    { id: 'unset', label: '정원 미설정', hint: '필요한 파트를 정해주세요' },
  ];
  function state(song) {
    let cap = 0, filled = 0;
    for (const [key, n] of Object.entries(song.slots)) {
      cap += n;
      filled += Math.min(n, song.members[key]?.length || 0);
    }
    const left = cap - filled;
    return { cap, filled, left, id: !cap ? 'unset' : !left ? 'full' : left === 1 ? 'near' : filled <= 1 ? 'start' : 'growing' };
  }
  function linkKey(link) {
    try {
      const u = new URL(link);
      const host = u.hostname.toLowerCase();
      if (host === 'youtu.be') return 'youtube:' + u.pathname.slice(1);
      if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
        const id = u.searchParams.get('v') || u.pathname.match(/^\/(?:shorts|embed)\/([^/]+)/)?.[1];
        if (id) return 'youtube:' + id;
      }
      if (host === 'open.spotify.com') {
        const id = u.pathname.match(/\/track\/([^/]+)/)?.[1];
        if (id) return 'spotify:' + id;
      }
      if (host === 'music.apple.com') {
        const id = u.searchParams.get('i') || u.pathname.match(/\/song\/(?:[^/]+\/)?(\d+)/)?.[1];
        if (id) return 'apple:' + id;
      }
      return u.origin + u.pathname;
    } catch { return ''; }
  }
  const api = { stages, state, linkKey };
  if (typeof module !== 'undefined') module.exports = api;
  else root.Discovery = api;
})(globalThis);
